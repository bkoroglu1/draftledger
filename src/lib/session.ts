import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';

/**
 * Session cookie handling. The cookie carries an opaque session id plus an
 * HMAC so a tampered value is rejected before it ever reaches the database.
 */

export const SESSION_COOKIE = 'draftledger_session';

export function signSessionId(id: string): string {
  const mac = createHmac('sha256', config.security.sessionSecret).update(id).digest('base64url');
  return `${id}.${mac}`;
}

export function verifySessionCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = createHmac('sha256', config.security.sessionSecret).update(id).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? id : null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: config.app.baseUrl.startsWith('https://'),
  maxAge: config.security.sessionTtlSeconds,
};
