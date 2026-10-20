// Memory stream: create (buffered until the next flush), retrieve, rumour tagging.
import { randomUUID } from 'node:crypto';
import type { RetrievalResult } from '@pixel-town/shared';
import { EMBEDDING_MODEL } from '../config/embedding';
import type { MemoryRecord, MemoryType, Stores } from '../store/types';
import { embed, embedBatch, similarity } from './embeddings';
import { hoursBetween } from './time';
import type { WorldState } from './types';

export const TOP_K = 8;

export interface NewMemoryOptions {
  /** 1–10; omit to have the next flush score it. */
  importance?: number;
  /** Short fact to match against seeded rumours (e.g. what was learned in a chat). */
  factHint?: string;
  sourceRef?: Record<string, unknown>;
}

/** Fills in missing embeddings in one model call (a no-op when the model isn't loaded). */
export async function embedMissing(memories: MemoryRecord[]) {
  const missing = memories.filter((m) => !m.embedding);
  if (!missing.length) return;
  const vectors = await embedBatch(missing.map((m) => m.text));
  missing.forEach((m, i) => {
    if (!vectors[i].length) return;
    m.embedding = vectors[i];
    m.embeddingModel = EMBEDDING_MODEL;
  });
}

export async function createMemory(
  world: WorldState, agentId: string, type: MemoryType, text: string, opts: NewMemoryOptions = {},
): Promise<MemoryRecord> {
  const clock = world.clock;
  // Rumour tagging needs vectors now; everything else is embedded in batch at flush time.
  const vector = type === 'seeded' || type === 'conversation' ? await embed(text) : [];
  const mem: MemoryRecord = {
    id: randomUUID(),
    simId: world.simId,
    agentId,
    type,
    text,
    importance: opts.importance ?? null,
    createdAtGame: clock,
    lastAccessedGame: clock,
    embedding: vector.length ? vector : null,
    embeddingModel: vector.length ? EMBEDDING_MODEL : null,
    seedId: null,
    sourceRef: opts.sourceRef ?? null,
  };
  if (type === 'seeded') {
    mem.seedId = mem.id;
    world.seeds[mem.id] = { text, embedding: vector };
  } else if (type === 'conversation') {
    const hint = opts.factHint ? { text: opts.factHint, embedding: await embed(opts.factHint) } : null;
    mem.seedId = matchSeed(world, { text, embedding: vector }) ?? (hint ? matchSeed(world, hint) : null);
  }
  if (mem.seedId) {
    const known = (world.rumours[agentId] ??= []);
    if (!known.includes(mem.seedId)) known.push(mem.seedId);
  }
  world.pending.addMemory(mem);
  return mem;
}

/** Tag a conversation memory with the seeded rumour it repeats, if any. */
function matchSeed(world: WorldState, mem: { text: string; embedding: number[] }): string | null {
  let best: { id: string; score: number } | undefined;
  for (const [id, seed] of Object.entries(world.seeds)) {
    const score = similarity(mem.text, mem.embedding, seed.text, seed.embedding);
    const threshold = mem.embedding.length && seed.embedding.length ? 0.78 : 0.5;
    if (score >= threshold && (!best || score > best.score)) best = { id, score };
  }
  return best?.id ?? null;
}

export interface Retrieval {
  memories: MemoryRecord[];
  results: RetrievalResult[];
}

const normalise = (xs: number[]) => {
  const min = Math.min(...xs), max = Math.max(...xs);
  return xs.map((x) => (max - min > 1e-9 ? (x - min) / (max - min) : 1));
};

/** The agent's saved memories with unsaved ones and unsaved access bumps laid over them. */
async function candidatesFor(stores: Stores, world: WorldState, agentId: string): Promise<MemoryRecord[]> {
  const unsaved = world.pending.unsavedMemories(agentId);
  await embedMissing(unsaved);
  const saved = await stores.memories.listByAgent(world.simId, agentId);
  const unsavedIds = new Set(unsaved.map((m) => m.id));
  const merged = saved.filter((m) => !unsavedIds.has(m.id)).map((m) => {
    const touched = world.pending.touchedAt(m.id);
    return touched === undefined ? m : { ...m, lastAccessedGame: Math.max(m.lastAccessedGame, touched) };
  });
  return [...merged, ...unsaved];
}

// Scoring is unchanged from the pre-database version; Phase 3 replaces it with
// candidate-union retrieval in src/retrieval/.
export async function retrieve(
  stores: Stores, world: WorldState, agentId: string, query: string, k = TOP_K,
): Promise<Retrieval> {
  const candidates = await candidatesFor(stores, world, agentId);
  if (!candidates.length) return { memories: [], results: [] };
  const qEmb = await embed(query);
  const rec = normalise(candidates.map((m) => 0.995 ** hoursBetween(m.lastAccessedGame, world.clock)));
  const imp = normalise(candidates.map((m) => (m.importance ?? 3) / 10));
  const rel = normalise(candidates.map((m) => similarity(m.text, m.embedding ?? [], query, qEmb)));
  const scored = candidates
    .map((m, i) => ({ m, recency: rec[i], importance: imp[i], relevance: rel[i], total: rec[i] + imp[i] + rel[i] }))
    .sort((a, b) => b.total - a.total)
    .slice(0, k);
  world.pending.touch(scored.map((s) => s.m.id), world.clock);
  return {
    memories: scored.map((s) => ({ ...s.m, lastAccessedGame: world.clock })),
    results: scored.map((s) => ({
      memoryId: s.m.id,
      recency: round(s.recency), importance: round(s.importance), relevance: round(s.relevance), total: round(s.total),
    })),
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
