import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { groupMembers, people } from '#src/db/schema.ts';
import { isAppError } from '#src/domain/errors.ts';
import { config } from '#src/lib/config.ts';
import { RENDER_PREFS_COOKIE, parseRenderPrefsCookie } from '#src/lib/prefs.ts';
import { InfoPanel } from '#src/components/reader/InfoPanel.tsx';
import { ReaderShell } from '#src/components/reader/ReaderShell.tsx';
import type { ContentsItem } from '#src/components/reader/ContentsTree.tsx';
import { getActor } from '#src/services/auth.ts';
import {
  countDisclosures,
  countErrata,
  groupRelations,
  listArtifacts,
  listFamilyRevisions,
  listRelations,
  listSections,
  resolveReaderTarget,
} from '#src/services/documents.ts';
import { renderForReader } from '#src/services/reader.ts';
import { canReportErratum } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const actor = await getActor();
    const { context } = await resolveReaderTarget(decodeURIComponent(slug), actor);
    return { title: `${context.document.documentNumber ?? context.document.slug} — ${context.document.title}` };
  } catch {
    return { title: 'Document' };
  }
}

export default async function ReaderPage({ params }: PageProps) {
  const { slug } = await params;
  const actor = await getActor();

  let target;
  try {
    target = await resolveReaderTarget(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && (err.code === 'not_found' || err.code === 'invalid_slug')) notFound();
    throw err;
  }

  const { context, revision } = target;
  const doc = context.document;

  const jar = await cookies();
  const renderPrefs = parseRenderPrefsCookie(jar.get(RENDER_PREFS_COOKIE)?.value);
  const render = await renderForReader(
    revision.id,
    renderPrefs.htmlization,
    renderPrefs.citationLinks,
  );

  const [sectionRows, artifactRows, relations, errataCounts, disclosureCount, familyRevisions] =
    await Promise.all([
      listSections(revision.id),
      listArtifacts(revision.id),
      listRelations(doc.id),
      countErrata(doc.id),
      countDisclosures(doc.id),
      listFamilyRevisions(doc.familyKey),
    ]);

  const contents: ContentsItem[] = sectionRows.map((s) => ({
    anchor: s.anchor,
    number: s.number,
    title: s.title,
    depth: s.depth,
    isAppendix: s.anchor.startsWith('appendix-'),
    pageNumber: s.pageNumber,
  }));

  const grouped = groupRelations(relations);

  const groupPeople = doc.groupId
    ? await db
        .select({ handle: people.handle, displayName: people.displayName, role: groupMembers.role })
        .from(groupMembers)
        .innerJoin(people, eq(groupMembers.personId, people.id))
        .where(and(eq(groupMembers.groupId, doc.groupId), inArray(groupMembers.role, ['reviewer', 'approver'])))
    : [];

  const wasDraftRow = familyRevisions.find((r) => r.documentSlug !== doc.slug);

  return (
    <ReaderShell
      brandName={config.app.brandName}
      documentLabel={doc.documentNumber ?? doc.slug}
      documentHref={`/doc/${doc.slug}`}
      statusLabel={`${labelForType(doc.type)} — ${labelForStatus(doc.status)}`}
      statusState={doc.status}
      pages={render.pages.map((p) => p.html)}
      contents={contents}
      htmlAvailable={artifactRows.some((a) => a.format === 'html')}
      activeHtmlization={render.mode}
      activeCitationMode={renderPrefs.citationLinks}
      bugReportUrl={config.app.bugReportUrl}
      info={
        <InfoPanel
          documentSlug={doc.slug}
          documentLabel={doc.documentNumber ?? doc.slug}
          documentType={labelForType(doc.type)}
          statusLabel={labelForStatus(doc.status)}
          origin={doc.origin}
          createdAt={doc.createdAt}
          lastRevisedAt={revision.createdAt}
          publishedAt={doc.publishedAt}
          pages={revision.pages}
          seriesLabel={context.namespace?.label ?? config.documents.defaultNamespace}
          groupSlug={context.group?.slug ?? null}
          groupName={context.group?.name ?? null}
          ownerName={context.owner?.displayName ?? null}
          ownerHandle={context.owner?.handle ?? null}
          authors={context.authors}
          reviewers={groupPeople.filter((p) => p.role === 'reviewer')}
          approvers={groupPeople.filter((p) => p.role === 'approver')}
          relations={{
            updates: grouped.updates,
            updatedBy: grouped.updatedBy,
            obsoletes: grouped.obsoletes,
            obsoletedBy: grouped.obsoletedBy,
            derivedFrom: grouped.derivedFrom,
            replaces: grouped.replaces,
          }}
          wasDraft={
            wasDraftRow ? { slug: wasDraftRow.slug, label: `${wasDraftRow.documentSlug} ${wasDraftRow.label}` } : null
          }
          errataCounts={errataCounts}
          disclosureCount={disclosureCount}
          revisionOptions={familyRevisions.map((r) => ({
            slug: r.slug,
            label: r.label,
            date: new Date(r.createdAt).toISOString().slice(0, 10),
            checksum: r.sourceSha256.slice(0, 8),
            family: r.documentSlug,
          }))}
          currentRevisionSlug={revision.slug}
          currentRevisionLabel={revision.label}
          checksum={revision.sourceSha256}
          parserVersion={revision.parserVersion}
          rendererVersion={revision.rendererVersion}
          syncState={doc.syncState}
          lastSyncedAt={doc.lastSyncedAt}
          sourceUrl={doc.sourceUrl}
          canReportErrata={canReportErratum(actor, context.acl)}
          canStartUpdate={doc.status === 'published' && Boolean(actor)}
          discussionHref={
            doc.status === 'published' && wasDraftRow
              ? `/drafts/${wasDraftRow.documentSlug}/reviews`
              : `/drafts/${doc.slug}/reviews`
          }
        />
      }
    />
  );
}

function labelForStatus(status: string): string {
  return status
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function labelForType(type: string): string {
  if (type === 'standard') return 'Standard';
  if (type === 'external') return 'External reference';
  return type.charAt(0).toUpperCase() + type.slice(1);
}
