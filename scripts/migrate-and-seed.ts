/** Container entrypoint: migrate, then seed only when the database is empty. */
import './env.ts';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '#src/db/index.ts';
import { people } from '#src/db/schema.ts';
import { runSeed } from '#seed/seed.ts';

async function main() {
  await migrate(db, { migrationsFolder: 'src/db/migrations' });
  console.log('[boot] migrations applied');

  const existing = await db.select({ id: people.id }).from(people).limit(1);
  if (existing.length > 0) {
    console.log('[boot] data present, skipping seed (no destructive startup behaviour)');
    return;
  }
  if (process.env.SEED_ON_BOOT === 'false') {
    console.log('[boot] SEED_ON_BOOT=false, skipping seed');
    return;
  }
  await runSeed();
  console.log('[boot] fixtures seeded');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[boot] failed:', err);
    await pool.end();
    process.exit(1);
  });
