import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DraftNav } from '#src/components/DraftNav.tsx';
import { DecisionForm, PublishForm } from '#src/components/PublishPanel.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';
import { evaluateGates, listApprovals } from '#src/services/approvals.ts';
import { canApprove, canPublish } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function PublishPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/drafts/${slug}/publish`);

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;

  let evaluation;
  try {
    evaluation = await evaluateGates(doc.id);
  } catch (err) {
    return (
      <>
        <AppBar actor={actor} />
        <div className="dl-app">
          <DraftNav slug={doc.slug} title={doc.title} status={doc.status} active="publish" />
          <p className="dl-error">{isAppError(err) ? err.message : 'Gates cannot be evaluated yet.'}</p>
          <p>
            <Link href={`/drafts/${doc.slug}/edit`}>Create a revision first</Link>.
          </p>
        </div>
      </>
    );
  }

  const approvals = await listApprovals(doc.id);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <DraftNav slug={doc.slug} title={doc.title} status={doc.status} active="publish" />

        <section className="dl-card">
          <h2>Approval gates</h2>
          <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
            Evaluated against revision <strong>{evaluation.revisionLabel}</strong> ·{' '}
            <span className="dl-mono">{evaluation.revisionSha256.slice(0, 12)}</span>
            {evaluation.staleApprovals ? ` · ${evaluation.staleApprovals} stale approval(s)` : ''}
          </p>
          {evaluation.gates.map((gate) => (
            <div className="dl-gate" key={gate.key} data-satisfied={gate.satisfied}>
              <span className="dl-gate-mark" aria-hidden="true">
                {gate.satisfied ? '✓' : '✗'}
              </span>
              <div style={{ flex: 1 }}>
                <strong>{gate.label}</strong>
                {gate.required ? null : <span className="dl-muted"> (advisory)</span>}
                <div className="dl-muted" style={{ fontSize: '0.8125rem' }}>
                  {gate.satisfied ? 'Satisfied' : 'Not satisfied'} — {gate.detail}
                </div>
                {gate.blockers.length ? (
                  <ul style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
                    {gate.blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                ) : null}
                {gate.approvals.length ? (
                  <ul style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }} className="dl-muted">
                    {gate.approvals.map((a, i) => (
                      <li key={i}>
                        {a.approverName} — {a.decision}
                        {a.isStale ? ' (stale: source changed since)' : ''} on{' '}
                        {a.createdAt.toISOString().slice(0, 10)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ))}
        </section>

        {canApprove(actor, context.acl) ? (
          <DecisionForm
            slug={doc.slug}
            revisionId={evaluation.revisionId}
            gates={evaluation.gates.map((g) => ({ key: g.key, label: g.label }))}
          />
        ) : null}

        {canPublish(actor, context.acl) ? (
          <PublishForm slug={doc.slug} blocked={!evaluation.canPublish} />
        ) : (
          <p className="dl-notice">
            Your role cannot publish in this namespace. A publisher must run the transaction.
          </p>
        )}

        <section className="dl-card">
          <h2>Approval history</h2>
          {approvals.length ? (
            <div className="dl-table-scroll">
              <table className="dl-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Approver</th>
                    <th scope="col">Gate</th>
                    <th scope="col">Decision</th>
                    <th scope="col">Revision</th>
                    <th scope="col">Bound checksum</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((row) => (
                    <tr key={row.approval.id}>
                      <td className="dl-mono">{row.approval.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                      <td>{row.approverName ?? '—'}</td>
                      <td>{row.approval.gateKey}</td>
                      <td>
                        {row.approval.decision}
                        {row.approval.isStale ? <span className="dl-muted"> (stale)</span> : null}
                      </td>
                      <td>{row.revisionLabel}</td>
                      <td className="dl-mono">{row.approval.revisionSha256.slice(0, 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="dl-muted">No decisions recorded yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
