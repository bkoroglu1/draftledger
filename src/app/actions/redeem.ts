'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { SESSION_COOKIE, sessionCookieOptions } from '#src/lib/session.ts';
import { startSession } from '#src/services/auth.ts';
import { redeemToken } from '#src/services/people.ts';

type State = { error?: string } | null;

/**
 * Consumes an invite or reset link. On success the person is signed in with a
 * fresh session — every earlier session was dropped by the redeem itself.
 */
export async function redeemAction(_prev: State, formData: FormData): Promise<State> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password !== confirm) return { error: 'The two passwords do not match.' };

  try {
    const subject = await redeemToken(token, password);
    const cookieValue = await startSession(subject.personId);
    const jar = await cookies();
    jar.set(SESSION_COOKIE, cookieValue, sessionCookieOptions);
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'That link could not be used.' };
  }

  redirect('/workspace');
}
