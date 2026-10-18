// Store factories for contract tests: memory always, postgres when TEST_DATABASE_URL is set.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../../src/config/embedding';
import { defaultSimConfig } from '../../src/sim/config';
import { createMemoryStores } from '../../src/store/memory';
import { createPostgresStores } from '../../src/store/postgres';
import type { AgentRecord, MemoryRecord, NewSim, Stores } from '../../src/store/types';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

let migrated: Promise<void> | undefined;
function migrateOnce(url: string) {
  migrated ??= (async () => {
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    try {
      await migrate(drizzle(pool), { migrationsFolder });
    } finally {
      await pool.end();
    }
  })();
  return migrated;
}

export interface StoreFactory {
  name: 'memory' | 'postgres';
  create(): Promise<Stores>;
}

export const storeFactories: StoreFactory[] = [
  { name: 'memory', create: async () => createMemoryStores() },
  ...(TEST_DATABASE_URL
    ? [{
        name: 'postgres' as const,
        create: async () => {
          await migrateOnce(TEST_DATABASE_URL);
          return createPostgresStores(TEST_DATABASE_URL);
        },
      }]
    : []),
];

if (!TEST_DATABASE_URL) console.warn('[test] TEST_DATABASE_URL not set: postgres contract tests skipped');

// ---------- fixtures ----------

export const newSim = (over: Partial<NewSim> = {}): NewSim => ({
  id: randomUUID(),
  name: 'test sim',
  seed: 0,
  status: 'running',
  gameMinutes: 420,
  config: defaultSimConfig(),
  runtime: { lastTalk: {} },
  ...over,
});

export const newAgent = (simId: string, slug: string, over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: randomUUID(),
  simId,
  slug,
  name: slug[0].toUpperCase() + slug.slice(1),
  age: 30,
  occupation: 'Tester',
  bio: `${slug} tests things.`,
  relationships: '',
  traits: {},
  homeLocationId: 'asha_house',
  appearance: { shirt: '#000000', hair: '#111111', skin: '#222222', pants: '#333333' },
  createdBy: null,
  ...over,
});

/** A deterministic unit-ish vector, distinct per `seed`. */
export function vec(seed: number): number[] {
  const v = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(seed * 31 + i * 0.7));
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

export const newMemory = (
  simId: string, agentId: string, over: Partial<MemoryRecord> = {},
): MemoryRecord => ({
  id: randomUUID(),
  simId,
  agentId,
  type: 'observation',
  text: 'Saw something.',
  importance: 3,
  createdAtGame: 420,
  lastAccessedGame: 420,
  embedding: vec(1),
  embeddingModel: EMBEDDING_MODEL,
  seedId: null,
  sourceRef: null,
  ...over,
});
