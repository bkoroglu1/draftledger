import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { documents, revisions } from '#src/db/schema.ts';
import { isAppError } from '#src/domain/errors.ts';
import { DIFF_VIEWS, type DiffView as DiffViewMode } from '#src/domain/types.ts';
import { diffText, isDiffView } from '#src/diff/index.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DiffView } from '#src/components/DiffView.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

/**
 * Revision comparison. The diff is computed locally; there is no dependency on
 * any external diff service.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; view?: string; ws?: string }>;
}) {
  const { from, to, view, ws } = await searchParams;
  const actor = await getActor();

  if (!from || !to) {
    return (
      <>
        <AppBar actor={actor} />
        <div className="dl-app">
          <h1 className="dl-page-title">Compare revisions</h1>
          <p className="dl-notice">
            Provide <code className="dl-mono">from</code> and <code className="dl-mono">to</code>{' '}
            revision identifiers, for example{' '}
            <code className="dl-mono">/compare?from=DRAFT-TEST-PROTOCOL-00&amp;to=DRAFT-TEST-PROTOCOL-01</code>.
          </p>
        </div>
      </>
    );
  }

  const [before, after] = await Promise.all([loadRevision(from), loadRevision(to)]);
  if (!before || !after) notFound();

  // Authorization is evaluated per revision through its parent document. An
  // unreadable side is reported as "not found" so private drafts stay hidden.
  try {
    await getDocumentContext(before.documentSlug, actor);
    await getDocumentContext(after.documentSlug, actor);
  } catch (err) {
    if (isAppError(err) && (err.code === 'not_found' || err.code === 'forbidden')) notFound();
    throw err;
  }

  const mode: DiffViewMode = view && isDiffView(view) ? view : 'side-by-side';
  const ignoreWhitespace = ws === '1';
  const result = diffText(before.source, after.source, { ignoreWhitespace, context: 3 });

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">Compare revisions</h1>
        <p className="dl-page-subtitle">
          {before.documentSlug} {before.label} → {after.documentSlug} {after.label}
        </p>

        <div className="dl-card">
          <div className="dl-form-grid">
            <div>
              <strong>From</strong>
              <div className="dl-muted" style={{ fontSize: '0.8125rem' }}>
                <Link href={`/doc/html/${before.slug}`}>{before.slug}</Link> ·{' '}
                {before.createdAt.toISOString().slice(0, 10)} ·{' '}
                <span className="dl-mono">{before.sourceSha256.slice(0, 12)}</span>
              </div>
            </div>
            <div>
              <strong>To</strong>
              <div className="dl-muted" style={{ fontSize: '0.8125rem' }}>
                <Link href={`/doc/html/${after.slug}`}>{after.slug}</Link> ·{' '}
                {after.createdAt.toISOString().slice(0, 10)} ·{' '}
                <span className="dl-mono">{after.sourceSha256.slice(0, 12)}</span>
              </div>
            </div>
          </div>

          <div className="dl-actions">
            {DIFF_VIEWS.map((v) => (
              <Link
                key={v}
                className="dl-button"
                aria-pressed={v === mode}
                href={`/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&view=${v}${ignoreWhitespace ? '&ws=1' : ''}`}
              >
                {v.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}
              </Link>
            ))}
            <Link
              className="dl-button"
              aria-pressed={ignoreWhitespace}
              href={`/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&view=${mode}${ignoreWhitespace ? '' : '&ws=1'}`}
              title="Whitespace is meaningful in fixed-width technical text, so this is off by default."
            >
              {ignoreWhitespace ? 'Whitespace hidden' : 'Show whitespace changes'}
            </Link>
          </div>
        </div>

        <DiffView
          result={result}
          mode={mode}
          beforeLabel={`${before.documentSlug} ${before.label}`}
          afterLabel={`${after.documentSlug} ${after.label}`}
          beforeText={before.source}
          afterText={after.source}
        />
      </div>
    </>
  );
}

async function loadRevision(slug: string) {
  const rows = await db
    .select({
      slug: revisions.slug,
      label: revisions.label,
      source: revisions.source,
      sourceSha256: revisions.sourceSha256,
      createdAt: revisions.createdAt,
      documentSlug: documents.slug,
    })
    .from(revisions)
    .innerJoin(documents, eq(revisions.documentId, documents.id))
    .where(eq(revisions.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}
