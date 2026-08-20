import { and, eq, sql } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import {
  documentAuthors,
  documentRelations,
  documents,
  groups,
  licenseProfiles,
  namespaces,
  people,
  revisions,
  templates,
  workflows,
} from '#src/db/schema.ts';
import { appError } from '#src/domain/errors.ts';
import type { CanonicalFormat, DocumentVisibility, RelationType } from '#src/domain/types.ts';
import { slugify } from '#src/parser/anchors.ts';
import { recordAudit } from './audit.ts';
import { enqueueJob } from '#src/jobs/queue.ts';
import { assertValidSlug } from './documents.ts';
import { canCreateDraft, type Actor } from './rbac.ts';

/**
 * Draft creation: blank, from template, copy, update/obsolete of a published
 * document, fork of an external document, or import of a source file. Every
 * path keeps provenance, and no publication number is allocated at this stage.
 */

export type DraftStartMode = 'blank' | 'template' | 'copy' | 'update' | 'obsolete' | 'fork' | 'import';

export interface CreateDraftInput {
  mode: DraftStartMode;
  title: string;
  shortName: string;
  abstract?: string;
  type?: string;
  intendedStatus?: string;
  namespaceKey?: string;
  groupSlug?: string;
  authorHandles: string[];
  editorHandles?: string[];
  canonicalFormat: CanonicalFormat;
  licenseKey?: string;
  visibility: DocumentVisibility;
  templateKey?: string;
  sourceDocumentSlug?: string;
  importedSource?: string;
  relations?: Array<{ type: RelationType; targetSlug: string }>;
  actor: Actor;
}

export interface CreateDraftResult {
  documentId: string;
  slug: string;
}

export async function createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
  if (!canCreateDraft(input.actor)) {
    throw appError('forbidden', 'Your role cannot create documents.');
  }
  if (!input.title.trim()) throw appError('validation_failed', 'A title is required.');

  const namespace = await resolveNamespace(input.namespaceKey);
  const draftSlug = await uniqueDraftSlug(input.shortName || input.title, namespace?.draftPrefix ?? 'DRAFT');
  assertValidSlug(draftSlug);

  const group = input.groupSlug
    ? (await db.select().from(groups).where(eq(groups.slug, input.groupSlug)).limit(1))[0] ?? null
    : null;
  const license = input.licenseKey
    ? (await db.select().from(licenseProfiles).where(eq(licenseProfiles.key, input.licenseKey)).limit(1))[0] ?? null
    : null;
  const workflow = (await db.select().from(workflows).limit(1))[0] ?? null;

  const { source, derivedFrom, relations } = await resolveInitialSource(input);

  const documentId = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(documents)
      .values({
        origin: input.mode === 'fork' && derivedFrom?.origin === 'external-import' ? 'external-fork' : 'local',
        namespaceId: namespace?.id ?? null,
        slug: draftSlug,
        displayName: draftSlug,
        familyKey: draftSlug,
        type: input.type ?? 'standard',
        title: input.title.trim(),
        abstract: input.abstract?.trim() || null,
        intendedStatus: input.intendedStatus ?? null,
        standardLevel: input.intendedStatus ?? 'proposed',
        status: 'drafting',
        visibility: input.visibility,
        canonicalFormat: input.canonicalFormat,
        groupId: group?.id ?? null,
        ownerId: input.actor.id,
        licenseProfileId: license?.id ?? null,
        workflowId: workflow?.id ?? null,
        workingSource: source,
        workingSourceUpdatedAt: new Date(),
        derivedFromDocumentId: derivedFrom?.id ?? null,
        createdBy: input.actor.id,
      })
      .returning({ id: documents.id });

    const id = rows[0]!.id;

    await attachPeople(tx, id, input.authorHandles, 'author');
    await attachPeople(tx, id, input.editorHandles ?? [], 'editor');

    for (const rel of relations) {
      await tx.insert(documentRelations).values({
        sourceDocumentId: id,
        targetDocumentId: rel.targetDocumentId,
        targetRef: rel.targetRef,
        type: rel.type,
        sourceSystem: 'local',
      });
    }

    await recordAudit(
      {
        familyKey: draftSlug,
        documentId: id,
        entityType: 'document',
        entityId: id,
        action: 'draft_created',
        summary: `Draft ${draftSlug} created (${input.mode})`,
        changes: [{ field: 'title', before: null, after: input.title, sensitivity: 'public' }],
        actorId: input.actor.id,
      },
      tx,
    );

    return id;
  });

  await enqueueJob('notify_event', { eventKey: 'draft_created', documentId });
  return { documentId, slug: draftSlug };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function attachPeople(tx: Tx, documentId: string, handles: string[], role: string): Promise<void> {
  let position = 0;
  for (const handle of handles) {
    const rows = await tx.select({ id: people.id }).from(people).where(eq(people.handle, handle)).limit(1);
    const person = rows[0];
    if (!person) throw appError('validation_failed', `Unknown user "${handle}".`);
    await tx
      .insert(documentAuthors)
      .values({ documentId, personId: person.id, role, position })
      .onConflictDoNothing();
    position += 1;
  }
}

async function resolveNamespace(key?: string) {
  if (key) {
    const rows = await db.select().from(namespaces).where(eq(namespaces.key, key)).limit(1);
    if (!rows[0]) throw appError('validation_failed', `Unknown namespace "${key}".`);
    return rows[0];
  }
  const rows = await db.select().from(namespaces).limit(1);
  return rows[0] ?? null;
}

async function uniqueDraftSlug(seed: string, prefix: string): Promise<string> {
  const base = `${prefix}-${slugify(seed).toUpperCase().replace(/-+/g, '-')}`.slice(0, 80);
  let candidate = base;
  let n = 2;
  // Human-visible draft identifier; the real publication number comes later.
  while (true) {
    const rows = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, candidate)).limit(1);
    if (!rows[0]) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

interface InitialSource {
  source: string;
  derivedFrom: typeof documents.$inferSelect | null;
  relations: Array<{ type: RelationType; targetDocumentId: string | null; targetRef: string | null }>;
}

async function resolveInitialSource(input: CreateDraftInput): Promise<InitialSource> {
  const relations: InitialSource['relations'] = (input.relations ?? []).map((r) => ({
    type: r.type,
    targetDocumentId: null,
    targetRef: r.targetSlug,
  }));

  for (const rel of relations) {
    const rows = await db.select({ id: documents.id }).from(documents).where(eq(documents.slug, rel.targetRef!)).limit(1);
    if (rows[0]) rel.targetDocumentId = rows[0].id;
  }

  if (input.mode === 'import') {
    if (!input.importedSource?.trim()) throw appError('validation_failed', 'Import requires a source file.');
    return { source: input.importedSource, derivedFrom: null, relations };
  }

  if (input.mode === 'template') {
    const rows = await db.select().from(templates).where(eq(templates.key, input.templateKey ?? '')).limit(1);
    const template = rows[0];
    if (!template) throw appError('validation_failed', `Unknown template "${input.templateKey}".`);
    return {
      source: applyTemplate(template.body, input),
      derivedFrom: null,
      relations,
    };
  }

  if (['copy', 'update', 'obsolete', 'fork'].includes(input.mode)) {
    if (!input.sourceDocumentSlug) throw appError('validation_failed', 'A source document is required.');
    const rows = await db.select().from(documents).where(eq(documents.slug, input.sourceDocumentSlug)).limit(1);
    const sourceDoc = rows[0];
    if (!sourceDoc) throw appError('not_found', `Source document ${input.sourceDocumentSlug} not found.`);

    const revRows = await db
      .select()
      .from(revisions)
      .where(
        and(
          eq(revisions.documentId, sourceDoc.id),
          sourceDoc.publishedRevisionId ? eq(revisions.id, sourceDoc.publishedRevisionId) : sql`true`,
        ),
      )
      .orderBy(sql`${revisions.sequence} desc`)
      .limit(1);
    const source = revRows[0]?.source ?? sourceDoc.workingSource;

    if (input.mode === 'update') relations.push({ type: 'updates', targetDocumentId: sourceDoc.id, targetRef: sourceDoc.slug });
    if (input.mode === 'obsolete') relations.push({ type: 'obsoletes', targetDocumentId: sourceDoc.id, targetRef: sourceDoc.slug });
    if (input.mode === 'fork') relations.push({ type: 'derived-from', targetDocumentId: sourceDoc.id, targetRef: sourceDoc.slug });
    if (input.mode === 'copy') relations.push({ type: 'replaces', targetDocumentId: sourceDoc.id, targetRef: sourceDoc.slug });

    return { source: retitle(source, input.title), derivedFrom: sourceDoc, relations };
  }

  return { source: blankDocument(input), derivedFrom: null, relations };
}

function applyTemplate(body: string, input: CreateDraftInput): string {
  return body
    .replace(/\{\{title\}\}/g, input.title)
    .replace(/\{\{abstract\}\}/g, input.abstract ?? 'TODO: write the abstract.')
    .replace(/\{\{shortName\}\}/g, input.shortName);
}

function retitle(source: string, title: string): string {
  if (source.startsWith('---')) {
    return source.replace(/^(---\n[\s\S]*?)^title:.*$/m, `$1title: ${title}`);
  }
  return `---\ntitle: ${title}\n---\n\n${source}`;
}

function blankDocument(input: CreateDraftInput): string {
  if (input.canonicalFormat === 'rfcxml') {
    return `<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" docName="${input.shortName}" category="std">
  <front>
    <title>${input.title}</title>
    <abstract><t>${input.abstract ?? 'TODO: write the abstract.'}</t></abstract>
  </front>
  <middle>
    <section anchor="section-1"><name>Introduction</name><t>TODO</t></section>
    <section anchor="section-2"><name>Security Considerations</name><t>TODO</t></section>
  </middle>
  <back/>
</rfc>
`;
  }
  return `---
title: ${input.title}
abbrev: ${input.shortName}
---

# Abstract

${input.abstract ?? 'TODO: write the abstract.'}

# Introduction

TODO: describe the problem this document solves.

# Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY in this document are
to be interpreted as requirement levels.

# Security Considerations

TODO: describe the security properties and residual risks.

# Normative References

[EXAMPLE-KEY]  Author, A., "Referenced document title", ORG-RFC-0000, 2026.
`;
}

export async function listTemplates() {
  return db.select().from(templates).orderBy(sql`name asc`);
}

export async function updateDraftMetadata(
  documentId: string,
  patch: {
    title?: string;
    abstract?: string | null;
    visibility?: DocumentVisibility;
    intendedStatus?: string;
    groupSlug?: string | null;
    type?: string;
  },
  actor: Actor,
): Promise<void> {
  const rows = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  const doc = rows[0];
  if (!doc) throw appError('not_found', 'Document not found.');

  const group = patch.groupSlug
    ? (await db.select().from(groups).where(eq(groups.slug, patch.groupSlug)).limit(1))[0] ?? null
    : null;

  const changes = [
    patch.title !== undefined && patch.title !== doc.title
      ? { field: 'title', before: doc.title, after: patch.title, sensitivity: 'public' as const }
      : null,
    patch.visibility !== undefined && patch.visibility !== doc.visibility
      ? { field: 'visibility', before: doc.visibility, after: patch.visibility, sensitivity: 'internal' as const }
      : null,
    patch.intendedStatus !== undefined && patch.intendedStatus !== doc.intendedStatus
      ? { field: 'intendedStatus', before: doc.intendedStatus, after: patch.intendedStatus, sensitivity: 'public' as const }
      : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  await db
    .update(documents)
    .set({
      title: patch.title ?? doc.title,
      abstract: patch.abstract !== undefined ? patch.abstract : doc.abstract,
      visibility: patch.visibility ?? doc.visibility,
      intendedStatus: patch.intendedStatus ?? doc.intendedStatus,
      standardLevel: patch.intendedStatus ?? doc.standardLevel,
      type: patch.type ?? doc.type,
      groupId: patch.groupSlug === null ? null : (group?.id ?? doc.groupId),
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));

  if (changes.length) {
    await recordAudit({
      familyKey: doc.familyKey,
      documentId,
      entityType: 'document',
      entityId: documentId,
      action: 'metadata_changed',
      summary: `Metadata updated: ${changes.map((c) => c.field).join(', ')}`,
      changes,
      actorId: actor.id,
    });
    await enqueueJob('notify_event', { eventKey: 'metadata_changed', documentId });
  }
}
