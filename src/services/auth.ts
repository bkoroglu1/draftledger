import 'server-only';
import { cookies } from 'next/headers';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { groupMembers, people, sessions } from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import type { GroupRole } from '#src/domain/types.ts';
import { hashPassword, randomToken, verifyPassword } from '#src/lib/hash.ts';
import { config } from '#src/lib/config.ts';
import { SESSION_COOKIE, signSessionId, verifySessionCookie } from '#src/lib/session.ts';
import type { Actor } from './rbac.ts';

export type { Actor } from './rbac.ts';

/** Resolves the signed-in actor, or null for anonymous readers. */
export async function getActor(): Promise<Actor | null> {
  const jar = await cookies();
  const sessionId = verifySessionCookie(jar.get(SESSION_COOKIE)?.value);
  if (!sessionId) return null;
  return actorBySessionId(sessionId);
}

export async function actorBySessionId(sessionId: string): Promise<Actor | null> {
  const rows = await db
    .select({ person: people })
    .from(sessions)
    .innerJoin(people, eq(sessions.personId, people.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const person = rows[0]?.person;
  if (!person || !person.isActive || person.isExternal) return null;
  return toActor(person);
}

export async function toActor(person: typeof people.$inferSelect): Promise<Actor> {
  const memberships = await db
    .select({ groupId: groupMembers.groupId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.personId, person.id));

  const groupRoles: Record<string, GroupRole[]> = {};
  for (const m of memberships) {
    const list = groupRoles[m.groupId] ?? [];
    list.push(m.role as GroupRole);
    groupRoles[m.groupId] = list;
  }

  return {
    id: person.id,
    handle: person.handle,
    displayName: person.displayName,
    email: person.email,
    orgRole: person.orgRole,
    groupRoles,
  };
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw appError('unauthenticated', 'Sign in to continue.');
  return actor;
}

export async function login(handle: string, password: string): Promise<string> {
  const rows = await db.select().from(people).where(eq(people.handle, handle)).limit(1);
  const person = rows[0];
  // Always run the KDF so a missing account is not distinguishable by timing.
  const ok = verifyPassword(password, person?.passwordHash ?? hashPassword('placeholder'));
  if (!person || !ok || !person.isActive || person.isExternal) {
    throw appError('unauthenticated', 'Invalid credentials.');
  }

  return startSession(person.id);
}

/** Creates a session and returns the signed cookie value. */
export async function startSession(personId: string): Promise<string> {
  const id = randomToken(24);
  await db.insert(sessions).values({
    id,
    personId,
    expiresAt: new Date(Date.now() + config.security.sessionTtlSeconds * 1000),
  });
  return signSessionId(id);
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const sessionId = verifySessionCookie(jar.get(SESSION_COOKIE)?.value);
  if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
}
