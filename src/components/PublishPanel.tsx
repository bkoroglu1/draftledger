'use client';

import { useActionState } from 'react';
import { decideAction, publishAction } from '#src/app/actions/drafts.ts';

export function DecisionForm({
  slug,
  revisionId,
  gates,
}: {
  slug: string;
  revisionId: string;
  gates: Array<{ key: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(decideAction, null);
  return (
    <form action={action} className="dl-card">
      <h2>Record an approval decision</h2>
      <p className="dl-muted">
        The decision is bound to the current revision checksum. If the source changes afterwards the
        approval goes stale automatically and cannot satisfy the gate again.
      </p>
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      {state?.message ? <p className="dl-notice">{state.message}</p> : null}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <div className="dl-actions">
        <label className="dl-field">
          <span className="dl-sr-only">Gate</span>
          <select name="gateKey">
            {gates.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dl-field">
          <span className="dl-sr-only">Decision</span>
          <select name="decision" defaultValue="approved">
            <option value="approved">Approve</option>
            <option value="rejected">Reject</option>
          </select>
        </label>
        <label className="dl-field" style={{ flex: '1 1 16rem' }}>
          <span className="dl-sr-only">Note</span>
          <input name="note" placeholder="Decision note (optional)" />
        </label>
        <button className="dl-button" type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Record decision'}
        </button>
      </div>
    </form>
  );
}

export function PublishForm({ slug, blocked }: { slug: string; blocked: boolean }) {
  const [state, action, pending] = useActionState(publishAction, null);
  return (
    <form action={action} className="dl-card">
      <h2>Publish</h2>
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      {state?.message ? <p className="dl-notice">{state.message}</p> : null}
      <p className="dl-muted">
        Publication is one atomic transaction: gates are re-checked, the number is allocated, the
        source snapshot is locked, every artifact is generated and only then does the document become
        visible as published.
      </p>
      <input type="hidden" name="slug" value={slug} />
      <div className="dl-actions">
        <button className="dl-button dl-button-primary" type="submit" disabled={pending || blocked}>
          {pending ? 'Queueing…' : blocked ? 'Blocked by unmet gates' : 'Publish this revision'}
        </button>
      </div>
    </form>
  );
}
