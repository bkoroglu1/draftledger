'use client';

import { useActionState } from 'react';
import { redeemAction } from '#src/app/actions/redeem.ts';

export function RedeemForm({ token, kind }: { token: string; kind: 'invite' | 'reset' }) {
  const [state, action, pending] = useActionState(redeemAction, null);

  return (
    <form action={action} className="dl-card">
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value={kind} />
      <label className="dl-field">
        <span>New password (12 characters minimum)</span>
        <input name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus />
      </label>
      <label className="dl-field" style={{ marginTop: '0.75rem' }}>
        <span>Confirm password</span>
        <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      <div className="dl-actions">
        <button className="dl-button dl-button-primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Set password and sign in'}
        </button>
      </div>
    </form>
  );
}
