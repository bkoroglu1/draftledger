import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';
import { listErrata } from '#src/services/errata.ts';
import { canApprove, canReportErratum } from '#src/services/rbac.ts';
import { ErratumStatusForm } from '#src/components/ErratumStatusForm.tsx';

export const dynamic = 'force-dynamic';

const STATUS_ORDER = ['verified', 'reported', 'held', 'rejected'] as const;

export default async function ErrataPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const { view } = await searchParams;
  const actor = await getActor();

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const entries = await listErrata(doc.id);
  const canVerify = canApprove(actor, context.acl);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">Errata — {doc.title}</h1>
        <p className="dl-page-subtitle">
          {doc.documentNumber ?? doc.slug} · <Link href={`/doc/${doc.slug}`}>Back to status</Link>
          {canReportErratum(actor, context.acl) ? (
            <>
              {' · '}
              <Link href={`/doc/${doc.slug}/errata/new`}>Report erratum</Link>
            </>
          ) : null}
        </p>

        {view === 'with-errata' ? (
          <p className="dl-notice">
            The with-errata reader view annotates the published text with verified errata. Verified
            entries below carry the section anchor they apply to; open the reader and follow the
            anchor to see the affected text. The published artifact itself is never rewritten.
          </p>
        ) : null}

        {entries.length === 0 ? (
          <p className="dl-notice">No errata have been filed against this document.</p>
        ) : (
          STATUS_ORDER.map((status) => {
            const group = entries.filter((e) => e.status === status);
            if (!group.length) return null;
            return (
              <section className="dl-card" key={status}>
                <h2>
                  {status.charAt(0).toUpperCase() + status.slice(1)} ({group.length})
                </h2>
                {group.map((entry) => (
                  <article key={entry.id} className="dl-thread" data-status={entry.status}>
                    <h3 style={{ marginTop: 0, fontSize: '0.95rem' }}>
                      Erratum {entry.number} — {entry.type}
                      {entry.sectionAnchor ? (
                        <>
                          {' · '}
                          <Link href={`/doc/html/${doc.slug}#${entry.sectionAnchor}`}>
                            Section {entry.sectionNumber ?? entry.sectionAnchor}
                          </Link>
                        </>
                      ) : null}
                    </h3>
                    <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
                      Reported by {entry.reporterName ?? 'unknown'} on{' '}
                      {entry.createdAt.toISOString().slice(0, 10)}
                      {entry.affectedRevisionLabel ? (
                        <>
                          {' · affects '}
                          <Link href={`/doc/html/${entry.affectedRevisionSlug}`}>
                            {entry.affectedRevisionLabel}
                          </Link>
                        </>
                      ) : null}
                      {entry.verifierName
                        ? ` · verified by ${entry.verifierName} on ${entry.verifiedAt?.toISOString().slice(0, 10)}`
                        : ''}
                    </p>
                    {entry.originalText ? (
                      <>
                        <p style={{ margin: '0.25rem 0 0' }}>
                          <strong>Original</strong>
                        </p>
                        <pre className="dl-page" style={{ margin: 0 }}>
                          {entry.originalText}
                        </pre>
                      </>
                    ) : null}
                    {entry.correctedText ? (
                      <>
                        <p style={{ margin: '0.5rem 0 0' }}>
                          <strong>Corrected</strong>
                        </p>
                        <pre className="dl-page" style={{ margin: 0 }}>
                          {entry.correctedText}
                        </pre>
                      </>
                    ) : null}
                    {entry.notes ? <p>{entry.notes}</p> : null}
                    {entry.resolution ? (
                      <p className="dl-muted">Resolution: {entry.resolution}</p>
                    ) : null}
                    {canVerify ? <ErratumStatusForm erratumId={entry.id} status={entry.status} /> : null}
                  </article>
                ))}
              </section>
            );
          })
        )}
      </div>
    </>
  );
}
