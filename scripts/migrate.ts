/** Applies every pending SQL migration in src/db/migrations. Idempotent. */
import './env.ts';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '#src/db/index.ts';

async function main() {
  await migrate(db, { migrationsFolder: 'src/db/migrations' });
  console.log('[migrate] schema is up to date');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[migrate] failed:', err);
    await pool.end();
    process.exit(1);
  });
