import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { groupMembers, groups, people } from '#src/db/schema.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';
import { searchDocuments } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

const ROLE_ORDER = ['owner', 'approver', 'reviewer', 'publisher', 'member'];

export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getActor();

  const rows = await db.select().from(groups).where(eq(groups.slug, decodeURIComponent(slug))).limit(1);
  const group = rows[0];
  if (!group) notFound();

  const members = await db
    .select({ handle: people.handle, displayName: people.displayName, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(people, eq(groupMembers.personId, people.id))
    .where(eq(groupMembers.groupId, group.id));

  const { items } = await searchDocuments({ groupSlug: group.slug, limit: 100 }, actor);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">{group.name}</h1>
        <p className="dl-page-subtitle">
          {group.slug} · {group.kind}
        </p>

        <section className="dl-card">
          <h2>Scope</h2>
          <p>{group.description ?? 'No description recorded.'}</p>
          {group.charter ? (
            <>
              <h3 style={{ fontSize: '0.95rem' }}>Charter</h3>
              <p>{group.charter}</p>
            </>
          ) : null}
          <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
            Contact policy: {group.contactPolicy}
          </p>
        </section>

        <section className="dl-card">
          <h2>Roles</h2>
          {ROLE_ORDER.map((role) => {
            const list = members.filter((m) => m.role === role);
            if (!list.length) return null;
            return (
              <p key={role}>
                <strong>{role}</strong>:{' '}
                {list.map((m) => (
                  <span key={`${m.handle}-${role}`}>
                    <Link href={`/people/${m.handle}`}>{m.displayName}</Link>{' '}
                  </span>
                ))}
              </p>
            );
          })}
        </section>

        <section className="dl-card">
          <h2>Documents</h2>
          {items.length ? (
            <ul>
              {items.map((d) => (
                <li key={d.id}>
                  <Link href={`/doc/${d.slug}`}>{d.documentNumber ?? d.slug}</Link> — {d.title}{' '}
                  <span className={`dl-status-chip dl-state-${d.status}`}>{d.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dl-muted">No documents visible to you in this group.</p>
          )}
        </section>
      </div>
    </>
  );
}
