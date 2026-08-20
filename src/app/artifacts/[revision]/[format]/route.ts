import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { artifacts, documents, revisions } from '#src/db/schema.ts';
import { appError, httpStatusFor, isAppError } from '#src/domain/errors.ts';
import { storage } from '#src/lib/storage.ts';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

const DOWNLOAD_FORMATS = new Set(['pdf', 'xml', 'markdown']);

/**
 * Serves a stored artifact. Access is checked against the parent document, the
 * bytes come from artifact storage, and nothing is proxied from upstream.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ revision: string; format: string }> },
) {
  const { revision: revisionSlug, format } = await params;
  try {
    const actor = await getActor();

    const rows = await db
      .select({
        artifact: artifacts,
        documentSlug: documents.slug,
        revisionLabel: revisions.label,
      })
      .from(artifacts)
      .innerJoin(revisions, eq(artifacts.revisionId, revisions.id))
      .innerJoin(documents, eq(revisions.documentId, documents.id))
      .where(eq(revisions.slug, decodeURIComponent(revisionSlug)))
      .orderBy(artifacts.format);

    const row = rows.find((r) => r.artifact.format === format);
    if (!row) {
      throw appError('not_found', `No ${format} artifact stored for ${revisionSlug}.`);
    }

    // Authorization is inherited from the document that owns the revision.
    await getDocumentContext(row.documentSlug, actor);

    let bytes: Buffer;
    try {
      bytes = await storage().get(row.artifact.storageKey);
    } catch {
      // The row exists but the blob is gone — a restore that brought the
      // database back ahead of the artifact volume, for example.
      throw appError(
        'not_synced',
        `The ${format} artifact for ${revisionSlug} is recorded but missing from storage. ` +
          'Restore the artifact volume, or re-render the revision.',
      );
    }
    const disposition = DOWNLOAD_FORMATS.has(format) ? 'attachment' : 'inline';
    const extension = format === 'markdown' ? 'md' : format === 'bibtex' ? 'bib' : format;

    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': row.artifact.mimeType,
        'content-length': String(row.artifact.byteLength),
        'content-disposition': `${disposition}; filename="${revisionSlug}.${extension}"`,
        etag: `"${row.artifact.sha256}"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=300',
      },
    });
  } catch (err) {
    return Response.json(
      isAppError(err) ? err.toJSON() : { error: 'internal', message: 'Unexpected failure' },
      { status: httpStatusFor(err) },
    );
  }
}
