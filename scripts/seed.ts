/** Seeds the fictional demo installation. Refuses to run over existing data. */
import './env.ts';
import { pool, db } from '#src/db/index.ts';
import { people } from '#src/db/schema.ts';
import { runSeed } from '#seed/seed.ts';

async function main() {
  const existing = await db.select({ id: people.id }).from(people).limit(1);
  if (existing.length && process.env.SEED_FORCE !== 'yes') {
    console.error('[seed] data already present; set SEED_FORCE=yes to seed anyway');
    process.exit(2);
  }
  await runSeed();
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[seed] failed:', err);
    await pool.end();
    process.exit(1);
  });
