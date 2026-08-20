import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DraftNav } from '#src/components/DraftNav.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext, listRevisions } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

export default async function RevisionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/drafts/${slug}/revisions`);

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const revisions = await listRevisions(doc.id);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <DraftNav slug={doc.slug} title={doc.title} status={doc.status} active="revisions" />
        <p className="dl-notice">
          Revisions are immutable snapshots. The working copy above them can change; a stored
          revision never does, which is what approvals and publications are bound to.
        </p>
        <div className="dl-table-scroll">
          <table className="dl-table">
            <thead>
              <tr>
                <th scope="col">Revision</th>
                <th scope="col">Created</th>
                <th scope="col">By</th>
                <th scope="col">Change summary</th>
                <th scope="col">Checksum</th>
                <th scope="col">Render</th>
                <th scope="col">Read</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((revision) => (
                <tr key={revision.id}>
                  <td>
                    <strong>{revision.label}</strong>
                    {revision.isCurrent ? <span className="dl-muted"> (current)</span> : null}
                    {revision.isPublication ? <span className="dl-muted"> (publication)</span> : null}
                  </td>
                  <td className="dl-mono" style={{ whiteSpace: 'nowrap' }}>
                    {revision.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td>{revision.createdBy ? 'recorded' : 'system'}</td>
                  <td>{revision.changeSummary ?? '—'}</td>
                  <td className="dl-mono">{revision.sourceSha256.slice(0, 12)}</td>
                  <td>
                    {revision.renderState}
                    {revision.renderError ? (
                      <div className="dl-error" style={{ margin: 0 }}>
                        {revision.renderError}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link href={`/doc/html/${revision.slug}`}>Reader</Link>
                    {' · '}
                    <a href={`/artifacts/${revision.slug}/txt`}>txt</a>
                    {' · '}
                    <a href={`/artifacts/${revision.slug}/pdf`}>pdf</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
