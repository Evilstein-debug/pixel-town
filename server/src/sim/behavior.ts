// Per-tick agent routine: sleep/wake, following the plan, choosing where to stand.
import {
  LOCATIONS, locationAt, parseHHMM, walkableTilesIn, type PlanBlock,
} from '@pixel-town/shared';
import { makeDailyPlan } from './cognition';
import type { SimContext } from './context';
import { findPath } from './pathfinding';
import { dayOf, isSleepTime, minuteOfDay, STEP_REAL_MS, TICK_MINUTES, TICK_REAL_MS } from './time';
import type { AgentState, Point } from './types';

export const chebyshev = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const pos = (a: AgentState): Point => ({ x: a.tileX, y: a.tileY });
const destination = (a: AgentState): Point => a.path[a.path.length - 1] ?? pos(a);

export function currentBlock(a: AgentState, clock: number): PlanBlock | undefined {
  const m = minuteOfDay(clock);
  return a.plan.find((b) => parseHHMM(b.start) <= m && m < parseHHMM(b.end));
}

/** Rough game minutes to walk to a zone (Manhattan distance, with slack for detours). */
function travelMinutes(a: AgentState, locationId: string): number {
  const z = LOCATIONS.find((l) => l.id === locationId);
  if (!z) return 0;
  const dx = Math.max(z.x0 - a.tileX, 0, a.tileX - z.x1), dy = Math.max(z.y0 - a.tileY, 0, a.tileY - z.y1);
  return (dx + dy) * 1.4 * TICK_MINUTES * (STEP_REAL_MS / TICK_REAL_MS);
}

/** Where the agent should be now: the current block, or the next one if it's time to set off. */
function targetBlock(a: AgentState, clock: number): PlanBlock | undefined {
  const m = minuteOfDay(clock);
  const cur = currentBlock(a, clock);
  if (cur?.priority) return cur;
  const next = a.plan.find((b) => parseHHMM(b.start) > m);
  if (next && next.locationId !== cur?.locationId && parseHHMM(next.start) - m <= travelMinutes(a, next.locationId))
    return next;
  return cur;
}

/** Pick a free tile in a zone, preferring one next to someone already there (so people meet). */
function chooseTile(ctx: SimContext, agent: AgentState, locationId: string): Point | null {
  const zone = LOCATIONS.find((l) => l.id === locationId);
  if (!zone) return null;
  const others = ctx.world.agents.filter((o) => o !== agent);
  const taken = others.flatMap((o) => [pos(o), destination(o)]);
  const free = walkableTilesIn(zone).filter((t) => !taken.some((p) => p.x === t.x && p.y === t.y));
  if (!free.length) return null;
  const inZone = others
    .map(destination)
    .filter((p) => locationAt(p.x, p.y)?.id === locationId);
  const near = free.filter((t) => inZone.some((p) => chebyshev(p, t) <= 2));
  const pool = near.length ? near : free;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function goTo(ctx: SimContext, agent: AgentState, locationId: string) {
  if (agent.targetLocationId === locationId) return;
  agent.targetLocationId = locationId;
  const here = locationAt(agent.tileX, agent.tileY)?.id;
  if (here === locationId && !agent.path.length) return;
  const tile = chooseTile(ctx, agent, locationId);
  const path = tile && findPath(pos(agent), tile);
  if (!path) return;
  agent.path = path;
  agent.stepMs = 0;
  ctx.io.emit('agent:path', { agentId: agent.id, path: [pos(agent), ...path] });
}

/** Stop walking right where the agent is (e.g. to chat). */
export function halt(ctx: SimContext, agent: AgentState) {
  if (!agent.path.length) return;
  agent.path = [];
  agent.targetLocationId = null; // re-path once free again
  ctx.io.emit('agent:path', { agentId: agent.id, path: [pos(agent)] });
}

export function updateAgent(ctx: SimContext, agent: AgentState) {
  const { clock } = ctx.world;
  if (agent.busy) return;
  if (agent.talkingWith) {
    if (clock < agent.talkUntil) return;
    agent.talkingWith = null;
  }

  const onPriority = !!currentBlock(agent, clock)?.priority;
  if (isSleepTime(clock) && !onPriority) {
    if (agent.asleep) return;
    if (agent.targetLocationId !== agent.homeId || agent.path.length) {
      goTo(ctx, agent, agent.homeId);
      agent.action = 'Heading home to sleep';
    } else {
      agent.asleep = true;
      agent.action = 'Sleeping';
      ctx.log(`${agent.name} went to sleep`, 'sleep', { agentId: agent.id });
    }
    return;
  }

  const day = dayOf(clock);
  if (agent.planDay !== day && !onPriority) {
    agent.asleep = false;
    agent.planDay = day;
    agent.action = 'Waking up and planning the day';
    void makeDailyPlan(ctx, agent);
    return;
  }

  const block = targetBlock(agent, clock);
  const locationId = block?.locationId ?? agent.homeId;
  goTo(ctx, agent, locationId);
  const name = LOCATIONS.find((l) => l.id === locationId)?.name ?? locationId;
  agent.action = agent.path.length ? `Heading to ${name}` : block?.activity ?? 'Taking it easy';
}
