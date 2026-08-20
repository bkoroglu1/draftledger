/** Shared domain vocabulary. Values are open enough for admin extension. */

export type OrgRole = 'admin' | 'publisher' | 'approver' | 'reviewer' | 'editor' | 'author' | 'reader';

/** Ordered by privilege; used for coarse organization-level checks. */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  reader: 0,
  author: 1,
  editor: 2,
  reviewer: 3,
  approver: 4,
  publisher: 5,
  admin: 6,
};

export type GroupRole = 'owner' | 'reviewer' | 'approver' | 'publisher' | 'member';

/** Shared with the admin client components, so these live in the domain layer. */
export const GROUP_ROLES: GroupRole[] = ['owner', 'reviewer', 'approver', 'publisher', 'member'];
export const GROUP_KINDS = ['working-group', 'project', 'team'] as const;
export const CONTACT_POLICIES = ['owners-only', 'members', 'public'] as const;
export const ORG_ROLES: OrgRole[] = ['reader', 'author', 'editor', 'reviewer', 'approver', 'publisher', 'admin'];
export const EMAIL_VISIBILITIES = ['private', 'group', 'organization', 'public'] as const;

export type DocumentOrigin = 'local' | 'external-import' | 'external-fork';

export type DocumentVisibility = 'private' | 'group' | 'organization' | 'public';

export const VISIBILITY_RANK: Record<DocumentVisibility, number> = {
  private: 0,
  group: 1,
  organization: 2,
  public: 3,
};

export type CanonicalFormat = 'markdown' | 'rfcxml';

export type LifecycleState =
  | 'idea'
  | 'drafting'
  | 'review'
  | 'changes-requested'
  | 'approved'
  | 'publishing'
  | 'published'
  | 'withdrawn'
  | 'historic'
  | 'superseded';

export const LIFECYCLE_STATES: LifecycleState[] = [
  'idea',
  'drafting',
  'review',
  'changes-requested',
  'approved',
  'publishing',
  'published',
  'withdrawn',
  'historic',
  'superseded',
];

/** Legal lifecycle transitions. Publication immutability is enforced separately. */
export const LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  idea: ['drafting', 'withdrawn'],
  drafting: ['review', 'withdrawn'],
  review: ['changes-requested', 'approved', 'drafting', 'withdrawn'],
  'changes-requested': ['drafting', 'review', 'withdrawn'],
  approved: ['publishing', 'drafting', 'changes-requested', 'withdrawn'],
  publishing: ['published', 'approved'],
  published: ['historic', 'superseded', 'withdrawn'],
  withdrawn: ['drafting'],
  historic: [],
  superseded: ['historic'],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

export type RelationType =
  | 'updates'
  | 'obsoletes'
  | 'replaces'
  | 'was'
  | 'derived-from'
  | 'normative-reference'
  | 'informative-reference'
  | 'unknown-reference';

export const INVERSE_RELATION: Partial<Record<RelationType, string>> = {
  updates: 'updated-by',
  obsoletes: 'obsoleted-by',
  replaces: 'replaced-by',
  'derived-from': 'forked-into',
};

export type ArtifactFormat = 'txt' | 'html' | 'xml' | 'markdown' | 'pdf' | 'bibtex' | 'html-with-errata';

export const ARTIFACT_MIME: Record<ArtifactFormat, string> = {
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  xml: 'application/rfc+xml; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  pdf: 'application/pdf',
  bibtex: 'application/x-bibtex; charset=utf-8',
  'html-with-errata': 'text/html; charset=utf-8',
};

export type ReviewThreadType =
  | 'comment'
  | 'question'
  | 'suggestion'
  | 'blocking'
  | 'editorial'
  | 'security'
  | 'legal'
  | 'approval-note';

/** Threads of these types block publication until resolved. */
export const BLOCKING_THREAD_TYPES: ReviewThreadType[] = ['blocking'];

export type ReviewThreadStatus = 'open' | 'resolved' | 'wont-fix' | 'superseded';

export type ErratumStatus = 'reported' | 'verified' | 'held' | 'rejected';

export type SyncState = 'local' | 'synced' | 'stale' | 'syncing' | 'error' | 'never';

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type DiffView = 'side-by-side' | 'before-after' | 'change-bars' | 'inline';

export const DIFF_VIEWS: DiffView[] = ['side-by-side', 'before-after', 'change-bars', 'inline'];

export type ThemePreference = 'light' | 'dark' | 'auto';

/** Notification event catalog seed. Extended at runtime via notification_events. */
export const DEFAULT_EVENT_CATALOG: Array<{ key: string; label: string; description: string }> = [
  { key: 'draft_created', label: 'Draft created', description: 'A new local draft was created.' },
  { key: 'revision_saved', label: 'Revision saved', description: 'An immutable revision snapshot was created.' },
  { key: 'review_started', label: 'Review started', description: 'A review round opened on a revision.' },
  { key: 'review_comment_added', label: 'Review comment added', description: 'A reviewer commented on a thread.' },
  { key: 'changes_requested', label: 'Changes requested', description: 'A blocking change request was opened.' },
  { key: 'review_approved', label: 'Review approved', description: 'An approver approved a revision.' },
  { key: 'approval_invalidated', label: 'Approval invalidated', description: 'A previous approval became stale.' },
  { key: 'publish_requested', label: 'Publish requested', description: 'A publish transaction was requested.' },
  { key: 'document_published', label: 'Document published', description: 'A document reached published state.' },
  { key: 'metadata_changed', label: 'Metadata changed', description: 'Document metadata was updated.' },
  { key: 'erratum_reported', label: 'Erratum reported', description: 'An erratum was filed against a publication.' },
  {
    key: 'external_resource_changed',
    label: 'External resource changed',
    description: 'An imported upstream artifact changed during sync.',
  },
];

/** Role/group based recipient selectors — never raw addresses. */
export const RECIPIENT_SELECTORS = [
  'document.authors',
  'document.editors',
  'document.owner',
  'document.watchers',
  'group.owners',
  'group.members',
  'workflow.reviewers',
  'workflow.approvers',
  'namespace.publishers',
] as const;

export type RecipientSelector = (typeof RECIPIENT_SELECTORS)[number] | `person:${string}` | `group:${string}`;

export const PARSER_VERSION = 'draftledger-parser/1.0.0';
export const RENDERER_VERSION = 'draftledger-renderer/1.0.0';
