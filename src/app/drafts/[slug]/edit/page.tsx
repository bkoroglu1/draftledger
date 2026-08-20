import { notFound, redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DraftEditor } from '#src/components/DraftEditor.tsx';
import { DraftNav } from '#src/components/DraftNav.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';
import { canEditDraft } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function EditDraftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/drafts/${slug}/edit`);

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const editable = canEditDraft(actor, context.acl);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <DraftNav slug={doc.slug} title={doc.title} status={doc.status} active="edit" />
        {doc.origin === 'external-import' ? (
          <p className="dl-notice">
            This document was imported and is read-only. Use <strong>Create local fork</strong> or
            propose a related document instead of editing it.
          </p>
        ) : null}
        <DraftEditor
          slug={doc.slug}
          initialSource={doc.workingSource}
          initialVersion={doc.workingSourceVersion}
          canEdit={editable}
        />
      </div>
    </>
  );
}
