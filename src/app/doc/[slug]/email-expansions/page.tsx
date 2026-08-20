import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DocumentHeader } from '#src/components/DocumentHeader.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';
import {
  expandRecipients,
  listEventCatalog,
  namespaceKeyFor,
  type ExpandedRecipient,
  type ExpansionResult,
} from '#src/services/notifications.ts';

export const dynamic = 'force-dynamic';

/**
 * Explains, per event, who a notification would reach and why. This screen
 * never sends anything: it computes the expansion from the effective policy.
 */
export default async function EmailExpansionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  const { slug } = await params;
  const { q, sort } = await searchParams;
  const actor = await getActor();

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const subject = await namespaceKeyFor(doc.id);
  const catalog = await listEventCatalog();

  const results: ExpansionResult[] = [];
  for (const event of catalog) {
    results.push(await expandRecipients(event.key, subject, context.acl, actor));
  }

  const term = (q ?? '').trim().toLowerCase();
  const filtered = term
    ? results.filter(
        (r) =>
          r.eventKey.toLowerCase().includes(term) ||
          r.eventLabel.toLowerCase().includes(term) ||
          [...r.to, ...r.cc].some(
            (p) =>
              p.displayName.toLowerCase().includes(term) ||
              p.reasons.some((reason) => reason.selector.toLowerCase().includes(term)),
          ),
      )
    : results;

  const sorted = [...filtered].sort((a, b) =>
    sort === 'recipients' ? b.to.length - a.to.length : a.eventKey.localeCompare(b.eventKey),
  );

  const addressesVisible = results[0]?.addressesVisible ?? false;

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
          active="email-expansions"
        />

        <p className="dl-notice">
          This table shows how each document event expands into recipients under the currently
          effective policy (global → namespace → group → document). Opening a row explains why every
          recipient is included. Nothing on this page sends a message.
          {addressesVisible ? null : ' You are not permitted to see delivery addresses, so only display names are shown.'}
        </p>

        <form className="dl-actions" method="get" role="search">
          <label className="dl-field" style={{ flex: '1 1 18rem' }}>
            <span className="dl-sr-only">Search events, roles or people</span>
            <input type="search" name="q" defaultValue={q ?? ''} placeholder="Search event, selector or person" />
          </label>
          <label className="dl-field">
            <span className="dl-sr-only">Sort</span>
            <select name="sort" defaultValue={sort ?? 'event'}>
              <option value="event">Sort by event key</option>
              <option value="recipients">Sort by recipient count</option>
            </select>
          </label>
          <button className="dl-button" type="submit">
            Apply
          </button>
          <Link className="dl-button" href={`/doc/${doc.slug}/email-expansions`}>
            Reset
          </Link>
        </form>

        <div className="dl-table-scroll">
          <table className="dl-table">
            <caption className="dl-sr-only">
              Notification events with their computed To and Cc recipients.
            </caption>
            <thead>
              <tr>
                <th scope="col">Mail trigger</th>
                <th scope="col">Channel</th>
                <th scope="col">To</th>
                <th scope="col">Cc</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((result) => (
                <tr key={result.eventKey}>
                  <td>
                    <strong>{result.eventLabel}</strong>
                    <br />
                    <code className="dl-mono" style={{ fontSize: '0.75rem' }}>
                      {result.eventKey}
                    </code>
                    {result.warnings.length ? (
                      <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1rem' }}>
                        {result.warnings.map((w, i) => (
                          <li key={i} className="dl-muted" style={{ fontSize: '0.75rem' }}>
                            ⚠ {w.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td>{result.channel}</td>
                  <td>
                    <RecipientCell
                      recipients={result.to}
                      addressesVisible={result.addressesVisible}
                      eventKey={result.eventKey}
                      kind="to"
                    />
                  </td>
                  <td>
                    <RecipientCell
                      recipients={result.cc}
                      addressesVisible={result.addressesVisible}
                      eventKey={result.eventKey}
                      kind="cc"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.some((r) => r.suppressed.length) ? (
          <section className="dl-card">
            <h2>Suppressed recipients</h2>
            <ul>
              {sorted.flatMap((r) =>
                r.suppressed.map((s) => (
                  <li key={`${r.eventKey}-${s.key}`}>
                    <code className="dl-mono">{r.eventKey}</code> — {s.displayName}: {s.reason}
                  </li>
                )),
              )}
            </ul>
          </section>
        ) : null}

        <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
          Policies are managed at <Link href="/admin/notification-policies">/admin/notification-policies</Link>.
        </p>
      </div>
    </>
  );
}

function RecipientCell({
  recipients,
  addressesVisible,
  eventKey,
  kind,
}: {
  recipients: ExpandedRecipient[];
  addressesVisible: boolean;
  eventKey: string;
  kind: 'to' | 'cc';
}) {
  if (!recipients.length) return <span className="dl-muted">—</span>;
  const summary = addressesVisible
    ? recipients.map((r) => r.displayName).join(', ')
    : `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`;

  return (
    <details>
      <summary aria-label={`${kind} recipients for ${eventKey}`}>{summary}</summary>
      <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1rem' }}>
        {recipients.map((r) => (
          <li key={r.key} style={{ marginBottom: '0.25rem' }}>
            <strong>{r.displayName}</strong>
            {addressesVisible && r.address ? (
              <span className="dl-mono dl-muted"> &lt;{r.address}&gt;</span>
            ) : null}
            <ul style={{ margin: 0, paddingLeft: '1rem' }}>
              {r.reasons.map((reason, i) => (
                <li key={i} className="dl-muted" style={{ fontSize: '0.75rem' }}>
                  included as <code className="dl-mono">{reason.selector}</code> ({reason.role}) by the{' '}
                  {reason.scope} policy
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}
