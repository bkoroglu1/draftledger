import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  ArtifactFormat,
  CanonicalFormat,
  DocumentOrigin,
  DocumentVisibility,
  ErratumStatus,
  JobState,
  LifecycleState,
  OrgRole,
  RelationType,
  ReviewThreadStatus,
  ReviewThreadType,
  SyncState,
} from '#src/domain/types.ts';

const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export const people = pgTable(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    /** private | group | organization | public — controls reader exposure. */
    emailVisibility: text('email_visibility').notNull().default('organization'),
    affiliation: text('affiliation'),
    bio: text('bio'),
    orgRole: text('org_role').$type<OrgRole>().notNull().default('reader'),
    passwordHash: text('password_hash'),
    isActive: boolean('is_active').notNull().default(true),
    /** External identities carry provenance and can never authenticate. */
    isExternal: boolean('is_external').notNull().default(false),
    externalSource: text('external_source'),
    externalRef: text('external_ref'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('people_handle_uq').on(t.handle)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: now(),
  },
  (t) => [index('sessions_person_idx').on(t.personId)],
);

/**
 * Single-use invite and password-reset tokens. Only the hash is stored, so a
 * database dump cannot be turned into a working link.
 */
export const credentialTokens = pgTable(
  'credential_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** invite | reset */
    kind: text('kind').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => people.id, { onDelete: 'set null' }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('credential_tokens_hash_uq').on(t.tokenHash),
    index('credential_tokens_person_idx').on(t.personId, t.createdAt),
  ],
);

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** working-group | project | team */
    kind: text('kind').notNull().default('working-group'),
    description: text('description'),
    charter: text('charter'),
    contactPolicy: text('contact_policy').notNull().default('owners-only'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('groups_slug_uq').on(t.slug)],
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** owner | reviewer | approver | publisher | member */
    role: text('role').notNull().default('member'),
    createdAt: now(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.personId, t.role] })],
);

/* -------------------------------------------------------------------------- */
/* Publication policy                                                          */
/* -------------------------------------------------------------------------- */

export const namespaces = pgTable(
  'namespaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    /** printf-ish pattern, e.g. "{prefix}-{seq:4}" */
    numberPattern: text('number_pattern').notNull().default('{prefix}-{seq:4}'),
    prefix: text('prefix').notNull(),
    nextSequence: integer('next_sequence').notNull().default(1),
    draftPrefix: text('draft_prefix').notNull().default('DRAFT'),
    workflowId: uuid('workflow_id'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('namespaces_key_uq').on(t.key)],
);

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** Ordered lifecycle states; admins may extend but not remove immutability. */
    states: jsonb('states').$type<LifecycleState[]>().notNull(),
    /** Approval gate definitions evaluated before publish. */
    gates: jsonb('gates')
      .$type<
        Array<{
          key: string;
          label: string;
          kind:
            | 'no-blocking-threads'
            | 'group-approval'
            | 'role-approval'
            | 'validation-clean'
            | 'required-sections'
            | 'references-resolved'
            | 'owner-approval';
          required: boolean;
          groupSlug?: string;
          minApprovals?: number;
          sections?: string[];
        }>
      >()
      .notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex('workflows_key_uq').on(t.key)],
);

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    canonicalFormat: text('canonical_format').$type<CanonicalFormat>().notNull().default('markdown'),
    body: text('body').notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex('templates_key_uq').on(t.key)],
);

export const licenseProfiles = pgTable(
  'license_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    copyrightHolder: text('copyright_holder').notNull(),
    noticeText: text('notice_text').notNull(),
    reusePolicy: text('reuse_policy').notNull().default('internal-only'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('license_profiles_key_uq').on(t.key)],
);

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    origin: text('origin').$type<DocumentOrigin>().notNull().default('local'),
    namespaceId: uuid('namespace_id').references(() => namespaces.id),
    /** Stable human URL key: DRAFT-TEST-PROTOCOL or TEST-STD-0001. */
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    /** Draft family key shared by a draft and the document it becomes. */
    familyKey: text('family_key').notNull(),
    documentNumber: text('document_number'),
    type: text('type').notNull().default('standard'),
    title: text('title').notNull(),
    abstract: text('abstract'),
    standardLevel: text('standard_level').notNull().default('proposed'),
    intendedStatus: text('intended_status'),
    status: text('status').$type<LifecycleState>().notNull().default('drafting'),
    visibility: text('visibility').$type<DocumentVisibility>().notNull().default('group'),
    canonicalFormat: text('canonical_format').$type<CanonicalFormat>().notNull().default('markdown'),
    groupId: uuid('group_id').references(() => groups.id),
    ownerId: uuid('owner_id').references(() => people.id),
    licenseProfileId: uuid('license_profile_id').references(() => licenseProfiles.id),
    workflowId: uuid('workflow_id').references(() => workflows.id),
    /** Mutable working copy — never published directly. */
    workingSource: text('working_source').notNull().default(''),
    workingSourceUpdatedAt: timestamp('working_source_updated_at', { withTimezone: true }),
    workingSourceVersion: integer('working_source_version').notNull().default(0),
    currentRevisionId: uuid('current_revision_id'),
    publishedRevisionId: uuid('published_revision_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    pages: integer('pages'),
    wordCount: integer('word_count'),
    /** External import provenance */
    sourceSystem: text('source_system'),
    sourceRef: text('source_ref'),
    sourceUrl: text('source_url'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    syncState: text('sync_state').$type<SyncState>().notNull().default('local'),
    derivedFromDocumentId: uuid('derived_from_document_id'),
    createdBy: uuid('created_by').references(() => people.id),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('documents_slug_uq').on(t.slug),
    index('documents_family_idx').on(t.familyKey),
    index('documents_status_idx').on(t.status),
    index('documents_group_idx').on(t.groupId),
  ],
);

export const revisions = pgTable(
  'revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Reader route key: DRAFT-TEST-PROTOCOL-01 */
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    sequence: integer('sequence').notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    isImmutable: boolean('is_immutable').notNull().default(true),
    isPublication: boolean('is_publication').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    changeSummary: text('change_summary'),
    source: text('source').notNull(),
    sourceKind: text('source_kind').notNull().default('authored'),
    sourceStorageKey: text('source_storage_key'),
    sourceSha256: text('source_sha256').notNull(),
    canonicalFormat: text('canonical_format').$type<CanonicalFormat>().notNull(),
    parserVersion: text('parser_version').notNull(),
    rendererVersion: text('renderer_version').notNull(),
    renderState: text('render_state').notNull().default('pending'),
    renderError: text('render_error'),
    pages: integer('pages'),
    wordCount: integer('word_count'),
    createdBy: uuid('created_by').references(() => people.id),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('revisions_slug_uq').on(t.slug),
    uniqueIndex('revisions_doc_seq_uq').on(t.documentId, t.sequence),
    index('revisions_doc_idx').on(t.documentId),
  ],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    format: text('format').$type<ArtifactFormat>().notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sha256: text('sha256').notNull(),
    byteLength: integer('byte_length').notNull(),
    sourceUrl: text('source_url'),
    etag: text('etag'),
    lastModified: text('last_modified'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    parserVersion: text('parser_version'),
    syncStatus: text('sync_status').notNull().default('generated'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('artifacts_rev_format_uq').on(t.revisionId, t.format)],
);

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    number: text('number'),
    title: text('title').notNull(),
    depth: integer('depth').notNull(),
    anchor: text('anchor').notNull(),
    pageNumber: integer('page_number'),
    sourceStart: integer('source_start'),
    sourceEnd: integer('source_end'),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    index('sections_rev_idx').on(t.revisionId, t.sortOrder),
    uniqueIndex('sections_rev_anchor_uq').on(t.revisionId, t.anchor),
  ],
);

export const documentRelations = pgTable(
  'document_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    targetDocumentId: uuid('target_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    /** Free-text target for references that are not local documents yet. */
    targetRef: text('target_ref'),
    targetTitle: text('target_title'),
    type: text('type').$type<RelationType>().notNull(),
    sourceSystem: text('source_system').notNull().default('local'),
    createdAt: now(),
  },
  (t) => [
    index('relations_source_idx').on(t.sourceDocumentId, t.type),
    index('relations_target_idx').on(t.targetDocumentId, t.type),
  ],
);

export const documentAuthors = pgTable(
  'document_authors',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** author | editor */
    role: text('role').notNull().default('author'),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.personId, t.role] })],
);

export const documentWatchers = pgTable(
  'document_watchers',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    createdAt: now(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.personId] })],
);

/* -------------------------------------------------------------------------- */
/* Review + approval + publication                                             */
/* -------------------------------------------------------------------------- */

export const reviewRounds = pgTable(
  'review_rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    /** open | closed */
    status: text('status').notNull().default('open'),
    requestedBy: uuid('requested_by').references(() => people.id),
    note: text('note'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [uniqueIndex('review_rounds_doc_seq_uq').on(t.documentId, t.sequence)],
);

export const reviewThreads = pgTable(
  'review_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => reviewRounds.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    anchor: text('anchor'),
    sectionNumber: text('section_number'),
    sourceStartLine: integer('source_start_line'),
    sourceEndLine: integer('source_end_line'),
    quotedText: text('quoted_text'),
    type: text('type').$type<ReviewThreadType>().notNull().default('comment'),
    severity: text('severity').notNull().default('normal'),
    status: text('status').$type<ReviewThreadStatus>().notNull().default('open'),
    assigneeId: uuid('assignee_id').references(() => people.id),
    /** Set when a thread is carried forward to a newer revision. */
    carriedFromThreadId: uuid('carried_from_thread_id'),
    isOrphaned: boolean('is_orphaned').notNull().default(false),
    createdBy: uuid('created_by').references(() => people.id),
    resolvedBy: uuid('resolved_by').references(() => people.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index('review_threads_round_idx').on(t.roundId), index('review_threads_doc_idx').on(t.documentId)],
);

export const reviewComments = pgTable(
  'review_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => reviewThreads.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /** Optional replacement text for `suggestion` threads. */
    suggestion: text('suggestion'),
    authorId: uuid('author_id').references(() => people.id),
    createdAt: now(),
  },
  (t) => [index('review_comments_thread_idx').on(t.threadId, t.createdAt)],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    gateKey: text('gate_key').notNull(),
    /** approved | rejected */
    decision: text('decision').notNull(),
    note: text('note'),
    /** Checksum the decision was bound to; mismatch ⇒ stale. */
    revisionSha256: text('revision_sha256').notNull(),
    isStale: boolean('is_stale').notNull().default(false),
    approverId: uuid('approver_id')
      .notNull()
      .references(() => people.id),
    createdAt: now(),
  },
  (t) => [index('approvals_doc_idx').on(t.documentId, t.revisionId)],
);

export const publications = pgTable(
  'publications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    documentNumber: text('document_number').notNull(),
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
    /** running | published | failed */
    state: text('state').notNull().default('running'),
    error: text('error'),
    jobId: uuid('job_id'),
    publishedBy: uuid('published_by').references(() => people.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [uniqueIndex('publications_number_uq').on(t.documentNumber)],
);

/* -------------------------------------------------------------------------- */
/* Audit + history                                                             */
/* -------------------------------------------------------------------------- */

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyKey: text('family_key').notNull(),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    revisionId: uuid('revision_id').references(() => revisions.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    /** Permission-tagged field diffs: [{ field, before, after, sensitivity }] */
    changes: jsonb('changes')
      .$type<Array<{ field: string; before: unknown; after: unknown; sensitivity?: 'public' | 'internal' | 'restricted' }>>()
      .notNull()
      .default([]),
    actorId: uuid('actor_id').references(() => people.id, { onDelete: 'set null' }),
    actorKind: text('actor_kind').notNull().default('user'),
    origin: text('origin').notNull().default('local'),
    correlationId: text('correlation_id'),
    visibility: text('visibility').notNull().default('group'),
    createdAt: now(),
  },
  (t) => [
    index('audit_family_idx').on(t.familyKey, t.createdAt),
    index('audit_doc_idx').on(t.documentId, t.createdAt),
    index('audit_action_idx').on(t.action),
  ],
);

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export const notificationPolicies = pgTable(
  'notification_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** global | namespace | group | document */
    scope: text('scope').notNull(),
    scopeRef: text('scope_ref'),
    eventKey: text('event_key').notNull(),
    channel: text('channel').notNull().default('email'),
    enabled: boolean('enabled').notNull().default(true),
    precedence: integer('precedence').notNull().default(0),
    toSelectors: jsonb('to_selectors').$type<string[]>().notNull().default([]),
    ccSelectors: jsonb('cc_selectors').$type<string[]>().notNull().default([]),
    /** Selectors removed from the inherited result. */
    suppressSelectors: jsonb('suppress_selectors').$type<string[]>().notNull().default([]),
    template: text('template'),
    version: integer('version').notNull().default(1),
    supersededById: uuid('superseded_by_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => people.id),
    createdAt: now(),
  },
  (t) => [index('notif_policy_lookup_idx').on(t.eventKey, t.scope, t.scopeRef, t.isActive)],
);

export const notificationEvents = pgTable(
  'notification_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    catalogVersion: integer('catalog_version').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: now(),
  },
  (t) => [uniqueIndex('notification_events_key_uq').on(t.key)],
);

export const notificationExpansions = pgTable(
  'notification_expansions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id').references(() => revisions.id, { onDelete: 'set null' }),
    eventKey: text('event_key').notNull(),
    channel: text('channel').notNull().default('email'),
    policyVersions: jsonb('policy_versions').$type<string[]>().notNull().default([]),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    computedAt: now(),
  },
  (t) => [index('notif_expansion_doc_idx').on(t.documentId, t.eventKey)],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    eventKey: text('event_key').notNull(),
    channel: text('channel').notNull().default('email'),
    policyVersion: integer('policy_version').notNull().default(1),
    /** Redacted recipient summary; never raw addresses. */
    recipients: jsonb('recipients').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    errorClass: text('error_class'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notif_delivery_doc_idx').on(t.documentId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Errata, disclosures, sync                                                   */
/* -------------------------------------------------------------------------- */

export const errata = pgTable(
  'errata',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id').references(() => revisions.id, { onDelete: 'set null' }),
    number: integer('number').notNull(),
    /** technical | editorial */
    type: text('type').notNull().default('editorial'),
    status: text('status').$type<ErratumStatus>().notNull().default('reported'),
    sectionAnchor: text('section_anchor'),
    sectionNumber: text('section_number'),
    originalText: text('original_text'),
    correctedText: text('corrected_text'),
    notes: text('notes'),
    reporterId: uuid('reporter_id').references(() => people.id),
    reporterName: text('reporter_name'),
    verifierId: uuid('verifier_id').references(() => people.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    resolution: text('resolution'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('errata_doc_number_uq').on(t.documentId, t.number)],
);

export const iprDisclosures = pgTable(
  'ipr_disclosures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    holder: text('holder').notNull(),
    statement: text('statement'),
    /** local | external */
    origin: text('origin').notNull().default('local'),
    externalUrl: text('external_url'),
    disclosedAt: timestamp('disclosed_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index('ipr_doc_idx').on(t.documentId)],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adapter: text('adapter').notNull(),
    mode: text('mode').notNull(),
    documentRef: text('document_ref'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    state: text('state').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    log: jsonb('log').$type<string[]>().notNull().default([]),
  },
  (t) => [index('sync_runs_doc_idx').on(t.documentRef, t.startedAt)],
);

/* -------------------------------------------------------------------------- */
/* Job queue                                                                   */
/* -------------------------------------------------------------------------- */

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** Deduplication key — a second identical job is folded into the first. */
    dedupeKey: text('dedupe_key'),
    state: text('state').$type<JobState>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    correlationId: text('correlation_id'),
    createdAt: now(),
  },
  (t) => [
    index('jobs_state_runat_idx').on(t.state, t.runAt),
    uniqueIndex('jobs_dedupe_uq').on(t.dedupeKey),
  ],
);
