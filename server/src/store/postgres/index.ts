// Postgres (Neon) store via Drizzle. Every store method runs on whichever
// executor it was built with: the pool, or an open transaction.
import { sql } from 'drizzle-orm';
import { createDb, createPool, type Executor } from '../../db/client';
import type { Stores } from '../types';
import { postgresLogStore } from './logStore';
import { postgresMemoryStore } from './memoryStore';
import { postgresWorldStore } from './worldStore';

function storesOn(db: Executor, close: () => Promise<void>, inTransaction: boolean): Stores {
  return {
    kind: 'postgres',
    world: postgresWorldStore(db, inTransaction),
    memories: postgresMemoryStore(db),
    log: postgresLogStore(db),
    // Nested calls become savepoints.
    transaction: (fn) => db.transaction((tx) => fn(storesOn(tx, close, true))),
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close,
  };
}

export function createPostgresStores(connectionString: string): Stores {
  const pool = createPool(connectionString);
  return storesOn(createDb(pool), () => pool.end(), false);
}
