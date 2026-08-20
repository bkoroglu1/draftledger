import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DraftNav } from '#src/components/DraftNav.tsx';
import { NewThreadForm, StartReviewForm, ThreadActions } from '#src/components/ReviewPanel.tsx';
import { getActor } from '#src/services/auth.ts';
import { currentReadableRevision, getDocumentContext, listSections } from '#src/services/documents.ts';
import { listRounds } from '#src/services/reviews.ts';
import { canEditDraft, canReview } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function ReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/drafts/${slug}/reviews`);

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const rounds = await listRounds(doc.id);
  const revision = await currentReadableRevision(doc).catch(() => null);
  const sections = revision ? await listSections(revision.id) : [];

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <DraftNav slug={doc.slug} title={doc.title} status={doc.status} active="reviews" />

        {canEditDraft(actor, context.acl) ? <StartReviewForm slug={doc.slug} /> : null}
        {canReview(actor, context.acl) && rounds.length ? (
          <NewThreadForm
            slug={doc.slug}
            sections={sections.map((s) => ({ anchor: s.anchor, number: s.number, title: s.title }))}
          />
        ) : null}

        {rounds.length === 0 ? (
          <p className="dl-notice">No review round has been opened on this draft yet.</p>
        ) : null}

        {rounds.map((round) => (
          <section className="dl-card" key={round.id}>
            <h2>
              Round {round.sequence} — revision{' '}
              <Link href={`/doc/html/${round.revisionSlug}`}>{round.revisionLabel}</Link>
            </h2>
            <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
              Opened {round.createdAt.toISOString().slice(0, 16).replace('T', ' ')} by{' '}
              {round.requestedByName ?? 'unknown'} · {round.status}
              {round.note ? ` · ${round.note}` : ''}
            </p>

            {round.threads.length === 0 ? (
              <p className="dl-muted">No threads in this round.</p>
            ) : (
              round.threads.map((thread) => (
                <article
                  className="dl-thread"
                  key={thread.id}
                  data-status={thread.status}
                  data-type={thread.type}
                >
                  <header>
                    <strong>{thread.type}</strong>
                    {thread.anchor ? (
                      <>
                        {' on '}
                        <Link href={`/doc/html/${round.revisionSlug}#${thread.anchor}`}>
                          {thread.sectionNumber ? `Section ${thread.sectionNumber}` : thread.anchor}
                        </Link>
                      </>
                    ) : (
                      ' on the whole document'
                    )}{' '}
                    <span className={`dl-status-chip dl-state-${thread.status === 'open' ? 'review' : 'approved'}`}>
                      {thread.status}
                    </span>
                    {thread.isOrphaned ? (
                      <span className="dl-muted"> · orphaned: the anchor no longer exists</span>
                    ) : null}
                  </header>
                  {thread.comments.map((comment) => (
                    <div className="dl-comment" key={comment.id}>
                      <div className="dl-muted" style={{ fontSize: '0.75rem' }}>
                        {comment.authorName ?? 'Unknown'} ·{' '}
                        {comment.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                      </div>
                      <p style={{ margin: '0.2rem 0' }}>{comment.body}</p>
                      {comment.suggestion ? (
                        <pre className="dl-page" style={{ margin: 0 }}>
                          {comment.suggestion}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                  {canReview(actor, context.acl) || canEditDraft(actor, context.acl) ? (
                    <ThreadActions slug={doc.slug} threadId={thread.id} status={thread.status} />
                  ) : null}
                </article>
              ))
            )}
          </section>
        ))}
      </div>
    </>
  );
}
