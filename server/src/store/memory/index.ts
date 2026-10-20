// In-process store for tests and STORE=memory. Nothing survives a restart.
import type { Stores } from '../types';
import { copy, emptyTables, type Db } from './data';
import { memoryLogStore } from './logStore';
import { memoryMemoryStore } from './memoryStore';
import { memoryWorldStore } from './worldStore';

export function createMemoryStores(): Stores {
  const db: Db = { t: emptyTables() };
  const stores: Stores = {
    kind: 'memory',
    world: memoryWorldStore(db),
    memories: memoryMemoryStore(db),
    log: memoryLogStore(db),
    // Copy-on-begin, restore-on-throw. Writes made concurrently by other callers
    // during a failed transaction are rolled back too; fine for one process.
    async transaction(fn) {
      const before = copy(db.t);
      try {
        return await fn(stores);
      } catch (err) {
        db.t = before;
        throw err;
      }
    },
    async ping() {},
    async close() {},
  };
  return stores;
}
