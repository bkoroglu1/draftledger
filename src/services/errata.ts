import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { documents, errata, people, revisions } from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import type { ErratumStatus } from '#src/domain/types.ts';
import { recordAudit } from './audit.ts';
import { enqueueJob } from '#src/jobs/queue.ts';
import type { Actor } from './rbac.ts';

/**
 * Errata are the only way to correct a published document in place — the
 * publication artifacts themselves are never rewritten.
 */

export interface ErratumView {
  id: string;
  number: number;
  type: string;
  status: ErratumStatus;
  sectionAnchor: string | null;
  sectionNumber: string | null;
  originalText: string | null;
  correctedText: string | null;
  notes: string | null;
  reporterName: string | null;
  verifierName: string | null;
  verifiedAt: Date | null;
  resolution: string | null;
  createdAt: Date;
  affectedRevisionLabel: string | null;
  affectedRevisionSlug: string | null;
}

export async function listErrata(documentId: string): Promise<ErratumView[]> {
  const rows = await db
    .select({
      erratum: errata,
      reporterName: people.displayName,
      revisionLabel: revisions.label,
      revisionSlug: revisions.slug,
    })
    .from(errata)
    .leftJoin(people, eq(errata.reporterId, people.id))
    .leftJoin(revisions, eq(errata.revisionId, revisions.id))
    .where(eq(errata.documentId, documentId))
    .orderBy(asc(errata.number));

  const verifiers = await db
    .select({ id: people.id, name: people.displayName })
    .from(people);
  const verifierName = new Map(verifiers.map((v) => [v.id, v.name] as const));

  return rows.map((r) => ({
    id: r.erratum.id,
    number: r.erratum.number,
    type: r.erratum.type,
    status: r.erratum.status,
    sectionAnchor: r.erratum.sectionAnchor,
    sectionNumber: r.erratum.sectionNumber,
    originalText: r.erratum.originalText,
    correctedText: r.erratum.correctedText,
    notes: r.erratum.notes,
    reporterName: r.reporterName ?? r.erratum.reporterName,
    verifierName: r.erratum.verifierId ? (verifierName.get(r.erratum.verifierId) ?? null) : null,
    verifiedAt: r.erratum.verifiedAt,
    resolution: r.erratum.resolution,
    createdAt: r.erratum.createdAt,
    affectedRevisionLabel: r.revisionLabel,
    affectedRevisionSlug: r.revisionSlug,
  }));
}

export interface ReportErratumInput {
  documentId: string;
  revisionId: string | null;
  type: 'technical' | 'editorial';
  sectionAnchor?: string | null;
  sectionNumber?: string | null;
  originalText?: string | null;
  correctedText?: string | null;
  notes?: string | null;
  actor: Actor;
}

export async function reportErratum(input: ReportErratumInput): Promise<string> {
  const docRows = await db.select().from(documents).where(eq(documents.id, input.documentId)).limit(1);
  const doc = docRows[0];
  if (!doc) throw appError('not_found', 'Document not found.');
  if (doc.status !== 'published' && doc.status !== 'superseded' && doc.status !== 'historic') {
    throw appError('validation_failed', 'Errata can only be filed against published documents.');
  }
  if (!input.correctedText?.trim() && !input.notes?.trim()) {
    throw appError('validation_failed', 'Describe the correction or add explanatory notes.');
  }

  const id = await db.transaction(async (tx) => {
    const maxRows = await tx
      .select({ max: sql<number>`coalesce(max(${errata.number}), 0)::int` })
      .from(errata)
      .where(eq(errata.documentId, input.documentId));
    const number = (maxRows[0]?.max ?? 0) + 1;

    const rows = await tx
      .insert(errata)
      .values({
        documentId: input.documentId,
        revisionId: input.revisionId ?? doc.publishedRevisionId,
        number,
        type: input.type,
        status: 'reported',
        sectionAnchor: input.sectionAnchor ?? null,
        sectionNumber: input.sectionNumber ?? null,
        originalText: input.originalText ?? null,
        correctedText: input.correctedText ?? null,
        notes: input.notes ?? null,
        reporterId: input.actor.id,
        reporterName: input.actor.displayName,
      })
      .returning({ id: errata.id });

    await recordAudit(
      {
        familyKey: doc.familyKey,
        documentId: input.documentId,
        revisionId: input.revisionId ?? doc.publishedRevisionId,
        entityType: 'erratum',
        entityId: rows[0]!.id,
        action: 'erratum_reported',
        summary: `Erratum ${number} (${input.type}) reported on ${input.sectionNumber ?? 'the document'}`,
        actorId: input.actor.id,
        visibility: 'public',
      },
      tx,
    );
    return rows[0]!.id;
  });

  await enqueueJob('notify_event', { eventKey: 'erratum_reported', documentId: input.documentId });
  return id;
}

export async function setErratumStatus(
  erratumId: string,
  status: ErratumStatus,
  actor: Actor,
  resolution?: string,
): Promise<void> {
  const rows = await db.select().from(errata).where(eq(errata.id, erratumId)).limit(1);
  const erratum = rows[0];
  if (!erratum) throw appError('not_found', 'Erratum not found.');

  await db
    .update(errata)
    .set({
      status,
      resolution: resolution ?? erratum.resolution,
      verifierId: status === 'verified' ? actor.id : erratum.verifierId,
      verifiedAt: status === 'verified' ? new Date() : erratum.verifiedAt,
    })
    .where(eq(errata.id, erratumId));

  const docRows = await db.select().from(documents).where(eq(documents.id, erratum.documentId)).limit(1);
  await recordAudit({
    familyKey: docRows[0]?.familyKey ?? '',
    documentId: erratum.documentId,
    entityType: 'erratum',
    entityId: erratumId,
    action: 'erratum_status_changed',
    summary: `Erratum ${erratum.number} marked ${status}`,
    changes: [{ field: 'status', before: erratum.status, after: status, sensitivity: 'public' }],
    actorId: actor.id,
    visibility: 'public',
  });
}

/** Verified errata become inline annotations in the with-errata reader view. */
export async function verifiedErrataByAnchor(
  documentId: string,
): Promise<Map<string, ErratumView[]>> {
  const all = await listErrata(documentId);
  const map = new Map<string, ErratumView[]>();
  for (const e of all) {
    if (e.status !== 'verified' || !e.sectionAnchor) continue;
    const list = map.get(e.sectionAnchor) ?? [];
    list.push(e);
    map.set(e.sectionAnchor, list);
  }
  return map;
}

export async function latestErrataActivity(documentId: string): Promise<Date | null> {
  const rows = await db
    .select({ at: errata.createdAt })
    .from(errata)
    .where(eq(errata.documentId, documentId))
    .orderBy(desc(errata.createdAt))
    .limit(1);
  return rows[0]?.at ?? null;
}

export async function countByStatus(documentId: string): Promise<Record<ErratumStatus, number>> {
  const rows = await db
    .select({ status: errata.status, count: sql<number>`count(*)::int` })
    .from(errata)
    .where(eq(errata.documentId, documentId))
    .groupBy(errata.status);
  const out: Record<ErratumStatus, number> = { reported: 0, verified: 0, held: 0, rejected: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export async function getErratum(documentId: string, number: number) {
  const rows = await db
    .select()
    .from(errata)
    .where(and(eq(errata.documentId, documentId), eq(errata.number, number)))
    .limit(1);
  return rows[0] ?? null;
}
