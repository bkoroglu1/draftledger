import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { auditEvents, documents, people, reviewRounds, reviewThreads } from '#src/db/schema.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';
import { listDraftsForActor } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/workspace');

  const drafts = await listDraftsForActor(actor);
  const draftIds = drafts.map((d) => d.id);

  const openThreads = draftIds.length
    ? await db
        .select({
          id: reviewThreads.id,
          documentId: reviewThreads.documentId,
          type: reviewThreads.type,
          sectionNumber: reviewThreads.sectionNumber,
          status: reviewThreads.status,
        })
        .from(reviewThreads)
        .where(inArray(reviewThreads.documentId, draftIds))
    : [];

  const rounds = draftIds.length
    ? await db
        .select({ documentId: reviewRounds.documentId, status: reviewRounds.status })
        .from(reviewRounds)
        .where(inArray(reviewRounds.documentId, draftIds))
    : [];

  const activity = draftIds.length
    ? await db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          summary: auditEvents.summary,
          createdAt: auditEvents.createdAt,
          documentId: auditEvents.documentId,
          actorName: people.displayName,
        })
        .from(auditEvents)
        .leftJoin(people, eq(auditEvents.actorId, people.id))
        .where(inArray(auditEvents.documentId, draftIds))
        .orderBy(desc(auditEvents.createdAt))
        .limit(20)
    : [];

  const slugById = new Map(drafts.map((d) => [d.id, d.slug]));
  const awaitingReview = drafts.filter((d) => d.status === 'review' || d.status === 'changes-requested');

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">Workspace</h1>
        <p className="dl-page-subtitle">
          {actor.displayName} · {actor.orgRole}
        </p>

        <section className="dl-card">
          <h2>Your drafts</h2>
          {drafts.length ? (
            <div className="dl-table-scroll">
              <table className="dl-table">
                <thead>
                  <tr>
                    <th scope="col">Draft</th>
                    <th scope="col">Status</th>
                    <th scope="col">Open threads</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((draft) => {
                    const open = openThreads.filter(
                      (t) => t.documentId === draft.id && t.status === 'open',
                    );
                    return (
                      <tr key={draft.id}>
                        <td>
                          <Link href={`/drafts/${draft.slug}/edit`}>{draft.slug}</Link>
                          <div className="dl-muted" style={{ fontSize: '0.8125rem' }}>
                            {draft.title}
                          </div>
                        </td>
                        <td>
                          <span className={`dl-status-chip dl-state-${draft.status}`}>{draft.status}</span>
                        </td>
                        <td>
                          {open.length}
                          {open.some((t) => t.type === 'blocking') ? (
                            <span className="dl-muted"> (blocking)</span>
                          ) : null}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <Link href={`/drafts/${draft.slug}/edit`}>Edit</Link>{' · '}
                          <Link href={`/drafts/${draft.slug}/reviews`}>Reviews</Link>{' · '}
                          <Link href={`/drafts/${draft.slug}/revisions`}>Revisions</Link>{' · '}
                          <Link href={`/drafts/${draft.slug}/publish`}>Publish</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="dl-muted">
              You have no drafts yet. <Link href="/drafts/new">Start one</Link>.
            </p>
          )}
        </section>

        <section className="dl-card">
          <h2>Awaiting review</h2>
          {awaitingReview.length ? (
            <ul>
              {awaitingReview.map((d) => (
                <li key={d.id}>
                  <Link href={`/drafts/${d.slug}/reviews`}>{d.slug}</Link> — {d.title} (
                  {rounds.filter((r) => r.documentId === d.id && r.status === 'open').length} open round(s))
                </li>
              ))}
            </ul>
          ) : (
            <p className="dl-muted">Nothing is waiting on a review decision.</p>
          )}
        </section>

        <section className="dl-card">
          <h2>Recent activity</h2>
          {activity.length ? (
            <ul>
              {activity.map((event) => (
                <li key={event.id}>
                  <span className="dl-mono dl-muted">
                    {event.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>{' '}
                  <code className="dl-mono">{event.action}</code> —{' '}
                  {event.documentId && slugById.has(event.documentId) ? (
                    <Link href={`/drafts/${slugById.get(event.documentId)}/revisions`}>
                      {slugById.get(event.documentId)}
                    </Link>
                  ) : null}{' '}
                  {event.summary}{' '}
                  <span className="dl-muted">by {event.actorName ?? 'System'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dl-muted">No recorded activity yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
