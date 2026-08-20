/**
 * Deterministic, entirely fictional fixture set.
 *
 * No real person, organization, RFC number or upstream metadata appears here.
 * Identifiers use the TEST-STD / DRAFT-TEST namespace so they can never be
 * confused with a real published standard.
 */

export const SEED_ORG = 'Example Standards Organization';

export const SEED_PEOPLE = [
  {
    handle: 'admin-1',
    displayName: 'Admin One',
    email: 'admin-1@example.invalid',
    orgRole: 'admin' as const,
    affiliation: SEED_ORG,
    password: 'draftledger',
    emailVisibility: 'organization',
  },
  {
    handle: 'author-1',
    displayName: 'Author One',
    email: 'author-1@example.invalid',
    orgRole: 'author' as const,
    affiliation: SEED_ORG,
    password: 'draftledger',
    emailVisibility: 'organization',
  },
  {
    handle: 'author-2',
    displayName: 'Author Two',
    email: 'author-2@example.invalid',
    orgRole: 'editor' as const,
    affiliation: 'Example Integrations Team',
    password: 'draftledger',
    emailVisibility: 'group',
  },
  {
    handle: 'reviewer-1',
    displayName: 'Reviewer One',
    email: 'reviewer-1@example.invalid',
    orgRole: 'reviewer' as const,
    affiliation: SEED_ORG,
    password: 'draftledger',
    emailVisibility: 'organization',
  },
  {
    handle: 'approver-1',
    displayName: 'Approver One',
    email: 'approver-1@example.invalid',
    orgRole: 'approver' as const,
    affiliation: SEED_ORG,
    password: 'draftledger',
    emailVisibility: 'organization',
  },
  {
    handle: 'publisher-1',
    displayName: 'Publisher One',
    email: 'publisher-1@example.invalid',
    orgRole: 'publisher' as const,
    affiliation: SEED_ORG,
    password: 'draftledger',
    emailVisibility: 'organization',
  },
  {
    handle: 'reader-1',
    displayName: 'Reader One',
    email: 'reader-1@example.invalid',
    orgRole: 'reader' as const,
    affiliation: 'Example Operations Team',
    password: 'draftledger',
    emailVisibility: 'private',
  },
];

export const SEED_GROUPS = [
  {
    slug: 'ledger-interchange',
    name: 'Ledger Interchange Working Group',
    kind: 'working-group',
    description:
      'Fictional working group responsible for the example ledger interchange standards used to exercise this installation.',
    charter:
      'Define and maintain the example ledger interchange formats, their conformance rules and their migration guidance.',
    members: [
      { handle: 'author-1', role: 'owner' },
      { handle: 'author-1', role: 'member' },
      { handle: 'author-2', role: 'member' },
      { handle: 'reviewer-1', role: 'reviewer' },
      { handle: 'approver-1', role: 'approver' },
      { handle: 'publisher-1', role: 'publisher' },
      { handle: 'admin-1', role: 'owner' },
    ],
  },
  {
    slug: 'platform-operations',
    name: 'Platform Operations Project',
    kind: 'project',
    description: 'Fictional project group used to exercise group-scoped visibility rules.',
    members: [
      { handle: 'reader-1', role: 'member' },
      { handle: 'admin-1', role: 'owner' },
    ],
  },
];

export const SEED_NAMESPACE = {
  key: 'example-standards',
  label: 'Example Standards Series',
  description: 'Primary publication series for this installation.',
  prefix: 'TEST-STD',
  numberPattern: '{prefix}-{seq:4}',
  draftPrefix: 'DRAFT',
};

export const SEED_LICENSE = {
  key: 'org-internal',
  name: 'Organization internal publication licence',
  copyrightHolder: SEED_ORG,
  noticeText:
    'Copyright (c) Example Standards Organization. This fictional document may be redistributed inside the organization together with this notice.',
  reusePolicy: 'internal-with-attribution',
};

export const SEED_WORKFLOW = {
  key: 'standards-track',
  name: 'Standards track',
  states: [
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
  ],
  gates: [
    {
      key: 'no-blocking-threads',
      label: 'All blocking review threads resolved',
      kind: 'no-blocking-threads',
      required: true,
    },
    {
      key: 'validation-clean',
      label: 'Document validates without errors',
      kind: 'validation-clean',
      required: true,
    },
    {
      key: 'required-sections',
      label: 'Required sections present',
      kind: 'required-sections',
      required: true,
      sections: ['Security Considerations'],
    },
    {
      key: 'references-resolved',
      label: 'Citations and cross references resolve',
      kind: 'references-resolved',
      required: true,
    },
    {
      key: 'group-approval',
      label: 'Owning working group approval',
      kind: 'group-approval',
      required: true,
      groupSlug: 'ledger-interchange',
      minApprovals: 1,
    },
  ],
};

export const SEED_TEMPLATE = {
  key: 'standards-track-default',
  name: 'Standards track document',
  description: 'Default skeleton with the sections the publication policy requires.',
  body: `---
title: {{title}}
abbrev: {{shortName}}
---

# Abstract

{{abstract}}

# Introduction

TODO: describe the problem this document solves.

# Terminology

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT and MAY in this
document are to be interpreted as requirement levels.

# Specification

TODO: write the normative rules.

# Security Considerations

TODO: describe the security properties, the threat model and residual risks.

# Operational Considerations

TODO: describe deployment and migration impact.

# Normative References

[EXAMPLE-KEY]  Author, A., "Referenced document title", TEST-STD-0000, 2026.
`,
};

export const SEED_NOTIFICATION_POLICIES = [
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'draft_created',
    toSelectors: ['document.owner'],
    ccSelectors: ['group.owners'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'revision_saved',
    toSelectors: ['document.authors'],
    ccSelectors: ['document.watchers'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'review_started',
    toSelectors: ['workflow.reviewers'],
    ccSelectors: ['document.authors', 'group.owners'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'review_comment_added',
    toSelectors: ['document.authors'],
    ccSelectors: ['workflow.reviewers'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'changes_requested',
    toSelectors: ['document.authors', 'document.editors'],
    ccSelectors: ['group.owners'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'review_approved',
    toSelectors: ['document.authors'],
    ccSelectors: ['workflow.approvers'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'approval_invalidated',
    toSelectors: ['workflow.approvers'],
    ccSelectors: ['document.authors'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'publish_requested',
    toSelectors: ['namespace.publishers'],
    ccSelectors: ['workflow.approvers'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'document_published',
    toSelectors: ['document.authors', 'group.members'],
    ccSelectors: ['namespace.publishers'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'metadata_changed',
    toSelectors: ['document.owner'],
    ccSelectors: [],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'erratum_reported',
    toSelectors: ['document.authors', 'group.owners'],
    ccSelectors: ['namespace.publishers'],
    precedence: 0,
  },
  {
    scope: 'global',
    scopeRef: null,
    eventKey: 'external_resource_changed',
    toSelectors: ['namespace.publishers'],
    ccSelectors: [],
    precedence: 0,
  },
  // Namespace scope adds publishers to every publication announcement.
  {
    scope: 'namespace',
    scopeRef: 'example-standards',
    eventKey: 'document_published',
    toSelectors: ['document.authors', 'group.members', 'namespace.publishers'],
    ccSelectors: ['group.owners'],
    precedence: 10,
  },
  // Group scope narrows review notifications to the reviewers of this group.
  {
    scope: 'group',
    scopeRef: 'ledger-interchange',
    eventKey: 'review_started',
    toSelectors: ['workflow.reviewers', 'workflow.approvers'],
    ccSelectors: ['document.authors'],
    suppressSelectors: ['document.watchers'],
    precedence: 20,
  },
];
