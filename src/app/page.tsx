import Link from 'next/link';
import { config } from '#src/lib/config.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';
import { searchDocuments } from '#src/services/documents.ts';
import type { DocumentOrigin, LifecycleState } from '#src/domain/types.ts';
import { ImportPrompt } from '#src/components/ImportPrompt.tsx';

export const dynamic = 'force-dynamic';

const STATUSES: LifecycleState[] = [
  'drafting',
  'review',
  'changes-requested',
  'approved',
  'published',
  'superseded',
  'withdrawn',
];

/** Entry point: search local identifiers, titles, authors, groups and status. */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; group?: string; author?: string; origin?: string }>;
}) {
  const sp = await searchParams;
  const actor = await getActor();

  const { items, total } = await searchDocuments(
    {
      q: sp.q,
      status: sp.status ? [sp.status as LifecycleState] : undefined,
      groupSlug: sp.group,
      authorHandle: sp.author,
      origin: sp.origin ? [sp.origin as DocumentOrigin] : undefined,
      limit: 50,
    },
    actor,
  );

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">{config.app.brandName}</h1>
        <p className="dl-page-subtitle">
          Local standards, drafts and imported references in the{' '}
          {config.documents.defaultNamespace} namespace.
        </p>

        <form method="get" className="dl-card" role="search">
          <div className="dl-form-grid">
            <label className="dl-field">
              <span>Identifier, title or abstract</span>
              <input
                type="search"
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="TEST-STD-0001, DRAFT-…, or words from the title"
                autoFocus
              />
            </label>
            <label className="dl-field">
              <span>Status</span>
              <select name="status" defaultValue={sp.status ?? ''}>
                <option value="">Any status</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="dl-field">
              <span>Working group</span>
              <input type="text" name="group" defaultValue={sp.group ?? ''} placeholder="group slug" />
            </label>
            <label className="dl-field">
              <span>Author</span>
              <input type="text" name="author" defaultValue={sp.author ?? ''} placeholder="user handle" />
            </label>
          </div>
          <div className="dl-actions">
            <button className="dl-button dl-button-primary" type="submit">
              Search
            </button>
            <Link className="dl-button" href="/">
              Reset
            </Link>
          </div>
        </form>

        <p className="dl-muted">{total} document(s) match.</p>

        {items.length === 0 ? (
          <>
            <p className="dl-notice">
              Nothing here matches that search. Searching never triggers an upstream fetch on its
              own.
            </p>
            <ImportPrompt query={sp.q ?? ''} enabled={config.external.enabled} />
          </>
        ) : (
          <div className="dl-table-scroll">
            <table className="dl-table">
              <thead>
                <tr>
                  <th scope="col">Identifier</th>
                  <th scope="col">Type / status</th>
                  <th scope="col">Title</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="dl-mono">
                      <Link href={`/doc/html/${item.slug}`}>{item.documentNumber ?? item.slug}</Link>
                    </td>
                    <td>
                      {item.type}
                      <br />
                      <span className={`dl-status-chip dl-state-${item.status}`}>{item.status}</span>
                    </td>
                    <td>
                      <Link href={`/doc/${item.slug}`}>{item.title}</Link>
                      {item.abstract ? (
                        <div className="dl-muted" style={{ fontSize: '0.8125rem' }}>
                          {item.abstract.slice(0, 180)}
                          {item.abstract.length > 180 ? '…' : ''}
                        </div>
                      ) : null}
                      {item.groupSlug ? (
                        <div style={{ fontSize: '0.75rem' }}>
                          <Link href={`/groups/${item.groupSlug}`}>{item.groupName}</Link>
                        </div>
                      ) : null}
                    </td>
                    <td className="dl-mono" style={{ whiteSpace: 'nowrap' }}>
                      {(item.publishedAt ?? item.updatedAt).toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
