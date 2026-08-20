'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import type {
  CanonicalFormat,
  DocumentVisibility,
  RelationType,
  ReviewThreadStatus,
  ReviewThreadType,
} from '#src/domain/types.ts';
import { requireActor } from '#src/services/auth.ts';
import { createDraft, updateDraftMetadata, type DraftStartMode } from '#src/services/drafts.ts';
import { getDocumentContext } from '#src/services/documents.ts';
import { createRevision, saveWorkingCopy } from '#src/services/revisions.ts';
import { createThread, currentRound, replyToThread, setThreadStatus, startReviewRound } from '#src/services/reviews.ts';
import { recordDecision } from '#src/services/approvals.ts';
import { requestPublish } from '#src/services/publish.ts';
import { invalidateReaderCache } from '#src/services/reader.ts';
import { assertEdit, canApprove, canReview, assertPublish } from '#src/services/rbac.ts';

type ActionState = { error?: string; message?: string; version?: number } | null;

function fail(err: unknown): ActionState {
  return { error: isAppError(err) ? err.message : 'The action could not be completed.' };
}

export async function createDraftAction(_prev: ActionState, formData: FormData) {
  let slug: string;
  try {
    const actor = await requireActor();
    const authorHandles = String(formData.get('authors') ?? actor.handle)
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    const editorHandles = String(formData.get('editors') ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    const relationType = String(formData.get('relationType') ?? '') as RelationType | '';
    const relationTarget = String(formData.get('relationTarget') ?? '').trim();

    const result = await createDraft({
      mode: String(formData.get('mode') ?? 'blank') as DraftStartMode,
      title: String(formData.get('title') ?? ''),
      shortName: String(formData.get('shortName') ?? ''),
      abstract: String(formData.get('abstract') ?? ''),
      type: String(formData.get('type') ?? 'standard'),
      intendedStatus: String(formData.get('intendedStatus') ?? 'standards-track'),
      namespaceKey: String(formData.get('namespace') ?? '') || undefined,
      groupSlug: String(formData.get('group') ?? '') || undefined,
      authorHandles: authorHandles.length ? authorHandles : [actor.handle],
      editorHandles,
      canonicalFormat: (String(formData.get('format') ?? 'markdown') as CanonicalFormat),
      licenseKey: String(formData.get('license') ?? '') || undefined,
      visibility: String(formData.get('visibility') ?? 'group') as DocumentVisibility,
      templateKey: String(formData.get('template') ?? '') || undefined,
      sourceDocumentSlug: String(formData.get('source') ?? '') || undefined,
      importedSource: String(formData.get('importedSource') ?? '') || undefined,
      relations: relationType && relationTarget ? [{ type: relationType, targetSlug: relationTarget }] : [],
      actor,
    });
    slug = result.slug;
  } catch (err) {
    return fail(err);
  }
  redirect(`/drafts/${slug}/edit`);
}

export async function saveDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    const context = await getDocumentContext(slug, actor);
    assertEdit(actor, context.acl);

    const result = await saveWorkingCopy(
      context.document.id,
      String(formData.get('source') ?? ''),
      Number(formData.get('version') ?? 0),
      actor,
    );
    revalidatePath(`/drafts/${slug}/edit`);
    return {
      version: result.version,
      message: `Saved at ${result.updatedAt.toISOString().slice(11, 19)} UTC`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function createRevisionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    const context = await getDocumentContext(slug, actor);
    assertEdit(actor, context.acl);

    const revision = await createRevision({
      documentId: context.document.id,
      actor,
      changeSummary: String(formData.get('changeSummary') ?? '') || undefined,
    });
    invalidateReaderCache(revision.id);
    revalidatePath(`/drafts/${slug}/revisions`);
    return { message: `Revision ${revision.label} created.` };
  } catch (err) {
    return fail(err);
  }
}

export async function startReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    const context = await getDocumentContext(slug, actor);
    assertEdit(actor, context.acl);

    // Submitting for review always pins an immutable snapshot.
    const revision = await createRevision({
      documentId: context.document.id,
      actor,
      changeSummary: String(formData.get('note') ?? 'Submitted for review'),
    });
    await startReviewRound(context.document.id, revision.id, actor, String(formData.get('note') ?? ''));
    revalidatePath(`/drafts/${slug}/reviews`);
    return { message: `Review round opened on revision ${revision.label}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function createThreadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    const context = await getDocumentContext(slug, actor);
    if (!canReview(actor, context.acl)) return { error: 'Your role cannot open review threads here.' };

    const round = await currentRound(context.document.id);
    if (!round) return { error: 'No review round is open on this draft.' };

    await createThread({
      roundId: round.id,
      documentId: context.document.id,
      revisionId: round.revisionId,
      anchor: String(formData.get('anchor') ?? '') || null,
      sectionNumber: String(formData.get('sectionNumber') ?? '') || null,
      type: String(formData.get('type') ?? 'comment') as ReviewThreadType,
      body: String(formData.get('body') ?? ''),
      suggestion: String(formData.get('suggestion') ?? '') || null,
      actor,
    });
    revalidatePath(`/drafts/${slug}/reviews`);
    return { message: 'Thread opened.' };
  } catch (err) {
    return fail(err);
  }
}

export async function replyThreadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    await getDocumentContext(slug, actor);
    await replyToThread(String(formData.get('threadId') ?? ''), String(formData.get('body') ?? ''), actor);
    revalidatePath(`/drafts/${slug}/reviews`);
    return { message: 'Reply added.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setThreadStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    await getDocumentContext(slug, actor);
    await setThreadStatus(
      String(formData.get('threadId') ?? ''),
      String(formData.get('status') ?? 'resolved') as ReviewThreadStatus,
      actor,
    );
    revalidatePath(`/drafts/${slug}/reviews`);
    return { message: 'Thread updated.' };
  } catch (err) {
    return fail(err);
  }
}

export async function decideAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    const context = await getDocumentContext(slug, actor);
    if (!canApprove(actor, context.acl)) return { error: 'You cannot approve this document.' };

    await recordDecision(
      context.document.id,
      String(formData.get('revisionId') ?? ''),
      String(formData.get('gateKey') ?? 'group-approval'),
      String(formData.get('decision') ?? 'approved') === 'rejected' ? 'rejected' : 'approved',
      actor,
      context.acl,
      String(formData.get('note') ?? '') || undefined,
    );
    revalidatePath(`/drafts/${slug}/publish`);
    return { message: 'Decision recorded against the current revision checksum.' };
  } catch (err) {
    return fail(err);
  }
}

export async function publishAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    const context = await getDocumentContext(slug, actor);
    assertPublish(actor, context.acl);

    const jobId = await requestPublish(context.document.id, actor);
    revalidatePath(`/drafts/${slug}/publish`);
    return { message: `Publication job ${jobId.slice(0, 8)} queued. The worker performs the transaction.` };
  } catch (err) {
    return fail(err);
  }
}

export async function updateMetadataAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    const context = await getDocumentContext(slug, actor);
    assertEdit(actor, context.acl);

    await updateDraftMetadata(
      context.document.id,
      {
        title: String(formData.get('title') ?? '') || undefined,
        abstract: String(formData.get('abstract') ?? ''),
        visibility: String(formData.get('visibility') ?? '') as DocumentVisibility,
        intendedStatus: String(formData.get('intendedStatus') ?? '') || undefined,
        groupSlug: String(formData.get('group') ?? '') || undefined,
        type: String(formData.get('type') ?? '') || undefined,
      },
      actor,
    );
    revalidatePath(`/drafts/${slug}/settings`);
    return { message: 'Metadata updated.' };
  } catch (err) {
    return fail(err);
  }
}
