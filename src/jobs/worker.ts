import { hostname } from 'node:os';
import { config } from '#src/lib/config.ts';
import { claimJob, completeJob, failJob, reclaimStuckJobs } from './queue.ts';
import { handlers } from './handlers.ts';

/**
 * Background worker loop. Runs render, publish, notification and (optional)
 * import jobs so no user request is blocked on them.
 */

export interface WorkerOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  /** Stop after this many idle polls — used by tests. */
  maxIdlePolls?: number;
  signal?: AbortSignal;
}

export async function runWorker(options: WorkerOptions = {}): Promise<void> {
  const concurrency = options.concurrency ?? config.worker.concurrency;
  const pollIntervalMs = options.pollIntervalMs ?? config.worker.pollIntervalMs;
  const workerId = `${hostname()}:${process.pid}`;

  let reclaimTimer = 0;
  const loops = Array.from({ length: concurrency }, (_, index) => loop(index));

  async function loop(index: number): Promise<void> {
    let idlePolls = 0;
    while (!options.signal?.aborted) {
      if (index === 0 && Date.now() - reclaimTimer > 60_000) {
        reclaimTimer = Date.now();
        const reclaimed = await reclaimStuckJobs();
        if (reclaimed) console.warn(`[worker] reclaimed ${reclaimed} stuck job(s)`);
      }

      const job = await claimJob(workerId);
      if (!job) {
        idlePolls += 1;
        if (options.maxIdlePolls && idlePolls >= options.maxIdlePolls) return;
        await sleep(pollIntervalMs);
        continue;
      }
      idlePolls = 0;

      const startedAt = Date.now();
      const handler = handlers[job.kind];
      if (!handler) {
        await failJob(job.id, new Error(`No handler for job kind "${job.kind}"`), job.maxAttempts, job.maxAttempts);
        continue;
      }

      try {
        const result = (await handler(job)) ?? {};
        await completeJob(job.id, result as Record<string, unknown>);
        console.info(
          JSON.stringify({
            level: 'info',
            event: 'job.succeeded',
            kind: job.kind,
            jobId: job.id,
            durationMs: Date.now() - startedAt,
          }),
        );
      } catch (err) {
        await failJob(job.id, err, job.attempts, job.maxAttempts);
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'job.failed',
            kind: job.kind,
            jobId: job.id,
            attempt: job.attempts,
            maxAttempts: job.maxAttempts,
            durationMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  await Promise.all(loops);
}

/** Drains the queue once — used by tests and by the seed script. */
export async function drainQueue(limit = 100): Promise<number> {
  const workerId = `drain:${process.pid}`;
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimJob(workerId);
    if (!job) break;
    const handler = handlers[job.kind];
    if (!handler) {
      await failJob(job.id, new Error(`No handler for "${job.kind}"`), job.maxAttempts, job.maxAttempts);
      continue;
    }
    try {
      const result = (await handler(job)) ?? {};
      await completeJob(job.id, result as Record<string, unknown>);
      processed += 1;
    } catch (err) {
      await failJob(job.id, err, job.attempts, job.maxAttempts);
    }
  }
  return processed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
