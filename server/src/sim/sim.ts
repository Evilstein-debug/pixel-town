// The running simulation: tick loop, movement loop, controls, snapshots.
import { randomUUID } from 'node:crypto';
import { formatClock, MAP_ID, type Memory, type WorldSnapshot } from '@pixel-town/shared';
import { loadWorld } from '../persist/loadWorld';
import { Persister } from '../persist/persister';
import { publicMemory } from '../persist/records';
import {
  buildBundle, createSimFromBundle, listLineageSnapshots, snapshotStateOf,
} from '../persist/snapshots';
import type { MemoryRecord, MemoryType, Stores } from '../store/types';
import { updateAgent } from './behavior';
import { maybeReplan, perceive } from './cognition';
import type { EventKind, IO, SimContext } from './context';
import { createMemory, type NewMemoryOptions } from './memory';
import { checkConversations } from './social';
import { STEP_REAL_MS, TICK_MINUTES, TICK_REAL_MS } from './time';
import { LOG_TAIL, type WorldState } from './types';
import { publicAgent, tickAgent } from './world';

const MOVE_INTERVAL_MS = 50;
const SPEEDS = [1, 2, 4];
/** Memories per agent sent to a browser on connect. */
const SNAPSHOT_MEMORIES = 200;

export class Sim implements SimContext {
  private tickTimer?: NodeJS.Timeout;
  private moveTimer?: NodeJS.Timeout;
  private lastMove = Date.now();
  private sinceTick = 0;
  private persister: Persister;

  constructor(public world: WorldState, readonly io: IO, readonly stores: Stores) {
    this.persister = new Persister(stores, { onScored: (w, mems) => this.onScored(w, mems) });
  }

  isCurrent(world: WorldState) {
    return world === this.world;
  }

  start() {
    this.moveTimer = setInterval(() => this.move(), MOVE_INTERVAL_MS);
    this.tickTimer = setInterval(() => this.maybeTick(), MOVE_INTERVAL_MS);
    this.log(`Simulation running at ${formatClock(this.world.clock)}`, 'system');
  }

  /** Stops the loops and persists everything written so far. */
  async shutdown() {
    clearInterval(this.tickTimer);
    clearInterval(this.moveTimer);
    await this.persister.drain(this.world);
  }

  // ---------- loops ----------

  private move() {
    const now = Date.now();
    const dt = (now - this.lastMove) * this.world.speed;
    this.lastMove = now;
    if (this.world.paused) return;
    this.sinceTick += dt;
    this.walk(dt);
  }

  /** Advances agents along their paths by `dt` real ms at 1× (1 tile per STEP_REAL_MS). Public for tests. */
  walk(dt: number) {
    for (const a of this.world.agents) {
      if (!a.path.length || a.talkingWith || a.busy) continue;
      a.stepMs += dt;
      while (a.stepMs >= STEP_REAL_MS && a.path.length) {
        a.stepMs -= STEP_REAL_MS;
        const next = a.path.shift()!;
        const dx = next.x - a.tileX, dy = next.y - a.tileY;
        a.facing = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
        a.tileX = next.x;
        a.tileY = next.y;
      }
      if (!a.path.length) a.stepMs = 0;
    }
  }

  private maybeTick() {
    if (this.world.paused || this.sinceTick < TICK_REAL_MS) return;
    this.sinceTick -= TICK_REAL_MS;
    this.tick();
  }

  /** One game tick. Public so tests can step the sim without timers. */
  tick() {
    const world = this.world;
    world.clock += TICK_MINUTES;
    for (const a of world.agents) updateAgent(this, a);
    for (const a of world.agents) perceive(this, a);
    checkConversations(this);
    this.emitTick();
    void this.persister.flush(world);
  }

  /** Persists everything written so far (tests, snapshots, shutdown). */
  drain() {
    return this.persister.drain(this.world);
  }

  private emitTick() {
    const w = this.world;
    this.io.emit('world:tick', { clock: w.clock, agents: w.agents.map(tickAgent), paused: w.paused, speed: w.speed });
  }

  /** Called by the persister once a batch's new memories are scored. */
  private onScored(world: WorldState, memories: MemoryRecord[]) {
    if (!this.isCurrent(world)) return;
    for (const m of memories) {
      const mem = publicMemory(m);
      this.io.emit('memory:add', { agentId: m.agentId, memory: mem });
      void maybeReplan(this, mem);
    }
  }

  // ---------- context ----------

  log(text: string, kind: EventKind, payload: Record<string, unknown> = {}) {
    const w = this.world;
    const entry = { ts: w.clock, text };
    w.log.push(entry);
    if (w.log.length > LOG_TAIL) w.log.shift();
    w.pending.addEvent({ simId: w.simId, atGame: w.clock, kind, text, payload });
    this.io.emit('log', entry);
    console.log(`[log] ${formatClock(entry.ts)}  ${text}`);
  }

  async addMemory(agentId: string, type: MemoryType, text: string, opts?: NewMemoryOptions): Promise<Memory> {
    const world = this.world;
    const mem = publicMemory(await createMemory(world, agentId, type, text, opts));
    if (this.isCurrent(world)) this.io.emit('memory:add', { agentId, memory: mem });
    return mem;
  }

  /** The full picture a browser needs when it connects or the world is replaced. */
  async clientSnapshot(): Promise<WorldSnapshot> {
    const w = this.world;
    const memories = await Promise.all(w.agents.map(async (a) => {
      const saved = await this.stores.memories.listByAgent(w.simId, a.id, { limit: SNAPSHOT_MEMORIES });
      const unsaved = w.pending.unsavedMemories(a.id);
      const ids = new Set(unsaved.map((m) => m.id));
      // Oldest first; the client puts newest on top.
      return [...saved.filter((m) => !ids.has(m.id)).reverse(), ...unsaved];
    }));
    return {
      mapId: MAP_ID,
      clock: w.clock,
      paused: w.paused,
      speed: w.speed,
      agents: w.agents.map(publicAgent),
      log: w.log.slice(-60),
      memories: memories.flat().map(publicMemory),
      plans: Object.fromEntries(w.agents.map((a) => [a.id, a.plan])),
      conversations: w.conversations.slice(-20),
      snapshots: await listLineageSnapshots(this.stores, w.simId),
    };
  }

  // ---------- controls ----------

  control(cmd: 'pause' | 'play' | 'speed', value?: number) {
    if (cmd === 'pause') this.world.paused = true;
    if (cmd === 'play') this.world.paused = false;
    if (cmd === 'speed' && value && SPEEDS.includes(value)) this.world.speed = value;
    this.emitTick();
    // Ticks stop while paused, so persist the change now.
    void this.persister.flush(this.world);
  }

  /** Plants a thought in an agent. `actor` says who did it (one local user for now). */
  async seed(agentId: string, text: string, actor = 'local') {
    const agent = this.world.agents.find((a) => a.id === agentId);
    const clean = text.trim().slice(0, 200);
    if (!agent || !clean) return;
    // Top priority: wake up and break off any conversation to act on it right away.
    if (agent.asleep) {
      agent.asleep = false;
      this.log(`${agent.name} is woken by an urgent thought`, 'wake', { agentId });
    }
    if (agent.talkingWith) {
      const other = this.world.agents.find((a) => a.id === agent.talkingWith);
      for (const a of [agent, other]) if (a) { a.talkingWith = null; a.talkUntil = this.world.clock; }
      this.log(`${agent.name} cuts the chat with ${other?.name} short`, 'talk_interrupted', { agentIds: [agentId, other?.id] });
      this.emitTick();
    }
    const mem = await this.addMemory(agentId, 'seeded', clean, { importance: 8, sourceRef: { actor } });
    this.log(`🌱 Seeded into ${agent.name}: "${clean}"`, 'seed', { agentId, memoryId: mem.id, actor });
    void maybeReplan(this, mem, { priority: true });
    void this.persister.flush(this.world);
  }

  async saveSnapshot(): Promise<string> {
    await this.persister.drain(this.world);
    const w = this.world;
    const stamp = formatClock(w.clock).replace(/[^\dA-Za-z]+/g, '-');
    const name = `${stamp}_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
    const snap = await this.stores.world.saveSnapshot({
      id: randomUUID(), simId: w.simId, name, atGame: w.clock, state: snapshotStateOf(w),
    });
    this.log(`Saved snapshot ${name}`, 'snapshot', { snapshotId: snap.id });
    this.io.emit('snapshots:list', await listLineageSnapshots(this.stores, w.simId));
    return snap.id;
  }

  /** Restores a snapshot by forking a new sim from it; the current sim is archived. */
  async loadSnapshot(snapshotId: string) {
    const old = this.world;
    await this.persister.drain(old);
    const bundle = await buildBundle(this.stores, snapshotId);
    const base = bundle.sim.name.split(' ↺ ')[0];
    const fork = await createSimFromBundle(this.stores, bundle, {
      name: `${base} ↺ ${bundle.snapshot.name}`,
      parentSimId: bundle.sourceSimId,
      forkedFromSnapshotId: snapshotId,
      archiveSimId: old.simId,
    });
    this.world = await loadWorld(this.stores, fork.id);
    this.sinceTick = 0;
    this.log(`Loaded snapshot ${bundle.snapshot.name}`, 'snapshot', { snapshotId, forkedFrom: old.simId });
    this.io.emit('world:snapshot', await this.clientSnapshot());
    console.log(`[sim] forked ${fork.id} from snapshot ${snapshotId}; archived ${old.simId}`);
  }
}
