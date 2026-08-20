import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import {
  documents,
  people,
  reviewComments,
  reviewRounds,
  reviewThreads,
  revisions,
  sections,
} from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import { BLOCKING_THREAD_TYPES, type ReviewThreadStatus, type ReviewThreadType } from '#src/domain/types.ts';
import { recordAudit } from './audit.ts';
import { enqueueJob } from '#src/jobs/queue.ts';
import type { Actor } from './rbac.ts';

/**
 * Review rounds are pinned to an immutable revision, so the evidence trail for
 * a decision cannot be altered by later edits to the working copy.
 */

export interface ThreadView {
  id: string;
  anchor: string | null;
  sectionNumber: string | null;
  sourceStartLine: number | null;
  sourceEndLine: number | null;
  quotedText: string | null;
  type: ReviewThreadType;
  severity: string;
  status: ReviewThreadStatus;
  isOrphaned: boolean;
  createdAt: Date;
  createdByName: string | null;
  assigneeName: string | null;
  comments: Array<{
    id: string;
    body: string;
    suggestion: string | null;
    authorName: string | null;
    authorHandle: string | null;
    createdAt: Date;
  }>;
}

export interface RoundView {
  id: string;
  sequence: number;
  status: string;
  note: string | null;
  createdAt: Date;
  closedAt: Date | null;
  revisionId: string;
  revisionLabel: string;
  revisionSlug: string;
  requestedByName: string | null;
  threads: ThreadView[];
}

export async function startReviewRound(
  documentId: string,
  revisionId: string,
  actor: Actor,
  note?: string,
): Promise<string> {
  const docRows = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  const doc = docRows[0];
  if (!doc) throw appError('not_found', 'Document not found.');

  const previous = await db
    .select({ sequence: reviewRounds.sequence, id: reviewRounds.id, revisionId: reviewRounds.revisionId })
    .from(reviewRounds)
    .where(eq(reviewRounds.documentId, documentId))
    .orderBy(desc(reviewRounds.sequence))
    .limit(1);

  const sequence = (previous[0]?.sequence ?? 0) + 1;

  const roundId = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(reviewRounds)
      .values({ documentId, revisionId, sequence, requestedBy: actor.id, note: note ?? null })
      .returning({ id: reviewRounds.id });
    const id = rows[0]!.id;

    await tx.update(documents).set({ status: 'review', updatedAt: new Date() }).where(eq(documents.id, documentId));

    await recordAudit(
      {
        familyKey: doc.familyKey,
        documentId,
        revisionId,
        entityType: 'review_round',
        entityId: id,
        action: 'review_started',
        summary: `Review round ${sequence} opened on revision ${revisionId.slice(0, 8)}`,
        actorId: actor.id,
      },
      tx,
    );
    return id;
  });

  // Carry unresolved threads forward, mapping anchors onto the new revision.
  if (previous[0]) await carryForwardThreads(previous[0].id, roundId, revisionId, documentId);

  await enqueueJob('notify_event', { eventKey: 'review_started', documentId, revisionId });
  return roundId;
}

/**
 * Threads from the previous round move to the new revision when their anchor
 * still exists; otherwise they are explicitly marked orphaned rather than
 * silently dropped.
 */
async function carryForwardThreads(
  fromRoundId: string,
  toRoundId: string,
  toRevisionId: string,
  documentId: string,
): Promise<void> {
  const open = await db
    .select()
    .from(reviewThreads)
    .where(and(eq(reviewThreads.roundId, fromRoundId), inArray(reviewThreads.status, ['open'])));
  if (!open.length) return;

  const newSections = await db
    .select({ anchor: sections.anchor, number: sections.number, start: sections.sourceStart, end: sections.sourceEnd })
    .from(sections)
    .where(eq(sections.revisionId, toRevisionId));
  const anchorSet = new Map(newSections.map((s) => [s.anchor, s]));

  for (const thread of open) {
    const mapped = thread.anchor ? anchorSet.get(thread.anchor) : undefined;
    await db.insert(reviewThreads).values({
      roundId: toRoundId,
      documentId,
      revisionId: toRevisionId,
      anchor: thread.anchor,
      sectionNumber: mapped?.number ?? thread.sectionNumber,
      sourceStartLine: mapped?.start ?? null,
      sourceEndLine: mapped?.end ?? null,
      quotedText: thread.quotedText,
      type: thread.type,
      severity: thread.severity,
      status: 'open',
      assigneeId: thread.assigneeId,
      carriedFromThreadId: thread.id,
      isOrphaned: !mapped,
      createdBy: thread.createdBy,
    });
    await db
      .update(reviewThreads)
      .set({ status: 'superseded' })
      .where(eq(reviewThreads.id, thread.id));
  }
}

export interface CreateThreadInput {
  roundId: string;
  documentId: string;
  revisionId: string;
  anchor?: string | null;
  sectionNumber?: string | null;
  sourceStartLine?: number | null;
  sourceEndLine?: number | null;
  quotedText?: string | null;
  type: ReviewThreadType;
  severity?: string;
  body: string;
  suggestion?: string | null;
  actor: Actor;
}

export async function createThread(input: CreateThreadInput): Promise<string> {
  const docRows = await db.select().from(documents).where(eq(documents.id, input.documentId)).limit(1);
  const doc = docRows[0];
  if (!doc) throw appError('not_found', 'Document not found.');
  if (!input.body.trim()) throw appError('validation_failed', 'A review comment cannot be empty.');

  const threadId = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(reviewThreads)
      .values({
        roundId: input.roundId,
        documentId: input.documentId,
        revisionId: input.revisionId,
        anchor: input.anchor ?? null,
        sectionNumber: input.sectionNumber ?? null,
        sourceStartLine: input.sourceStartLine ?? null,
        sourceEndLine: input.sourceEndLine ?? null,
        quotedText: input.quotedText ?? null,
        type: input.type,
        severity: input.severity ?? (input.type === 'blocking' ? 'high' : 'normal'),
        createdBy: input.actor.id,
      })
      .returning({ id: reviewThreads.id });

    const id = rows[0]!.id;
    await tx.insert(reviewComments).values({
      threadId: id,
      body: input.body,
      suggestion: input.suggestion ?? null,
      authorId: input.actor.id,
    });

    const blocking = BLOCKING_THREAD_TYPES.includes(input.type);
    if (blocking) {
      await tx
        .update(documents)
        .set({ status: 'changes-requested', updatedAt: new Date() })
        .where(eq(documents.id, input.documentId));
    }

    await recordAudit(
      {
        familyKey: doc.familyKey,
        documentId: input.documentId,
        revisionId: input.revisionId,
        entityType: 'review_thread',
        entityId: id,
        action: blocking ? 'changes_requested' : 'review_comment_added',
        summary: blocking
          ? `Blocking change requested on ${input.anchor ?? 'the document'}`
          : `${input.type} comment added on ${input.anchor ?? 'the document'}`,
        actorId: input.actor.id,
      },
      tx,
    );
    return id;
  });

  await enqueueJob('notify_event', {
    eventKey: BLOCKING_THREAD_TYPES.includes(input.type) ? 'changes_requested' : 'review_comment_added',
    documentId: input.documentId,
    revisionId: input.revisionId,
  });
  return threadId;
}

export async function replyToThread(
  threadId: string,
  body: string,
  actor: Actor,
  suggestion?: string,
): Promise<void> {
  if (!body.trim()) throw appError('validation_failed', 'A reply cannot be empty.');
  const rows = await db.select().from(reviewThreads).where(eq(reviewThreads.id, threadId)).limit(1);
  const thread = rows[0];
  if (!thread) throw appError('not_found', 'Thread not found.');

  await db.insert(reviewComments).values({
    threadId,
    body,
    suggestion: suggestion ?? null,
    authorId: actor.id,
  });

  const docRows = await db.select().from(documents).where(eq(documents.id, thread.documentId)).limit(1);
  await recordAudit({
    familyKey: docRows[0]?.familyKey ?? '',
    documentId: thread.documentId,
    revisionId: thread.revisionId,
    entityType: 'review_thread',
    entityId: threadId,
    action: 'review_comment_added',
    summary: 'Reply added to review thread',
    actorId: actor.id,
  });
}

export async function setThreadStatus(
  threadId: string,
  status: ReviewThreadStatus,
  actor: Actor,
): Promise<void> {
  const rows = await db.select().from(reviewThreads).where(eq(reviewThreads.id, threadId)).limit(1);
  const thread = rows[0];
  if (!thread) throw appError('not_found', 'Thread not found.');

  await db
    .update(reviewThreads)
    .set({
      status,
      resolvedBy: status === 'open' ? null : actor.id,
      resolvedAt: status === 'open' ? null : new Date(),
    })
    .where(eq(reviewThreads.id, threadId));

  const docRows = await db.select().from(documents).where(eq(documents.id, thread.documentId)).limit(1);
  await recordAudit({
    familyKey: docRows[0]?.familyKey ?? '',
    documentId: thread.documentId,
    revisionId: thread.revisionId,
    entityType: 'review_thread',
    entityId: threadId,
    action: 'thread_status_changed',
    summary: `Thread marked ${status}`,
    changes: [{ field: 'status', before: thread.status, after: status, sensitivity: 'public' }],
    actorId: actor.id,
  });
}

export async function listRounds(documentId: string): Promise<RoundView[]> {
  const rounds = await db
    .select({
      round: reviewRounds,
      revisionLabel: revisions.label,
      revisionSlug: revisions.slug,
      requestedByName: people.displayName,
    })
    .from(reviewRounds)
    .innerJoin(revisions, eq(reviewRounds.revisionId, revisions.id))
    .leftJoin(people, eq(reviewRounds.requestedBy, people.id))
    .where(eq(reviewRounds.documentId, documentId))
    .orderBy(desc(reviewRounds.sequence));

  if (!rounds.length) return [];

  const threads = await db
    .select({
      thread: reviewThreads,
      createdByName: people.displayName,
    })
    .from(reviewThreads)
    .leftJoin(people, eq(reviewThreads.createdBy, people.id))
    .where(inArray(reviewThreads.roundId, rounds.map((r) => r.round.id)))
    .orderBy(asc(reviewThreads.createdAt));

  const comments = threads.length
    ? await db
        .select({
          comment: reviewComments,
          authorName: people.displayName,
          authorHandle: people.handle,
        })
        .from(reviewComments)
        .leftJoin(people, eq(reviewComments.authorId, people.id))
        .where(inArray(reviewComments.threadId, threads.map((t) => t.thread.id)))
        .orderBy(asc(reviewComments.createdAt))
    : [];

  return rounds.map((r) => ({
    id: r.round.id,
    sequence: r.round.sequence,
    status: r.round.status,
    note: r.round.note,
    createdAt: r.round.createdAt,
    closedAt: r.round.closedAt,
    revisionId: r.round.revisionId,
    revisionLabel: r.revisionLabel,
    revisionSlug: r.revisionSlug,
    requestedByName: r.requestedByName,
    threads: threads
      .filter((t) => t.thread.roundId === r.round.id)
      .map((t) => ({
        id: t.thread.id,
        anchor: t.thread.anchor,
        sectionNumber: t.thread.sectionNumber,
        sourceStartLine: t.thread.sourceStartLine,
        sourceEndLine: t.thread.sourceEndLine,
        quotedText: t.thread.quotedText,
        type: t.thread.type,
        severity: t.thread.severity,
        status: t.thread.status,
        isOrphaned: t.thread.isOrphaned,
        createdAt: t.thread.createdAt,
        createdByName: t.createdByName,
        assigneeName: null,
        comments: comments
          .filter((c) => c.comment.threadId === t.thread.id)
          .map((c) => ({
            id: c.comment.id,
            body: c.comment.body,
            suggestion: c.comment.suggestion,
            authorName: c.authorName,
            authorHandle: c.authorHandle,
            createdAt: c.comment.createdAt,
          })),
      })),
  }));
}

export async function countOpenBlockingThreads(documentId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reviewThreads)
    .where(
      and(
        eq(reviewThreads.documentId, documentId),
        eq(reviewThreads.status, 'open'),
        inArray(reviewThreads.type, BLOCKING_THREAD_TYPES),
      ),
    );
  return rows[0]?.count ?? 0;
}

export async function currentRound(documentId: string) {
  const rows = await db
    .select()
    .from(reviewRounds)
    .where(eq(reviewRounds.documentId, documentId))
    .orderBy(desc(reviewRounds.sequence))
    .limit(1);
  return rows[0] ?? null;
}
