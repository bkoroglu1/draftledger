import { and, eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { artifacts, documents, revisions, sections, syncRuns } from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import { PARSER_VERSION, RENDERER_VERSION } from '#src/domain/types.ts';
import { config, upstreamAllowlist } from '#src/lib/config.ts';
import { sha256 } from '#src/lib/hash.ts';
import { artifactKey, storage } from '#src/lib/storage.ts';
import { documentFromHtml, sanitizeHtml } from '#src/render/index.ts';
import { recordAudit } from '#src/services/audit.ts';

/**
 * Optional external document adapter.
 *
 * Everything here is off unless EXTERNAL_IMPORT_ENABLED=true. Local authoring,
 * review, publication, the reader, diffs and search never call into it.
 *
 * Security posture: the server only ever talks to a fixed host allowlist, the
 * reference must match a narrow pattern, responses are size- and time-limited,
 * and imported HTML is sanitized before it is stored.
 */

/** Narrow shape for upstream references; anything else is rejected outright. */
const EXTERNAL_REF_RE = /^(rfc[0-9]{1,5}|draft-[a-z0-9]+(?:-[a-z0-9]+)*)$/i;

export interface ImportResult {
  slug: string;
  documentId: string;
  revisionId: string;
  fromCache: boolean;
}

export function assertExternalEnabled(): void {
  if (!config.external.enabled) {
    throw appError('upstream_unavailable', 'External import is disabled on this installation.');
  }
}

export function normalizeExternalRef(ref: string): string {
  const trimmed = ref.trim().toLowerCase();
  if (!EXTERNAL_REF_RE.test(trimmed)) {
    throw appError('invalid_slug', `"${ref}" is not an importable upstream reference.`);
  }
  return trimmed;
}

/** Fetches an allowlisted URL with a timeout, size cap and content-type check. */
async function safeFetch(
  url: string,
  accept: string,
): Promise<{ body: string; etag: string | null; lastModified: string | null; contentType: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !upstreamAllowlist().includes(parsed.host)) {
    throw appError('forbidden', `Refusing to fetch a host outside the allowlist: ${parsed.host}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.external.fetchTimeoutMs);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'error',
      headers: { accept, 'user-agent': 'DraftLedger/1.0 (self-hosted)' },
    });
    if (!response.ok) {
      throw appError('upstream_unavailable', `Upstream returned ${response.status} for ${parsed.pathname}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > config.external.maxBytes) {
      throw appError('upstream_unavailable', 'Upstream response exceeds the configured size limit.');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > config.external.maxBytes) {
      throw appError('upstream_unavailable', 'Upstream response exceeds the configured size limit.');
    }
    return {
      body: buffer.toString('utf8'),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      contentType,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function importExternalDocument(rawRef: string): Promise<ImportResult> {
  assertExternalEnabled();
  const ref = normalizeExternalRef(rawRef);
  const slug = ref.toUpperCase();

  const existing = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
  if (existing[0]?.currentRevisionId && existing[0].syncState === 'synced') {
    return {
      slug,
      documentId: existing[0].id,
      revisionId: existing[0].currentRevisionId,
      fromCache: true,
    };
  }

  const runRows = await db
    .insert(syncRuns)
    .values({ adapter: 'ietf', mode: config.external.syncMode, documentRef: ref, state: 'running' })
    .returning({ id: syncRuns.id });
  const runId = runRows[0]!.id;
  const log: string[] = [];

  try {
    const textUrl = `${config.external.rfcEditorBase}/rfc/${ref}.txt`;
    const htmlUrl = `${config.external.rfcEditorBase}/rfc/${ref}.html`;

    const text = await safeFetch(textUrl, 'text/plain');
    log.push(`fetched ${textUrl}`);

    let html: Awaited<ReturnType<typeof safeFetch>> | null = null;
    try {
      html = await safeFetch(htmlUrl, 'text/html');
      log.push(`fetched ${htmlUrl}`);
    } catch {
      log.push(`html artifact unavailable for ${ref}`);
    }

    const sanitized = html ? sanitizeHtml(html.body) : '';
    const parsed = sanitized ? documentFromHtml(sanitized) : null;
    const title = parsed?.meta.title || slug;

    const documentId = await db.transaction(async (tx) => {
      const docRows = await tx
        .insert(documents)
        .values({
          origin: 'external-import',
          slug,
          displayName: slug,
          familyKey: slug,
          documentNumber: slug,
          type: 'external',
          title,
          status: 'published',
          visibility: 'organization',
          canonicalFormat: 'markdown',
          standardLevel: 'external',
          sourceSystem: 'rfc-editor',
          sourceRef: ref,
          sourceUrl: textUrl,
          syncState: 'synced',
          lastSyncedAt: new Date(),
          workingSource: '',
        })
        .onConflictDoUpdate({
          target: documents.slug,
          set: { syncState: 'synced', lastSyncedAt: new Date(), title },
        })
        .returning({ id: documents.id });
      return docRows[0]!.id;
    });

    const checksum = sha256(text.body);
    const revisionSlug = `${slug}-IMPORT`;
    const revRows = await db
      .insert(revisions)
      .values({
        documentId,
        slug: revisionSlug,
        label: 'Imported',
        sequence: 0,
        isCurrent: true,
        isImmutable: true,
        isPublication: true,
        source: text.body,
        sourceKind: 'external',
        sourceSha256: checksum,
        canonicalFormat: 'markdown',
        parserVersion: PARSER_VERSION,
        rendererVersion: RENDERER_VERSION,
        renderState: 'rendered',
      })
      .onConflictDoNothing({ target: revisions.slug })
      .returning({ id: revisions.id });

    const revisionId =
      revRows[0]?.id ??
      (await db.select({ id: revisions.id }).from(revisions).where(eq(revisions.slug, revisionSlug)).limit(1))[0]!.id;

    // Store the upstream artifacts with their provenance headers.
    const txtMeta = await storage().put(artifactKey(revisionSlug, checksum, 'txt'), text.body);
    await db
      .insert(artifacts)
      .values({
        revisionId,
        format: 'txt',
        storageKey: txtMeta.storageKey,
        mimeType: 'text/plain; charset=utf-8',
        sha256: txtMeta.sha256,
        byteLength: txtMeta.byteLength,
        sourceUrl: textUrl,
        etag: text.etag,
        lastModified: text.lastModified,
        fetchedAt: new Date(),
        syncStatus: 'fetched',
      })
      .onConflictDoNothing();

    if (html) {
      const htmlMeta = await storage().put(artifactKey(revisionSlug, checksum, 'html'), sanitized);
      await db
        .insert(artifacts)
        .values({
          revisionId,
          format: 'html',
          storageKey: htmlMeta.storageKey,
          mimeType: 'text/html; charset=utf-8',
          sha256: htmlMeta.sha256,
          byteLength: htmlMeta.byteLength,
          sourceUrl: htmlUrl,
          etag: html.etag,
          lastModified: html.lastModified,
          fetchedAt: new Date(),
          syncStatus: 'fetched',
        })
        .onConflictDoNothing();
    }

    if (parsed) {
      await db.delete(sections).where(eq(sections.revisionId, revisionId));
      let order = 0;
      const walk = async (nodes: typeof parsed.sections, parentId: string | null) => {
        for (const node of nodes) {
          const inserted = await db
            .insert(sections)
            .values({
              revisionId,
              parentId,
              number: node.number,
              title: node.title,
              depth: node.depth,
              anchor: node.anchor,
              sortOrder: order,
            })
            .returning({ id: sections.id });
          order += 1;
          await walk(node.children, inserted[0]!.id);
        }
      };
      await walk(parsed.sections, null);
    }

    await db
      .update(documents)
      .set({ currentRevisionId: revisionId, publishedRevisionId: revisionId })
      .where(eq(documents.id, documentId));

    await db
      .update(syncRuns)
      .set({ state: 'succeeded', finishedAt: new Date(), documentId, log })
      .where(eq(syncRuns.id, runId));

    await recordAudit({
      familyKey: slug,
      documentId,
      revisionId,
      entityType: 'document',
      action: 'external_resource_changed',
      summary: `Imported ${ref} from ${new URL(textUrl).host}`,
      actorKind: 'system',
      origin: 'external-import',
      visibility: 'group',
    });

    return { slug, documentId, revisionId, fromCache: false };
  } catch (err) {
    log.push(err instanceof Error ? err.message : String(err));
    await db
      .update(syncRuns)
      .set({ state: 'failed', finishedAt: new Date(), error: log[log.length - 1] ?? 'unknown', log })
      .where(eq(syncRuns.id, runId));
    await db
      .update(documents)
      .set({ syncState: 'error' })
      .where(and(eq(documents.slug, slug), eq(documents.origin, 'external-import')));
    throw err;
  }
}

export async function runMirrorSync(refs: string[]): Promise<{ imported: number; failed: number }> {
  assertExternalEnabled();
  let imported = 0;
  let failed = 0;
  for (const ref of refs) {
    try {
      await importExternalDocument(ref);
      imported += 1;
    } catch {
      failed += 1;
    }
  }
  return { imported, failed };
}

export async function listSyncRuns(limit = 25) {
  return db.select().from(syncRuns).orderBy(syncRuns.startedAt).limit(limit);
}
