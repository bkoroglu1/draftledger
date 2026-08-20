import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { auditEvents, documents, people, publications, revisions } from '#src/db/schema.ts';
import type { LifecycleState } from '#src/domain/types.ts';

/**
 * Lifecycle timeline read model.
 *
 * Derived entirely from revisions, publications and audit events — there is no
 * hand-maintained timeline JSON anywhere, which is why the Status timeline and
 * the History tab can never tell different stories.
 */

export interface TimelineSegment {
  id: string;
  revisionId: string;
  revisionLabel: string;
  revisionSlug: string;
  documentSlug: string;
  start: Date;
  /** Null means "still in effect", rendered up to now. */
  end: Date | null;
  state: LifecycleState;
  actorName: string;
  changeSummary: string | null;
  checksumShort: string;
  isCurrent: boolean;
  isPublication: boolean;
  href: string;
}

export interface TimelineRow {
  key: string;
  label: string;
  kind: 'draft' | 'published';
  segments: TimelineSegment[];
}

export interface TimelineMarker {
  at: Date;
  label: string;
  kind: 'publish' | 'supersede' | 'withdraw' | 'fork';
  fromRow?: string;
  toRow?: string;
}

export interface TimelineModel {
  rows: TimelineRow[];
  markers: TimelineMarker[];
  start: Date;
  end: Date;
  empty: boolean;
  single: boolean;
}

const TERMINAL_STATES: LifecycleState[] = ['withdrawn', 'historic', 'superseded'];

export async function buildTimeline(familyKey: string): Promise<TimelineModel> {
  const familyDocs = await db
    .select()
    .from(documents)
    .where(eq(documents.familyKey, familyKey))
    .orderBy(asc(documents.createdAt));

  if (!familyDocs.length) {
    const now = new Date();
    return { rows: [], markers: [], start: now, end: now, empty: true, single: false };
  }

  const docIds = familyDocs.map((d) => d.id);
  const revisionRows = await db
    .select({ revision: revisions, authorName: people.displayName })
    .from(revisions)
    .leftJoin(people, eq(revisions.createdBy, people.id))
    .where(inArray(revisions.documentId, docIds))
    .orderBy(asc(revisions.createdAt));

  const pubRows = await db
    .select()
    .from(publications)
    .where(inArray(publications.documentId, docIds));

  const events = await db
    .select({
      action: auditEvents.action,
      createdAt: auditEvents.createdAt,
      documentId: auditEvents.documentId,
      summary: auditEvents.summary,
    })
    .from(auditEvents)
    .where(inArray(auditEvents.familyKey, [familyKey]))
    .orderBy(asc(auditEvents.createdAt));

  const now = new Date();
  const rows: TimelineRow[] = [];
  const markers: TimelineMarker[] = [];

  for (const doc of familyDocs) {
    const docRevisions = revisionRows.filter((r) => r.revision.documentId === doc.id);
    if (!docRevisions.length) continue;

    const isPublishedRow = doc.status === 'published' || Boolean(doc.publishedAt);
    const rowKey = `${isPublishedRow ? 'doc' : 'draft'}:${doc.slug}`;
    const segments: TimelineSegment[] = [];

    docRevisions.forEach((entry, index) => {
      const revision = entry.revision;
      const next = docRevisions[index + 1]?.revision;

      // A revision is in effect until the next revision exists, or until the
      // document reaches a terminal state, or until now.
      let end: Date | null = next?.createdAt ?? null;
      if (!next && TERMINAL_STATES.includes(doc.status)) end = doc.updatedAt;
      if (!next && revision.isPublication && doc.status === 'published') end = null;

      const state = segmentState(doc.status, revision.isPublication, Boolean(next), events, doc.id, revision.createdAt, end);

      segments.push({
        id: `${doc.slug}:${revision.label}`,
        revisionId: revision.id,
        revisionLabel: revision.label,
        revisionSlug: revision.slug,
        documentSlug: doc.slug,
        start: revision.createdAt,
        end,
        state,
        actorName: entry.authorName ?? 'System',
        changeSummary: revision.changeSummary,
        checksumShort: revision.sourceSha256.slice(0, 12),
        isCurrent: revision.isCurrent,
        isPublication: revision.isPublication,
        href: `/doc/html/${encodeURIComponent(revision.slug)}`,
      });
    });

    rows.push({
      key: rowKey,
      label: doc.documentNumber ?? doc.slug,
      kind: isPublishedRow ? 'published' : 'draft',
      segments,
    });

    const publication = pubRows.find((p) => p.documentId === doc.id && p.state === 'published');
    if (publication?.publishedAt) {
      markers.push({
        at: publication.publishedAt,
        label: `Published as ${publication.documentNumber}`,
        kind: 'publish',
        toRow: rowKey,
      });
    }
    if (doc.status === 'superseded') {
      markers.push({ at: doc.updatedAt, label: `${doc.slug} superseded`, kind: 'supersede', fromRow: rowKey });
    }
    if (doc.status === 'withdrawn') {
      markers.push({ at: doc.updatedAt, label: `${doc.slug} withdrawn`, kind: 'withdraw', fromRow: rowKey });
    }
    // A publication derives from its own draft; that is not a fork.
    const derivedOutsideFamily =
      doc.derivedFromDocumentId &&
      !familyDocs.some((other) => other.id === doc.derivedFromDocumentId);
    if (derivedOutsideFamily) {
      markers.push({ at: doc.createdAt, label: `${doc.slug} forked`, kind: 'fork', toRow: rowKey });
    }
  }

  const allDates = rows.flatMap((r) =>
    r.segments.flatMap((s) => [s.start, s.end ?? now]),
  );
  const start = allDates.length ? new Date(Math.min(...allDates.map((d) => d.getTime()))) : now;
  const end = allDates.length ? new Date(Math.max(...allDates.map((d) => d.getTime()), now.getTime())) : now;

  const segmentCount = rows.reduce((sum, r) => sum + r.segments.length, 0);
  return {
    rows,
    markers: markers.sort((a, b) => a.at.getTime() - b.at.getTime()),
    start,
    end,
    empty: segmentCount === 0,
    single: segmentCount === 1,
  };
}

function segmentState(
  documentStatus: string,
  isPublication: boolean,
  hasNext: boolean,
  events: Array<{ action: string; createdAt: Date; documentId: string | null }>,
  documentId: string,
  from: Date,
  to: Date | null,
): LifecycleState {
  if (isPublication) {
    if (documentStatus === 'superseded') return 'superseded';
    if (documentStatus === 'withdrawn') return 'withdrawn';
    if (documentStatus === 'historic') return 'historic';
    return 'published';
  }

  // Pick the strongest workflow signal recorded while this revision was current.
  const window = events.filter(
    (e) =>
      e.documentId === documentId &&
      e.createdAt >= from &&
      (to === null || e.createdAt <= to),
  );
  const has = (action: string) => window.some((e) => e.action === action);

  if (has('changes_requested')) return 'changes-requested';
  if (has('review_approved')) return 'approved';
  if (has('publish_requested')) return 'publishing';
  if (has('review_started')) return 'review';
  if (!hasNext && documentStatus) {
    const status = documentStatus as LifecycleState;
    if (status !== 'published') return status;
  }
  return 'drafting';
}

/** Screen-reader alternative to the graphical timeline. */
export function timelineToTable(model: TimelineModel) {
  return model.rows.flatMap((row) =>
    row.segments.map((s) => ({
      row: row.label,
      revision: s.revisionLabel,
      state: s.state,
      from: s.start,
      to: s.end,
      actor: s.actorName,
      checksum: s.checksumShort,
      href: s.href,
      summary: s.changeSummary,
    })),
  );
}
