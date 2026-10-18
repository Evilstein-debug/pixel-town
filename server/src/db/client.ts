// node-postgres pool + Drizzle. The app connects through Neon's pooled host;
// migrations (drizzle-kit) use the direct one.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** The root database or an open transaction; store code accepts either. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    // Neon's free tier suspends idle compute; waking it can take a few seconds.
    connectionTimeoutMillis: 15_000,
  });
  // Neon drops idle connections; without a listener that error would crash the process.
  pool.on('error', (err) => console.warn('[db] idle client error:', err.message));
  return pool;
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}
