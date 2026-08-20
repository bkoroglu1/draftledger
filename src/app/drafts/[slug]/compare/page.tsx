import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { DIFF_VIEWS, type DiffView as DiffViewMode } from '#src/domain/types.ts';
import { diffText, isDiffView } from '#src/diff/index.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DiffView } from '#src/components/DiffView.tsx';
import { DraftNav } from '#src/components/DraftNav.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext, listFamilyRevisions } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

export default async function DraftComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; view?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/drafts/${slug}/compare`);

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const revisions = await listFamilyRevisions(doc.familyKey);
  const defaultTo = revisions[revisions.length - 1]?.slug ?? '';
  const defaultFrom = revisions[revisions.length - 2]?.slug ?? defaultTo;
  const fromSlug = sp.from ?? defaultFrom;
  const toSlug = sp.to ?? defaultTo;
  const mode: DiffViewMode = sp.view && isDiffView(sp.view) ? sp.view : 'side-by-side';

  const before = revisions.find((r) => r.slug === fromSlug);
  const after = revisions.find((r) => r.slug === toSlug);
  const diff = before && after && fromSlug !== toSlug ? diffText(before.source, after.source) : null;

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <DraftNav slug={doc.slug} title={doc.title} status={doc.status} active="compare" />

        <form method="get" className="dl-card dl-form-grid">
          <label className="dl-field">
            <span>From revision</span>
            <select name="from" defaultValue={fromSlug}>
              {revisions.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.documentSlug} {r.label} · {r.createdAt.toISOString().slice(0, 10)} ·{' '}
                  {r.sourceSha256.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="dl-field">
            <span>To revision</span>
            <select name="to" defaultValue={toSlug}>
              {revisions.map((r) => (
                <option key={r.slug} value={r.slug} disabled={r.slug === fromSlug}>
                  {r.documentSlug} {r.label} · {r.createdAt.toISOString().slice(0, 10)} ·{' '}
                  {r.sourceSha256.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="dl-field">
            <span>View</span>
            <select name="view" defaultValue={mode}>
              {DIFF_VIEWS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button className="dl-button dl-button-primary" type="submit">
              Compare
            </button>{' '}
            <Link className="dl-button" href={`/compare?from=${fromSlug}&to=${toSlug}&view=${mode}`}>
              Shareable link
            </Link>
          </div>
        </form>

        {diff && before && after ? (
          <DiffView
            result={diff}
            mode={mode}
            beforeLabel={`${before.documentSlug} ${before.label}`}
            afterLabel={`${after.documentSlug} ${after.label}`}
            beforeText={before.source}
            afterText={after.source}
          />
        ) : (
          <p className="dl-notice">Select two different revisions to compare.</p>
        )}
      </div>
    </>
  );
}
