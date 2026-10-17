// Client-side mirror of the server world, fed by socket events. React reads it
// via useWorld(); Phaser gets discrete events through the bus.
import { useSyncExternalStore } from 'react';
import type {
  AgentPublic, ConversationRecord, LogEntry, Memory, PlanBlock, RetrievalResult, WorldSnapshot, WorldTick,
} from '@pixel-town/shared';

export interface Retrieved { query: string; results: RetrievalResult[]; at: number }

export interface ClientWorld {
  connected: boolean;
  clock: number;
  paused: boolean;
  speed: number;
  order: string[];
  agents: Record<string, AgentPublic>;
  memories: Record<string, Memory[]>; // newest first
  plans: Record<string, PlanBlock[]>;
  conversations: ConversationRecord[];
  log: LogEntry[];
  snapshots: string[];
  retrieved: Record<string, Retrieved>;
  /** memory id → Date.now() when it arrived (for the flash-in effect). */
  arrivedAt: Record<string, number>;
  selectedId: string | null;
  lockedId: string | null;
  loaded: boolean;
}

export const world: ClientWorld = {
  connected: false, clock: 0, paused: false, speed: 1, order: [], agents: {}, memories: {}, plans: {},
  conversations: [], log: [], snapshots: [], retrieved: {}, arrivedAt: {}, selectedId: null, lockedId: null,
  loaded: false,
};

let version = 0;
const listeners = new Set<() => void>();
export function changed() {
  version++;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-renders on any world change. Cheap enough at this scale (a few updates/sec). */
export function useWorld(): ClientWorld {
  useSyncExternalStore(subscribe, () => version);
  return world;
}

export function selectAgent(id: string) {
  world.selectedId = id;
  changed();
}

// ---------- reducers (called from net/socket.ts) ----------

export function applySnapshot(s: WorldSnapshot) {
  world.clock = s.clock;
  world.paused = s.paused;
  world.speed = s.speed;
  world.order = s.agents.map((a) => a.id);
  world.agents = Object.fromEntries(s.agents.map((a) => [a.id, a]));
  world.memories = Object.fromEntries(s.agents.map((a) => [a.id, [] as Memory[]]));
  for (const m of s.memories) world.memories[m.agentId]?.unshift(m);
  world.plans = s.plans;
  world.conversations = s.conversations;
  world.log = s.log;
  world.snapshots = s.snapshots;
  world.retrieved = {};
  world.arrivedAt = {};
  world.selectedId ??= world.order[0] ?? null;
  world.loaded = true;
  changed();
}

export function applyTick(t: WorldTick) {
  world.clock = t.clock;
  world.paused = t.paused;
  world.speed = t.speed;
  for (const a of t.agents) if (world.agents[a.id]) world.agents[a.id] = { ...world.agents[a.id], ...a };
  changed();
}

export function upsertMemory(m: Memory) {
  const list = (world.memories[m.agentId] ??= []);
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) list[i] = m;
  else {
    list.unshift(m);
    world.arrivedAt[m.id] = Date.now();
  }
  changed();
}

export function addLog(e: LogEntry) {
  world.log = [...world.log.slice(-199), e];
  changed();
}
