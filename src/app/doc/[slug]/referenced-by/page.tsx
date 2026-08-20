import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext, listRelations } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function ReferencedByPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const actor = await getActor();

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const inbound = (await listRelations(doc.id)).filter((r) => r.direction === 'inbound');
  const page = Math.max(1, Number(pageParam ?? '1') || 1);
  const total = Math.max(1, Math.ceil(inbound.length / PAGE_SIZE));
  const slice = inbound.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">Referenced by — {doc.title}</h1>
        <p className="dl-page-subtitle">
          {doc.documentNumber ?? doc.slug} · <Link href={`/doc/${doc.slug}`}>Back to status</Link>
        </p>

        {slice.length ? (
          <div className="dl-table-scroll">
            <table className="dl-table">
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Relation</th>
                  <th scope="col">Title</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => (
                  <tr key={`${r.type}-${r.targetSlug}`}>
                    <td>
                      <Link href={`/doc/html/${r.targetSlug}`}>{r.targetNumber ?? r.targetSlug}</Link>
                    </td>
                    <td>
                      <code className="dl-mono">{r.type}</code>
                    </td>
                    <td>{r.targetTitle ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="dl-notice">No local document references this one yet.</p>
        )}

        <div className="dl-actions">
          {page > 1 ? (
            <Link className="dl-button" href={`/doc/${doc.slug}/referenced-by?page=${page - 1}`}>
              Previous
            </Link>
          ) : null}
          <span className="dl-muted" style={{ alignSelf: 'center' }}>
            Page {page} of {total}
          </span>
          {page < total ? (
            <Link className="dl-button" href={`/doc/${doc.slug}/referenced-by?page=${page + 1}`}>
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}
