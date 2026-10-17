// The running simulation: tick loop, movement loop, controls, snapshots.
import { formatClock, type Memory, type MemoryType } from '@pixel-town/shared';
import { updateAgent } from './behavior';
import { maybeReplan, perceive, scoreImportance } from './cognition';
import type { IO, SimContext } from './context';
import { createMemory, publicMemory } from './memory';
import { checkConversations } from './social';
import { STEP_REAL_MS, TICK_MINUTES, TICK_REAL_MS } from './time';
import type { WorldState } from './types';
import {
  listSnapshots, loadSnapshot, saveRolling, saveSnapshot, snapshotOf, tickAgent,
} from './world';

const MOVE_INTERVAL_MS = 50;
const SPEEDS = [1, 2, 4];

export class Sim implements SimContext {
  private tickTimer?: NodeJS.Timeout;
  private moveTimer?: NodeJS.Timeout;
  private lastMove = Date.now();
  private sinceTick = 0;

  constructor(public world: WorldState, readonly io: IO) {}

  isCurrent(world: WorldState) {
    return world === this.world;
  }

  start() {
    this.moveTimer = setInterval(() => this.move(), MOVE_INTERVAL_MS);
    this.tickTimer = setInterval(() => this.maybeTick(), MOVE_INTERVAL_MS);
    this.log(`Simulation started at ${formatClock(this.world.clock)}`);
  }

  stop() {
    clearInterval(this.tickTimer);
    clearInterval(this.moveTimer);
  }

  // ---------- loops ----------

  /** Advances along paths at 1 tile per STEP_REAL_MS (scaled by speed). */
  private move() {
    const now = Date.now();
    const dt = (now - this.lastMove) * this.world.speed;
    this.lastMove = now;
    if (this.world.paused) return;
    this.sinceTick += dt;
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

  private tick() {
    const world = this.world;
    world.clock += TICK_MINUTES;
    for (const a of world.agents) updateAgent(this, a);
    for (const a of world.agents) perceive(this, a);
    checkConversations(this);
    void scoreImportance(this);
    this.emitTick();
    void saveRolling(world);
  }

  private emitTick() {
    const w = this.world;
    this.io.emit('world:tick', { clock: w.clock, agents: w.agents.map(tickAgent), paused: w.paused, speed: w.speed });
  }

  // ---------- context ----------

  log(text: string) {
    const entry = { ts: this.world.clock, text };
    this.world.log.push(entry);
    if (this.world.log.length > 200) this.world.log.shift();
    this.io.emit('log', entry);
    console.log(`[log] ${formatClock(entry.ts)}  ${text}`);
  }

  async addMemory(
    agentId: string, type: MemoryType, text: string, importance?: number, factHint?: string,
  ): Promise<Memory> {
    const world = this.world;
    const mem = await createMemory(world, agentId, type, text, importance, factHint);
    if (this.isCurrent(world)) this.io.emit('memory:add', { agentId, memory: publicMemory(mem) });
    return mem;
  }

  // ---------- controls ----------

  control(cmd: 'pause' | 'play' | 'speed', value?: number) {
    if (cmd === 'pause') this.world.paused = true;
    if (cmd === 'play') this.world.paused = false;
    if (cmd === 'speed' && value && SPEEDS.includes(value)) this.world.speed = value;
    this.emitTick();
  }

  async seed(agentId: string, text: string) {
    const agent = this.world.agents.find((a) => a.id === agentId);
    const clean = text.trim().slice(0, 200);
    if (!agent || !clean) return;
    // Top priority: wake up and break off any conversation to act on it right away.
    if (agent.asleep) {
      agent.asleep = false;
      this.log(`${agent.name} is woken by an urgent thought`);
    }
    if (agent.talkingWith) {
      const other = this.world.agents.find((a) => a.id === agent.talkingWith);
      for (const a of [agent, other]) if (a) { a.talkingWith = null; a.talkUntil = this.world.clock; }
      this.log(`${agent.name} cuts the chat with ${other?.name} short`);
      this.emitTick();
    }
    const mem = await this.addMemory(agentId, 'seeded', clean, 8);
    this.log(`🌱 Seeded into ${agent.name}: "${clean}"`);
    void maybeReplan(this, mem, { priority: true });
  }

  async saveSnapshot(): Promise<string> {
    const w = this.world;
    const stamp = formatClock(w.clock).replace(/[^\dA-Za-z]+/g, '-');
    const file = await saveSnapshot(w, `${stamp}_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`);
    this.log(`Saved snapshot ${file}`);
    this.io.emit('snapshots:list', await listSnapshots());
    return file;
  }

  async loadSnapshot(file: string) {
    const world = await loadSnapshot(file);
    this.world = world;
    this.sinceTick = 0;
    this.io.emit('world:snapshot', snapshotOf(world, await listSnapshots()));
    this.log(`Loaded snapshot ${file}`);
  }
}
