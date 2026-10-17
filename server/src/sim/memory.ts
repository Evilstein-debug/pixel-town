// Memory stream: add, retrieve (recency + importance + relevance), rumour tagging.
import type { Memory, MemoryType, RetrievalResult } from '@pixel-town/shared';
import { embed, similarity } from './embeddings';
import { hoursBetween } from './time';
import type { WorldState } from './types';

export const TOP_K = 8;
/** New memories wait for the batched importance call; 0 = not yet scored. */
export const UNSCORED = 0;

export async function createMemory(
  world: WorldState, agentId: string, type: MemoryType, text: string, importance = UNSCORED,
  /** Short fact to match against seeded rumours (e.g. what was learned in a chat). */
  factHint?: string,
): Promise<Memory> {
  const mem: Memory = {
    id: `m${++world.seq}`,
    agentId,
    createdAt: world.clock,
    lastAccessed: world.clock,
    type,
    text,
    importance,
    embedding: await embed(text),
  };
  if (type === 'seeded') mem.seedId = mem.id;
  else if (type === 'conversation') {
    const hint = factHint ? { text: factHint, embedding: await embed(factHint) } : null;
    mem.seedId = matchSeed(world, mem) ?? (hint ? matchSeed(world, hint) : undefined);
  }
  world.memories.push(mem);
  return mem;
}

/** Tag a conversation memory with the seeded rumour it repeats, if any. */
function matchSeed(world: WorldState, mem: { text: string; embedding: number[] }): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const seed of world.memories) {
    if (seed.type !== 'seeded') continue;
    const score = similarity(mem.text, mem.embedding, seed.text, seed.embedding);
    const threshold = mem.embedding.length && seed.embedding.length ? 0.78 : 0.5;
    if (score >= threshold && (!best || score > best.score)) best = { id: seed.id, score };
  }
  return best?.id;
}

export interface Retrieval {
  memories: Memory[];
  results: RetrievalResult[];
}

const normalise = (xs: number[]) => {
  const min = Math.min(...xs), max = Math.max(...xs);
  return xs.map((x) => (max - min > 1e-9 ? (x - min) / (max - min) : 1));
};

export async function retrieve(world: WorldState, agentId: string, query: string, k = TOP_K): Promise<Retrieval> {
  const candidates = world.memories.filter((m) => m.agentId === agentId);
  if (!candidates.length) return { memories: [], results: [] };
  const qEmb = await embed(query);
  const rec = normalise(candidates.map((m) => 0.995 ** hoursBetween(m.lastAccessed, world.clock)));
  const imp = normalise(candidates.map((m) => (m.importance || 3) / 10));
  const rel = normalise(candidates.map((m) => similarity(m.text, m.embedding, query, qEmb)));
  const scored = candidates
    .map((m, i) => ({ m, recency: rec[i], importance: imp[i], relevance: rel[i], total: rec[i] + imp[i] + rel[i] }))
    .sort((a, b) => b.total - a.total)
    .slice(0, k);
  for (const s of scored) s.m.lastAccessed = world.clock;
  return {
    memories: scored.map((s) => s.m),
    results: scored.map((s) => ({
      memoryId: s.m.id,
      recency: round(s.recency), importance: round(s.importance), relevance: round(s.relevance), total: round(s.total),
    })),
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Copy without the embedding, for sending to browsers. */
export const publicMemory = (m: Memory): Memory => ({ ...m, embedding: [] });
