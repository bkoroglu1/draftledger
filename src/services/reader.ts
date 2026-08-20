import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { artifacts, revisions } from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import type { CitationMode, HtmlizationMode } from '#src/lib/prefs.ts';
import { storage } from '#src/lib/storage.ts';
import {
  buildLinkContext,
  documentFromHtml,
  htmlizePlaintext,
  renderPlaintext,
  renderRevision,
  sanitizeHtml,
  toPlaintextContext,
  type HtmlizedPage,
} from '#src/render/index.ts';
import type { ParsedDocument } from '#src/parser/index.ts';
import { buildRenderContext } from './revisions.ts';

/**
 * Reader render cache.
 *
 * Rendering is derived from the immutable revision source, so the cache key is
 * (revision, parser+renderer version, render mode). Nothing about the request
 * or the viewer influences the output beyond the two render preferences.
 */

interface CacheEntry {
  pages: HtmlizedPage[];
  totalPages: number;
  doc: ParsedDocument;
  storedAt: number;
}

const CACHE_LIMIT = 64;
const cache = new Map<string, CacheEntry>();

function cacheKey(
  revisionId: string,
  parserVersion: string,
  rendererVersion: string,
  htmlization: HtmlizationMode,
  citation: CitationMode,
): string {
  return [revisionId, parserVersion, rendererVersion, htmlization, citation].join('|');
}

function remember(key: string, entry: CacheEntry): CacheEntry {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, entry);
  return entry;
}

export function invalidateReaderCache(revisionId?: string): void {
  if (!revisionId) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${revisionId}|`)) cache.delete(key);
  }
}

export interface ReaderRender {
  pages: HtmlizedPage[];
  totalPages: number;
  doc: ParsedDocument;
  mode: HtmlizationMode;
  /** False when the requested mode has no source artifact for this revision. */
  modeSupported: boolean;
}

export async function renderForReader(
  revisionId: string,
  htmlization: HtmlizationMode,
  citation: CitationMode,
): Promise<ReaderRender> {
  const rows = await db.select().from(revisions).where(eq(revisions.id, revisionId)).limit(1);
  const revision = rows[0];
  if (!revision) throw appError('not_found', 'Revision not found.');

  const supported =
    htmlization === 'htmlize-plaintext' ? true : await hasHtmlArtifact(revisionId);
  const mode: HtmlizationMode = supported ? htmlization : 'htmlize-plaintext';

  const key = cacheKey(revisionId, revision.parserVersion, revision.rendererVersion, mode, citation);
  const cached = cache.get(key);
  if (cached) {
    return { ...cached, mode, modeSupported: supported };
  }

  const ctx = await buildRenderContext(revision.documentId);

  if (mode === 'plaintextify-html') {
    const artifactRows = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.revisionId, revisionId));
    const htmlArtifact = artifactRows.find((a) => a.format === 'html');
    if (!htmlArtifact) throw appError('not_synced', 'No HTML artifact stored for this revision.');
    const raw = (await storage().get(htmlArtifact.storageKey)).toString('utf8');
    const doc = documentFromHtml(sanitizeHtml(raw));
    const plaintext = renderPlaintext(doc, toPlaintextContext(doc, ctx));
    const pages = htmlizePlaintext(plaintext, buildLinkContext(doc, plaintext, ctx, citation));
    const entry = remember(key, {
      pages,
      totalPages: plaintext.totalPages,
      doc,
      storedAt: Date.now(),
    });
    return { ...entry, mode, modeSupported: supported };
  }

  const result = renderRevision(revision.source, revision.canonicalFormat, ctx);
  const pages =
    citation === 'reference-section'
      ? result.pages
      : htmlizePlaintext(
          result.plaintext,
          buildLinkContext(result.doc, result.plaintext, ctx, citation),
        );

  const entry = remember(key, {
    pages,
    totalPages: result.pageCount,
    doc: result.doc,
    storedAt: Date.now(),
  });
  return { ...entry, mode, modeSupported: supported };
}

async function hasHtmlArtifact(revisionId: string): Promise<boolean> {
  const rows = await db.select({ format: artifacts.format }).from(artifacts).where(eq(artifacts.revisionId, revisionId));
  return rows.some((r) => r.format === 'html');
}

export function readerCacheStats(): { entries: number; limit: number } {
  return { entries: cache.size, limit: CACHE_LIMIT };
}
