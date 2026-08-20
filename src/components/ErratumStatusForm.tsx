'use client';

import { useActionState } from 'react';
import { setErratumStatusAction } from '#src/app/actions/errata.ts';

export function ErratumStatusForm({ erratumId, status }: { erratumId: string; status: string }) {
  const [state, action, pending] = useActionState(setErratumStatusAction, null);
  return (
    <form action={action} className="dl-actions">
      <input type="hidden" name="erratumId" value={erratumId} />
      <label className="dl-field">
        <span className="dl-sr-only">Status</span>
        <select name="status" defaultValue={status}>
          <option value="reported">Reported</option>
          <option value="verified">Verified</option>
          <option value="held">Held for update</option>
          <option value="rejected">Rejected</option>
        </select>
      </label>
      <label className="dl-field" style={{ flex: '1 1 14rem' }}>
        <span className="dl-sr-only">Resolution note</span>
        <input type="text" name="resolution" placeholder="Resolution note (optional)" />
      </label>
      <button className="dl-button" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Update status'}
      </button>
      {state?.error ? <span className="dl-error">{state.error}</span> : null}
    </form>
  );
}
