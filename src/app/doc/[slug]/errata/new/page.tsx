import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { ErratumForm } from '#src/components/ErratumForm.tsx';
import { getActor } from '#src/services/auth.ts';
import { currentReadableRevision, getDocumentContext, listSections } from '#src/services/documents.ts';
import { canReportErratum } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function NewErratumPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/doc/${slug}/errata/new`);

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  if (!canReportErratum(actor, context.acl)) {
    return (
      <>
        <AppBar actor={actor} />
        <div className="dl-app">
          <h1 className="dl-page-title">Report erratum</h1>
          <p className="dl-error">
            Errata can only be filed against published documents you are allowed to read.
          </p>
          <Link href={`/doc/${doc.slug}`}>Back to the document</Link>
        </div>
      </>
    );
  }

  const revision = await currentReadableRevision(doc);
  const sections = await listSections(revision.id);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">Report erratum — {doc.title}</h1>
        <p className="dl-page-subtitle">
          {doc.documentNumber ?? doc.slug} · affects revision {revision.label}
        </p>
        <p className="dl-notice">
          A published document is never edited in place. A verified erratum is shown next to the
          published text; a normative change needs an update or obsoleting document instead.
        </p>
        <ErratumForm
          slug={doc.slug}
          sections={sections.map((s) => ({
            anchor: s.anchor,
            number: s.number,
            title: s.title,
          }))}
        />
      </div>
    </>
  );
}
