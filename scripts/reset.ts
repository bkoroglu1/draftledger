/**
 * Drops and recreates the public schema. Destructive — refuses to run unless
 * DRAFTLEDGER_ALLOW_RESET=yes so it can never fire accidentally on boot.
 */
import './env.ts';
import { sql } from 'drizzle-orm';
import { db, pool } from '#src/db/index.ts';

async function main() {
  if (process.env.DRAFTLEDGER_ALLOW_RESET !== 'yes') {
    console.error('[reset] refusing: set DRAFTLEDGER_ALLOW_RESET=yes to confirm data loss');
    process.exit(2);
  }
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  // The migration journal lives in its own schema; drop it too or the next
  // migrate run believes everything is already applied.
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  console.log('[reset] public and drizzle schemas recreated');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[reset] failed:', err);
    await pool.end();
    process.exit(1);
  });
