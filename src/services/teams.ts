import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { documents, groupMembers, groups, people } from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import { CONTACT_POLICIES, GROUP_KINDS, GROUP_ROLES, type GroupRole } from '#src/domain/types.ts';
import { recordAudit } from './audit.ts';
import type { Actor } from './rbac.ts';

/**
 * Group administration. A group's slug is part of its permanent URL, so it is
 * fixed at creation; everything else about a group can be edited freely.
 */

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface TeamRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  description: string | null;
  charter: string | null;
  contactPolicy: string;
  documentCount: number;
  members: Array<{ personId: string; handle: string; displayName: string; role: string }>;
}

export async function listTeams(): Promise<TeamRow[]> {
  const rows = await db.select().from(groups).orderBy(asc(groups.name));
  const members = await db
    .select({
      groupId: groupMembers.groupId,
      role: groupMembers.role,
      personId: people.id,
      handle: people.handle,
      displayName: people.displayName,
    })
    .from(groupMembers)
    .innerJoin(people, eq(groupMembers.personId, people.id))
    .orderBy(asc(people.displayName));
  const counts = await db.select({ groupId: documents.groupId }).from(documents);

  return rows.map((group) => ({
    id: group.id,
    slug: group.slug,
    name: group.name,
    kind: group.kind,
    description: group.description,
    charter: group.charter,
    contactPolicy: group.contactPolicy,
    documentCount: counts.filter((d) => d.groupId === group.id).length,
    members: members
      .filter((m) => m.groupId === group.id)
      .map((m) => ({ personId: m.personId, handle: m.handle, displayName: m.displayName, role: m.role })),
  }));
}

export interface TeamInput {
  name: string;
  kind: string;
  description: string | null;
  charter: string | null;
  contactPolicy: string;
}

function assertTeamInput(input: TeamInput): void {
  if (!input.name.trim()) throw appError('validation_failed', 'A team name is required.');
  if (!GROUP_KINDS.includes(input.kind as (typeof GROUP_KINDS)[number])) {
    throw appError('validation_failed', `Unknown team kind "${input.kind}".`);
  }
  if (!CONTACT_POLICIES.includes(input.contactPolicy as (typeof CONTACT_POLICIES)[number])) {
    throw appError('validation_failed', `Unknown contact policy "${input.contactPolicy}".`);
  }
}

export async function createTeam(slug: string, input: TeamInput, actor: Actor): Promise<string> {
  if (!SLUG_RE.test(slug)) {
    throw appError('validation_failed', 'The slug must be lower-case words joined by hyphens.');
  }
  assertTeamInput(input);
  const clash = (await db.select({ id: groups.id }).from(groups).where(eq(groups.slug, slug)).limit(1))[0];
  if (clash) throw appError('validation_failed', `The slug "${slug}" is already taken.`);

  const inserted = (await db.insert(groups).values({ slug, ...input }).returning({ id: groups.id }))[0]!;
  await recordAudit({
    familyKey: `group:${slug}`,
    entityType: 'group',
    entityId: inserted.id,
    action: 'group_created',
    summary: `Team ${input.name} (${slug}) created`,
    actorId: actor.id,
  });
  return inserted.id;
}

/** The slug is deliberately absent: /groups/<slug> has to keep resolving. */
export async function updateTeam(id: string, input: TeamInput, actor: Actor): Promise<void> {
  assertTeamInput(input);
  const previous = (await db.select().from(groups).where(eq(groups.id, id)).limit(1))[0];
  if (!previous) throw appError('not_found', 'That team does not exist.');

  await db.update(groups).set(input).where(eq(groups.id, id));
  await recordAudit({
    familyKey: `group:${previous.slug}`,
    entityType: 'group',
    entityId: id,
    action: 'group_updated',
    summary: `Team ${input.name} (${previous.slug}) updated`,
    changes: [
      { field: 'name', before: previous.name, after: input.name, sensitivity: 'internal' },
      { field: 'kind', before: previous.kind, after: input.kind, sensitivity: 'internal' },
      { field: 'contactPolicy', before: previous.contactPolicy, after: input.contactPolicy, sensitivity: 'internal' },
    ],
    actorId: actor.id,
  });
}

export async function setMembership(
  groupId: string,
  personId: string,
  role: GroupRole,
  actor: Actor,
): Promise<void> {
  if (!GROUP_ROLES.includes(role)) throw appError('validation_failed', `Unknown group role "${role}".`);
  const group = (await db.select().from(groups).where(eq(groups.id, groupId)).limit(1))[0];
  if (!group) throw appError('not_found', 'That team does not exist.');
  const person = (await db.select().from(people).where(eq(people.id, personId)).limit(1))[0];
  if (!person) throw appError('not_found', 'That person does not exist.');

  const existing = (
    await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, personId), eq(groupMembers.role, role)))
      .limit(1)
  )[0];
  if (existing) throw appError('validation_failed', `${person.displayName} already holds ${role} in this team.`);

  await db.insert(groupMembers).values({ groupId, personId, role });
  await recordAudit({
    familyKey: `group:${group.slug}`,
    entityType: 'group',
    entityId: groupId,
    action: 'group_member_added',
    summary: `${person.displayName} added to ${group.name} as ${role}`,
    actorId: actor.id,
  });
}

export async function removeMembership(
  groupId: string,
  personId: string,
  role: string,
  actor: Actor,
): Promise<void> {
  const group = (await db.select().from(groups).where(eq(groups.id, groupId)).limit(1))[0];
  if (!group) throw appError('not_found', 'That team does not exist.');
  const person = (await db.select().from(people).where(eq(people.id, personId)).limit(1))[0];
  if (!person) throw appError('not_found', 'That person does not exist.');

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.personId, personId), eq(groupMembers.role, role)));

  await recordAudit({
    familyKey: `group:${group.slug}`,
    entityType: 'group',
    entityId: groupId,
    action: 'group_member_removed',
    summary: `${person.displayName} removed from ${group.name} as ${role}`,
    actorId: actor.id,
  });
}
