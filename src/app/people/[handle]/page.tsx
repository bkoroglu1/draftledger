import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { documentAuthors, documents, groupMembers, groups, people } from '#src/db/schema.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';
import { emailFor, searchDocuments } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

/** Local person profile. Contributions are filtered by what the viewer may see. */
export default async function PersonPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const actor = await getActor();

  const rows = await db.select().from(people).where(eq(people.handle, decodeURIComponent(handle))).limit(1);
  const person = rows[0];
  if (!person) notFound();

  const memberships = await db
    .select({ slug: groups.slug, name: groups.name, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.personId, person.id));

  const authored = await db
    .select({ documentId: documentAuthors.documentId, role: documentAuthors.role })
    .from(documentAuthors)
    .where(eq(documentAuthors.personId, person.id));

  // Reuse the visibility-filtered listing so private drafts never leak here.
  const visible = await searchDocuments({ limit: 200 }, actor);
  const authoredIds = new Set(authored.map((a) => a.documentId));
  const contributions = visible.items.filter((d) => authoredIds.has(d.id));

  const ownedRows = await db
    .select({ slug: documents.slug, title: documents.title, status: documents.status })
    .from(documents)
    .where(and(eq(documents.ownerId, person.id), inArray(documents.status, ['published'])))
    .orderBy(desc(documents.publishedAt))
    .limit(20);

  const email = emailFor(person.email, person.emailVisibility, actor);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">{person.displayName}</h1>
        <p className="dl-page-subtitle">
          {person.handle} · {person.orgRole}
          {person.isExternal ? ' · external identity' : ''}
        </p>

        <section className="dl-card">
          <h2>Profile</h2>
          <dl>
            <div className="dl-info-row">
              <dt>Affiliation</dt>
              <dd>{person.affiliation ?? '—'}</dd>
            </div>
            <div className="dl-info-row">
              <dt>Email</dt>
              <dd>
                {email ? (
                  <a href={`mailto:${email}`}>{email}</a>
                ) : (
                  <span className="dl-muted">
                    Not visible to you (visibility: {person.emailVisibility})
                  </span>
                )}
              </dd>
            </div>
            {person.isExternal ? (
              <div className="dl-info-row">
                <dt>Provenance</dt>
                <dd>
                  {person.externalSource ?? 'unknown source'}
                  {person.externalRef ? ` · ${person.externalRef}` : ''}
                </dd>
              </div>
            ) : null}
            {person.bio ? (
              <div className="dl-info-row">
                <dt>Bio</dt>
                <dd>{person.bio}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="dl-card">
          <h2>Groups</h2>
          {memberships.length ? (
            <ul>
              {memberships.map((m) => (
                <li key={`${m.slug}-${m.role}`}>
                  <Link href={`/groups/${m.slug}`}>{m.name}</Link> — {m.role}
                </li>
              ))}
            </ul>
          ) : (
            <p className="dl-muted">No group memberships.</p>
          )}
        </section>

        <section className="dl-card">
          <h2>Document contributions</h2>
          {contributions.length ? (
            <ul>
              {contributions.map((d) => (
                <li key={d.id}>
                  <Link href={`/doc/${d.slug}`}>{d.documentNumber ?? d.slug}</Link> — {d.title}{' '}
                  <span className={`dl-status-chip dl-state-${d.status}`}>{d.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dl-muted">No contributions visible to you.</p>
          )}
        </section>

        {ownedRows.length ? (
          <section className="dl-card">
            <h2>Owned publications</h2>
            <ul>
              {ownedRows.map((d) => (
                <li key={d.slug}>
                  <Link href={`/doc/${d.slug}`}>{d.slug}</Link> — {d.title}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
