// Picks the store implementation once, at boot. The sim only sees `Stores`.
import type { Env } from '../config/env';
import { createMemoryStores } from './memory';
import { createPostgresStores } from './postgres';
import type { Stores } from './types';

export function createStores(e: Pick<Env, 'STORE' | 'DATABASE_URL'>): Stores {
  if (e.STORE === 'memory') return createMemoryStores();
  return createPostgresStores(e.DATABASE_URL!);
}

export type * from './types';
