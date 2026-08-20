/** Worker process entrypoint (`npm run worker`, or the compose `worker` service). */
import '../../scripts/env.ts';
import { pool } from '#src/db/index.ts';
import { runWorker } from './worker.ts';

const controller = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`[worker] ${signal} received, finishing in-flight jobs`);
    controller.abort();
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

console.info('[worker] started');
runWorker({ signal: controller.signal })
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[worker] crashed:', err);
    await pool.end();
    process.exit(1);
  });
