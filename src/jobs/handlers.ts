import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { documents, notificationDeliveries } from '#src/db/schema.ts';
import { config } from '#src/lib/config.ts';
import { sendMail } from '#src/lib/mail.ts';
import { renderAndPersistRevision } from '#src/services/revisions.ts';
import { executePublish, markPublicationFailed } from '#src/services/publish.ts';
import {
  expandRecipients,
  namespaceKeyFor,
  recordDeliveryIntent,
} from '#src/services/notifications.ts';
import { toAcl, loadAuthors } from '#src/services/documents.ts';
import { importExternalDocument, runMirrorSync } from '#src/adapters/external.ts';
import type { JobRecord } from './queue.ts';

/** Job handlers. Each one must be safe to run more than once. */
export type JobHandler = (job: JobRecord) => Promise<Record<string, unknown> | void>;

export const handlers: Record<string, JobHandler> = {
  async render_revision(job) {
    const revisionId = String(job.payload.revisionId ?? '');
    const result = await renderAndPersistRevision(revisionId);
    return { pages: result.pageCount, words: result.wordCount, sha: result.sourceSha256 };
  },

  async publish_document(job) {
    const documentId = String(job.payload.documentId ?? '');
    const revisionId = String(job.payload.revisionId ?? '');
    const actorId = String(job.payload.actorId ?? '');
    await db.update(documents).set({ status: 'publishing' }).where(eq(documents.id, documentId));
    try {
      const result = await executePublish(documentId, revisionId, actorId);
      return { documentNumber: result.documentNumber, publicationId: result.publicationId };
    } catch (err) {
      await markPublicationFailed(documentId, revisionId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  },

  /**
   * Computes the recipient expansion, records a delivery attempt and hands the
   * message to the SMTP transport. With no transport configured the delivery is
   * recorded as `skipped` rather than silently dropped.
   */
  async notify_event(job) {
    const eventKey = String(job.payload.eventKey ?? '');
    const documentId = String(job.payload.documentId ?? '');
    if (!eventKey || !documentId) return { skipped: 'missing payload' };

    const docRows = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    const doc = docRows[0];
    if (!doc) return { skipped: 'document gone' };

    const authors = await loadAuthors(documentId, null);
    const acl = toAcl(doc, authors);
    const subject = await namespaceKeyFor(documentId);
    // System actor: expansion runs with full visibility, output is redacted.
    const expansion = await expandRecipients(eventKey, subject, acl, {
      id: 'system',
      handle: 'system',
      displayName: 'System',
      email: null,
      orgRole: 'admin',
      groupRoles: {},
    });

    if (!expansion.enabled || (!expansion.to.length && !expansion.cc.length)) {
      return { skipped: 'no recipients', warnings: expansion.warnings.length };
    }

    const deliveryId = await recordDeliveryIntent(eventKey, documentId, expansion);
    const addresses = (list: typeof expansion.to) =>
      list.map((r) => r.address).filter((a): a is string => Boolean(a));

    const result = await sendMail({
      to: addresses(expansion.to),
      cc: addresses(expansion.cc),
      subject: `[${config.app.brandName}] ${expansion.eventLabel}: ${doc.slug}`,
      text: [
        `${expansion.eventLabel} for ${doc.slug} — ${doc.title}.`,
        '',
        `${config.app.baseUrl.replace(/\/+$/, '')}/doc/${doc.slug}`,
        '',
        `You are receiving this because of a notification policy in ${config.app.brandName}.`,
      ].join('\n'),
    });

    await db
      .update(notificationDeliveries)
      .set({
        status: result.status,
        errorClass: result.errorClass ?? null,
        attemptCount: 1,
        updatedAt: new Date(),
      })
      .where(eq(notificationDeliveries.id, deliveryId));

    // A transport failure is retried by the queue; a missing transport is not.
    if (result.status === 'failed') {
      throw new Error(`notification delivery failed: ${result.errorClass}`);
    }

    return { deliveryId, status: result.status, to: expansion.to.length, cc: expansion.cc.length };
  },

  async import_document(job) {
    if (!config.external.enabled) return { skipped: 'external import disabled' };
    const ref = String(job.payload.ref ?? '');
    const result = await importExternalDocument(ref);
    return { slug: result.slug, revisionId: result.revisionId };
  },

  async sync_mirror(job) {
    if (!config.external.enabled || config.external.syncMode !== 'mirror') {
      return { skipped: 'mirror sync disabled' };
    }
    const refs = Array.isArray(job.payload.refs) ? (job.payload.refs as string[]) : [];
    return runMirrorSync(refs);
  },
};
