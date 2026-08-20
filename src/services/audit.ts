import { and, desc, eq, inArray, lte, gte, sql, type SQL } from 'drizzle-orm';
import { db, type DbOrTx } from '#src/db/index.ts';
import { auditEvents, people } from '#src/db/schema.ts';
import type { Actor } from './rbac.ts';

/**
 * Append-only audit trail. Both the Status timeline and the History tab read
 * from this one stream, so the two screens can never disagree.
 */

export type ChangeSensitivity = 'public' | 'internal' | 'restricted';

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
  sensitivity?: ChangeSensitivity;
}

export interface RecordAuditInput {
  familyKey: string;
  documentId?: string | null;
  revisionId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  summary: string;
  changes?: AuditChange[];
  actorId?: string | null;
  actorKind?: 'user' | 'system';
  origin?: 'local' | 'external-import';
  correlationId?: string | null;
  visibility?: 'public' | 'group' | 'restricted';
}

export async function recordAudit(input: RecordAuditInput, tx: DbOrTx = db): Promise<void> {
  await tx.insert(auditEvents).values({
    familyKey: input.familyKey,
    documentId: input.documentId ?? null,
    revisionId: input.revisionId ?? null,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    summary: input.summary,
    changes: (input.changes ?? []).map(redactChange),
    actorId: input.actorId ?? null,
    actorKind: input.actorKind ?? (input.actorId ? 'user' : 'system'),
    origin: input.origin ?? 'local',
    correlationId: input.correlationId ?? null,
    visibility: input.visibility ?? 'group',
  });
}

const SECRET_FIELD_RE = /(password|secret|token|apikey|api_key|credential)/i;

/** Secrets never reach the audit payload, not even redacted-in-place. */
function redactChange(change: AuditChange): AuditChange {
  if (SECRET_FIELD_RE.test(change.field)) {
    return { field: change.field, before: '[redacted]', after: '[redacted]', sensitivity: 'restricted' };
  }
  return { ...change, sensitivity: change.sensitivity ?? 'internal' };
}

export interface HistoryQuery {
  familyKey: string;
  documentIds?: string[];
  search?: string;
  actions?: string[];
  actorId?: string;
  revisionId?: string;
  from?: Date;
  to?: Date;
  sort?: 'date' | 'actor' | 'action';
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface HistoryRow {
  id: string;
  action: string;
  summary: string;
  createdAt: Date;
  actorName: string;
  actorKind: string;
  actorHandle: string | null;
  origin: string;
  documentId: string | null;
  revisionId: string | null;
  entityType: string;
  correlationId: string | null;
  changes: AuditChange[];
}

export async function queryHistory(
  query: HistoryQuery,
  actor: Actor | null,
  canSeeRestricted: boolean,
): Promise<{ rows: HistoryRow[]; total: number }> {
  const filters: SQL[] = [eq(auditEvents.familyKey, query.familyKey)];

  if (query.documentIds?.length) filters.push(inArray(auditEvents.documentId, query.documentIds));
  if (query.actions?.length) filters.push(inArray(auditEvents.action, query.actions));
  if (query.actorId) filters.push(eq(auditEvents.actorId, query.actorId));
  if (query.revisionId) filters.push(eq(auditEvents.revisionId, query.revisionId));
  if (query.from) filters.push(gte(auditEvents.createdAt, query.from));
  if (query.to) filters.push(lte(auditEvents.createdAt, query.to));
  if (!actor) filters.push(eq(auditEvents.visibility, 'public'));
  else if (!canSeeRestricted) filters.push(inArray(auditEvents.visibility, ['public', 'group']));

  // Server-side search across the whole authorized history, not just this page.
  if (query.search?.trim()) {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push(
      sql`(lower(${auditEvents.summary}) like ${term} or lower(${auditEvents.action}) like ${term} or lower(coalesce(${people.displayName}, '')) like ${term})`,
    );
  }

  const where = and(...filters);
  const sortColumn =
    query.sort === 'actor'
      ? people.displayName
      : query.sort === 'action'
        ? auditEvents.action
        : auditEvents.createdAt;
  const order = query.direction === 'asc' ? sortColumn : desc(sortColumn);

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      summary: auditEvents.summary,
      createdAt: auditEvents.createdAt,
      actorKind: auditEvents.actorKind,
      origin: auditEvents.origin,
      documentId: auditEvents.documentId,
      revisionId: auditEvents.revisionId,
      entityType: auditEvents.entityType,
      correlationId: auditEvents.correlationId,
      changes: auditEvents.changes,
      actorName: people.displayName,
      actorHandle: people.handle,
    })
    .from(auditEvents)
    .leftJoin(people, eq(auditEvents.actorId, people.id))
    .where(where)
    .orderBy(order)
    .limit(query.limit ?? 50)
    .offset(query.offset ?? 0);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .leftJoin(people, eq(auditEvents.actorId, people.id))
    .where(where);

  return {
    rows: rows.map((r) => ({
      ...r,
      actorName: r.actorName ?? (r.actorKind === 'system' ? 'System' : 'Unknown actor'),
      changes: canSeeRestricted
        ? r.changes
        : r.changes.map((c) =>
            c.sensitivity === 'restricted'
              ? { ...c, before: '[restricted]', after: '[restricted]' }
              : c,
          ),
    })),
    total: count,
  };
}

export async function getAuditEvent(id: string): Promise<HistoryRow | null> {
  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      summary: auditEvents.summary,
      createdAt: auditEvents.createdAt,
      actorKind: auditEvents.actorKind,
      origin: auditEvents.origin,
      documentId: auditEvents.documentId,
      revisionId: auditEvents.revisionId,
      entityType: auditEvents.entityType,
      correlationId: auditEvents.correlationId,
      changes: auditEvents.changes,
      actorName: people.displayName,
      actorHandle: people.handle,
    })
    .from(auditEvents)
    .leftJoin(people, eq(auditEvents.actorId, people.id))
    .where(eq(auditEvents.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, actorName: row.actorName ?? 'System' };
}
