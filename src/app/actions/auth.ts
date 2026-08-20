'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { SESSION_COOKIE, sessionCookieOptions } from '#src/lib/session.ts';
import { login, logout } from '#src/services/auth.ts';

export async function loginAction(_prev: { error?: string } | null, formData: FormData) {
  const handle = String(formData.get('handle') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/workspace');

  try {
    const cookieValue = await login(handle, password);
    const jar = await cookies();
    jar.set(SESSION_COOKIE, cookieValue, sessionCookieOptions);
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Sign in failed.' };
  }
  redirect(next.startsWith('/') ? next : '/workspace');
}

export async function logoutAction() {
  await logout();
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect('/');
}
