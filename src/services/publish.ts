import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import {
  documentAuthors,
  documentRelations,
  documents,
  namespaces,
  publications,
  revisions,
} from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import { recordAudit } from './audit.ts';
import { evaluateGates } from './approvals.ts';
import { enqueueJob } from '#src/jobs/queue.ts';
import { renderAndPersistRevision } from './revisions.ts';
import type { Actor } from './rbac.ts';

/**
 * Publication is a single atomic transaction. Either the document becomes
 * published with a number, a locked revision, a manifest and artifacts, or
 * nothing at all is visible — there is no half-published state.
 */

export interface PublishResult {
  publicationId: string;
  documentNumber: string;
  revisionId: string;
  slug: string;
  /** Present when this call performed the publication. */
  publishedDocumentId?: string;
}

export async function requestPublish(
  documentId: string,
  actor: Actor,
  revisionId?: string,
): Promise<string> {
  const evaluation = await evaluateGates(documentId, revisionId);
  if (!evaluation.canPublish) {
    const blockers = evaluation.gates.filter((g) => g.required && !g.satisfied);
    throw appError(
      evaluation.staleApprovals > 0 && blockers.some((b) => b.kind.endsWith('approval'))
        ? 'stale_approval'
        : 'unresolved_gate',
      'Publication is blocked by unmet gates.',
      { gates: blockers.map((b) => ({ key: b.key, blockers: b.blockers })) },
    );
  }

  const docRows = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  const doc = docRows[0];
  if (!doc) throw appError('not_found', 'Document not found.');

  await recordAudit({
    familyKey: doc.familyKey,
    documentId,
    revisionId: evaluation.revisionId,
    entityType: 'publication',
    action: 'publish_requested',
    summary: `Publication requested for revision ${evaluation.revisionLabel}`,
    actorId: actor.id,
  });

  const jobId = await enqueueJob(
    'publish_document',
    { documentId, revisionId: evaluation.revisionId, actorId: actor.id },
    `publish:${documentId}:${evaluation.revisionSha256}`,
  );
  await enqueueJob('notify_event', { eventKey: 'publish_requested', documentId, revisionId: evaluation.revisionId });
  return jobId;
}

/**
 * The publish transaction itself. Runs in the worker; safe to retry because the
 * number allocation and state change happen together and an already-published
 * revision short-circuits.
 */
export async function executePublish(
  draftDocumentId: string,
  revisionId: string,
  actorId: string,
): Promise<PublishResult> {
  // Step 1-2: verify the gates once more and lock onto the target checksum.
  const evaluation = await evaluateGates(draftDocumentId, revisionId);
  if (!evaluation.canPublish) {
    throw appError('unresolved_gate', 'Gates were no longer satisfied at publish time.');
  }

  // Idempotent retry: a publication produced from this draft already committed.
  // The lookup goes through the published document's derivation, because the
  // publication revision is a distinct row from the draft revision.
  const existing = await db
    .select({ publication: publications, slug: documents.slug })
    .from(publications)
    .innerJoin(documents, eq(publications.documentId, documents.id))
    .where(
      and(
        eq(documents.derivedFromDocumentId, draftDocumentId),
        eq(publications.state, 'published'),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return {
      publicationId: existing[0].publication.id,
      documentNumber: existing[0].publication.documentNumber,
      revisionId: existing[0].publication.revisionId,
      slug: existing[0].slug,
      publishedDocumentId: existing[0].publication.documentId,
    };
  }

  const result = await db.transaction(async (tx) => {
    const draftRows = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, draftDocumentId))
      .limit(1)
      .for('update');
    const draft = draftRows[0];
    if (!draft) throw appError('not_found', 'Draft document not found.');
    if (draft.status === 'published' || draft.status === 'historic') {
      throw appError('conflict', 'This draft has already been published.');
    }

    const sourceRevRows = await tx.select().from(revisions).where(eq(revisions.id, revisionId)).limit(1);
    const sourceRevision = sourceRevRows[0];
    if (!sourceRevision) throw appError('not_found', 'Revision not found.');

    // Step 3: allocate the final identifier atomically inside the namespace.
    const documentNumber = await allocateDocumentNumber(tx, draft.namespaceId, draft.slug);
    const publishedAt = new Date();

    // Step 4: the publication becomes its own document row, so the draft family
    // and the published standard stay distinguishable forever.
    const publishedRows = await tx
      .insert(documents)
      .values({
        origin: draft.origin,
        namespaceId: draft.namespaceId,
        slug: documentNumber,
        displayName: documentNumber,
        familyKey: draft.familyKey,
        documentNumber,
        type: draft.type,
        title: draft.title,
        abstract: draft.abstract,
        standardLevel: draft.standardLevel,
        intendedStatus: draft.intendedStatus,
        status: 'published',
        visibility: draft.visibility === 'private' ? 'group' : draft.visibility,
        canonicalFormat: draft.canonicalFormat,
        groupId: draft.groupId,
        ownerId: draft.ownerId,
        licenseProfileId: draft.licenseProfileId,
        workflowId: draft.workflowId,
        workingSource: sourceRevision.source,
        workingSourceUpdatedAt: publishedAt,
        publishedAt,
        derivedFromDocumentId: draft.id,
        createdBy: actorId,
      })
      .returning();
    const published = publishedRows[0]!;

    const publicationRevisionRows = await tx
      .insert(revisions)
      .values({
        documentId: published.id,
        slug: `${documentNumber}-PUBLISHED`,
        label: 'Published 1.0',
        sequence: 0,
        isCurrent: true,
        isImmutable: true,
        isPublication: true,
        publishedAt,
        changeSummary: `Published from ${draft.slug} ${sourceRevision.label}`,
        source: sourceRevision.source,
        sourceKind: 'published',
        sourceStorageKey: sourceRevision.sourceStorageKey,
        sourceSha256: sourceRevision.sourceSha256,
        canonicalFormat: sourceRevision.canonicalFormat,
        parserVersion: sourceRevision.parserVersion,
        rendererVersion: sourceRevision.rendererVersion,
        renderState: 'pending',
        createdBy: actorId,
      })
      .returning();
    const publicationRevision = publicationRevisionRows[0]!;

    await tx
      .update(documents)
      .set({ publishedRevisionId: publicationRevision.id, currentRevisionId: publicationRevision.id })
      .where(eq(documents.id, published.id));

    // Authors, editors and relations carry over with their ordering intact.
    const authors = await tx.select().from(documentAuthors).where(eq(documentAuthors.documentId, draft.id));
    for (const author of authors) {
      await tx
        .insert(documentAuthors)
        .values({ ...author, documentId: published.id })
        .onConflictDoNothing();
    }

    const relations = await tx
      .select()
      .from(documentRelations)
      .where(eq(documentRelations.sourceDocumentId, draft.id));
    for (const relation of relations) {
      await tx.insert(documentRelations).values({
        sourceDocumentId: published.id,
        targetDocumentId: relation.targetDocumentId,
        targetRef: relation.targetRef,
        targetTitle: relation.targetTitle,
        type: relation.type,
        sourceSystem: relation.sourceSystem,
      });
    }
    // "Was draft" is an explicit relation, not an inference.
    await tx.insert(documentRelations).values({
      sourceDocumentId: published.id,
      targetDocumentId: draft.id,
      targetRef: draft.slug,
      type: 'was',
      sourceSystem: 'local',
    });

    // Step 5: every derived artifact is produced before the state is visible.
    const render = await renderAndPersistRevision(publicationRevision.id, tx);

    const manifest = {
      documentNumber,
      revisionSlug: publicationRevision.slug,
      draftSlug: draft.slug,
      draftRevision: sourceRevision.label,
      sourceSha256: sourceRevision.sourceSha256,
      parserVersion: render.parserVersion,
      rendererVersion: render.rendererVersion,
      pages: render.pageCount,
      wordCount: render.wordCount,
      artifacts: render.artifacts.map((a) => a.format),
      publishedAt: publishedAt.toISOString(),
    };

    const pubRows = await tx
      .insert(publications)
      .values({
        documentId: published.id,
        revisionId: publicationRevision.id,
        documentNumber,
        manifest,
        state: 'published',
        publishedBy: actorId,
        publishedAt,
      })
      .returning({ id: publications.id });

    // Step 6: relations declared by this publication take effect now.
    await applySupersedeRelations(tx, published.id);

    // The draft family is closed out; its revisions stay readable forever.
    await tx
      .update(documents)
      .set({ status: 'historic', updatedAt: publishedAt })
      .where(eq(documents.id, draft.id));

    await recordAudit(
      {
        familyKey: draft.familyKey,
        documentId: published.id,
        revisionId: publicationRevision.id,
        entityType: 'publication',
        entityId: pubRows[0]!.id,
        action: 'document_published',
        summary: `Published as ${documentNumber} from ${draft.slug} ${sourceRevision.label}`,
        changes: [
          { field: 'status', before: draft.status, after: 'published', sensitivity: 'public' },
          { field: 'documentNumber', before: null, after: documentNumber, sensitivity: 'public' },
        ],
        actorId,
        visibility: 'public',
      },
      tx,
    );

    return {
      publicationId: pubRows[0]!.id,
      documentNumber,
      revisionId: publicationRevision.id,
      slug: published.slug,
      publishedDocumentId: published.id,
    };
  });

  await enqueueJob('notify_event', {
    eventKey: 'document_published',
    documentId: result.publishedDocumentId,
    revisionId: result.revisionId,
  });
  return result;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function allocateDocumentNumber(
  tx: Tx,
  namespaceId: string | null,
  fallback: string,
): Promise<string> {
  if (!namespaceId) return fallback;
  const rows = await tx
    .update(namespaces)
    .set({ nextSequence: sql`${namespaces.nextSequence} + 1` })
    .where(eq(namespaces.id, namespaceId))
    .returning({
      prefix: namespaces.prefix,
      pattern: namespaces.numberPattern,
      sequence: namespaces.nextSequence,
    });

  const ns = rows[0];
  if (!ns) return fallback;
  const allocated = ns.sequence - 1;
  return ns.pattern.replace(/\{prefix\}/g, ns.prefix).replace(/\{seq:(\d+)\}/g, (_, width: string) =>
    String(allocated).padStart(Number(width), '0'),
  );
}

/** Marks the documents this publication updates/obsoletes as superseded. */
async function applySupersedeRelations(tx: Tx, documentId: string): Promise<void> {
  const relations = await tx
    .select({ type: documentRelations.type, targetId: documentRelations.targetDocumentId })
    .from(documentRelations)
    .where(eq(documentRelations.sourceDocumentId, documentId));

  for (const rel of relations) {
    if (rel.type !== 'obsoletes' || !rel.targetId) continue;
    await tx
      .update(documents)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(and(eq(documents.id, rel.targetId), eq(documents.status, 'published')));
  }
}

export async function markPublicationFailed(
  documentId: string,
  revisionId: string,
  error: string,
): Promise<void> {
  await db
    .insert(publications)
    .values({
      documentId,
      revisionId,
      documentNumber: `FAILED-${revisionId.slice(0, 8)}`,
      manifest: {},
      state: 'failed',
      error,
    })
    .onConflictDoNothing();
  await db
    .update(documents)
    .set({ status: 'approved', updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), eq(documents.status, 'publishing')));
}

export async function latestPublication(documentId: string) {
  const rows = await db
    .select()
    .from(publications)
    .where(eq(publications.documentId, documentId))
    .orderBy(desc(publications.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
