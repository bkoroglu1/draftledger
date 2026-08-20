import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { DIFF_VIEWS, type DiffView as DiffViewMode } from '#src/domain/types.ts';
import { diffText, isDiffView } from '#src/diff/index.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DiffView } from '#src/components/DiffView.tsx';
import { DocumentHeader } from '#src/components/DocumentHeader.tsx';
import { getActor } from '#src/services/auth.ts';
import {
  findFamilyDocuments,
  getDocumentContext,
  listFamilyRevisions,
} from '#src/services/documents.ts';
import { queryHistory } from '#src/services/audit.ts';
import { canSeeRestrictedAudit } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    from?: string;
    to?: string;
    view?: string;
    tab?: string;
    q?: string;
    action?: string;
    sort?: string;
    dir?: string;
    page?: string;
    event?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const actor = await getActor();

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const familyDocs = await findFamilyDocuments(doc.familyKey);
  const familyRevisions = await listFamilyRevisions(doc.familyKey);

  // Default selection: previous revision → current/published revision.
  const defaultTo = familyRevisions[familyRevisions.length - 1]?.slug ?? '';
  const defaultFrom = familyRevisions[familyRevisions.length - 2]?.slug ?? defaultTo;
  const fromSlug = sp.from ?? defaultFrom;
  const toSlug = sp.to ?? defaultTo;
  const mode: DiffViewMode = sp.view && isDiffView(sp.view) ? sp.view : 'side-by-side';

  const before = familyRevisions.find((r) => r.slug === fromSlug);
  const after = familyRevisions.find((r) => r.slug === toSlug);
  const sameRevision = fromSlug === toSlug;
  const diff = before && after && !sameRevision ? diffText(before.source, after.source) : null;

  const tab = sp.tab ?? 'all';
  const documentIds =
    tab === 'all' ? undefined : familyDocs.filter((d) => d.slug === tab).map((d) => d.id);

  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const history = await queryHistory(
    {
      familyKey: doc.familyKey,
      documentIds,
      search: sp.q,
      actions: sp.action ? [sp.action] : undefined,
      sort: (sp.sort as 'date' | 'actor' | 'action') ?? 'date',
      direction: sp.dir === 'asc' ? 'asc' : 'desc',
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    actor,
    canSeeRestrictedAudit(actor, context.acl),
  );

  const totalPages = Math.max(1, Math.ceil(history.total / PAGE_SIZE));
  const baseQuery = (patch: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
    return `/doc/${doc.slug}/history?${qs.toString()}`;
  };

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <DocumentHeader
          slug={doc.slug}
          title={doc.title}
          identifier={doc.documentNumber ?? doc.slug}
          statusLabel={doc.status}
          statusState={doc.status}
          active="history"
        />

        <section className="dl-card" aria-labelledby="diffs-heading">
          <h2 id="diffs-heading">Revision differences</h2>
          <form method="get" className="dl-form-grid">
            <label className="dl-field">
              <span>From revision</span>
              <select name="from" defaultValue={fromSlug}>
                {familyRevisions.map((r) => (
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
                {familyRevisions.map((r) => (
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
              <Link
                className="dl-button"
                href={`/compare?from=${encodeURIComponent(fromSlug)}&to=${encodeURIComponent(toSlug)}&view=${mode}`}
              >
                Open shareable diff
              </Link>
            </div>
          </form>

          {sameRevision ? (
            <p className="dl-notice">Pick two different revisions to see a difference.</p>
          ) : diff && before && after ? (
            <DiffView
              result={diff}
              mode={mode}
              beforeLabel={`${before.documentSlug} ${before.label}`}
              afterLabel={`${after.documentSlug} ${after.label}`}
              beforeText={before.source}
              afterText={after.source}
            />
          ) : (
            <p className="dl-notice">This family has only one revision so far.</p>
          )}
        </section>

        <section className="dl-card" aria-labelledby="events-heading">
          <h2 id="events-heading">Document history</h2>

          <div className="dl-doctabs" role="tablist" aria-label="History scope">
            <Link className="dl-doctab" role="tab" aria-selected={tab === 'all'} href={baseQuery({ tab: 'all', page: undefined })}>
              All events
            </Link>
            {familyDocs.map((d) => (
              <Link
                key={d.id}
                className="dl-doctab"
                role="tab"
                aria-selected={tab === d.slug}
                href={baseQuery({ tab: d.slug, page: undefined })}
              >
                {d.slug}
              </Link>
            ))}
          </div>

          <form method="get" className="dl-actions" role="search">
            <input type="hidden" name="tab" value={tab} />
            <label className="dl-field" style={{ flex: '1 1 16rem' }}>
              <span className="dl-sr-only">Search history</span>
              <input type="search" name="q" defaultValue={sp.q ?? ''} placeholder="Search summary, action or actor" />
            </label>
            <label className="dl-field">
              <span className="dl-sr-only">Action</span>
              <input type="text" name="action" defaultValue={sp.action ?? ''} placeholder="Event key" />
            </label>
            <button className="dl-button" type="submit">
              Filter
            </button>
            <Link className="dl-button" href={`/doc/${doc.slug}/history`}>
              Reset
            </Link>
          </form>

          <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
            {history.total} event(s). Search and filters run server-side across the whole authorized
            history, not just this page.
          </p>

          <div className="dl-table-scroll">
            <table className="dl-table">
              <thead>
                <tr>
                  <th scope="col">
                    <Link href={baseQuery({ sort: 'date', dir: sp.dir === 'asc' ? 'desc' : 'asc' })}>Date</Link>
                  </th>
                  <th scope="col">
                    <Link href={baseQuery({ sort: 'actor', dir: sp.dir === 'asc' ? 'desc' : 'asc' })}>By</Link>
                  </th>
                  <th scope="col">
                    <Link href={baseQuery({ sort: 'action', dir: sp.dir === 'asc' ? 'desc' : 'asc' })}>Action</Link>
                  </th>
                  <th scope="col">Summary</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <tr key={row.id} id={`event-${row.id}`}>
                    <td className="dl-mono" style={{ whiteSpace: 'nowrap' }}>
                      {row.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td>
                      {row.actorHandle ? (
                        <Link href={`/people/${row.actorHandle}`}>{row.actorName}</Link>
                      ) : (
                        <span title="System actor">{row.actorName}</span>
                      )}
                      <br />
                      <span className="dl-muted" style={{ fontSize: '0.75rem' }}>
                        {row.actorKind}
                        {row.origin !== 'local' ? ` · ${row.origin}` : ''}
                      </span>
                    </td>
                    <td>
                      <code className="dl-mono" style={{ fontSize: '0.75rem' }}>
                        {row.action}
                      </code>
                    </td>
                    <td>
                      <details open={sp.event === row.id}>
                        <summary>{row.summary}</summary>
                        <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1rem', fontSize: '0.8125rem' }}>
                          {row.changes.length ? (
                            row.changes.map((c, i) => (
                              <li key={i}>
                                <code className="dl-mono">{c.field}</code>: {format(c.before)} →{' '}
                                {format(c.after)}
                              </li>
                            ))
                          ) : (
                            <li className="dl-muted">No field-level changes recorded.</li>
                          )}
                          <li className="dl-muted">
                            entity: {row.entityType}
                            {row.revisionId ? ` · revision ${row.revisionId.slice(0, 8)}` : ''}
                            {row.correlationId ? ` · job ${row.correlationId}` : ''}
                          </li>
                          <li>
                            <Link href={baseQuery({ event: row.id })}>Permalink to this event</Link>
                          </li>
                        </ul>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="dl-actions">
            {page > 1 ? (
              <Link className="dl-button" href={baseQuery({ page: String(page - 1) })}>
                Previous
              </Link>
            ) : null}
            <span className="dl-muted" style={{ alignSelf: 'center', fontSize: '0.8125rem' }}>
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link className="dl-button" href={baseQuery({ page: String(page + 1) })}>
                Next
              </Link>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  return JSON.stringify(value);
}
