import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { approvals, documents, groupMembers, groups, people, revisions, workflows } from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import { recordAudit } from './audit.ts';
import { enqueueJob } from '#src/jobs/queue.ts';
import { countOpenBlockingThreads } from './reviews.ts';
import { validateSource } from './revisions.ts';
import { canApprove, type Actor, type DocumentAcl } from './rbac.ts';

/**
 * Approval gates. Every approval is bound to a revision checksum: when the
 * source changes the approval is marked stale and can no longer satisfy a gate.
 */

export type GateKind =
  | 'no-blocking-threads'
  | 'group-approval'
  | 'role-approval'
  | 'validation-clean'
  | 'required-sections'
  | 'references-resolved'
  | 'owner-approval';

export interface GateDefinition {
  key: string;
  label: string;
  kind: GateKind;
  required: boolean;
  groupSlug?: string;
  minApprovals?: number;
  sections?: string[];
}

export interface GateStatus extends GateDefinition {
  satisfied: boolean;
  detail: string;
  /** Human-readable reasons the gate is not satisfied yet. */
  blockers: string[];
  approvals: Array<{ approverName: string; decision: string; createdAt: Date; isStale: boolean }>;
}

export interface GateEvaluation {
  gates: GateStatus[];
  canPublish: boolean;
  revisionId: string;
  revisionLabel: string;
  revisionSha256: string;
  staleApprovals: number;
}

const DEFAULT_GATES: GateDefinition[] = [
  { key: 'no-blocking-threads', label: 'All blocking review threads resolved', kind: 'no-blocking-threads', required: true },
  { key: 'validation-clean', label: 'Document validates without errors', kind: 'validation-clean', required: true },
  { key: 'references-resolved', label: 'All citations resolve', kind: 'references-resolved', required: true },
  { key: 'group-approval', label: 'Owning group approval', kind: 'group-approval', required: true, minApprovals: 1 },
];

export async function gateDefinitionsFor(documentId: string): Promise<GateDefinition[]> {
  const rows = await db
    .select({ gates: workflows.gates })
    .from(documents)
    .leftJoin(workflows, eq(documents.workflowId, workflows.id))
    .where(eq(documents.id, documentId))
    .limit(1);
  const gates = rows[0]?.gates;
  return gates && gates.length ? (gates as GateDefinition[]) : DEFAULT_GATES;
}

export async function evaluateGates(documentId: string, revisionId?: string): Promise<GateEvaluation> {
  const docRows = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  const doc = docRows[0];
  if (!doc) throw appError('not_found', 'Document not found.');

  const targetId = revisionId ?? doc.currentRevisionId;
  if (!targetId) throw appError('unresolved_gate', 'Create a revision before requesting publication.');

  const revRows = await db.select().from(revisions).where(eq(revisions.id, targetId)).limit(1);
  const revision = revRows[0];
  if (!revision) throw appError('not_found', 'Revision not found.');

  const definitions = await gateDefinitionsFor(documentId);
  const decisionRows = await db
    .select({
      approval: approvals,
      approverName: people.displayName,
    })
    .from(approvals)
    .leftJoin(people, eq(approvals.approverId, people.id))
    .where(and(eq(approvals.documentId, documentId), eq(approvals.revisionId, revision.id)))
    .orderBy(desc(approvals.createdAt));

  const blockingOpen = await countOpenBlockingThreads(documentId);
  const validation = await validateSource(documentId, revision.source, revision.canonicalFormat);
  const errors = validation.diagnostics.filter((d) => d.severity === 'error');

  const gates: GateStatus[] = [];
  for (const def of definitions) {
    const relevant = decisionRows.filter((d) => d.approval.gateKey === def.key);
    const fresh = relevant.filter(
      (d) => !d.approval.isStale && d.approval.revisionSha256 === revision.sourceSha256,
    );
    const approvalsForGate = relevant.map((d) => ({
      approverName: d.approverName ?? 'Unknown',
      decision: d.approval.decision,
      createdAt: d.approval.createdAt,
      isStale: d.approval.isStale || d.approval.revisionSha256 !== revision.sourceSha256,
    }));

    const blockers: string[] = [];
    let satisfied = false;
    let detail = '';

    switch (def.kind) {
      case 'no-blocking-threads':
        satisfied = blockingOpen === 0;
        detail = satisfied ? 'No open blocking threads' : `${blockingOpen} open blocking thread(s)`;
        if (!satisfied) blockers.push(`Resolve ${blockingOpen} blocking review thread(s).`);
        break;
      case 'validation-clean':
        satisfied = errors.length === 0;
        detail = satisfied ? 'No validation errors' : `${errors.length} validation error(s)`;
        for (const e of errors.slice(0, 5)) blockers.push(`${e.code}: ${e.message}`);
        break;
      case 'references-resolved': {
        const broken = errors.filter((e) => e.code === 'broken-citation' || e.code === 'broken-xref');
        satisfied = broken.length === 0;
        detail = satisfied ? 'All references resolve' : `${broken.length} unresolved reference(s)`;
        for (const e of broken.slice(0, 5)) blockers.push(e.message);
        break;
      }
      case 'required-sections': {
        const missing = validation.diagnostics.filter((d) => d.code === 'missing-required-section');
        satisfied = missing.length === 0;
        detail = satisfied ? 'Required sections present' : `${missing.length} required section(s) missing`;
        for (const m of missing) blockers.push(m.message);
        break;
      }
      case 'group-approval':
      case 'role-approval':
      case 'owner-approval': {
        const min = def.minApprovals ?? 1;
        const approved = fresh.filter((d) => d.approval.decision === 'approved');
        const rejected = fresh.filter((d) => d.approval.decision === 'rejected');
        satisfied = rejected.length === 0 && approved.length >= min;
        detail = `${approved.length}/${min} approval(s) on the current checksum`;
        if (rejected.length) blockers.push('A reviewer rejected this revision.');
        else if (approved.length < min) {
          blockers.push(`Needs ${min - approved.length} more approval(s) bound to this revision.`);
        }
        const staleCount = approvalsForGate.filter((a) => a.isStale).length;
        if (staleCount) blockers.push(`${staleCount} earlier approval(s) went stale when the source changed.`);
        break;
      }
    }

    gates.push({ ...def, satisfied, detail, blockers, approvals: approvalsForGate });
  }

  const staleApprovals = decisionRows.filter(
    (d) => d.approval.isStale || d.approval.revisionSha256 !== revision.sourceSha256,
  ).length;

  return {
    gates,
    canPublish: gates.every((g) => !g.required || g.satisfied),
    revisionId: revision.id,
    revisionLabel: revision.label,
    revisionSha256: revision.sourceSha256,
    staleApprovals,
  };
}

export async function recordDecision(
  documentId: string,
  revisionId: string,
  gateKey: string,
  decision: 'approved' | 'rejected',
  actor: Actor,
  acl: DocumentAcl,
  note?: string,
): Promise<void> {
  if (!canApprove(actor, acl)) throw appError('forbidden', 'You cannot approve this document.');

  const revRows = await db.select().from(revisions).where(eq(revisions.id, revisionId)).limit(1);
  const revision = revRows[0];
  if (!revision) throw appError('not_found', 'Revision not found.');

  const docRows = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  const doc = docRows[0];
  if (!doc) throw appError('not_found', 'Document not found.');

  // An approver may only act inside the namespace/group they belong to.
  const definitions = await gateDefinitionsFor(documentId);
  const definition = definitions.find((g) => g.key === gateKey);
  if (!definition) throw appError('validation_failed', `Unknown approval gate "${gateKey}".`);
  if (definition.groupSlug) {
    const allowed = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(groupMembers)
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .where(
        and(
          eq(groups.slug, definition.groupSlug),
          eq(groupMembers.personId, actor.id),
          inArray(groupMembers.role, ['approver', 'owner']),
        ),
      );
    if ((allowed[0]?.count ?? 0) === 0 && actor.orgRole !== 'admin') {
      throw appError('forbidden', `Gate "${gateKey}" requires membership of ${definition.groupSlug}.`);
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(approvals)
      .set({ isStale: true })
      .where(
        and(
          eq(approvals.documentId, documentId),
          eq(approvals.revisionId, revisionId),
          eq(approvals.gateKey, gateKey),
          eq(approvals.approverId, actor.id),
        ),
      );

    await tx.insert(approvals).values({
      documentId,
      revisionId,
      gateKey,
      decision,
      note: note ?? null,
      revisionSha256: revision.sourceSha256,
      approverId: actor.id,
    });

    if (decision === 'rejected') {
      await tx
        .update(documents)
        .set({ status: 'changes-requested', updatedAt: new Date() })
        .where(eq(documents.id, documentId));
    }

    await recordAudit(
      {
        familyKey: doc.familyKey,
        documentId,
        revisionId,
        entityType: 'approval',
        action: decision === 'approved' ? 'review_approved' : 'review_rejected',
        summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} gate "${gateKey}" on revision ${revision.label}`,
        changes: [
          { field: 'revisionSha256', before: null, after: revision.sourceSha256.slice(0, 12), sensitivity: 'public' },
        ],
        actorId: actor.id,
      },
      tx,
    );
  });

  const evaluation = await evaluateGates(documentId, revisionId);
  if (evaluation.canPublish) {
    await db
      .update(documents)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.status, 'review')));
  }

  await enqueueJob('notify_event', {
    eventKey: decision === 'approved' ? 'review_approved' : 'changes_requested',
    documentId,
    revisionId,
  });
}

export async function listApprovals(documentId: string) {
  return db
    .select({
      approval: approvals,
      approverName: people.displayName,
      approverHandle: people.handle,
      revisionLabel: revisions.label,
    })
    .from(approvals)
    .leftJoin(people, eq(approvals.approverId, people.id))
    .innerJoin(revisions, eq(approvals.revisionId, revisions.id))
    .where(eq(approvals.documentId, documentId))
    .orderBy(desc(approvals.createdAt));
}
