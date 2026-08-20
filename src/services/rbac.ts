import type { DocumentVisibility, GroupRole, OrgRole } from '#src/domain/types.ts';
import { ORG_ROLE_RANK } from '#src/domain/types.ts';
import { appError } from '#src/domain/errors.ts';

/**
 * Authorization rules. Every check is evaluated server-side; hiding a button in
 * the UI is never the enforcement point.
 */

export interface Actor {
  id: string;
  handle: string;
  displayName: string;
  email: string | null;
  orgRole: OrgRole;
  /** groupId -> roles held in that group. */
  groupRoles: Record<string, GroupRole[]>;
}

export interface DocumentAcl {
  id: string;
  ownerId: string | null;
  groupId: string | null;
  visibility: DocumentVisibility;
  origin: string;
  status: string;
  authorIds: string[];
  editorIds: string[];
}

export function hasOrgRole(actor: Actor | null, role: OrgRole): boolean {
  if (!actor) return false;
  return ORG_ROLE_RANK[actor.orgRole] >= ORG_ROLE_RANK[role];
}

export function isAdmin(actor: Actor | null): boolean {
  return actor?.orgRole === 'admin';
}

export function groupRolesOf(actor: Actor | null, groupId: string | null): GroupRole[] {
  if (!actor || !groupId) return [];
  return actor.groupRoles[groupId] ?? [];
}

export function hasGroupRole(actor: Actor | null, groupId: string | null, role: GroupRole): boolean {
  return groupRolesOf(actor, groupId).includes(role);
}

function isContributor(actor: Actor | null, doc: DocumentAcl): boolean {
  if (!actor) return false;
  return (
    doc.ownerId === actor.id ||
    doc.authorIds.includes(actor.id) ||
    doc.editorIds.includes(actor.id)
  );
}

export function canReadDocument(actor: Actor | null, doc: DocumentAcl): boolean {
  if (isAdmin(actor)) return true;
  // "public" is an explicit authoring choice and covers the whole document,
  // including the draft revisions a published standard came from.
  if (doc.visibility === 'public') return true;
  if (!actor) return false;
  if (doc.visibility === 'organization') return true;
  if (doc.visibility === 'group') {
    return groupRolesOf(actor, doc.groupId).length > 0 || isContributor(actor, doc);
  }
  return isContributor(actor, doc);
}

/** Published local documents with public visibility are readable anonymously. */
export function canReadRevisionHistory(actor: Actor | null, doc: DocumentAcl): boolean {
  return canReadDocument(actor, doc);
}

export function canEditDraft(actor: Actor | null, doc: DocumentAcl): boolean {
  if (!actor) return false;
  if (doc.origin === 'external-import') return false;
  if (doc.status === 'published' || doc.status === 'superseded' || doc.status === 'historic') {
    return false;
  }
  if (isAdmin(actor)) return true;
  if (isContributor(actor, doc)) return hasOrgRole(actor, 'author');
  return hasGroupRole(actor, doc.groupId, 'owner');
}

export function canCreateDraft(actor: Actor | null): boolean {
  return hasOrgRole(actor, 'author');
}

export function canComment(actor: Actor | null, doc: DocumentAcl): boolean {
  return Boolean(actor) && canReadDocument(actor, doc);
}

/** Reviewers may open threads and request changes but never edit the text. */
export function canReview(actor: Actor | null, doc: DocumentAcl): boolean {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  return (
    hasOrgRole(actor, 'reviewer') ||
    hasGroupRole(actor, doc.groupId, 'reviewer') ||
    hasGroupRole(actor, doc.groupId, 'approver')
  );
}

export function canApprove(actor: Actor | null, doc: DocumentAcl): boolean {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  return hasOrgRole(actor, 'approver') || hasGroupRole(actor, doc.groupId, 'approver');
}

export function canPublish(actor: Actor | null, doc: DocumentAcl): boolean {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  return hasOrgRole(actor, 'publisher') || hasGroupRole(actor, doc.groupId, 'publisher');
}

export function canManagePolicy(actor: Actor | null): boolean {
  return isAdmin(actor);
}

/** Real delivery addresses are only shown to people who can act on them. */
export function canSeeRecipientAddresses(actor: Actor | null, doc: DocumentAcl): boolean {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  return canPublish(actor, doc) || hasGroupRole(actor, doc.groupId, 'owner') || doc.ownerId === actor.id;
}

export function canSeeRestrictedAudit(actor: Actor | null, doc: DocumentAcl): boolean {
  return canSeeRecipientAddresses(actor, doc);
}

export function canReportErratum(actor: Actor | null, doc: DocumentAcl): boolean {
  return Boolean(actor) && canReadDocument(actor, doc) && doc.status === 'published';
}

/* ------------------------------- assertions ------------------------------- */

export function assertRead(actor: Actor | null, doc: DocumentAcl): void {
  if (!canReadDocument(actor, doc)) {
    throw appError(actor ? 'forbidden' : 'unauthenticated', 'You cannot read this document.');
  }
}

export function assertEdit(actor: Actor | null, doc: DocumentAcl): void {
  assertRead(actor, doc);
  if (!canEditDraft(actor, doc)) {
    throw appError(
      doc.status === 'published' ? 'immutable_revision' : 'forbidden',
      doc.status === 'published'
        ? 'Published documents cannot be edited; file an erratum or start an update draft.'
        : 'You cannot edit this draft.',
    );
  }
}

export function assertPublish(actor: Actor | null, doc: DocumentAcl): void {
  assertRead(actor, doc);
  if (!canPublish(actor, doc)) throw appError('forbidden', 'You cannot publish in this namespace.');
}

export function assertApprove(actor: Actor | null, doc: DocumentAcl): void {
  assertRead(actor, doc);
  if (!canApprove(actor, doc)) throw appError('forbidden', 'You cannot approve this document.');
}

export function assertAdmin(actor: Actor | null): void {
  if (!isAdmin(actor)) throw appError(actor ? 'forbidden' : 'unauthenticated', 'Admin role required.');
}
