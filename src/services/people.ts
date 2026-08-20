import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '#src/db/index.ts';
import { credentialTokens, groupMembers, groups, people, sessions } from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import { config } from '#src/lib/config.ts';
import { hashPassword, sha256 } from '#src/lib/hash.ts';
import { recordAudit } from './audit.ts';
import type { Actor } from './rbac.ts';

/**
 * Person and credential administration. Two rules shape this module:
 * a plaintext password or token exists only in the response that creates it,
 * and every credential change is auditable without the secret reaching the log.
 */

export type TokenKind = 'invite' | 'reset';

/** Word-shaped so it survives being read aloud or copied by hand. */
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function generatePassword(length = 20): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += PASSWORD_ALPHABET[bytes[i]! % PASSWORD_ALPHABET.length];
    if ((i + 1) % 5 === 0 && i + 1 < length) out += '-';
  }
  return out;
}

/** 256 bits, URL-safe. Only its hash is ever stored. */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenLink(kind: TokenKind, token: string): string {
  const base = config.app.baseUrl.replace(/\/+$/, '');
  return `${base}/${kind === 'invite' ? 'invite' : 'reset'}/${token}`;
}

function ttlFor(kind: TokenKind): number {
  return kind === 'invite' ? config.security.inviteTtlSeconds : config.security.resetTtlSeconds;
}

export interface IssuedToken {
  token: string;
  link: string;
  expiresAt: Date;
}

/**
 * Issues a link and invalidates any outstanding one of the same kind, so a
 * reissue cannot leave two working links behind.
 */
export async function issueToken(
  personId: string,
  kind: TokenKind,
  actor: Actor,
  tx: DbOrTx = db,
): Promise<IssuedToken> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlFor(kind) * 1000);

  await tx
    .update(credentialTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(credentialTokens.personId, personId),
        eq(credentialTokens.kind, kind),
        isNull(credentialTokens.usedAt),
      ),
    );

  await tx.insert(credentialTokens).values({
    personId,
    kind,
    tokenHash: sha256(token),
    expiresAt,
    createdBy: actor.id,
  });

  return { token, link: tokenLink(kind, token), expiresAt };
}

export interface TokenSubject {
  tokenId: string;
  personId: string;
  handle: string;
  displayName: string;
  kind: TokenKind;
}

/** Resolves a raw token without consuming it. Returns null for anything unusable. */
export async function lookupToken(token: string): Promise<TokenSubject | null> {
  if (!token) return null;
  const rows = await db
    .select({ token: credentialTokens, person: people })
    .from(credentialTokens)
    .innerJoin(people, eq(credentialTokens.personId, people.id))
    .where(eq(credentialTokens.tokenHash, sha256(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.token.usedAt) return null;
  if (row.token.expiresAt.getTime() <= Date.now()) return null;
  if (!row.person.isActive || row.person.isExternal) return null;

  return {
    tokenId: row.token.id,
    personId: row.person.id,
    handle: row.person.handle,
    displayName: row.person.displayName,
    kind: row.token.kind as TokenKind,
  };
}

/**
 * Consumes a token and sets the password in one transaction. Existing sessions
 * are dropped: whoever forced the reset should not keep a live session.
 */
export async function redeemToken(token: string, password: string): Promise<TokenSubject> {
  assertPasswordPolicy(password);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ token: credentialTokens, person: people })
      .from(credentialTokens)
      .innerJoin(people, eq(credentialTokens.personId, people.id))
      .where(eq(credentialTokens.tokenHash, sha256(token)))
      .for('update')
      .limit(1);

    const row = rows[0];
    if (!row || row.token.usedAt || row.token.expiresAt.getTime() <= Date.now()) {
      throw appError('validation_failed', 'This link is no longer valid. Ask an administrator for a new one.');
    }
    if (!row.person.isActive || row.person.isExternal) {
      throw appError('forbidden', 'This account cannot sign in.');
    }

    await tx
      .update(credentialTokens)
      .set({ usedAt: new Date() })
      .where(eq(credentialTokens.id, row.token.id));
    await tx.update(people).set({ passwordHash: hashPassword(password) }).where(eq(people.id, row.person.id));
    await tx.delete(sessions).where(eq(sessions.personId, row.person.id));

    await recordAudit(
      {
        familyKey: `person:${row.person.handle}`,
        entityType: 'person',
        entityId: row.person.id,
        action: row.token.kind === 'invite' ? 'invite_redeemed' : 'password_reset_redeemed',
        summary: `${row.person.displayName} set a password from a ${row.token.kind} link`,
        actorId: row.person.id,
        visibility: 'restricted',
      },
      tx,
    );

    return {
      tokenId: row.token.id,
      personId: row.person.id,
      handle: row.person.handle,
      displayName: row.person.displayName,
      kind: row.token.kind as TokenKind,
    };
  });
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < 12) {
    throw appError('validation_failed', 'A password must be at least 12 characters long.');
  }
  if (password.length > 200) {
    throw appError('validation_failed', 'A password must be at most 200 characters long.');
  }
}

/** Admin-set password. Also drops sessions, for the same reason as a redeem. */
export async function setPassword(personId: string, password: string, actor: Actor): Promise<void> {
  assertPasswordPolicy(password);
  const person = (await db.select().from(people).where(eq(people.id, personId)).limit(1))[0];
  if (!person) throw appError('not_found', 'That person does not exist.');
  if (person.isExternal) throw appError('validation_failed', 'External identities cannot authenticate.');

  await db.transaction(async (tx) => {
    await tx.update(people).set({ passwordHash: hashPassword(password) }).where(eq(people.id, personId));
    await tx.delete(sessions).where(eq(sessions.personId, personId));
    await recordAudit(
      {
        familyKey: `person:${person.handle}`,
        entityType: 'person',
        entityId: personId,
        action: 'password_set',
        summary: `An administrator set the password for ${person.displayName}`,
        // `password` in the field name makes recordAudit redact it automatically.
        changes: [{ field: 'password', before: null, after: null, sensitivity: 'restricted' }],
        actorId: actor.id,
        visibility: 'restricted',
      },
      tx,
    );
  });
}

export interface PersonRow {
  id: string;
  handle: string;
  displayName: string;
  email: string | null;
  emailVisibility: string;
  affiliation: string | null;
  orgRole: string;
  isActive: boolean;
  isExternal: boolean;
  hasPassword: boolean;
  groups: Array<{ slug: string; name: string; role: string }>;
}

export async function listPeople(): Promise<PersonRow[]> {
  const rows = await db.select().from(people).orderBy(asc(people.displayName));
  const memberships = await db
    .select({ personId: groupMembers.personId, role: groupMembers.role, slug: groups.slug, name: groups.name })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id));

  return rows.map((person) => ({
    id: person.id,
    handle: person.handle,
    displayName: person.displayName,
    email: person.email,
    emailVisibility: person.emailVisibility,
    affiliation: person.affiliation,
    orgRole: person.orgRole,
    isActive: person.isActive,
    isExternal: person.isExternal,
    hasPassword: Boolean(person.passwordHash),
    groups: memberships
      .filter((m) => m.personId === person.id)
      .map((m) => ({ slug: m.slug, name: m.name, role: m.role })),
  }));
}

/** Expired and consumed tokens are of no further use; keep the table small. */
export async function pruneTokens(): Promise<number> {
  const result = await db
    .delete(credentialTokens)
    .where(sql`${credentialTokens.usedAt} is not null or ${credentialTokens.expiresAt} < now()`);
  return result.rowCount ?? 0;
}
