'use client';

import { useTransition } from 'react';
import { logoutAction } from '#src/app/actions/auth.ts';

export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="dl-button"
      disabled={pending}
      onClick={() => startTransition(() => logoutAction())}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
