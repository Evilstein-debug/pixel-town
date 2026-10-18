// One-time import of a legacy world.json / snapshot file (WorldState v1) into a new sim.
// Mapping is pure (planLegacyImport); writing happens in one transaction.
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { locationAt } from '@pixel-town/shared';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../config/embedding';
import { defaultSimConfig } from '../sim/config';
import { dayOf } from '../sim/time';
import { pairKey } from '../sim/types';
import type {
  AgentRecord, AgentStateRecord, EventRecord, MemoryRecord, NewSim, PlanRecord, StoredConversation, Stores,
} from '../store/types';

const point = z.object({ x: z.number(), y: z.number() });
const planBlock = z.object({
  start: z.string(), end: z.string(), locationId: z.string(), activity: z.string(), priority: z.boolean().optional(),
});

const legacyAgent = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  occupation: z.string(),
  bio: z.string(),
  relationships: z.string().default(''),
  homeId: z.string(),
  appearance: z.object({ shirt: z.string(), hair: z.string(), skin: z.string(), pants: z.string() }),
  tileX: z.number(),
  tileY: z.number(),
  facing: z.enum(['up', 'down', 'left', 'right']),
  path: z.array(point),
  targetLocationId: z.string().nullable(),
  action: z.string(),
  plan: z.array(planBlock),
  planDay: z.number(),
  asleep: z.boolean(),
  talkingWith: z.string().nullable(),
  talkUntil: z.number(),
  lastPerceived: z.object({ locationId: z.string().nullable(), nearby: z.array(z.string()) }),
  // -Infinity is written to JSON as null.
  lastReplanAt: z.number().nullable().optional(),
});

const legacyMemory = z.object({
  id: z.string(),
  agentId: z.string(),
  createdAt: z.number(),
  lastAccessed: z.number(),
  type: z.enum(['observation', 'conversation', 'seeded', 'plan']),
  text: z.string(),
  importance: z.number(),
  embedding: z.array(z.number()).default([]),
  seedId: z.string().optional(),
});

export const legacyWorldSchema = z.object({
  version: z.literal(1),
  clock: z.number(),
  paused: z.boolean(),
  speed: z.number(),
  agents: z.array(legacyAgent).min(1),
  memories: z.array(legacyMemory),
  log: z.array(z.object({ ts: z.number(), text: z.string() })),
  conversations: z.array(z.object({
    id: z.string(),
    participants: z.array(z.string()),
    lines: z.array(z.object({ speakerId: z.string(), text: z.string() })),
    ts: z.number(),
    locationId: z.string().nullable(),
  })),
  lastTalk: z.record(z.string(), z.number()),
  seq: z.number(),
});

export type LegacyWorld = z.infer<typeof legacyWorldSchema>;
type LegacyAgent = z.infer<typeof legacyAgent>;

/** Same rule as the sim's statusIcon(), applied to the legacy shape. */
function legacyStatusIcon(a: LegacyAgent): AgentStateRecord['statusIcon'] {
  if (a.asleep) return 'sleep';
  if (a.talkingWith) return 'talk';
  if (a.path.length) return 'none';
  const loc = locationAt(a.tileX, a.tileY)?.id;
  return loc === 'cafe' ? 'coffee' : loc === 'library' ? 'book' : 'none';
}

export interface ImportPlan {
  sim: NewSim;
  agents: AgentRecord[];
  states: AgentStateRecord[];
  memories: MemoryRecord[];
  plans: PlanRecord[];
  conversations: StoredConversation[];
  events: EventRecord[];
  stats: { reembedded: number; unembedded: number; droppedSeedRefs: number };
}

export const hashFile = (contents: string) => createHash('sha256').update(contents).digest('hex');

/** Maps a legacy world onto store records with fresh uuids. Re-embeds missing or wrong-size vectors. */
export async function planLegacyImport(
  world: LegacyWorld,
  opts: { name: string; importHash: string; embed: (text: string) => Promise<number[]> },
): Promise<ImportPlan> {
  const simId = randomUUID();
  const agentIds = new Map(world.agents.map((a) => [a.id, randomUUID()]));
  const memoryIds = new Map(world.memories.map((m) => [m.id, randomUUID()]));
  const agentId = (legacy: string, where: string) => {
    const id = agentIds.get(legacy);
    if (!id) throw new Error(`${where} refers to unknown agent '${legacy}'`);
    return id;
  };

  const lastTalk: Record<string, number> = {};
  for (const [key, minute] of Object.entries(world.lastTalk)) {
    const [a, b] = key.split('|');
    lastTalk[pairKey(agentId(a, 'lastTalk'), agentId(b, 'lastTalk'))] = minute;
  }

  const sim: NewSim = {
    id: simId,
    name: opts.name,
    seed: 0,
    status: world.paused ? 'paused' : 'running',
    gameMinutes: world.clock,
    config: defaultSimConfig({ speed: world.speed }),
    runtime: { lastTalk },
    importHash: opts.importHash,
  };

  const agents: AgentRecord[] = world.agents.map((a) => ({
    id: agentId(a.id, 'agent'),
    simId,
    slug: a.id,
    name: a.name,
    age: a.age,
    occupation: a.occupation,
    bio: a.bio,
    relationships: a.relationships,
    traits: {},
    homeLocationId: a.homeId,
    appearance: a.appearance,
    createdBy: null,
  }));

  const states: AgentStateRecord[] = world.agents.map((a) => ({
    agentId: agentId(a.id, 'agent'),
    tileX: a.tileX,
    tileY: a.tileY,
    facing: a.facing,
    currentAction: a.action,
    statusIcon: legacyStatusIcon(a),
    locationId: locationAt(a.tileX, a.tileY)?.id ?? null,
    path: a.path,
    awake: !a.asleep,
    runtime: {
      targetLocationId: a.targetLocationId,
      planDay: a.planDay,
      talkingWith: a.talkingWith ? agentId(a.talkingWith, `${a.id}.talkingWith`) : null,
      talkUntil: a.talkUntil,
      lastPerceived: {
        locationId: a.lastPerceived.locationId,
        nearby: a.lastPerceived.nearby.filter((id) => agentIds.has(id)).map((id) => agentIds.get(id)!),
      },
      lastReplanAt: a.lastReplanAt ?? null,
    },
    updatedAtGame: world.clock,
  }));

  const stats = { reembedded: 0, unembedded: 0, droppedSeedRefs: 0 };
  // Oldest first, so a seeded memory is always inserted before memories that cite it.
  const ordered = [...world.memories].sort((a, b) => a.createdAt - b.createdAt);
  const memories: MemoryRecord[] = [];
  for (const m of ordered) {
    let embedding: number[] | null = m.embedding.length === EMBEDDING_DIMENSIONS ? m.embedding : null;
    if (!embedding) {
      const fresh = await opts.embed(m.text);
      if (fresh.length === EMBEDDING_DIMENSIONS) {
        embedding = fresh;
        stats.reembedded++;
      } else stats.unembedded++;
    }
    let seedId: string | null = null;
    if (m.seedId) {
      seedId = memoryIds.get(m.seedId) ?? null;
      if (!seedId) stats.droppedSeedRefs++;
    }
    memories.push({
      id: memoryIds.get(m.id)!,
      simId,
      agentId: agentId(m.agentId, `memory ${m.id}`),
      type: m.type,
      text: m.text,
      importance: m.importance >= 1 ? Math.min(10, Math.round(m.importance)) : null,
      createdAtGame: m.createdAt,
      lastAccessedGame: m.lastAccessed,
      embedding,
      embeddingModel: embedding ? EMBEDDING_MODEL : null,
      seedId,
      sourceRef: { legacyId: m.id },
    });
  }

  // Only the current plan survives in a legacy file; its creation time is unknown, so use the file's clock.
  const plans: PlanRecord[] = world.agents
    .filter((a) => a.plan.length)
    .map((a) => ({
      id: randomUUID(),
      simId,
      agentId: agentId(a.id, 'plan'),
      day: a.planDay || dayOf(world.clock),
      blocks: a.plan,
      createdAtGame: world.clock,
      supersededAtGame: null,
    }));

  const conversations: StoredConversation[] = world.conversations.map((c) => ({
    id: randomUUID(),
    simId,
    locationId: c.locationId,
    startedAtGame: c.ts,
    participants: c.participants.map((p) => agentId(p, `conversation ${c.id}`)),
    lines: c.lines.map((l, seq) => ({ seq, speakerId: agentId(l.speakerId, `conversation ${c.id}`), text: l.text })),
  }));

  const events: EventRecord[] = world.log.map((e) => ({
    simId, atGame: e.ts, kind: 'log', text: e.text, payload: {},
  }));

  return { sim, agents, states, memories, plans, conversations, events, stats };
}

export class DuplicateImportError extends Error {
  constructor(readonly existingSimId: string) {
    super(`this file was already imported as sim ${existingSimId}; refusing to import it twice`);
  }
}

export interface ImportCounts {
  agents: number;
  agentStates: number;
  memories: number;
  plans: number;
  conversations: number;
  conversationLines: number;
  events: number;
}

export const countsOf = (p: ImportPlan): ImportCounts => ({
  agents: p.agents.length,
  agentStates: p.states.length,
  memories: p.memories.length,
  plans: p.plans.length,
  conversations: p.conversations.length,
  conversationLines: p.conversations.reduce((n, c) => n + c.lines.length, 0),
  events: p.events.length,
});

/** Writes an import plan in one transaction. Refuses a file that was already imported. */
export async function writeImport(stores: Stores, plan: ImportPlan): Promise<string> {
  return stores.transaction(async (tx) => {
    const existing = await tx.world.findSimByImportHash(plan.sim.importHash!);
    if (existing) throw new DuplicateImportError(existing.id);
    await tx.world.createSim(plan.sim);
    await tx.world.insertAgents(plan.agents);
    await tx.world.upsertAgentStates(plan.states);
    await tx.memories.insertMemories(plan.memories);
    await tx.world.insertPlans(plan.plans);
    await tx.world.insertConversations(plan.conversations);
    await tx.log.appendEvents(plan.events);
    return plan.sim.id;
  });
}

/** Reads back what a sim holds, to check against what the import reported. */
export async function countSim(stores: Stores, simId: string): Promise<ImportCounts> {
  const [agents, states, memoryCounts, plans, conversations, events] = await Promise.all([
    stores.world.listAgents(simId),
    stores.world.listAgentStates(simId),
    stores.memories.countByAgent(simId),
    stores.world.currentPlans(simId),
    stores.world.recentConversations(simId, Number.MAX_SAFE_INTEGER),
    stores.log.recentEvents(simId, Number.MAX_SAFE_INTEGER),
  ]);
  return {
    agents: agents.length,
    agentStates: states.length,
    memories: Object.values(memoryCounts).reduce((a, b) => a + b, 0),
    plans: plans.length,
    conversations: conversations.length,
    conversationLines: conversations.reduce((n, c) => n + c.lines.length, 0),
    events: events.length,
  };
}
