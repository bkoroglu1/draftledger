import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '#src/db/index.ts';
import {
  approvals,
  artifacts,
  documentAuthors,
  documentRelations,
  documents,
  groups,
  namespaces,
  people,
  revisions,
  sections,
} from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import { ARTIFACT_MIME, PARSER_VERSION, RENDERER_VERSION, type CanonicalFormat } from '#src/domain/types.ts';
import { sha256 } from '#src/lib/hash.ts';
import { config } from '#src/lib/config.ts';
import { artifactKey, sourceKey, storage } from '#src/lib/storage.ts';
import { renderRevision, type RenderContext, type RenderResult } from '#src/render/index.ts';
import { requiredSectionDiagnostics, summarizeDiagnostics, type Diagnostic } from '#src/parser/index.ts';
import { recordAudit } from './audit.ts';
import { listPublishedDocumentNumbers, type DocumentRow } from './documents.ts';
import { enqueueJob } from '#src/jobs/queue.ts';
import type { Actor } from './rbac.ts';

/**
 * Working copies are mutable; revisions are immutable snapshots. Rendering is
 * always derived from a revision's source checksum, never from the working copy,
 * so a stored artifact can always be traced back to exactly one source.
 */

export interface SaveWorkingCopyResult {
  version: number;
  updatedAt: Date;
  diagnostics: Diagnostic[];
}

export async function saveWorkingCopy(
  documentId: string,
  source: string,
  expectedVersion: number,
  actor: Actor,
): Promise<SaveWorkingCopyResult> {
  const rows = await db
    .update(documents)
    .set({
      workingSource: source,
      workingSourceVersion: sql`${documents.workingSourceVersion} + 1`,
      workingSourceUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(documents.id, documentId), eq(documents.workingSourceVersion, expectedVersion)))
    .returning({
      version: documents.workingSourceVersion,
      updatedAt: documents.workingSourceUpdatedAt,
      familyKey: documents.familyKey,
      canonicalFormat: documents.canonicalFormat,
    });

  const row = rows[0];
  if (!row) {
    // Someone else saved in between: never silently overwrite their work.
    const current = await db
      .select({ version: documents.workingSourceVersion })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    throw appError(
      'conflict',
      'This draft was changed by someone else while you were editing.',
      { expectedVersion, actualVersion: current[0]?.version ?? null },
    );
  }

  const { diagnostics } = await validateSource(documentId, source, row.canonicalFormat);
  return { version: row.version, updatedAt: row.updatedAt ?? new Date(), diagnostics };
}

export async function validateSource(
  documentId: string,
  source: string,
  format: CanonicalFormat,
): Promise<{ diagnostics: Diagnostic[]; render: RenderResult }> {
  const ctx = await buildRenderContext(documentId);
  const render = renderRevision(source, format, ctx);
  const required = await requiredSectionsFor(documentId);
  const diagnostics = [...render.diagnostics, ...requiredSectionDiagnostics(render.doc, required)];
  return { diagnostics, render };
}

async function requiredSectionsFor(documentId: string): Promise<string[]> {
  const rows = await db
    .select({ ns: namespaces.id })
    .from(documents)
    .leftJoin(namespaces, eq(documents.namespaceId, namespaces.id))
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!rows[0]) return [];
  // Required sections come from the workflow gate configuration.
  const gateRows = await db
    .select({ gates: sql<Array<{ kind: string; sections?: string[] }>>`w.gates` })
    .from(sql`workflows w`)
    .innerJoin(documents, sql`${documents.workflowId} = w.id`)
    .where(eq(documents.id, documentId));
  const gates = gateRows[0]?.gates ?? [];
  return gates.filter((g) => g.kind === 'required-sections').flatMap((g) => g.sections ?? []);
}

export async function buildRenderContext(
  documentId: string,
  tx: DbOrTx = db,
): Promise<RenderContext> {
  const rows = await tx
    .select({
      document: documents,
      namespace: namespaces,
      group: groups,
    })
    .from(documents)
    .leftJoin(namespaces, eq(documents.namespaceId, namespaces.id))
    .leftJoin(groups, eq(documents.groupId, groups.id))
    .where(eq(documents.id, documentId))
    .limit(1);

  const row = rows[0];
  if (!row) throw appError('not_found', 'Document not found.');

  const authorRows = await tx
    .select({
      name: people.displayName,
      affiliation: people.affiliation,
      email: people.email,
      emailVisibility: people.emailVisibility,
      role: documentAuthors.role,
    })
    .from(documentAuthors)
    .innerJoin(people, eq(documentAuthors.personId, people.id))
    .where(eq(documentAuthors.documentId, documentId))
    .orderBy(asc(documentAuthors.position));

  const related = await tx
    .select({ type: documentRelations.type, slug: documents.slug, ref: documentRelations.targetRef })
    .from(documentRelations)
    .leftJoin(documents, eq(documentRelations.targetDocumentId, documents.id))
    .where(eq(documentRelations.sourceDocumentId, documentId));

  const doc = row.document;
  return {
    documentNumber: doc.documentNumber ?? doc.slug,
    documentSlug: doc.slug,
    documentType: doc.type === 'standard' ? 'Standards Document' : titleCase(doc.type),
    status: doc.status,
    standardLevel: titleCase(doc.standardLevel.replace(/-/g, ' ')),
    organization: config.app.orgName,
    brandName: config.app.brandName,
    series: row.namespace?.label ?? config.documents.defaultNamespace,
    date: doc.publishedAt ?? new Date(),
    authors: authorRows.map((a) => ({
      name: a.name,
      organization: a.affiliation ?? undefined,
      email: a.emailVisibility === 'public' ? (a.email ?? undefined) : undefined,
    })),
    obsoletes: related.filter((r) => r.type === 'obsoletes').map((r) => r.slug ?? r.ref ?? '').filter(Boolean),
    updates: related.filter((r) => r.type === 'updates').map((r) => r.slug ?? r.ref ?? '').filter(Boolean),
    baseUrl: config.app.baseUrl,
    knownDocuments: await listPublishedDocumentNumbers(),
  };
}

function titleCase(value: string): string {
  return value.replace(/(^|\s|-)([a-z])/g, (_, p, c: string) => `${p}${c.toUpperCase()}`);
}

export interface CreateRevisionInput {
  documentId: string;
  actor: Actor;
  changeSummary?: string;
  label?: string;
  /** Publication snapshots get a different label scheme. */
  isPublication?: boolean;
  source?: string;
}

export async function createRevision(input: CreateRevisionInput) {
  const docRows = await db.select().from(documents).where(eq(documents.id, input.documentId)).limit(1);
  const doc = docRows[0];
  if (!doc) throw appError('not_found', 'Document not found.');

  const source = input.source ?? doc.workingSource;
  if (!source.trim()) throw appError('validation_failed', 'Cannot snapshot an empty draft.');

  const previous = await db
    .select({ sequence: revisions.sequence, sha: revisions.sourceSha256 })
    .from(revisions)
    .where(eq(revisions.documentId, doc.id))
    .orderBy(desc(revisions.sequence))
    .limit(1);

  const sequence = (previous[0]?.sequence ?? -1) + 1;
  const checksum = sha256(source);
  const label = input.label ?? (input.isPublication ? 'Published 1.0' : String(sequence).padStart(2, '0'));
  const slug = input.isPublication ? `${doc.slug}-${label.replace(/\s+/g, '-')}` : `${doc.slug}-${label}`;

  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(revisions)
      .values({
        documentId: doc.id,
        slug,
        label,
        sequence,
        isCurrent: true,
        isImmutable: true,
        isPublication: Boolean(input.isPublication),
        changeSummary: input.changeSummary ?? null,
        source,
        sourceKind: 'authored',
        sourceStorageKey: sourceKey(slug, checksum, doc.canonicalFormat),
        sourceSha256: checksum,
        canonicalFormat: doc.canonicalFormat,
        parserVersion: PARSER_VERSION,
        rendererVersion: RENDERER_VERSION,
        renderState: 'pending',
        createdBy: input.actor.id,
      })
      .returning();

    const revision = rows[0]!;
    await tx
      .update(revisions)
      .set({ isCurrent: false })
      .where(and(eq(revisions.documentId, doc.id), sql`${revisions.id} <> ${revision.id}`));
    await tx.update(documents).set({ currentRevisionId: revision.id, updatedAt: new Date() }).where(eq(documents.id, doc.id));

    // A new snapshot invalidates approvals bound to an older checksum.
    const staled = await tx
      .update(approvals)
      .set({ isStale: true })
      .where(and(eq(approvals.documentId, doc.id), sql`${approvals.revisionSha256} <> ${checksum}`, eq(approvals.isStale, false)))
      .returning({ id: approvals.id });

    await recordAudit(
      {
        familyKey: doc.familyKey,
        documentId: doc.id,
        revisionId: revision.id,
        entityType: 'revision',
        entityId: revision.id,
        action: 'revision_saved',
        summary: `Revision ${label} created${input.changeSummary ? `: ${input.changeSummary}` : ''}`,
        changes: [{ field: 'sourceSha256', before: previous[0]?.sha ?? null, after: checksum, sensitivity: 'public' }],
        actorId: input.actor.id,
        visibility: 'group',
      },
      tx,
    );

    if (staled.length) {
      await recordAudit(
        {
          familyKey: doc.familyKey,
          documentId: doc.id,
          revisionId: revision.id,
          entityType: 'approval',
          action: 'approval_invalidated',
          summary: `${staled.length} approval(s) became stale because the source changed`,
          actorKind: 'system',
        },
        tx,
      );
    }

    return revision;
  });

  await storage().put(inserted.sourceStorageKey!, source);
  await enqueueJob('render_revision', { revisionId: inserted.id }, `render:${inserted.id}`);
  return inserted;
}

/**
 * Renders a revision and stores every derived artifact. Idempotent: re-running
 * replaces artifacts for the same revision and produces identical checksums.
 */
export async function renderAndPersistRevision(
  revisionId: string,
  tx: DbOrTx = db,
): Promise<RenderResult> {
  const rows = await tx.select().from(revisions).where(eq(revisions.id, revisionId)).limit(1);
  const revision = rows[0];
  if (!revision) throw appError('not_found', 'Revision not found.');

  const ctx = await buildRenderContext(revision.documentId, tx);
  let result: RenderResult;
  try {
    result = renderRevision(revision.source, revision.canonicalFormat, ctx);
  } catch (err) {
    await tx
      .update(revisions)
      .set({ renderState: 'failed', renderError: err instanceof Error ? err.message : String(err) })
      .where(eq(revisions.id, revisionId));
    throw appError('parse_failed', 'Rendering failed.', { cause: String(err) });
  }

  const stored = await Promise.all(
    result.artifacts.map(async (artifact) => {
      const key = artifactKey(revision.slug, result.sourceSha256, artifact.format);
      const meta = await storage().put(key, artifact.data);
      return { artifact, meta };
    }),
  );

  const revisionDocumentId = revision.documentId;
  const persist = async (scope: DbOrTx) => {
    await scope.delete(sections).where(eq(sections.revisionId, revisionId));
    const anchorToId = new Map<string, string>();
    for (const row of result.sections) {
      const inserted = await scope
        .insert(sections)
        .values({
          revisionId,
          parentId: row.parentAnchor ? (anchorToId.get(row.parentAnchor) ?? null) : null,
          number: row.number,
          title: row.title,
          depth: row.depth,
          anchor: row.anchor,
          pageNumber: row.pageNumber,
          sourceStart: row.sourceStart,
          sourceEnd: row.sourceEnd,
          sortOrder: row.sortOrder,
        })
        .returning({ id: sections.id });
      anchorToId.set(row.anchor, inserted[0]!.id);
    }

    await scope.delete(artifacts).where(eq(artifacts.revisionId, revisionId));
    for (const { artifact, meta } of stored) {
      await scope.insert(artifacts).values({
        revisionId,
        format: artifact.format,
        storageKey: meta.storageKey,
        mimeType: ARTIFACT_MIME[artifact.format] ?? artifact.mimeType,
        sha256: meta.sha256,
        byteLength: meta.byteLength,
        parserVersion: result.parserVersion,
        syncStatus: 'generated',
      });
    }

    await scope
      .update(revisions)
      .set({
        renderState: 'rendered',
        renderError: null,
        pages: result.pageCount,
        wordCount: result.wordCount,
      })
      .where(eq(revisions.id, revisionId));

    await scope
      .update(documents)
      .set({ pages: result.pageCount, wordCount: result.wordCount, updatedAt: new Date() })
      .where(eq(documents.id, revisionDocumentId));
  };

  await persist(tx);
  return result;
}

export async function getRevision(revisionId: string) {
  const rows = await db.select().from(revisions).where(eq(revisions.id, revisionId)).limit(1);
  if (!rows[0]) throw appError('not_found', 'Revision not found.');
  return rows[0];
}

export async function getRevisionBySlug(slug: string) {
  const rows = await db.select().from(revisions).where(eq(revisions.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function diagnosticsSummaryFor(documentId: string) {
  const docRows = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  const doc = docRows[0];
  if (!doc) throw appError('not_found', 'Document not found.');
  const { diagnostics } = await validateSource(doc.id, doc.workingSource, doc.canonicalFormat);
  return { diagnostics, summary: summarizeDiagnostics(diagnostics) };
}

export async function markRenderPending(revisionId: string, tx: DbOrTx = db): Promise<void> {
  await tx.update(revisions).set({ renderState: 'pending' }).where(eq(revisions.id, revisionId));
}

export type { DocumentRow };
