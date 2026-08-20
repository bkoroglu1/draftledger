import { and, eq, lte, or, sql } from 'drizzle-orm';
import { db, pool } from '#src/db/index.ts';
import { jobs } from '#src/db/schema.ts';

/**
 * PostgreSQL-backed job queue. No external broker: claims use
 * `FOR UPDATE SKIP LOCKED`, so several workers can run side by side, and a
 * dedupe key folds a duplicate enqueue into the job that is already pending.
 */

export type JobKind =
  | 'render_revision'
  | 'publish_document'
  | 'notify_event'
  | 'import_document'
  | 'sync_mirror';

export interface JobRecord {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
}

export async function enqueueJob(
  kind: JobKind,
  payload: Record<string, unknown>,
  dedupeKey?: string,
  options: { runAt?: Date; maxAttempts?: number; correlationId?: string } = {},
): Promise<string> {
  const rows = await db
    .insert(jobs)
    .values({
      kind,
      payload,
      dedupeKey: dedupeKey ?? null,
      runAt: options.runAt ?? new Date(),
      maxAttempts: options.maxAttempts ?? 5,
      correlationId: options.correlationId ?? null,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });

  if (rows[0]) return rows[0].id;

  // A pending job with the same dedupe key already exists; reuse it.
  const existing = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.dedupeKey, dedupeKey ?? ''))
    .limit(1);
  return existing[0]?.id ?? '';
}

/** Claims one due job atomically. Returns null when the queue is empty. */
export async function claimJob(workerId: string): Promise<JobRecord | null> {
  const result = await pool.query<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
    correlation_id: string | null;
  }>(
    `UPDATE jobs SET state = 'running', started_at = now(), locked_by = $1, attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs
          WHERE state = 'queued' AND run_at <= now()
          ORDER BY run_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
     RETURNING id, kind, payload, attempts, max_attempts, correlation_id`,
    [workerId],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    correlationId: row.correlation_id,
  };
}

export async function completeJob(id: string, result?: Record<string, unknown>): Promise<void> {
  await db
    .update(jobs)
    .set({
      state: 'succeeded',
      finishedAt: new Date(),
      result: result ?? null,
      error: null,
      // Free the dedupe key so the same work can be requested again later.
      dedupeKey: null,
    })
    .where(eq(jobs.id, id));
}

export async function failJob(id: string, error: unknown, attempts: number, maxAttempts: number): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const exhausted = attempts >= maxAttempts;
  // Exponential backoff with jitter so retries do not synchronise.
  const backoffSeconds = Math.min(600, 2 ** attempts) + Math.random() * 5;

  await db
    .update(jobs)
    .set({
      state: exhausted ? 'failed' : 'queued',
      error: message,
      finishedAt: exhausted ? new Date() : null,
      lockedBy: null,
      runAt: exhausted ? new Date() : new Date(Date.now() + backoffSeconds * 1000),
      dedupeKey: exhausted ? null : undefined,
    })
    .where(eq(jobs.id, id));
}

export async function getJob(id: string) {
  const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listRecentJobs(limit = 50) {
  return db.select().from(jobs).orderBy(sql`created_at desc`).limit(limit);
}

export async function retryJob(id: string): Promise<void> {
  await db
    .update(jobs)
    .set({ state: 'queued', runAt: new Date(), error: null, lockedBy: null })
    .where(and(eq(jobs.id, id), or(eq(jobs.state, 'failed'), eq(jobs.state, 'cancelled'))!));
}

/** Requeues jobs whose worker died mid-run. */
export async function reclaimStuckJobs(olderThanMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const rows = await db
    .update(jobs)
    .set({ state: 'queued', lockedBy: null })
    .where(and(eq(jobs.state, 'running'), lte(jobs.startedAt, cutoff)))
    .returning({ id: jobs.id });
  return rows.length;
}

export async function jobStats(): Promise<Record<string, number>> {
  const rows = await db
    .select({ state: jobs.state, count: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.state);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.state] = r.count;
  return out;
}
