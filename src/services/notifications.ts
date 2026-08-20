import { and, asc, desc, eq, inArray, or, isNull } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import {
  documentAuthors,
  documentWatchers,
  documents,
  groupMembers,
  groups,
  namespaces,
  notificationDeliveries,
  notificationEvents,
  notificationExpansions,
  notificationPolicies,
  people,
} from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import { DEFAULT_EVENT_CATALOG } from '#src/domain/types.ts';
import { canSeeRecipientAddresses, type Actor, type DocumentAcl } from './rbac.ts';

/**
 * Notification recipient expansion.
 *
 * The Email/Notification expansions screen answers one question: when event X
 * happens on this document, who is notified and *why*. Policies are merged in
 * global -> namespace -> group -> document order; every recipient records the
 * selector and policy that pulled it in, and addresses are only revealed to
 * viewers allowed to see them.
 */

export const SCOPE_ORDER = ['global', 'namespace', 'group', 'document'] as const;
export type PolicyScope = (typeof SCOPE_ORDER)[number];

export interface PolicyRef {
  id: string;
  scope: PolicyScope;
  scopeRef: string | null;
  precedence: number;
  version: number;
  enabled: boolean;
}

export interface ExpandedRecipient {
  /** Stable identity so duplicates across selectors collapse to one row. */
  key: string;
  displayName: string;
  /** Null unless the viewer may see delivery addresses. */
  address: string | null;
  kind: 'person' | 'group';
  /** All selectors that pulled this recipient in, with their policy. */
  reasons: Array<{ selector: string; policyId: string; scope: PolicyScope; role: string }>;
}

export interface ExpansionWarning {
  code:
    | 'event_disabled'
    | 'no_policy'
    | 'empty_group'
    | 'missing_address'
    | 'unknown_selector'
    | 'channel_unconfigured';
  message: string;
}

export interface ExpansionResult {
  eventKey: string;
  eventLabel: string;
  channel: string;
  enabled: boolean;
  to: ExpandedRecipient[];
  cc: ExpandedRecipient[];
  suppressed: Array<ExpandedRecipient & { reason: string }>;
  policies: PolicyRef[];
  warnings: ExpansionWarning[];
  /** True when the viewer is allowed to see real delivery addresses. */
  addressesVisible: boolean;
}

export interface ExpansionSubject {
  documentId: string;
  namespaceKey: string | null;
  groupSlug: string | null;
}

export async function listEventCatalog(): Promise<Array<{ key: string; label: string; description: string | null; enabled: boolean }>> {
  const rows = await db.select().from(notificationEvents).orderBy(asc(notificationEvents.key));
  if (rows.length) {
    return rows.map((r) => ({ key: r.key, label: r.label, description: r.description, enabled: r.enabled }));
  }
  return DEFAULT_EVENT_CATALOG.map((e) => ({ ...e, enabled: true }));
}

export async function listPolicies(eventKey?: string): Promise<Array<typeof notificationPolicies.$inferSelect>> {
  const where = eventKey
    ? and(eq(notificationPolicies.isActive, true), eq(notificationPolicies.eventKey, eventKey))
    : eq(notificationPolicies.isActive, true);
  return db
    .select()
    .from(notificationPolicies)
    .where(where)
    .orderBy(asc(notificationPolicies.eventKey), asc(notificationPolicies.precedence));
}

async function applicablePolicies(
  eventKey: string,
  channel: string,
  subject: ExpansionSubject,
): Promise<Array<typeof notificationPolicies.$inferSelect>> {
  const scopeMatches = [
    eq(notificationPolicies.scope, 'global'),
    and(eq(notificationPolicies.scope, 'namespace'), subject.namespaceKey ? eq(notificationPolicies.scopeRef, subject.namespaceKey) : isNull(notificationPolicies.scopeRef)),
    and(eq(notificationPolicies.scope, 'group'), subject.groupSlug ? eq(notificationPolicies.scopeRef, subject.groupSlug) : isNull(notificationPolicies.scopeRef)),
    and(eq(notificationPolicies.scope, 'document'), eq(notificationPolicies.scopeRef, subject.documentId)),
  ];

  const rows = await db
    .select()
    .from(notificationPolicies)
    .where(
      and(
        eq(notificationPolicies.isActive, true),
        eq(notificationPolicies.eventKey, eventKey),
        eq(notificationPolicies.channel, channel),
        or(...scopeMatches),
      ),
    );

  return rows.sort((a, b) => {
    const scopeDiff =
      SCOPE_ORDER.indexOf(a.scope as PolicyScope) - SCOPE_ORDER.indexOf(b.scope as PolicyScope);
    return scopeDiff !== 0 ? scopeDiff : a.precedence - b.precedence;
  });
}

export async function expandRecipients(
  eventKey: string,
  subject: ExpansionSubject,
  acl: DocumentAcl,
  actor: Actor | null,
  channel = 'email',
): Promise<ExpansionResult> {
  const catalog = await listEventCatalog();
  const event = catalog.find((e) => e.key === eventKey);
  if (!event) throw appError('event_not_supported', `Unknown notification event "${eventKey}".`);

  const policies = await applicablePolicies(eventKey, channel, subject);
  const warnings: ExpansionWarning[] = [];
  const addressesVisible = canSeeRecipientAddresses(actor, acl);

  if (!policies.length) {
    warnings.push({
      code: 'no_policy',
      message: `No local notification policy applies to ${eventKey} on the ${channel} channel.`,
    });
  }

  // Merge selectors in scope order; later scopes add, suppress lists remove.
  const toSelectors = new Map<string, PolicyRef>();
  const ccSelectors = new Map<string, PolicyRef>();
  const suppressed = new Map<string, PolicyRef>();
  const refs: PolicyRef[] = [];
  let enabled = event.enabled;

  for (const policy of policies) {
    const ref: PolicyRef = {
      id: policy.id,
      scope: policy.scope as PolicyScope,
      scopeRef: policy.scopeRef,
      precedence: policy.precedence,
      version: policy.version,
      enabled: policy.enabled,
    };
    refs.push(ref);
    enabled = policy.enabled;
    if (!policy.enabled) continue;
    for (const sel of policy.toSelectors) {
      toSelectors.set(sel, ref);
      ccSelectors.delete(sel);
    }
    for (const sel of policy.ccSelectors) {
      if (!toSelectors.has(sel)) ccSelectors.set(sel, ref);
    }
    for (const sel of policy.suppressSelectors) {
      suppressed.set(sel, ref);
      toSelectors.delete(sel);
      ccSelectors.delete(sel);
    }
  }

  if (!enabled) {
    warnings.push({
      code: 'event_disabled',
      message: `Notifications for ${eventKey} are disabled by the effective policy.`,
    });
    return {
      eventKey,
      eventLabel: event.label,
      channel,
      enabled: false,
      to: [],
      cc: [],
      suppressed: [],
      policies: refs,
      warnings,
      addressesVisible,
    };
  }

  const to = await resolveSelectors([...toSelectors.entries()], subject, addressesVisible, warnings);
  const ccRaw = await resolveSelectors([...ccSelectors.entries()], subject, addressesVisible, warnings);

  // A recipient already on To is never duplicated into Cc.
  const toKeys = new Set(to.map((r) => r.key));
  const cc = ccRaw.filter((r) => !toKeys.has(r.key));

  const suppressedList = (
    await resolveSelectors([...suppressed.entries()], subject, addressesVisible, [])
  ).map((r) => ({ ...r, reason: 'Excluded by a suppress rule in the effective policy.' }));

  return {
    eventKey,
    eventLabel: event.label,
    channel,
    enabled: true,
    to,
    cc,
    suppressed: suppressedList,
    policies: refs,
    warnings,
    addressesVisible,
  };
}

async function resolveSelectors(
  entries: Array<[string, PolicyRef]>,
  subject: ExpansionSubject,
  addressesVisible: boolean,
  warnings: ExpansionWarning[],
): Promise<ExpandedRecipient[]> {
  const byKey = new Map<string, ExpandedRecipient>();

  for (const [selector, policy] of entries) {
    const resolved = await resolveOne(selector, subject, warnings);
    for (const person of resolved.people) {
      const key = `person:${person.id}`;
      const existing = byKey.get(key);
      const reason = { selector, policyId: policy.id, scope: policy.scope, role: resolved.role };
      if (existing) {
        existing.reasons.push(reason);
        continue;
      }
      if (!person.email) {
        warnings.push({
          code: 'missing_address',
          message: `${person.displayName} has no delivery address configured.`,
        });
      }
      byKey.set(key, {
        key,
        displayName: person.displayName,
        address: addressesVisible ? person.email : null,
        kind: 'person',
        reasons: [reason],
      });
    }
  }

  return [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

interface ResolvedSelector {
  role: string;
  people: Array<{ id: string; displayName: string; email: string | null }>;
}

async function resolveOne(
  selector: string,
  subject: ExpansionSubject,
  warnings: ExpansionWarning[],
): Promise<ResolvedSelector> {
  const byAuthorRole = async (role: string) => {
    const rows = await db
      .select({ id: people.id, displayName: people.displayName, email: people.email })
      .from(documentAuthors)
      .innerJoin(people, eq(documentAuthors.personId, people.id))
      .where(and(eq(documentAuthors.documentId, subject.documentId), eq(documentAuthors.role, role)))
      .orderBy(asc(documentAuthors.position));
    return rows;
  };

  const byGroupRole = async (slug: string | null, roles: string[]) => {
    if (!slug) return [];
    const rows = await db
      .select({ id: people.id, displayName: people.displayName, email: people.email })
      .from(groupMembers)
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .innerJoin(people, eq(groupMembers.personId, people.id))
      .where(and(eq(groups.slug, slug), inArray(groupMembers.role, roles)));
    return rows;
  };

  switch (selector) {
    case 'document.authors':
      return { role: 'author', people: await byAuthorRole('author') };
    case 'document.editors':
      return { role: 'editor', people: await byAuthorRole('editor') };
    case 'document.owner': {
      const rows = await db
        .select({ id: people.id, displayName: people.displayName, email: people.email })
        .from(documents)
        .innerJoin(people, eq(documents.ownerId, people.id))
        .where(eq(documents.id, subject.documentId));
      return { role: 'owner', people: rows };
    }
    case 'document.watchers': {
      const rows = await db
        .select({ id: people.id, displayName: people.displayName, email: people.email })
        .from(documentWatchers)
        .innerJoin(people, eq(documentWatchers.personId, people.id))
        .where(eq(documentWatchers.documentId, subject.documentId));
      return { role: 'watcher', people: rows };
    }
    case 'group.owners': {
      const rows = await byGroupRole(subject.groupSlug, ['owner']);
      if (!rows.length && subject.groupSlug) {
        warnings.push({
          code: 'empty_group',
          message: `Group ${subject.groupSlug} has no owners, so group.owners resolves to nobody.`,
        });
      }
      return { role: 'group owner', people: rows };
    }
    case 'group.members':
      return {
        role: 'group member',
        people: await byGroupRole(subject.groupSlug, ['owner', 'member', 'reviewer', 'approver', 'publisher']),
      };
    case 'workflow.reviewers':
      return { role: 'reviewer', people: await byGroupRole(subject.groupSlug, ['reviewer']) };
    case 'workflow.approvers':
      return { role: 'approver', people: await byGroupRole(subject.groupSlug, ['approver']) };
    case 'namespace.publishers': {
      if (!subject.namespaceKey) return { role: 'publisher', people: [] };
      const rows = await db
        .select({ id: people.id, displayName: people.displayName, email: people.email })
        .from(people)
        .where(inArray(people.orgRole, ['publisher', 'admin']));
      return { role: 'publisher', people: rows };
    }
    default: {
      if (selector.startsWith('person:')) {
        const handle = selector.slice('person:'.length);
        const rows = await db
          .select({ id: people.id, displayName: people.displayName, email: people.email })
          .from(people)
          .where(eq(people.handle, handle));
        if (!rows.length) {
          warnings.push({ code: 'unknown_selector', message: `Unknown person selector "${selector}".` });
        }
        return { role: 'named person', people: rows };
      }
      if (selector.startsWith('group:')) {
        const slug = selector.slice('group:'.length);
        return { role: 'named group', people: await byGroupRole(slug, ['owner', 'member', 'reviewer', 'approver', 'publisher']) };
      }
      warnings.push({ code: 'unknown_selector', message: `Selector "${selector}" is not recognised.` });
      return { role: 'unknown', people: [] };
    }
  }
}

/** Preview never sends: it only computes and caches the expansion. */
export async function previewExpansion(
  eventKey: string,
  subject: ExpansionSubject,
  acl: DocumentAcl,
  actor: Actor | null,
  channel = 'email',
): Promise<ExpansionResult> {
  const result = await expandRecipients(eventKey, subject, acl, actor, channel);
  await db.insert(notificationExpansions).values({
    documentId: subject.documentId,
    eventKey,
    channel,
    policyVersions: result.policies.map((p) => `${p.id}@${p.version}`),
    result: {
      to: result.to.map((r) => ({ key: r.key, displayName: r.displayName })),
      cc: result.cc.map((r) => ({ key: r.key, displayName: r.displayName })),
      warnings: result.warnings,
    },
  });
  return result;
}

/** Queues a real delivery record; the worker performs the send attempt. */
export async function recordDeliveryIntent(
  eventKey: string,
  documentId: string,
  result: ExpansionResult,
): Promise<string> {
  const rows = await db
    .insert(notificationDeliveries)
    .values({
      documentId,
      eventKey,
      channel: result.channel,
      policyVersion: result.policies[result.policies.length - 1]?.version ?? 1,
      recipients: {
        to: result.to.map(redact),
        cc: result.cc.map(redact),
      },
      status: 'queued',
    })
    .returning({ id: notificationDeliveries.id });
  return rows[0]!.id;
}

function redact(r: ExpandedRecipient) {
  return { key: r.key, displayName: r.displayName, selectors: r.reasons.map((x) => x.selector) };
}

export async function listDeliveries(documentId: string, limit = 25) {
  return db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.documentId, documentId))
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(limit);
}

export async function namespaceKeyFor(documentId: string): Promise<ExpansionSubject> {
  const rows = await db
    .select({
      documentId: documents.id,
      namespaceKey: namespaces.key,
      groupSlug: groups.slug,
    })
    .from(documents)
    .leftJoin(namespaces, eq(documents.namespaceId, namespaces.id))
    .leftJoin(groups, eq(documents.groupId, groups.id))
    .where(eq(documents.id, documentId))
    .limit(1);
  const row = rows[0];
  if (!row) throw appError('not_found', 'Document not found.');
  return { documentId: row.documentId, namespaceKey: row.namespaceKey, groupSlug: row.groupSlug };
}
