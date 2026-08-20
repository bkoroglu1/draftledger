import { sql } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { jobStats } from '#src/jobs/queue.ts';
import { readerCacheStats } from '#src/services/reader.ts';

export const dynamic = 'force-dynamic';

/** Readiness: dependencies this instance needs in order to serve traffic. */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let ok = true;

  try {
    const started = Date.now();
    await db.execute(sql`select 1`);
    checks.database = { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    ok = false;
    checks.database = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    checks.jobs = await jobStats();
  } catch {
    checks.jobs = { ok: false };
  }

  checks.readerCache = readerCacheStats();

  return Response.json({ status: ok ? 'ready' : 'degraded', checks }, { status: ok ? 200 : 503 });
}
