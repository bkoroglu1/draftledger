import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { groupMembers, people } from '#src/db/schema.ts';
import { isAppError } from '#src/domain/errors.ts';
import { config } from '#src/lib/config.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DocumentHeader } from '#src/components/DocumentHeader.tsx';
import { Timeline } from '#src/components/Timeline.tsx';
import { getActor } from '#src/services/auth.ts';
import {
  countDisclosures,
  countErrata,
  currentReadableRevision,
  getPublication,
  groupRelations,
  listArtifacts,
  listFamilyRevisions,
  listRelations,
  getDocumentContext,
} from '#src/services/documents.ts';
import { buildTimeline } from '#src/services/timeline.ts';
import { canSeeRecipientAddresses } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function StatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getActor();

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const [revision, relations, errataCounts, disclosures, publication, familyRevisions, timeline] =
    await Promise.all([
      currentReadableRevision(doc).catch(() => null),
      listRelations(doc.id),
      countErrata(doc.id),
      countDisclosures(doc.id),
      getPublication(doc.id),
      listFamilyRevisions(doc.familyKey),
      buildTimeline(doc.familyKey),
    ]);

  const artifactRows = revision ? await listArtifacts(revision.id) : [];
  const grouped = groupRelations(relations);
  const groupPeople = doc.groupId
    ? await db
        .select({ handle: people.handle, displayName: people.displayName, role: groupMembers.role })
        .from(groupMembers)
        .innerJoin(people, eq(groupMembers.personId, people.id))
        .where(
          and(
            eq(groupMembers.groupId, doc.groupId),
            inArray(groupMembers.role, ['reviewer', 'approver', 'publisher', 'owner']),
          ),
        )
    : [];

  const showAddresses = canSeeRecipientAddresses(actor, context.acl);
  const draftRow = familyRevisions.find((r) => r.documentSlug !== doc.slug);
  const referenceCount = grouped.normativeReferences.length + grouped.informativeReferences.length;

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <DocumentHeader
          slug={doc.slug}
          title={doc.title}
          identifier={doc.documentNumber ?? doc.slug}
          statusLabel={labelize(doc.status)}
          statusState={doc.status}
          active=""
        />

        <section className="dl-card" aria-labelledby="timeline-heading">
          <h2 id="timeline-heading">Lifecycle timeline</h2>
          <p className="dl-muted" style={{ marginTop: 0, fontSize: '0.8125rem' }}>
            Derived from revision, publication and audit records — the same event stream the History
            tab reads.
          </p>
          <Timeline model={timeline} />
        </section>

        <section className="dl-card" aria-labelledby="status-heading">
          <h2 id="status-heading">Status metadata</h2>
          <div className="dl-table-scroll">
            <table className="dl-table">
              <tbody>
                <Group label="Document" />
                <Row label="Type / status">
                  {labelize(doc.type)} — {labelize(doc.status)}
                  {doc.intendedStatus ? ` (intended: ${labelize(doc.intendedStatus)})` : ''}
                </Row>
                <Row label="Created">{fmt(doc.createdAt)}</Row>
                <Row label="Published">{fmt(doc.publishedAt)}</Row>
                <Row label="Errata">
                  <Link href={`/doc/${doc.slug}/errata`}>
                    {Object.entries(errataCounts)
                      .map(([k, v]) => `${v} ${k}`)
                      .join(', ') || 'none'}
                  </Link>
                </Row>
                <Row label="Disclosures">
                  <Link href={`/doc/${doc.slug}/ipr`}>{disclosures}</Link>
                </Row>
                <Row label="Updates / Updated by">
                  <Rels list={grouped.updates} /> / <Rels list={grouped.updatedBy} />
                </Row>
                <Row label="Obsoletes / Obsoleted by">
                  <Rels list={grouped.obsoletes} /> / <Rels list={grouped.obsoletedBy} />
                </Row>
                <Row label="Replaces / Derived from">
                  <Rels list={grouped.replaces} /> / <Rels list={grouped.derivedFrom} />
                </Row>
                <Row label="Draft family">
                  {draftRow ? (
                    <Link href={`/drafts/${draftRow.documentSlug}/revisions`}>
                      {draftRow.documentSlug}
                    </Link>
                  ) : (
                    <span className="dl-muted">This document is the draft family root.</span>
                  )}
                </Row>

                <Group label="People" />
                <Row label="Authors">
                  {context.authors
                    .filter((a) => a.role === 'author')
                    .map((a) => (
                      <span key={a.personId}>
                        <Link href={`/people/${a.handle}`}>{a.displayName}</Link>{' '}
                      </span>
                    ))}
                </Row>
                <Row label="Editors">
                  {context.authors.filter((a) => a.role === 'editor').length
                    ? context.authors
                        .filter((a) => a.role === 'editor')
                        .map((a) => (
                          <span key={a.personId}>
                            <Link href={`/people/${a.handle}`}>{a.displayName}</Link>{' '}
                          </span>
                        ))
                    : dash()}
                </Row>
                <Row label="Reviewers">
                  {names(groupPeople.filter((p) => p.role === 'reviewer'))}
                </Row>
                <Row label="Approvers">
                  {names(groupPeople.filter((p) => p.role === 'approver'))}
                </Row>
                <Row label="Publishers">
                  {names(groupPeople.filter((p) => p.role === 'publisher'))}
                </Row>

                <Group label="Last updated" />
                <Row label="Most recent change">{fmt(doc.updatedAt)}</Row>
                <Row label="Current revision">
                  {revision ? (
                    <Link href={`/doc/html/${revision.slug}`}>
                      {revision.label} ({fmt(revision.createdAt)})
                    </Link>
                  ) : (
                    dash()
                  )}
                </Row>

                <Group label="Series / Namespace" />
                <Row label="Series">{context.namespace?.label ?? config.documents.defaultNamespace}</Row>
                <Row label="Numbering">{context.namespace?.numberPattern ?? '—'}</Row>
                <Row label="Group / project">
                  {context.group ? (
                    <Link href={`/groups/${context.group.slug}`}>{context.group.name}</Link>
                  ) : (
                    dash()
                  )}
                </Row>

                <Group label="Formats" />
                <Row label="Artifacts">
                  {revision ? (
                    artifactRows.map((a) => (
                      <span key={a.id}>
                        <a href={`/artifacts/${revision.slug}/${a.format}`}>{a.format}</a>{' '}
                      </span>
                    ))
                  ) : (
                    dash()
                  )}
                  <Link href={`/doc/${doc.slug}/bibtex`}>bibtex</Link>
                </Row>

                <Group label="Additional resources" />
                <Row label="Discussion">
                  <Link href={`/drafts/${draftRow?.documentSlug ?? doc.slug}/reviews`}>
                    Review rounds &amp; threads
                  </Link>
                </Row>
                <Row label="References">
                  <Link href={`/doc/${doc.slug}/references`}>{referenceCount} outgoing</Link>
                  {' · '}
                  <Link href={`/doc/${doc.slug}/referenced-by`}>
                    {grouped.referencedBy.length} incoming
                  </Link>
                </Row>
                <Row label="Notifications">
                  <Link href={`/doc/${doc.slug}/email-expansions`}>Recipient expansion</Link>
                </Row>

                <Group label="Responsibility" />
                <Row label="Owner">
                  {context.owner ? (
                    <>
                      <Link href={`/people/${context.owner.handle}`}>{context.owner.displayName}</Link>
                      {showAddresses && context.owner.email ? (
                        <span className="dl-muted"> · {context.owner.email}</span>
                      ) : null}
                    </>
                  ) : (
                    dash()
                  )}
                </Row>
                <Row label="Owning group">
                  {names(groupPeople.filter((p) => p.role === 'owner'))}
                </Row>
                <Row label="Published by">
                  {publication?.publishedBy ? 'Recorded in the publication manifest' : dash()}
                </Row>

                <Group label="Provenance" />
                <Row label="Canonical checksum">
                  <span className="dl-mono">{revision?.sourceSha256 ?? '—'}</span>
                </Row>
                <Row label="Renderer">
                  {revision ? `${revision.parserVersion} · ${revision.rendererVersion}` : dash()}
                </Row>
                <Row label="Origin">
                  {doc.origin}
                  {doc.origin !== 'local' ? ` · ${doc.syncState}` : ''}
                  {doc.lastSyncedAt ? ` · synced ${fmt(doc.lastSyncedAt)}` : ''}
                </Row>
                <Row label="Publication manifest">
                  {publication ? (
                    <code className="dl-mono" style={{ fontSize: '0.75rem' }}>
                      {JSON.stringify(publication.manifest)}
                    </code>
                  ) : (
                    dash()
                  )}
                </Row>
              </tbody>
            </table>
          </div>

          <div className="dl-actions">
            {showAddresses && context.authors.some((a) => a.email) ? (
              <a
                className="dl-button"
                href={`mailto:${context.authors
                  .map((a) => a.email)
                  .filter(Boolean)
                  .join(',')}`}
              >
                Email authors
              </a>
            ) : null}
            {context.group ? (
              <Link className="dl-button" href={`/groups/${context.group.slug}`}>
                Owner group
              </Link>
            ) : null}
            <Link className="dl-button" href={`/doc/${doc.slug}/ipr`}>
              Disclosures ({disclosures})
            </Link>
            <Link className="dl-button" href={`/doc/${doc.slug}/references`}>
              References ({referenceCount})
            </Link>
            <Link className="dl-button" href={`/doc/${doc.slug}/referenced-by`}>
              Referenced by ({grouped.referencedBy.length})
            </Link>
            <Link className="dl-button" href={`/?q=${encodeURIComponent(doc.title)}`}>
              Search related
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row" style={{ width: '14rem' }}>
        {label}
      </th>
      <td>{children}</td>
    </tr>
  );
}

function Group({ label }: { label: string }) {
  return (
    <tr>
      <th colSpan={2} style={{ paddingTop: '1rem', color: 'var(--dl-fg)' }}>
        {label}
      </th>
    </tr>
  );
}

function Rels({ list }: { list: Array<{ targetSlug: string | null; targetNumber: string | null }> }) {
  if (!list.length) return <span className="dl-muted">—</span>;
  return (
    <>
      {list.map((r) => (
        <span key={r.targetSlug}>
          <Link href={`/doc/html/${r.targetSlug}`}>{r.targetNumber ?? r.targetSlug}</Link>{' '}
        </span>
      ))}
    </>
  );
}

function names(list: Array<{ handle: string; displayName: string }>) {
  if (!list.length) return dash();
  return list.map((p) => (
    <span key={p.handle}>
      <Link href={`/people/${p.handle}`}>{p.displayName}</Link>{' '}
    </span>
  ));
}

function dash() {
  return <span className="dl-muted">—</span>;
}

function fmt(date: Date | null): string {
  return date ? new Date(date).toISOString().slice(0, 10) : '—';
}

function labelize(value: string): string {
  return value
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
