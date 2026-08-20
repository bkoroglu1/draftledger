import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '#src/lib/config.ts';
import * as schema from './schema.ts';

// Postgres returns numerics as strings by default; keep integers as numbers.
pg.types.setTypeParser(20, (v: string) => Number(v));

declare global {
  var __draftledgerPool: pg.Pool | undefined;
}

function createPool(): pg.Pool {
  return new pg.Pool({
    connectionString: config.db.url,
    max: config.db.poolMax,
    application_name: 'draftledger',
  });
}

// Reuse the pool across HMR reloads and route module instances.
export const pool: pg.Pool = globalThis.__draftledgerPool ?? createPool();
if (process.env.NODE_ENV !== 'production') globalThis.__draftledgerPool = pool;

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export { schema };
export * from './schema.ts';
