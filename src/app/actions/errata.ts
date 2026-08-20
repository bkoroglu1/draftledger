'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { documents, errata } from '#src/db/schema.ts';
import { isAppError } from '#src/domain/errors.ts';
import type { ErratumStatus } from '#src/domain/types.ts';
import { requireActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';
import { reportErratum, setErratumStatus } from '#src/services/errata.ts';
import { canApprove, canReportErratum } from '#src/services/rbac.ts';

export async function reportErratumAction(_prev: { error?: string } | null, formData: FormData) {
  try {
    const actor = await requireActor();
    const slug = String(formData.get('slug') ?? '');
    const context = await getDocumentContext(slug, actor);
    if (!canReportErratum(actor, context.acl)) {
      return { error: 'You cannot report errata against this document.' };
    }

    await reportErratum({
      documentId: context.document.id,
      revisionId: context.document.publishedRevisionId,
      type: (String(formData.get('type') ?? 'editorial') === 'technical' ? 'technical' : 'editorial'),
      sectionAnchor: String(formData.get('sectionAnchor') ?? '') || null,
      sectionNumber: String(formData.get('sectionNumber') ?? '') || null,
      originalText: String(formData.get('originalText') ?? '') || null,
      correctedText: String(formData.get('correctedText') ?? '') || null,
      notes: String(formData.get('notes') ?? '') || null,
      actor,
    });
    revalidatePath(`/doc/${slug}/errata`);
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not file the erratum.' };
  }
  redirect(`/doc/${String(formData.get('slug') ?? '')}/errata`);
}

export async function setErratumStatusAction(_prev: { error?: string } | null, formData: FormData) {
  try {
    const actor = await requireActor();
    const erratumId = String(formData.get('erratumId') ?? '');
    const status = String(formData.get('status') ?? 'reported') as ErratumStatus;

    const rows = await db
      .select({ documentSlug: documents.slug })
      .from(errata)
      .innerJoin(documents, eq(errata.documentId, documents.id))
      .where(eq(errata.id, erratumId))
      .limit(1);
    if (!rows[0]) return { error: 'Erratum not found.' };

    const context = await getDocumentContext(rows[0].documentSlug, actor);
    if (!canApprove(actor, context.acl)) return { error: 'You cannot verify errata here.' };

    await setErratumStatus(erratumId, status, actor, String(formData.get('resolution') ?? '') || undefined);
    revalidatePath(`/doc/${rows[0].documentSlug}/errata`);
    return { error: undefined };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not update the erratum.' };
  }
}
