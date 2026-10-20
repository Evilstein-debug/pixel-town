// Snapshots are checkpoint rows. Restoring one forks a new sim: history is never
// rewritten, so every sim keeps a complete record for replays and recaps.
// The same "bundle" (checkpoint + history up to it) backs forks and JSON export/import.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PlanBlock, SnapshotInfo } from '@pixel-town/shared';
import type { WorldState } from '../sim/types';
import { pairKey } from '../sim/types';
import type {
  AgentRecord, AgentStateRecord, EventRecord, MemoryRecord, SimConfig, SimRecord, SimRuntime, Stores,
  StoredConversation,
} from '../store/types';
import { agentStateRecord } from './records';

/** What a snapshot row's `state` holds. Agent ids are those of the snapshot's sim. */
export interface SnapshotState {
  version: 2;
  gameMinutes: number;
  paused: boolean;
  speed: number;
  runtime: SimRuntime;
  agents: AgentStateRecord[];
  plans: { agentId: string; day: number; blocks: PlanBlock[] }[];
}

export const FRESH_START_SNAPSHOT = '00-fresh-start-day1-0700';

export function snapshotStateOf(w: WorldState): SnapshotState {
  return {
    version: 2,
    gameMinutes: w.clock,
    paused: w.paused,
    speed: w.speed,
    runtime: { lastTalk: { ...w.lastTalk } },
    agents: w.agents.map((a) => agentStateRecord(a, w.clock)),
    plans: w.agents.filter((a) => a.plan.length).map((a) => ({ agentId: a.id, day: a.planDay, blocks: a.plan })),
  };
}

/** Snapshots of a sim and its ancestors (forks keep their parents' restore points), newest first. */
export async function listLineageSnapshots(stores: Stores, simId: string): Promise<SnapshotInfo[]> {
  const out: SnapshotInfo[] = [];
  const seen = new Set<string>();
  for (let id: string | null = simId; id && !seen.has(id); ) {
    seen.add(id);
    out.push(...(await stores.world.listSnapshots(id)).map(({ id: sid, name, atGame }) => ({ id: sid, name, atGame })));
    id = (await stores.world.getSim(id))?.parentSimId ?? null;
  }
  return out;
}

// ---------- bundles ----------

export interface SimBundle {
  format: 'pixel-town-snapshot';
  version: 1;
  sourceSimId: string;
  snapshot: { id: string; name: string; atGame: number };
  sim: { name: string; seed: number; config: SimConfig };
  state: SnapshotState;
  agents: AgentRecord[];
  memories: MemoryRecord[];
  evidence: { reflectionId: string; evidenceId: string }[];
  conversations: StoredConversation[];
  events: EventRecord[];
}

/** Loose structural check for bundles read from files; contents came from this app. */
export const simBundleSchema = z.looseObject({
  format: z.literal('pixel-town-snapshot'),
  version: z.literal(1),
  snapshot: z.looseObject({ name: z.string(), atGame: z.number() }),
  sim: z.looseObject({ name: z.string(), config: z.looseObject({}) }),
  state: z.looseObject({ version: z.literal(2), agents: z.array(z.looseObject({ agentId: z.string() })) }),
  agents: z.array(z.looseObject({ id: z.string(), slug: z.string() })).min(1),
  memories: z.array(z.looseObject({ id: z.string(), agentId: z.string() })),
  evidence: z.array(z.looseObject({ reflectionId: z.string(), evidenceId: z.string() })),
  conversations: z.array(z.looseObject({ id: z.string() })),
  events: z.array(z.looseObject({ atGame: z.number() })),
});

/** A snapshot plus the history it stands on (everything up to its game time). */
export async function buildBundle(stores: Stores, snapshotId: string): Promise<SimBundle> {
  const snap = await stores.world.getSnapshot(snapshotId);
  if (!snap) throw new Error(`no snapshot ${snapshotId}`);
  const sim = await stores.world.getSim(snap.simId);
  if (!sim) throw new Error(`snapshot ${snapshotId} belongs to a missing sim`);
  const state = snap.state as SnapshotState;
  if (state?.version !== 2) throw new Error(`snapshot ${snapshotId} has an unsupported format`);

  const agents = await stores.world.listAgents(sim.id);
  const at = snap.atGame;
  const memories = (await Promise.all(agents.map((a) => stores.memories.listByAgent(sim.id, a.id))))
    .flat()
    .filter((m) => m.createdAtGame <= at)
    .sort((a, b) => a.createdAtGame - b.createdAtGame)
    // Accesses after the snapshot didn't happen yet at that point.
    .map((m) => ({ ...m, lastAccessedGame: Math.min(m.lastAccessedGame, at) }));
  const kept = new Set(memories.map((m) => m.id));
  const evidence = (await stores.memories.listEvidence(sim.id)).filter((e) => kept.has(e.reflectionId) && kept.has(e.evidenceId));
  const conversations = (await stores.world.recentConversations(sim.id, Number.MAX_SAFE_INTEGER)).filter((c) => c.startedAtGame <= at);
  const events = (await stores.log.recentEvents(sim.id, Number.MAX_SAFE_INTEGER)).filter((e) => e.atGame <= at);

  return {
    format: 'pixel-town-snapshot',
    version: 1,
    sourceSimId: sim.id,
    snapshot: { id: snap.id, name: snap.name, atGame: at },
    sim: { name: sim.name, seed: sim.seed, config: sim.config },
    state, agents, memories, evidence, conversations, events,
  };
}

/** Replaces every exact old-id string inside a JSON value. */
function remap<T>(value: T, ids: Map<string, string>): T {
  if (typeof value === 'string') return (ids.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remap(v, ids)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, ids)])) as T;
  return value;
}

export interface ForkOptions {
  name: string;
  /** Set when forking a sim in this database (restore); unset for a file import. */
  parentSimId?: string;
  forkedFromSnapshotId?: string;
  /** Archive this sim in the same transaction (the one being replaced). */
  archiveSimId?: string;
}

/** Creates a new sim from a bundle with fresh ids, in one transaction. Returns its id. */
export async function createSimFromBundle(stores: Stores, b: SimBundle, opts: ForkOptions): Promise<SimRecord> {
  const ids = new Map<string, string>();
  const fresh = (old: string) => {
    const id = randomUUID();
    ids.set(old, id);
    return id;
  };
  const simId = randomUUID();
  ids.set(b.sourceSimId, simId);
  for (const a of b.agents) fresh(a.id);
  for (const m of b.memories) fresh(m.id);
  for (const c of b.conversations) fresh(c.id);
  const s = b.state;

  const lastTalk: Record<string, number> = {};
  for (const [key, minute] of Object.entries(s.runtime.lastTalk)) {
    const [x, y] = key.split('|');
    lastTalk[pairKey(ids.get(x) ?? x, ids.get(y) ?? y)] = minute;
  }

  return stores.transaction(async (tx) => {
    const sim = await tx.world.createSim({
      id: simId,
      name: opts.name,
      seed: b.sim.seed,
      status: s.paused ? 'paused' : 'running',
      gameMinutes: s.gameMinutes,
      config: { ...b.sim.config, speed: s.speed },
      runtime: { lastTalk },
      parentSimId: opts.parentSimId ?? null,
      forkedFromSnapshotId: opts.forkedFromSnapshotId ?? null,
    });
    await tx.world.insertAgents(remap(b.agents, ids));
    await tx.world.upsertAgentStates(remap(s.agents, ids));
    await tx.memories.insertMemories(remap(b.memories, ids));
    await tx.memories.insertEvidence(remap(b.evidence, ids));
    await tx.world.insertPlans(s.plans.map((p) => ({
      id: randomUUID(), simId, agentId: ids.get(p.agentId)!, day: p.day, blocks: p.blocks,
      createdAtGame: s.gameMinutes, supersededAtGame: null,
    })));
    await tx.world.insertConversations(remap(b.conversations, ids));
    await tx.log.appendEvents(remap(b.events, ids));
    // A file import has no parent to inherit restore points from, so it carries its own.
    if (!opts.parentSimId)
      await tx.world.saveSnapshot({ id: randomUUID(), simId, name: b.snapshot.name, atGame: b.snapshot.atGame, state: remap(s, ids) });
    if (opts.archiveSimId) await tx.world.updateSim(opts.archiveSimId, { status: 'archived' });
    return sim;
  });
}
