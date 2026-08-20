import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '#src/db/index.ts';
import {
  approvals,
  auditEvents,
  documents,
  namespaces,
  people,
  publications,
  revisions,
} from '#src/db/schema.ts';
import { appError, isAppError } from '#src/domain/errors.ts';
import { toActor } from '#src/services/auth.ts';
import { createDraft } from '#src/services/drafts.ts';
import { createRevision, saveWorkingCopy } from '#src/services/revisions.ts';
import { createThread, currentRound, setThreadStatus, startReviewRound } from '#src/services/reviews.ts';
import { evaluateGates, recordDecision } from '#src/services/approvals.ts';
import { executePublish, requestPublish } from '#src/services/publish.ts';
import { getDocumentContext, searchDocuments, toAcl, loadAuthors } from '#src/services/documents.ts';
import { expandRecipients, namespaceKeyFor } from '#src/services/notifications.ts';
import { drainQueue } from '#src/jobs/worker.ts';
import { canReadDocument } from '#src/services/rbac.ts';
import type { Actor } from '#src/services/rbac.ts';

/**
 * Integration coverage for the authoring → review → approval → publication
 * pipeline. Requires the seeded development database.
 */

const VALID_SOURCE = `---
title: Integration Fixture Standard
abbrev: Integration Fixture
---

# Abstract

Fixture used by the integration suite.

# Introduction

Introductory text referencing [EXAMPLE-KEY].

# Security Considerations

Implementations MUST validate every field before use.

# Normative References

[EXAMPLE-KEY]  Example Org, "Referenced", TEST-STD-0002, 2026.
`;

let author: Actor;
let reviewer: Actor;
let approver: Actor;
let publisher: Actor;
let reader: Actor;
const createdDocumentIds: string[] = [];

/** Drizzle wraps driver errors, so the trigger text lives on the cause. */
function causeMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' | ');
}

async function actorFor(handle: string): Promise<Actor> {
  const rows = await db.select().from(people).where(eq(people.handle, handle)).limit(1);
  if (!rows[0]) throw new Error(`fixture user ${handle} is missing — run npm run db:seed`);
  return toActor(rows[0]);
}

beforeAll(async () => {
  author = await actorFor('author-1');
  reviewer = await actorFor('reviewer-1');
  approver = await actorFor('approver-1');
  publisher = await actorFor('publisher-1');
  reader = await actorFor('reader-1');
});

afterAll(async () => {
  // Remove only what this suite created; the seeded fixtures stay intact.
  for (const id of createdDocumentIds) {
    await db.execute(sql`ALTER TABLE revisions DISABLE TRIGGER revisions_immutability`);
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`);
    await db.delete(documents).where(eq(documents.id, id));
    await db.execute(sql`ALTER TABLE revisions ENABLE TRIGGER revisions_immutability`);
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`);
  }
  await pool.end();
});

async function newDraft(title: string, source = VALID_SOURCE) {
  const created = await createDraft({
    mode: 'blank',
    title,
    shortName: `it-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    abstract: 'Integration fixture',
    namespaceKey: 'example-standards',
    groupSlug: 'ledger-interchange',
    authorHandles: ['author-1'],
    canonicalFormat: 'markdown',
    visibility: 'group',
    actor: author,
  });
  createdDocumentIds.push(created.documentId);
  await saveWorkingCopy(created.documentId, source, 0, author);
  return created;
}

describe('authoring and revisions', () => {
  it('creates immutable snapshots and renders artifacts', async () => {
    const draft = await newDraft('Integration Fixture Standard');
    const revision = await createRevision({ documentId: draft.documentId, actor: author });
    await drainQueue(20);

    const stored = await db.select().from(revisions).where(eq(revisions.id, revision.id)).limit(1);
    expect(stored[0]?.renderState).toBe('rendered');
    expect(stored[0]?.pages).toBeGreaterThan(0);

    await expect(
      db.update(revisions).set({ source: 'tampered' }).where(eq(revisions.id, revision.id)),
    ).rejects.toSatisfy((err: unknown) => /immutable_revision/.test(causeMessage(err)));
  });

  it('rejects a concurrent save instead of overwriting it', async () => {
    const draft = await newDraft('Concurrency Fixture');
    const first = await saveWorkingCopy(draft.documentId, `${VALID_SOURCE}\nedit A`, 1, author);
    await expect(
      saveWorkingCopy(draft.documentId, `${VALID_SOURCE}\nedit B`, 1, author),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(first.version).toBe(2);
  });
});

describe('review and approval gates', () => {
  it('blocks publication while a blocking thread is open', async () => {
    const draft = await newDraft('Gate Fixture Standard');
    const revision = await createRevision({ documentId: draft.documentId, actor: author });
    await drainQueue(20);
    await startReviewRound(draft.documentId, revision.id, author);

    const round = await currentRound(draft.documentId);
    const threadId = await createThread({
      roundId: round!.id,
      documentId: draft.documentId,
      revisionId: revision.id,
      type: 'blocking',
      body: 'Security considerations need more detail.',
      actor: reviewer,
    });

    let evaluation = await evaluateGates(draft.documentId, revision.id);
    expect(evaluation.canPublish).toBe(false);
    expect(evaluation.gates.find((g) => g.kind === 'no-blocking-threads')?.satisfied).toBe(false);

    await setThreadStatus(threadId, 'resolved', author);
    evaluation = await evaluateGates(draft.documentId, revision.id);
    expect(evaluation.gates.find((g) => g.kind === 'no-blocking-threads')?.satisfied).toBe(true);
  });

  it('marks an approval stale when the source changes', async () => {
    const draft = await newDraft('Stale Approval Fixture');
    const revision = await createRevision({ documentId: draft.documentId, actor: author });
    await drainQueue(20);

    const docRow = (await db.select().from(documents).where(eq(documents.id, draft.documentId)).limit(1))[0]!;
    const acl = toAcl(docRow, await loadAuthors(draft.documentId, null));
    await recordDecision(draft.documentId, revision.id, 'group-approval', 'approved', approver, acl);

    let evaluation = await evaluateGates(draft.documentId, revision.id);
    expect(evaluation.gates.find((g) => g.key === 'group-approval')?.satisfied).toBe(true);

    // A new snapshot invalidates the approval bound to the old checksum.
    await saveWorkingCopy(draft.documentId, `${VALID_SOURCE}\n\n# Extra Section\n\nMore text.\n`, 1, author);
    const second = await createRevision({ documentId: draft.documentId, actor: author });
    await drainQueue(20);

    evaluation = await evaluateGates(draft.documentId, second.id);
    expect(evaluation.gates.find((g) => g.key === 'group-approval')?.satisfied).toBe(false);

    const stale = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.documentId, draft.documentId), eq(approvals.isStale, true)));
    expect(stale.length).toBeGreaterThan(0);
  });

  it('refuses publication when required gates are unmet', async () => {
    const draft = await newDraft('Unmet Gate Fixture');
    await createRevision({ documentId: draft.documentId, actor: author });
    await drainQueue(20);
    await expect(requestPublish(draft.documentId, publisher)).rejects.toMatchObject({
      code: 'unresolved_gate',
    });
  });

  it('blocks a document whose required section is missing', async () => {
    const draft = await newDraft(
      'Missing Section Fixture',
      `---\ntitle: Missing Section Fixture\n---\n\n# Abstract\n\nNo security section here.\n\n# Introduction\n\nText.\n`,
    );
    const revision = await createRevision({ documentId: draft.documentId, actor: author });
    await drainQueue(20);
    const evaluation = await evaluateGates(draft.documentId, revision.id);
    expect(evaluation.gates.find((g) => g.kind === 'required-sections')?.satisfied).toBe(false);
  });
});

describe('publication', () => {
  it('publishes atomically into a separate published document', async () => {
    const draft = await newDraft('Publication Fixture Standard');
    const revision = await createRevision({ documentId: draft.documentId, actor: author });
    await drainQueue(20);

    const docRow = (await db.select().from(documents).where(eq(documents.id, draft.documentId)).limit(1))[0]!;
    const acl = toAcl(docRow, await loadAuthors(draft.documentId, null));
    await recordDecision(draft.documentId, revision.id, 'group-approval', 'approved', approver, acl);

    const before = await db
      .select({ next: namespaces.nextSequence })
      .from(namespaces)
      .where(eq(namespaces.key, 'example-standards'))
      .limit(1);

    const result = await executePublish(draft.documentId, revision.id, publisher.id);
    createdDocumentIds.push(result.publishedDocumentId!);

    expect(result.documentNumber).toMatch(/^TEST-STD-\d{4}$/);

    const published = (await db.select().from(documents).where(eq(documents.id, result.publishedDocumentId!)).limit(1))[0]!;
    expect(published.status).toBe('published');
    expect(published.familyKey).toBe(docRow.familyKey);
    expect(published.publishedRevisionId).toBeTruthy();

    const draftAfter = (await db.select().from(documents).where(eq(documents.id, draft.documentId)).limit(1))[0]!;
    expect(draftAfter.status).toBe('historic');

    const after = await db
      .select({ next: namespaces.nextSequence })
      .from(namespaces)
      .where(eq(namespaces.key, 'example-standards'))
      .limit(1);
    expect(after[0]!.next).toBe(before[0]!.next + 1);

    const publicationRows = await db
      .select()
      .from(publications)
      .where(eq(publications.documentId, published.id));
    expect(publicationRows[0]?.state).toBe('published');
    expect(publicationRows[0]?.manifest).toHaveProperty('sourceSha256');

    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.familyKey, docRow.familyKey));
    expect(events.map((e) => e.action)).toContain('document_published');
  });

  it('is idempotent when the publish job is retried', async () => {
    const draft = await newDraft('Idempotent Publish Fixture');
    const revision = await createRevision({ documentId: draft.documentId, actor: author });
    await drainQueue(20);
    const docRow = (await db.select().from(documents).where(eq(documents.id, draft.documentId)).limit(1))[0]!;
    const acl = toAcl(docRow, await loadAuthors(draft.documentId, null));
    await recordDecision(draft.documentId, revision.id, 'group-approval', 'approved', approver, acl);

    const first = await executePublish(draft.documentId, revision.id, publisher.id);
    createdDocumentIds.push(first.publishedDocumentId!);
    const second = await executePublish(draft.documentId, revision.id, publisher.id);
    expect(second.documentNumber).toBe(first.documentNumber);
    expect(second.publicationId).toBe(first.publicationId);
  });
});

describe('authorization', () => {
  it('hides a private draft from readers', async () => {
    const created = await createDraft({
      mode: 'blank',
      title: 'Private Fixture',
      shortName: `private-${Date.now()}`,
      namespaceKey: 'example-standards',
      groupSlug: 'ledger-interchange',
      authorHandles: ['author-1'],
      canonicalFormat: 'markdown',
      visibility: 'private',
      actor: author,
    });
    createdDocumentIds.push(created.documentId);

    const docRow = (await db.select().from(documents).where(eq(documents.id, created.documentId)).limit(1))[0]!;
    const acl = toAcl(docRow, await loadAuthors(created.documentId, null));

    expect(canReadDocument(author, acl)).toBe(true);
    expect(canReadDocument(reader, acl)).toBe(false);
    expect(canReadDocument(null, acl)).toBe(false);

    await expect(getDocumentContext(created.slug, reader)).rejects.toMatchObject({ code: 'not_found' });
    const readerSearch = await searchDocuments({ q: 'Private Fixture' }, reader);
    expect(readerSearch.items).toHaveLength(0);
  });

  it('lets an anonymous reader see published public documents only', async () => {
    const anonymous = await searchDocuments({ limit: 100 }, null);
    expect(anonymous.items.length).toBeGreaterThan(0);
    expect(anonymous.items.every((d) => d.status === 'published' && d.visibility === 'public')).toBe(true);
  });

  it('refuses an approval from an actor without the role', async () => {
    const draft = await newDraft('Role Check Fixture');
    const revision = await createRevision({ documentId: draft.documentId, actor: author });
    await drainQueue(20);
    const docRow = (await db.select().from(documents).where(eq(documents.id, draft.documentId)).limit(1))[0]!;
    const acl = toAcl(docRow, await loadAuthors(draft.documentId, null));

    await expect(
      recordDecision(draft.documentId, revision.id, 'group-approval', 'approved', reader, acl),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('notification expansion', () => {
  it('applies precedence and deduplicates recipients', async () => {
    const rows = await db.select().from(documents).where(eq(documents.slug, 'TEST-STD-0001')).limit(1);
    const doc = rows[0]!;
    const acl = toAcl(doc, await loadAuthors(doc.id, null));
    const subject = await namespaceKeyFor(doc.id);

    const result = await expandRecipients('document_published', subject, acl, approver);
    expect(result.enabled).toBe(true);
    expect(result.to.length).toBeGreaterThan(0);

    // The namespace-scoped policy has the higher precedence and wins.
    expect(result.policies[result.policies.length - 1]?.scope).toBe('namespace');

    const toKeys = result.to.map((r) => r.key);
    expect(new Set(toKeys).size).toBe(toKeys.length);
    for (const cc of result.cc) expect(toKeys).not.toContain(cc.key);
    for (const recipient of result.to) expect(recipient.reasons.length).toBeGreaterThan(0);
  });

  it('honours the group suppress rule', async () => {
    const rows = await db.select().from(documents).where(eq(documents.slug, 'DRAFT-TEST-PROTOCOL')).limit(1);
    const doc = rows[0]!;
    const acl = toAcl(doc, await loadAuthors(doc.id, null));
    const subject = await namespaceKeyFor(doc.id);

    const result = await expandRecipients('review_started', subject, acl, approver);
    const selectors = result.to.flatMap((r) => r.reasons.map((x) => x.selector));
    expect(selectors).not.toContain('document.watchers');
    expect(result.policies.some((p) => p.scope === 'group')).toBe(true);
  });

  it('hides delivery addresses from unauthorized viewers', async () => {
    const rows = await db.select().from(documents).where(eq(documents.slug, 'TEST-STD-0001')).limit(1);
    const doc = rows[0]!;
    const acl = toAcl(doc, await loadAuthors(doc.id, null));
    const subject = await namespaceKeyFor(doc.id);

    const asReader = await expandRecipients('document_published', subject, acl, reader);
    expect(asReader.addressesVisible).toBe(false);
    expect(asReader.to.every((r) => r.address === null)).toBe(true);
  });

  it('rejects an unknown event key', async () => {
    const rows = await db.select().from(documents).where(eq(documents.slug, 'TEST-STD-0001')).limit(1);
    const doc = rows[0]!;
    const acl = toAcl(doc, await loadAuthors(doc.id, null));
    const subject = await namespaceKeyFor(doc.id);
    await expect(expandRecipients('not_an_event', subject, acl, approver)).rejects.toMatchObject({
      code: 'event_not_supported',
    });
  });
});

describe('audit trail', () => {
  it('is append-only', async () => {
    const rows = await db.select({ id: auditEvents.id }).from(auditEvents).limit(1);
    if (!rows[0]) throw appError('not_found', 'no audit events to test against');
    await expect(
      db.update(auditEvents).set({ summary: 'tampered' }).where(eq(auditEvents.id, rows[0].id)),
    ).rejects.toSatisfy((err: unknown) => /append-only/.test(causeMessage(err)));
  });

  it('never stores secrets in a change payload', async () => {
    const { recordAudit } = await import('#src/services/audit.ts');
    await recordAudit({
      familyKey: 'test-secret-redaction',
      entityType: 'test',
      action: 'metadata_changed',
      summary: 'redaction check',
      changes: [{ field: 'apiKey', before: 'abc', after: 'def' }],
      actorKind: 'system',
    });
    const stored = await db
      .select({ changes: auditEvents.changes })
      .from(auditEvents)
      .where(eq(auditEvents.familyKey, 'test-secret-redaction'))
      .limit(1);
    expect(stored[0]?.changes[0]?.after).toBe('[redacted]');
    expect(isAppError(appError('forbidden'))).toBe(true);
  });
});
