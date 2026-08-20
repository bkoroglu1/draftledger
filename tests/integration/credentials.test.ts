import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db, pool } from '#src/db/index.ts';
import { credentialTokens, people, sessions } from '#src/db/schema.ts';
import { isAppError } from '#src/domain/errors.ts';
import { verifyPassword } from '#src/lib/hash.ts';
import { toActor } from '#src/services/auth.ts';
import {
  generatePassword,
  issueToken,
  lookupToken,
  pruneTokens,
  redeemToken,
  setPassword,
} from '#src/services/people.ts';
import type { Actor } from '#src/services/rbac.ts';

/** Invite, reset and admin-set credentials. Requires the seeded database. */

let admin: Actor;
let subjectId: string;
const HANDLE = 'credential-fixture';

beforeAll(async () => {
  const adminRow = (await db.select().from(people).where(eq(people.handle, 'admin-1')).limit(1))[0]!;
  admin = await toActor(adminRow);

  // The fixture person is reused across runs: once someone has produced audit
  // events the append-only guard blocks the audit FK's ON DELETE SET NULL, so a
  // person with history can never be deleted. That is exactly why the admin
  // screen deactivates instead of deleting.
  const existing = (await db.select().from(people).where(eq(people.handle, HANDLE)).limit(1))[0];
  if (existing) {
    subjectId = existing.id;
    await db.update(people).set({ isActive: true, passwordHash: null }).where(eq(people.id, subjectId));
    await db.delete(credentialTokens).where(eq(credentialTokens.personId, subjectId));
  } else {
    const inserted = await db
      .insert(people)
      .values({ handle: HANDLE, displayName: 'Credential Fixture', orgRole: 'author' })
      .returning({ id: people.id });
    subjectId = inserted[0]!.id;
  }
});

afterAll(async () => {
  await db.delete(credentialTokens).where(eq(credentialTokens.personId, subjectId));
  await db.delete(sessions).where(eq(sessions.personId, subjectId));
  await db.update(people).set({ isActive: false, passwordHash: null }).where(eq(people.id, subjectId));
  await pool.end();
});

describe('generated credentials', () => {
  it('produces a password that satisfies the policy it enforces', () => {
    const password = generatePassword();
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(new Set([generatePassword(), generatePassword(), generatePassword()]).size).toBe(3);
  });

  it('stores only a hash, never the password itself', async () => {
    await setPassword(subjectId, 'correct horse battery', admin);
    const row = (await db.select().from(people).where(eq(people.id, subjectId)).limit(1))[0]!;
    expect(row.passwordHash).not.toContain('correct horse battery');
    expect(row.passwordHash?.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct horse battery', row.passwordHash)).toBe(true);
  });

  it('rejects a password below the minimum length', async () => {
    await expect(setPassword(subjectId, 'short', admin)).rejects.toSatisfy(
      (err: unknown) => isAppError(err) && /at least 12/.test(err.message),
    );
  });

  it('signs existing sessions out when the password changes', async () => {
    await db.insert(sessions).values({
      id: `test-session-${Date.now()}`,
      personId: subjectId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await setPassword(subjectId, 'another valid password', admin);
    const remaining = await db.select().from(sessions).where(eq(sessions.personId, subjectId));
    expect(remaining).toHaveLength(0);
  });
});

describe('invite and reset links', () => {
  it('stores the token only as a hash', async () => {
    const issued = await issueToken(subjectId, 'invite', admin);
    const rows = await db
      .select()
      .from(credentialTokens)
      .where(and(eq(credentialTokens.personId, subjectId), isNull(credentialTokens.usedAt)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(issued.token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('invalidates the previous link of the same kind when reissued', async () => {
    const first = await issueToken(subjectId, 'invite', admin);
    const second = await issueToken(subjectId, 'invite', admin);

    expect(await lookupToken(first.token)).toBeNull();
    expect(await lookupToken(second.token)).not.toBeNull();
  });

  it('redeems once and refuses the second attempt', async () => {
    const issued = await issueToken(subjectId, 'reset', admin);
    const subject = await redeemToken(issued.token, 'a fresh valid password');
    expect(subject.handle).toBe(HANDLE);

    const row = (await db.select().from(people).where(eq(people.id, subjectId)).limit(1))[0]!;
    expect(verifyPassword('a fresh valid password', row.passwordHash)).toBe(true);

    await expect(redeemToken(issued.token, 'yet another password')).rejects.toSatisfy(
      (err: unknown) => isAppError(err) && /no longer valid/.test(err.message),
    );
  });

  it('refuses an expired link', async () => {
    const issued = await issueToken(subjectId, 'reset', admin);
    await db
      .update(credentialTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(credentialTokens.personId, subjectId), isNull(credentialTokens.usedAt)));

    expect(await lookupToken(issued.token)).toBeNull();
    await expect(redeemToken(issued.token, 'a perfectly fine password')).rejects.toSatisfy(
      (err: unknown) => isAppError(err) && /no longer valid/.test(err.message),
    );
  });

  it('refuses a link for a deactivated account', async () => {
    const issued = await issueToken(subjectId, 'invite', admin);
    await db.update(people).set({ isActive: false }).where(eq(people.id, subjectId));

    expect(await lookupToken(issued.token)).toBeNull();
    await expect(redeemToken(issued.token, 'a perfectly fine password')).rejects.toSatisfy(
      (err: unknown) => isAppError(err) && /cannot sign in/.test(err.message),
    );

    await db.update(people).set({ isActive: true }).where(eq(people.id, subjectId));
  });

  it('rejects an unknown token without leaking whether the account exists', async () => {
    expect(await lookupToken('not-a-real-token')).toBeNull();
    expect(await lookupToken('')).toBeNull();
  });

  it('prunes spent and expired tokens', async () => {
    await issueToken(subjectId, 'invite', admin);
    const removed = await pruneTokens();
    expect(removed).toBeGreaterThan(0);
  });
});
