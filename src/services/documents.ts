import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import {
  artifacts,
  documentAuthors,
  documentRelations,
  documents,
  errata,
  groups,
  iprDisclosures,
  licenseProfiles,
  namespaces,
  people,
  publications,
  revisions,
  sections,
} from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import type { DocumentOrigin, DocumentVisibility, LifecycleState, RelationType } from '#src/domain/types.ts';
import { canReadDocument, type Actor, type DocumentAcl } from './rbac.ts';

export type DocumentRow = typeof documents.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type SectionRow = typeof sections.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;

export interface AuthorView {
  personId: string;
  handle: string;
  displayName: string;
  role: string;
  position: number;
  affiliation: string | null;
  /** Only populated when the viewer is allowed to see it. */
  email: string | null;
  isExternal: boolean;
}

export interface RelationView {
  type: RelationType | string;
  direction: 'outbound' | 'inbound';
  targetSlug: string | null;
  targetTitle: string | null;
  targetDocumentId: string | null;
  targetNumber: string | null;
  sourceSystem: string;
}

export interface DocumentContext {
  document: DocumentRow;
  namespace: typeof namespaces.$inferSelect | null;
  group: typeof groups.$inferSelect | null;
  owner: typeof people.$inferSelect | null;
  license: typeof licenseProfiles.$inferSelect | null;
  authors: AuthorView[];
  acl: DocumentAcl;
}

/** Slug validation for locally created documents and drafts. */
const LOCAL_SLUG_RE = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/;

export function assertValidSlug(slug: string): string {
  if (!LOCAL_SLUG_RE.test(slug) || slug.length > 96) {
    throw appError('invalid_slug', `"${slug}" is not a valid document identifier.`);
  }
  return slug;
}

export function toAcl(doc: DocumentRow, authors: AuthorView[]): DocumentAcl {
  return {
    id: doc.id,
    ownerId: doc.ownerId,
    groupId: doc.groupId,
    visibility: doc.visibility,
    origin: doc.origin,
    status: doc.status,
    authorIds: authors.filter((a) => a.role === 'author').map((a) => a.personId),
    editorIds: authors.filter((a) => a.role === 'editor').map((a) => a.personId),
  };
}

export async function loadAuthors(documentId: string, actor: Actor | null): Promise<AuthorView[]> {
  const rows = await db
    .select({
      personId: documentAuthors.personId,
      role: documentAuthors.role,
      position: documentAuthors.position,
      handle: people.handle,
      displayName: people.displayName,
      email: people.email,
      emailVisibility: people.emailVisibility,
      affiliation: people.affiliation,
      isExternal: people.isExternal,
    })
    .from(documentAuthors)
    .innerJoin(people, eq(documentAuthors.personId, people.id))
    .where(eq(documentAuthors.documentId, documentId))
    .orderBy(asc(documentAuthors.position));

  return rows.map((r) => ({
    personId: r.personId,
    handle: r.handle,
    displayName: r.displayName,
    role: r.role,
    position: r.position,
    affiliation: r.affiliation,
    isExternal: r.isExternal,
    email: emailFor(r.email, r.emailVisibility, actor),
  }));
}

/** Public readers never see addresses; organization members see org-visible ones. */
export function emailFor(
  email: string | null,
  visibility: string,
  actor: Actor | null,
): string | null {
  if (!email) return null;
  if (visibility === 'public') return email;
  if (!actor) return null;
  if (visibility === 'organization') return email;
  if (visibility === 'group') return actor.orgRole === 'admin' ? email : null;
  return actor.orgRole === 'admin' ? email : null;
}

export async function getDocumentContext(
  slug: string,
  actor: Actor | null,
): Promise<DocumentContext> {
  const rows = await db
    .select({
      document: documents,
      namespace: namespaces,
      group: groups,
      owner: people,
      license: licenseProfiles,
    })
    .from(documents)
    .leftJoin(namespaces, eq(documents.namespaceId, namespaces.id))
    .leftJoin(groups, eq(documents.groupId, groups.id))
    .leftJoin(people, eq(documents.ownerId, people.id))
    .leftJoin(licenseProfiles, eq(documents.licenseProfileId, licenseProfiles.id))
    .where(eq(documents.slug, slug))
    .limit(1);

  const row = rows[0];
  if (!row) throw appError('not_found', `No document with identifier ${slug}.`);

  const authors = await loadAuthors(row.document.id, actor);
  const acl = toAcl(row.document, authors);
  if (!canReadDocument(actor, acl)) {
    // Do not disclose existence of private drafts to unauthorized readers.
    throw appError('not_found', `No document with identifier ${slug}.`);
  }

  return { ...row, authors, acl };
}

export interface ReaderTarget {
  context: DocumentContext;
  revision: RevisionRow;
  /** True when the URL addressed a specific revision rather than the document. */
  pinned: boolean;
}

/**
 * Resolves a reader URL that may name either a document (`TEST-STD-0001`) or an
 * exact immutable revision (`DRAFT-TEST-PROTOCOL-01`).
 */
export async function resolveReaderTarget(slug: string, actor: Actor | null): Promise<ReaderTarget> {
  assertValidSlug(slug);

  const docRows = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, slug)).limit(1);
  if (docRows[0]) {
    const context = await getDocumentContext(slug, actor);
    const revision = await currentReadableRevision(context.document);
    return { context, revision, pinned: false };
  }

  const revRows = await db.select().from(revisions).where(eq(revisions.slug, slug)).limit(1);
  const revision = revRows[0];
  if (!revision) throw appError('not_found', `No document or revision with identifier ${slug}.`);

  const parent = await db
    .select({ slug: documents.slug })
    .from(documents)
    .where(eq(documents.id, revision.documentId))
    .limit(1);
  if (!parent[0]) throw appError('not_found', `Revision ${slug} has no parent document.`);

  const context = await getDocumentContext(parent[0].slug, actor);
  return { context, revision, pinned: true };
}

export async function currentReadableRevision(doc: DocumentRow): Promise<RevisionRow> {
  const id = doc.publishedRevisionId ?? doc.currentRevisionId;
  if (id) {
    const rows = await db.select().from(revisions).where(eq(revisions.id, id)).limit(1);
    if (rows[0]) return rows[0];
  }
  const latest = await db
    .select()
    .from(revisions)
    .where(eq(revisions.documentId, doc.id))
    .orderBy(desc(revisions.sequence))
    .limit(1);
  if (!latest[0]) {
    throw appError('not_synced', `${doc.slug} has no rendered revision yet.`);
  }
  return latest[0];
}

export async function listRevisions(documentId: string): Promise<RevisionRow[]> {
  return db
    .select()
    .from(revisions)
    .where(eq(revisions.documentId, documentId))
    .orderBy(asc(revisions.sequence));
}

/** Every revision in the draft family, including the published document's. */
export async function listFamilyRevisions(
  familyKey: string,
): Promise<Array<RevisionRow & { documentSlug: string; documentStatus: string }>> {
  const rows = await db
    .select({
      revision: revisions,
      documentSlug: documents.slug,
      documentStatus: documents.status,
    })
    .from(revisions)
    .innerJoin(documents, eq(revisions.documentId, documents.id))
    .where(eq(documents.familyKey, familyKey))
    .orderBy(asc(revisions.createdAt));
  return rows.map((r) => ({ ...r.revision, documentSlug: r.documentSlug, documentStatus: r.documentStatus }));
}

export async function listSections(revisionId: string): Promise<SectionRow[]> {
  return db
    .select()
    .from(sections)
    .where(eq(sections.revisionId, revisionId))
    .orderBy(asc(sections.sortOrder));
}

export async function listArtifacts(revisionId: string): Promise<ArtifactRow[]> {
  return db.select().from(artifacts).where(eq(artifacts.revisionId, revisionId));
}

export async function listRelations(documentId: string): Promise<RelationView[]> {
  const outbound = await db
    .select({
      type: documentRelations.type,
      targetRef: documentRelations.targetRef,
      targetTitle: documentRelations.targetTitle,
      targetDocumentId: documentRelations.targetDocumentId,
      sourceSystem: documentRelations.sourceSystem,
      targetSlug: documents.slug,
      targetNumber: documents.documentNumber,
      resolvedTitle: documents.title,
    })
    .from(documentRelations)
    .leftJoin(documents, eq(documentRelations.targetDocumentId, documents.id))
    .where(eq(documentRelations.sourceDocumentId, documentId));

  const inbound = await db
    .select({
      type: documentRelations.type,
      sourceSystem: documentRelations.sourceSystem,
      sourceSlug: documents.slug,
      sourceNumber: documents.documentNumber,
      sourceTitle: documents.title,
      sourceDocumentId: documents.id,
    })
    .from(documentRelations)
    .innerJoin(documents, eq(documentRelations.sourceDocumentId, documents.id))
    // A draft that has already been published is represented by its published
    // row; showing both would list every relation twice.
    .where(and(eq(documentRelations.targetDocumentId, documentId), ne(documents.status, 'historic')));

  return [
    ...outbound.map<RelationView>((r) => ({
      type: r.type,
      direction: 'outbound',
      targetSlug: r.targetSlug ?? r.targetRef,
      targetTitle: r.resolvedTitle ?? r.targetTitle,
      targetDocumentId: r.targetDocumentId,
      targetNumber: r.targetNumber,
      sourceSystem: r.sourceSystem,
    })),
    ...inbound.map<RelationView>((r) => ({
      type: r.type,
      direction: 'inbound',
      targetSlug: r.sourceSlug,
      targetTitle: r.sourceTitle,
      targetDocumentId: r.sourceDocumentId,
      targetNumber: r.sourceNumber,
      sourceSystem: r.sourceSystem,
    })),
  ];
}

/** Groups relations into the labels the Info panel and Status table display. */
export function groupRelations(relations: RelationView[]) {
  const pick = (type: string, direction: 'outbound' | 'inbound') =>
    relations.filter((r) => r.type === type && r.direction === direction);
  return {
    updates: pick('updates', 'outbound'),
    updatedBy: pick('updates', 'inbound'),
    obsoletes: pick('obsoletes', 'outbound'),
    obsoletedBy: pick('obsoletes', 'inbound'),
    replaces: pick('replaces', 'outbound'),
    replacedBy: pick('replaces', 'inbound'),
    derivedFrom: pick('derived-from', 'outbound'),
    forkedInto: pick('derived-from', 'inbound'),
    normativeReferences: pick('normative-reference', 'outbound'),
    informativeReferences: pick('informative-reference', 'outbound'),
    unknownReferences: pick('unknown-reference', 'outbound'),
    referencedBy: relations.filter(
      (r) => r.direction === 'inbound' && r.type.endsWith('reference'),
    ),
  };
}

export async function countErrata(documentId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: errata.status, count: sql<number>`count(*)::int` })
    .from(errata)
    .where(eq(errata.documentId, documentId))
    .groupBy(errata.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export async function countDisclosures(documentId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(iprDisclosures)
    .where(eq(iprDisclosures.documentId, documentId));
  return rows[0]?.count ?? 0;
}

export async function getPublication(documentId: string) {
  const rows = await db
    .select()
    .from(publications)
    .where(and(eq(publications.documentId, documentId), eq(publications.state, 'published')))
    .orderBy(desc(publications.publishedAt))
    .limit(1);
  return rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Listing + search                                                            */
/* -------------------------------------------------------------------------- */

export interface DocumentListItem {
  id: string;
  slug: string;
  title: string;
  abstract: string | null;
  documentNumber: string | null;
  status: string;
  type: string;
  origin: string;
  visibility: string;
  publishedAt: Date | null;
  updatedAt: Date;
  groupSlug: string | null;
  groupName: string | null;
}

/** Visibility predicate applied inside SQL so pagination stays correct. */
function visibilityFilter(actor: Actor | null) {
  if (actor?.orgRole === 'admin') return sql`true`;
  if (!actor) {
    return and(eq(documents.visibility, 'public'), eq(documents.status, 'published'))!;
  }
  const groupIds = Object.keys(actor.groupRoles);
  const publicish: DocumentVisibility[] = ['public', 'organization'];
  const clauses = [
    inArray(documents.visibility, publicish),
    eq(documents.ownerId, actor.id),
    eq(documents.createdBy, actor.id),
    sql`exists (select 1 from document_authors da where da.document_id = ${documents.id} and da.person_id = ${actor.id})`,
  ];
  if (groupIds.length) {
    clauses.push(and(eq(documents.visibility, 'group'), inArray(documents.groupId, groupIds))!);
  }
  return or(...clauses)!;
}

export interface SearchQuery {
  q?: string;
  status?: LifecycleState[];
  type?: string[];
  groupSlug?: string;
  authorHandle?: string;
  origin?: DocumentOrigin[];
  limit?: number;
  offset?: number;
}

export async function searchDocuments(
  query: SearchQuery,
  actor: Actor | null,
): Promise<{ items: DocumentListItem[]; total: number }> {
  const filters = [visibilityFilter(actor)];

  if (query.q?.trim()) {
    const term = query.q.trim();
    const like = `%${term.toLowerCase()}%`;
    filters.push(
      sql`(
        to_tsvector('simple',
          coalesce(${documents.slug},'') || ' ' || coalesce(${documents.documentNumber},'') || ' ' ||
          coalesce(${documents.displayName},'') || ' ' || coalesce(${documents.title},'') || ' ' ||
          coalesce(${documents.abstract},'')
        ) @@ plainto_tsquery('simple', ${term})
        or lower(${documents.slug}) like ${like}
        or lower(coalesce(${documents.documentNumber}, '')) like ${like}
        or lower(${documents.title}) like ${like}
      )`,
    );
  }
  if (query.status?.length) filters.push(inArray(documents.status, query.status));
  if (query.type?.length) filters.push(inArray(documents.type, query.type));
  if (query.origin?.length) filters.push(inArray(documents.origin, query.origin));
  if (query.groupSlug) {
    filters.push(sql`exists (select 1 from groups g where g.id = ${documents.groupId} and g.slug = ${query.groupSlug})`);
  }
  if (query.authorHandle) {
    filters.push(
      sql`exists (
        select 1 from document_authors da join people p on p.id = da.person_id
        where da.document_id = ${documents.id} and p.handle = ${query.authorHandle}
      )`,
    );
  }

  const where = and(...filters);

  const items = await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      abstract: documents.abstract,
      documentNumber: documents.documentNumber,
      status: documents.status,
      type: documents.type,
      origin: documents.origin,
      visibility: documents.visibility,
      publishedAt: documents.publishedAt,
      updatedAt: documents.updatedAt,
      groupSlug: groups.slug,
      groupName: groups.name,
    })
    .from(documents)
    .leftJoin(groups, eq(documents.groupId, groups.id))
    .where(where)
    .orderBy(desc(documents.updatedAt))
    .limit(query.limit ?? 25)
    .offset(query.offset ?? 0);

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(where);

  return { items, total: count };
}

export async function listPublishedDocumentNumbers(): Promise<Set<string>> {
  const rows = await db
    .select({ number: documents.documentNumber, slug: documents.slug })
    .from(documents)
    .where(isNotNull(documents.documentNumber));
  const out = new Set<string>();
  for (const r of rows) {
    if (r.number) out.add(r.number);
    out.add(r.slug);
  }
  return out;
}

export async function listDraftsForActor(actor: Actor): Promise<DocumentListItem[]> {
  const { items } = await searchDocuments(
    { status: ['idea', 'drafting', 'review', 'changes-requested', 'approved', 'publishing'], limit: 100 },
    actor,
  );
  return items;
}

export async function findFamilyDocuments(familyKey: string): Promise<DocumentRow[]> {
  return db
    .select()
    .from(documents)
    .where(eq(documents.familyKey, familyKey))
    .orderBy(asc(documents.createdAt));
}

export async function findSiblingDocument(
  documentId: string,
  familyKey: string,
): Promise<DocumentRow | null> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.familyKey, familyKey), ne(documents.id, documentId)))
    .limit(1);
  return rows[0] ?? null;
}
