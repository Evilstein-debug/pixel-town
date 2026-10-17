// World construction, public projections, and persistence.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAP_ID, locationAt, type AgentPublic, type StatusIcon, type TickAgent, type WorldSnapshot,
} from '@pixel-town/shared';
import { AGENT_SEEDS } from '../agents/seed';
import { publicMemory } from './memory';
import { START_CLOCK } from './time';
import type { AgentState, WorldState } from './types';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(here, '../../data');
export const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const ROLLING_FILE = path.join(DATA_DIR, 'world.json');

export function createWorld(): WorldState {
  const agents: AgentState[] = AGENT_SEEDS.map((s) => ({
    ...s,
    facing: 'down',
    path: [],
    stepMs: 0,
    targetLocationId: s.homeId,
    action: 'Sleeping',
    plan: [],
    planDay: 0,
    asleep: true,
    talkingWith: null,
    talkUntil: 0,
    busy: false,
    lastPerceived: { locationId: s.homeId, nearby: [] },
    lastReplanAt: -Infinity,
  }));
  return {
    version: 1, clock: START_CLOCK, paused: false, speed: 1, agents,
    memories: [], log: [], conversations: [], lastTalk: {}, seq: 0,
  };
}

export function statusIcon(a: AgentState): StatusIcon {
  if (a.asleep) return 'sleep';
  if (a.talkingWith) return 'talk';
  if (a.path.length) return 'none';
  const loc = locationAt(a.tileX, a.tileY)?.id;
  if (loc === 'cafe') return 'coffee';
  if (loc === 'library') return 'book';
  return 'none';
}

export function tickAgent(a: AgentState): TickAgent {
  return {
    id: a.id, tileX: a.tileX, tileY: a.tileY, facing: a.facing, action: a.action,
    statusIcon: statusIcon(a), locationId: locationAt(a.tileX, a.tileY)?.id ?? null,
  };
}

export function publicAgent(a: AgentState): AgentPublic {
  return {
    name: a.name, age: a.age, occupation: a.occupation, bio: a.bio, appearance: a.appearance,
    ...tickAgent(a),
  };
}

export function snapshotOf(world: WorldState, snapshots: string[]): WorldSnapshot {
  return {
    mapId: MAP_ID,
    clock: world.clock,
    paused: world.paused,
    speed: world.speed,
    agents: world.agents.map(publicAgent),
    log: world.log.slice(-60),
    memories: world.memories.map(publicMemory),
    plans: Object.fromEntries(world.agents.map((a) => [a.id, a.plan])),
    conversations: world.conversations.slice(-20),
    snapshots,
  };
}

// ---------- persistence ----------

let saving = false;
/** Rolling save, skipped if the previous write is still in flight. */
export async function saveRolling(world: WorldState) {
  if (saving) return;
  saving = true;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${ROLLING_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(world));
    await rename(tmp, ROLLING_FILE);
  } catch (err) {
    console.warn('[save] rolling save failed:', (err as Error).message);
  } finally {
    saving = false;
  }
}

const safeName = (name: string) => path.basename(name).replace(/[^\w.-]/g, '_');

export async function saveSnapshot(world: WorldState, label: string): Promise<string> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const file = `${safeName(label)}.json`;
  await writeFile(path.join(SNAPSHOT_DIR, file), JSON.stringify(world));
  return file;
}

export async function listSnapshots(): Promise<string[]> {
  try {
    const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith('.json'));
    return files.sort().reverse();
  } catch {
    return [];
  }
}

export async function loadSnapshot(file: string): Promise<WorldState> {
  const raw = JSON.parse(await readFile(path.join(SNAPSHOT_DIR, safeName(file)), 'utf8')) as WorldState;
  if (raw.version !== 1 || !Array.isArray(raw.agents)) throw new Error('not a Pixel Town snapshot');
  for (const a of raw.agents) { a.busy = false; a.lastReplanAt ??= -Infinity; }
  return raw;
}
