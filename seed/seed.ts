import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import {
  auditEvents,
  documentAuthors,
  documentRelations,
  documents,
  groupMembers,
  groups,
  iprDisclosures,
  licenseProfiles,
  namespaces,
  notificationEvents,
  notificationPolicies,
  people,
  publications,
  revisions,
  templates,
  workflows,
} from '#src/db/schema.ts';
import { DEFAULT_EVENT_CATALOG, type LifecycleState } from '#src/domain/types.ts';
import { hashPassword } from '#src/lib/hash.ts';
import { recordAudit } from '#src/services/audit.ts';
import { createRevision } from '#src/services/revisions.ts';
import { createThread, startReviewRound } from '#src/services/reviews.ts';
import { recordDecision } from '#src/services/approvals.ts';
import { executePublish } from '#src/services/publish.ts';
import { reportErratum, setErratumStatus } from '#src/services/errata.ts';
import { toAcl, loadAuthors } from '#src/services/documents.ts';
import { drainQueue } from '#src/jobs/worker.ts';
import type { Actor } from '#src/services/rbac.ts';
import {
  SEED_GROUPS,
  SEED_LICENSE,
  SEED_NAMESPACE,
  SEED_NOTIFICATION_POLICIES,
  SEED_PEOPLE,
  SEED_TEMPLATE,
  SEED_WORKFLOW,
} from './fixtures.ts';

/**
 * Builds the offline demo installation: fictional people, groups, publication
 * policy and four documents that exercise the full lifecycle. Runs the real
 * services, so the seeded state is reachable through the normal workflow rather
 * than written straight into tables.
 */

const DOC_DIR = join(process.cwd(), 'seed', 'documents');
const read = (name: string) => readFileSync(join(DOC_DIR, name), 'utf8');

export async function runSeed(): Promise<void> {
  const actors = await seedPeople();
  await seedGroups();
  const { namespaceId, workflowId, licenseId } = await seedPolicy();
  await seedNotificationCatalog();

  const groupRows = await db.select().from(groups);
  const ledgerGroup = groupRows.find((g) => g.slug === 'ledger-interchange')!;

  const common = {
    namespaceId,
    workflowId,
    licenseId,
    groupId: ledgerGroup.id,
    actors,
  };

  // Phase 1: create every draft. Relations are recorded by identifier only,
  // because the documents they point at may not be published yet.
  const drafts = [
    await seedDraftForPublication({
      ...common,
      draftSlug: 'DRAFT-TEST-STD-0001',
      title: 'Example Ledger Interchange Format',
      abstract:
        'Small fictional interchange format for ledger records, used as the primary published example in this installation.',
      source: read('test-std-0001.md'),
      authors: ['author-1', 'author-2'],
      relations: [{ type: 'normative-reference', ref: 'TEST-STD-0002' }],
    }),
    await seedDraftForPublication({
      ...common,
      draftSlug: 'DRAFT-TEST-STD-0002',
      title: 'Example Ledger Data Model',
      abstract:
        'Fictional data model that the Example Ledger Interchange Format serialises. Used to exercise deep heading trees and multi-page rendering.',
      source: read('test-std-0002.md'),
      authors: ['author-2'],
      relations: [{ type: 'normative-reference', ref: 'TEST-STD-0001' }],
    }),
    await seedDraftForPublication({
      ...common,
      draftSlug: 'DRAFT-TEST-STD-0003',
      title: 'Example Ledger Interchange Format, Version 1.1',
      abstract:
        'Fictional update that adds an optional extension field and clarifies rejection behaviour.',
      source: read('test-std-0003.md'),
      authors: ['author-1'],
      relations: [
        { type: 'updates', ref: 'TEST-STD-0001' },
        { type: 'normative-reference', ref: 'TEST-STD-0001' },
      ],
    }),
  ];

  // Phase 2: publish in order, so the allocated numbers match the fixture names.
  const publishedAt = [
    new Date('2026-07-01T10:00:00Z'),
    new Date('2026-06-15T09:00:00Z'),
    new Date('2026-08-10T08:30:00Z'),
  ];
  const published: string[] = [];
  for (const [index, draft] of drafts.entries()) {
    published.push(await publishSeedDraft(draft, actors, publishedAt[index]!));
  }

  // Phase 3: now that every number exists, resolve the relation targets.
  await resolveRelationTargets();

  const format = { id: published[0]! };

  await seedWorkingDraft({ ...common, referenceDocumentId: format.id });
  await seedErrataAndDisclosures(format.id, actors);

  // Run every queued render/publish/notify job so the seeded state is complete.
  await drainQueue(500);
  await drainQueue(500);

  await backdateFixtureHistory();

  console.log('[seed] fixtures ready: TEST-STD-0001, TEST-STD-0002, TEST-STD-0003, DRAFT-TEST-PROTOCOL');
}

type ActorMap = Record<string, Actor>;

async function seedPeople(): Promise<ActorMap> {
  const actors: ActorMap = {};
  for (const person of SEED_PEOPLE) {
    const rows = await db
      .insert(people)
      .values({
        handle: person.handle,
        displayName: person.displayName,
        email: person.email,
        emailVisibility: person.emailVisibility,
        affiliation: person.affiliation,
        orgRole: person.orgRole,
        passwordHash: hashPassword(person.password),
      })
      .onConflictDoNothing({ target: people.handle })
      .returning();
    const row =
      rows[0] ?? (await db.select().from(people).where(eq(people.handle, person.handle)).limit(1))[0]!;
    actors[person.handle] = {
      id: row.id,
      handle: row.handle,
      displayName: row.displayName,
      email: row.email,
      orgRole: row.orgRole,
      groupRoles: {},
    };
  }
  return actors;
}

async function seedGroups(): Promise<void> {
  for (const group of SEED_GROUPS) {
    const rows = await db
      .insert(groups)
      .values({
        slug: group.slug,
        name: group.name,
        kind: group.kind,
        description: group.description,
        charter: 'charter' in group ? group.charter : null,
      })
      .onConflictDoNothing({ target: groups.slug })
      .returning();
    const row =
      rows[0] ?? (await db.select().from(groups).where(eq(groups.slug, group.slug)).limit(1))[0]!;

    for (const member of group.members) {
      const personRows = await db.select().from(people).where(eq(people.handle, member.handle)).limit(1);
      if (!personRows[0]) continue;
      await db
        .insert(groupMembers)
        .values({ groupId: row.id, personId: personRows[0].id, role: member.role })
        .onConflictDoNothing();
    }
  }
}

async function seedPolicy() {
  const wfRows = await db
    .insert(workflows)
    .values({
      key: SEED_WORKFLOW.key,
      name: SEED_WORKFLOW.name,
      states: SEED_WORKFLOW.states as LifecycleState[],
      gates: SEED_WORKFLOW.gates as never,
    })
    .onConflictDoNothing({ target: workflows.key })
    .returning();
  const workflowId =
    wfRows[0]?.id ??
    (await db.select().from(workflows).where(eq(workflows.key, SEED_WORKFLOW.key)).limit(1))[0]!.id;

  const nsRows = await db
    .insert(namespaces)
    .values({
      key: SEED_NAMESPACE.key,
      label: SEED_NAMESPACE.label,
      description: SEED_NAMESPACE.description,
      prefix: SEED_NAMESPACE.prefix,
      numberPattern: SEED_NAMESPACE.numberPattern,
      draftPrefix: SEED_NAMESPACE.draftPrefix,
      workflowId,
    })
    .onConflictDoNothing({ target: namespaces.key })
    .returning();
  const namespaceId =
    nsRows[0]?.id ??
    (await db.select().from(namespaces).where(eq(namespaces.key, SEED_NAMESPACE.key)).limit(1))[0]!.id;

  const licRows = await db
    .insert(licenseProfiles)
    .values(SEED_LICENSE)
    .onConflictDoNothing({ target: licenseProfiles.key })
    .returning();
  const licenseId =
    licRows[0]?.id ??
    (await db.select().from(licenseProfiles).where(eq(licenseProfiles.key, SEED_LICENSE.key)).limit(1))[0]!.id;

  await db
    .insert(templates)
    .values({
      key: SEED_TEMPLATE.key,
      name: SEED_TEMPLATE.name,
      description: SEED_TEMPLATE.description,
      canonicalFormat: 'markdown',
      body: SEED_TEMPLATE.body,
    })
    .onConflictDoNothing({ target: templates.key });

  return { namespaceId, workflowId, licenseId };
}

async function seedNotificationCatalog(): Promise<void> {
  for (const event of DEFAULT_EVENT_CATALOG) {
    await db
      .insert(notificationEvents)
      .values({ key: event.key, label: event.label, description: event.description })
      .onConflictDoNothing({ target: notificationEvents.key });
  }
  const existing = await db.select({ id: notificationPolicies.id }).from(notificationPolicies).limit(1);
  if (existing[0]) return;

  for (const policy of SEED_NOTIFICATION_POLICIES) {
    await db.insert(notificationPolicies).values({
      scope: policy.scope,
      scopeRef: policy.scopeRef,
      eventKey: policy.eventKey,
      channel: 'email',
      enabled: true,
      precedence: policy.precedence,
      toSelectors: policy.toSelectors,
      ccSelectors: policy.ccSelectors,
      suppressSelectors: 'suppressSelectors' in policy ? (policy.suppressSelectors as string[]) : [],
    });
  }
}

interface DraftForPublicationInput {
  draftSlug: string;
  title: string;
  abstract: string;
  source: string;
  namespaceId: string;
  workflowId: string;
  licenseId: string;
  groupId: string;
  actors: ActorMap;
  authors: string[];
  relations?: Array<{ type: string; ref: string }>;
}

/** Creates a draft, its first revision, a review round and an approval. */
async function seedDraftForPublication(input: DraftForPublicationInput): Promise<string> {
  const existing = await db.select().from(documents).where(eq(documents.slug, input.draftSlug)).limit(1);
  if (existing[0]) return existing[0].id;

  const owner = input.actors['author-1']!;
  const inserted = await db
    .insert(documents)
    .values({
      origin: 'local',
      namespaceId: input.namespaceId,
      slug: input.draftSlug,
      displayName: input.draftSlug,
      familyKey: input.draftSlug,
      type: 'standard',
      title: input.title,
      abstract: input.abstract,
      intendedStatus: 'standards-track',
      standardLevel: 'standards-track',
      status: 'drafting',
      visibility: 'public',
      canonicalFormat: 'markdown',
      groupId: input.groupId,
      ownerId: owner.id,
      licenseProfileId: input.licenseId,
      workflowId: input.workflowId,
      workingSource: input.source,
      createdBy: owner.id,
    })
    .returning({ id: documents.id });

  const documentId = inserted[0]!.id;

  let position = 0;
  for (const handle of input.authors) {
    await db.insert(documentAuthors).values({
      documentId,
      personId: input.actors[handle]!.id,
      role: 'author',
      position: position++,
    });
  }

  for (const relation of input.relations ?? []) {
    await db.insert(documentRelations).values({
      sourceDocumentId: documentId,
      targetRef: relation.ref,
      type: relation.type as never,
      sourceSystem: 'local',
    });
  }

  await recordAudit({
    familyKey: input.draftSlug,
    documentId,
    entityType: 'document',
    entityId: documentId,
    action: 'draft_created',
    summary: `Draft ${input.draftSlug} created (blank)`,
    actorId: owner.id,
    visibility: 'public',
  });

  const rev00 = await createRevision({
    documentId,
    actor: owner,
    changeSummary: 'Initial complete draft',
  });
  await drainQueue(50);

  await startReviewRound(documentId, rev00.id, owner, 'Initial working group review');

  const authors = await loadAuthors(documentId, null);
  const docRow = (await db.select().from(documents).where(eq(documents.id, documentId)).limit(1))[0]!;
  await recordDecision(
    documentId,
    rev00.id,
    'group-approval',
    'approved',
    input.actors['approver-1']!,
    toAcl(docRow, authors),
    'Approved for publication by the working group.',
  );

  return documentId;
}

/** Publishes a seeded draft and backdates the publication for the timeline. */
async function publishSeedDraft(
  draftId: string,
  actors: ActorMap,
  publishedAt: Date,
): Promise<string> {
  const draft = (await db.select().from(documents).where(eq(documents.id, draftId)).limit(1))[0]!;
  if (draft.status === 'historic') {
    const existing = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.familyKey, draft.familyKey), eq(documents.status, 'published')))
      .limit(1);
    if (existing[0]) return existing[0].id;
  }

  await db.update(documents).set({ status: 'approved' }).where(eq(documents.id, draftId));
  const result = await executePublish(draftId, draft.currentRevisionId!, actors['publisher-1']!.id);
  const publishedId = result.publishedDocumentId!;

  await db
    .update(documents)
    .set({ publishedAt, updatedAt: publishedAt })
    .where(eq(documents.id, publishedId));

  return publishedId;
}

/** Links relation rows that were seeded by identifier to their document rows. */
async function resolveRelationTargets(): Promise<void> {
  const unresolved = await db
    .select()
    .from(documentRelations)
    .where(isNull(documentRelations.targetDocumentId));

  for (const relation of unresolved) {
    if (!relation.targetRef) continue;
    const target = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(eq(documents.slug, relation.targetRef))
      .limit(1);
    if (!target[0]) continue;
    await db
      .update(documentRelations)
      .set({ targetDocumentId: target[0].id, targetTitle: target[0].title })
      .where(eq(documentRelations.id, relation.id));
  }
}

interface DraftSeedInput {
  namespaceId: string;
  workflowId: string;
  licenseId: string;
  groupId: string;
  actors: ActorMap;
  referenceDocumentId: string;
}

async function seedWorkingDraft(input: DraftSeedInput): Promise<void> {
  const slug = 'DRAFT-TEST-PROTOCOL';
  const existing = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
  if (existing[0]) return;

  const owner = input.actors['author-1']!;
  const inserted = await db
    .insert(documents)
    .values({
      origin: 'local',
      namespaceId: input.namespaceId,
      slug,
      displayName: slug,
      familyKey: slug,
      type: 'standard',
      title: 'Example Ledger Notification Protocol',
      abstract:
        'Working draft of a fictional push notification protocol for accepted ledger batches.',
      intendedStatus: 'standards-track',
      standardLevel: 'standards-track',
      status: 'drafting',
      visibility: 'organization',
      canonicalFormat: 'markdown',
      groupId: input.groupId,
      ownerId: owner.id,
      licenseProfileId: input.licenseId,
      workflowId: input.workflowId,
      workingSource: read('draft-test-protocol-00.md'),
      workingSourceUpdatedAt: new Date('2026-08-02T09:00:00Z'),
      createdBy: owner.id,
    })
    .returning({ id: documents.id });

  const documentId = inserted[0]!.id;
  await db.insert(documentAuthors).values([
    { documentId, personId: owner.id, role: 'author', position: 0 },
    { documentId, personId: input.actors['author-2']!.id, role: 'editor', position: 0 },
  ]);
  await db.insert(documentRelations).values({
    sourceDocumentId: documentId,
    targetDocumentId: input.referenceDocumentId,
    targetRef: 'TEST-STD-0001',
    type: 'normative-reference',
    sourceSystem: 'local',
  });

  await recordAudit({
    familyKey: slug,
    documentId,
    entityType: 'document',
    entityId: documentId,
    action: 'draft_created',
    summary: `Draft ${slug} created (blank)`,
    actorId: owner.id,
  });

  const rev00 = await createRevision({
    documentId,
    actor: owner,
    changeSummary: 'First skeleton with placeholder security considerations',
  });
  await drainQueue(50);

  const roundId = await startReviewRound(documentId, rev00.id, owner, 'Early structural review');

  await createThread({
    roundId,
    documentId,
    revisionId: rev00.id,
    anchor: 'section-4',
    sectionNumber: '4',
    type: 'blocking',
    severity: 'high',
    body: 'Security Considerations is a TODO. This cannot be approved until the replay and authentication properties are written out.',
    actor: input.actors['reviewer-1']!,
  });

  await createThread({
    roundId,
    documentId,
    revisionId: rev00.id,
    anchor: 'section-3',
    sectionNumber: '3',
    type: 'suggestion',
    body: 'Consider stating the message grammar in ABNF so it can be validated mechanically.',
    suggestion: 'Add an ABNF block defining `notification` and `outcome`.',
    actor: input.actors['reviewer-1']!,
  });

  // Author addresses the feedback: revision 01 becomes the current snapshot.
  await db
    .update(documents)
    .set({
      workingSource: read('draft-test-protocol-01.md'),
      workingSourceVersion: 1,
      workingSourceUpdatedAt: new Date('2026-08-14T11:00:00Z'),
      status: 'review',
    })
    .where(eq(documents.id, documentId));

  const rev01 = await createRevision({
    documentId,
    actor: owner,
    changeSummary: 'Wrote Security Considerations, added ABNF message grammar and delivery guarantees',
  });
  await drainQueue(50);

  await startReviewRound(documentId, rev01.id, owner, 'Second review round after addressing blocking feedback');

  await createThread({
    roundId: (await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)) && roundId,
    documentId,
    revisionId: rev01.id,
    anchor: 'section-5',
    sectionNumber: '5',
    type: 'comment',
    body: 'Operational considerations read well. No further concerns from my side.',
    actor: input.actors['reviewer-1']!,
  });

  // Left deliberately without approval: the publish gate must still block.
  await db.update(documents).set({ status: 'review' }).where(eq(documents.id, documentId));
}

async function seedErrataAndDisclosures(documentId: string, actors: ActorMap): Promise<void> {
  const doc = (await db.select().from(documents).where(eq(documents.id, documentId)).limit(1))[0];
  if (!doc) return;

  const verified = await reportErratum({
    documentId,
    revisionId: doc.publishedRevisionId,
    type: 'editorial',
    sectionAnchor: 'section-3.2',
    sectionNumber: '3.2',
    originalText: 'A receiver SHOULD reject a batch whose amounts do not sum to the control total',
    correctedText:
      'A receiver MUST reject a batch whose amounts do not sum to the control total carried out of band',
    notes: 'The conformance section already treats this as mandatory; the field table wording is weaker.',
    actor: actors['reviewer-1']!,
  });
  await setErratumStatus(verified, 'verified', actors['approver-1']!, 'Wording corrected in the next update.');

  await reportErratum({
    documentId,
    revisionId: doc.publishedRevisionId,
    type: 'technical',
    sectionAnchor: 'section-3.1',
    sectionNumber: '3.1',
    originalText: 'batch-id    = 8*32(ALPHA / DIGIT / "-")',
    correctedText: 'batch-id    = 8*32(ALPHA / DIGIT / "-" / "_")',
    notes: 'Reported by an implementer; still under discussion by the working group.',
    actor: actors['author-2']!,
  });

  await db.insert(iprDisclosures).values({
    documentId,
    title: 'Fictional disclosure regarding batch control totals',
    holder: 'Example Holdings (fictional)',
    statement:
      'A fictional disclosure record used to exercise the IPR screen. No real intellectual property is described.',
    origin: 'local',
    disclosedAt: new Date('2026-07-20T00:00:00Z'),
  });
}

/**
 * Spreads the fixture history over the preceding months.
 *
 * Seeding runs the real services, which stamp everything with "now"; without
 * this pass the lifecycle timeline would collapse into a single instant and
 * would not demonstrate anything. Audit rows are append-only by trigger, so the
 * trigger is disabled for exactly this statement and restored immediately.
 */
async function backdateFixtureHistory(): Promise<void> {
  const schedule: Array<{ familyKey: string; draftDays: number[]; publishedAt?: string }> = [
    { familyKey: 'DRAFT-TEST-STD-0001', draftDays: [-95, -78], publishedAt: '2026-07-01T10:00:00Z' },
    { familyKey: 'DRAFT-TEST-STD-0002', draftDays: [-140, -120], publishedAt: '2026-06-15T09:00:00Z' },
    { familyKey: 'DRAFT-TEST-STD-0003', draftDays: [-40, -22], publishedAt: '2026-08-10T08:30:00Z' },
    { familyKey: 'DRAFT-TEST-PROTOCOL', draftDays: [-16, -4] },
  ];

  const dayMs = 86_400_000;
  const now = Date.now();

  // Both guards exist precisely to stop this kind of write in normal operation.
  await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`);
  await db.execute(sql`ALTER TABLE revisions DISABLE TRIGGER revisions_immutability`);
  try {
    for (const entry of schedule) {
      const familyDocs = await db.select().from(documents).where(eq(documents.familyKey, entry.familyKey));
      const draft = familyDocs.find((d) => d.slug.startsWith('DRAFT-'));
      const published = familyDocs.find((d) => !d.slug.startsWith('DRAFT-'));
      if (!draft) continue;

      const draftRevisions = await db
        .select()
        .from(revisions)
        .where(eq(revisions.documentId, draft.id))
        .orderBy(revisions.sequence);

      for (const [index, revision] of draftRevisions.entries()) {
        const offset = entry.draftDays[Math.min(index, entry.draftDays.length - 1)]!;
        const at = new Date(now + offset * dayMs);
        await db.update(revisions).set({ createdAt: at }).where(eq(revisions.id, revision.id));
      }

      await db
        .update(documents)
        .set({ createdAt: new Date(now + entry.draftDays[0]! * dayMs) })
        .where(eq(documents.id, draft.id));

      if (published && entry.publishedAt) {
        const at = new Date(entry.publishedAt);
        await db
          .update(documents)
          .set({ createdAt: at, publishedAt: at, updatedAt: at })
          .where(eq(documents.id, published.id));
        await db
          .update(revisions)
          .set({ createdAt: at, publishedAt: at })
          .where(eq(revisions.documentId, published.id));
        await db
          .update(publications)
          .set({ createdAt: at, publishedAt: at })
          .where(eq(publications.documentId, published.id));
        await db
          .update(documents)
          .set({ updatedAt: at })
          .where(eq(documents.id, draft.id));
      }

      // Spread the audit events for this family across the same window.
      const events = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.familyKey, entry.familyKey))
        .orderBy(auditEvents.createdAt);
      const first = entry.draftDays[0]!;
      const last = entry.publishedAt
        ? (new Date(entry.publishedAt).getTime() - now) / dayMs
        : entry.draftDays[entry.draftDays.length - 1]!;
      for (const [index, event] of events.entries()) {
        const ratio = events.length > 1 ? index / (events.length - 1) : 0;
        const offset = first + (last - first) * ratio;
        await db
          .update(auditEvents)
          .set({ createdAt: new Date(now + offset * dayMs) })
          .where(eq(auditEvents.id, event.id));
      }
    }
  } finally {
    await db.execute(sql`ALTER TABLE revisions ENABLE TRIGGER revisions_immutability`);
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`);
  }
}
