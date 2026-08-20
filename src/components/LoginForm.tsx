'use client';

import { useActionState } from 'react';
import { loginAction } from '#src/app/actions/auth.ts';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, null);

  return (
    <form action={action} className="dl-card">
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      <input type="hidden" name="next" value={next} />
      <label className="dl-field">
        <span>User handle</span>
        <input name="handle" autoComplete="username" required autoFocus />
      </label>
      <label className="dl-field" style={{ marginTop: '0.75rem' }}>
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <div className="dl-actions">
        <button className="dl-button dl-button-primary" type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  );
}
