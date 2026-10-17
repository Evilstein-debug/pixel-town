// Perception, daily planning, importance scoring and reactive replanning.
import { locationAt, parseHHMM, toHHMM, type Memory, type PlanBlock } from '@pixel-town/shared';
import { runPrompt } from '../llm/client';
import { locationName } from '../prompts/common';
import { dailyPlanPrompt } from '../prompts/dailyPlan';
import { importancePrompt } from '../prompts/importance';
import { keepPriority } from '../prompts/planning';
import { replanPrompt } from '../prompts/replan';
import { updateAgent } from './behavior';
import type { SimContext } from './context';
import { retrieve, UNSCORED } from './memory';
import { dayOf, minuteOfDay } from './time';
import type { AgentState, WorldState } from './types';

const PERCEPTION_RADIUS = 5;
export const REPLAN_THRESHOLD = 7;
const REPLAN_COOLDOWN_MIN = 30;

/** Retrieve and tell the UI which memories were pulled and why. */
export async function recall(ctx: SimContext, agent: AgentState, query: string, k?: number) {
  const r = await retrieve(ctx.world, agent.id, query, k);
  if (r.results.length) ctx.io.emit('memory:retrieved', { agentId: agent.id, query, results: r.results });
  return r.memories;
}

/** Text of the seeded rumours this agent knows about. */
export function knownRumours(world: WorldState, agentId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of world.memories) {
    if (m.agentId !== agentId || !m.seedId) continue;
    const seed = world.memories.find((s) => s.id === m.seedId);
    if (seed) out.set(m.seedId, seed.text);
  }
  return out;
}

export function perceive(ctx: SimContext, agent: AgentState) {
  if (agent.asleep || agent.busy) return;
  const place = locationAt(agent.tileX, agent.tileY)?.id ?? null;
  const last = agent.lastPerceived;

  // Location: only once the agent has arrived somewhere new.
  if (!agent.path.length && place && place !== last.locationId) {
    last.locationId = place;
    void ctx.addMemory(agent.id, 'observation', `Arrived at ${locationName(place)}.`);
  }

  const nearby = ctx.world.agents.filter(
    (o) => o !== agent && Math.hypot(o.tileX - agent.tileX, o.tileY - agent.tileY) <= PERCEPTION_RADIUS,
  );
  for (const o of nearby) {
    if (last.nearby.includes(o.id)) continue;
    const where = locationName(locationAt(o.tileX, o.tileY)?.id ?? null);
    void ctx.addMemory(agent.id, 'observation', `Saw ${o.name} (${o.action.toLowerCase()}) near ${where}.`);
  }
  last.nearby = nearby.map((o) => o.id);
}

export async function makeDailyPlan(ctx: SimContext, agent: AgentState) {
  const world = ctx.world;
  agent.busy = true;
  try {
    const memories = await recall(ctx, agent, `${agent.name}'s plans, commitments and important news for today`);
    const plan = await runPrompt(dailyPlanPrompt, {
      agent, day: dayOf(world.clock), memories, seedTexts: [...knownRumours(world, agent.id).values()],
    });
    if (!ctx.isCurrent(world)) return;
    // A seed may have landed while we were planning; it stays on top.
    agent.plan = keepPriority(agent.plan, plan, minuteOfDay(world.clock));
    ctx.io.emit('plan:update', { agentId: agent.id, plan: agent.plan });
    const summary = agent.plan.map((b) => `${b.start} ${b.activity}`).join('; ');
    await ctx.addMemory(agent.id, 'plan', `Plan for today: ${summary}`, 3);
    ctx.log(`${agent.name} planned the day (${agent.plan.length} blocks)`);
  } finally {
    agent.busy = false;
  }
}

let scoring = false;
/** One batched importance call covering every unscored memory. */
export async function scoreImportance(ctx: SimContext) {
  if (scoring) return;
  const world = ctx.world;
  const pending = world.memories.filter((m) => m.importance === UNSCORED);
  if (!pending.length) return;
  scoring = true;
  try {
    const name = (id: string) => world.agents.find((a) => a.id === id)?.name ?? id;
    const scores = await runPrompt(importancePrompt, {
      items: pending.map((m) => ({ id: m.id, agentName: name(m.agentId), type: m.type, text: m.text })),
    });
    if (!ctx.isCurrent(world)) return;
    for (const m of pending) {
      m.importance = scores[m.id] ?? 3;
      ctx.io.emit('memory:add', { agentId: m.agentId, memory: { ...m, embedding: [] } });
      void maybeReplan(ctx, m);
    }
  } finally {
    scoring = false;
  }
}

/** Replans run one at a time per agent, so two can't overwrite each other. */
const replanChains = new Map<string, Promise<void>>();

/**
 * Rewrite the rest of today's plan when something important (≥7) is learned.
 * `priority` (seeded thoughts) skips every guard and makes the agent act right now.
 */
export function maybeReplan(ctx: SimContext, mem: Memory, opts: { priority?: boolean } = {}): Promise<void> {
  const prev = replanChains.get(mem.agentId) ?? Promise.resolve();
  const next = prev.then(() => replan(ctx, mem, opts)).catch((err) => console.warn('[replan]', err));
  replanChains.set(mem.agentId, next);
  return next;
}

/** Most common location of the other awake agents. */
function crowdLocation(world: WorldState, self: AgentState): string | null {
  const counts = new Map<string, number>();
  for (const o of world.agents) {
    if (o === self || o.asleep) continue;
    const loc = o.targetLocationId ?? locationAt(o.tileX, o.tileY)?.id;
    if (loc && !loc.endsWith('_house')) counts.set(loc, (counts.get(loc) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function replan(ctx: SimContext, mem: Memory, opts: { priority?: boolean }) {
  const world = ctx.world;
  if (!ctx.isCurrent(world)) return;
  const agent = world.agents.find((a) => a.id === mem.agentId);
  if (!agent) return;
  const priority = !!opts.priority;
  if (!priority) {
    if (mem.importance < REPLAN_THRESHOLD || mem.type === 'plan' || mem.type === 'observation') return;
    if (agent.asleep || agent.planDay !== dayOf(world.clock) || !agent.plan.length) return; // tomorrow's plan uses it
    // Hearing a rumour always gets a replan; other news is rate-limited.
    if (!mem.seedId && world.clock - agent.lastReplanAt < REPLAN_COOLDOWN_MIN) return;
  }
  agent.lastReplanAt = world.clock;

  const now = minuteOfDay(world.clock);
  const fact = (mem.seedId && world.memories.find((s) => s.id === mem.seedId)?.text) || mem.text;
  const here = locationAt(agent.tileX, agent.tileY)?.id ?? agent.homeId;
  const memories = await recall(ctx, agent, mem.text);
  const crowd = crowdLocation(world, agent);
  const rest = await runPrompt(replanPrompt, { agent, now, trigger: mem, fact, memories, priority, here, crowd });
  if (!ctx.isCurrent(world)) return;

  const before = new Set(agent.plan.map((b) => `${b.locationId}|${b.activity}`));
  // Keep what already happened (clipped at the replan time); the new blocks start there.
  const past = agent.plan
    .filter((b) => parseHHMM(b.start) < now)
    .map((b) => (parseHHMM(b.end) > now ? { ...b, end: toHHMM(now) } : b));
  // Earlier priorities survive ordinary replans; a new priority takes the slot it asks for.
  const protectedOld = agent.plan.filter((b) => b.priority && !(priority && overlaps(b, rest[0])));
  agent.plan = [...past, ...keepPriority(protectedOld, rest, now)];
  ctx.io.emit('plan:update', { agentId: agent.id, plan: agent.plan });

  const changed = rest.find((b) => !before.has(`${b.locationId}|${b.activity}`)) ?? rest[0];
  ctx.log(
    priority
      ? `⭐ ${agent.name} drops everything: ${rest[0].activity} (${locationName(rest[0].locationId)})`
      : `${agent.name} changed plans: ${changed ? `${changed.start} ${changed.activity}` : 'rest of day'}`,
  );
  // Start moving now rather than on the next tick.
  if (priority && !agent.busy && !agent.talkingWith) {
    agent.targetLocationId = null;
    updateAgent(ctx, agent);
  }
  await ctx.addMemory(agent.id, 'plan', `${priority ? 'Made top priority' : 'Changed plans after learning'}: ${fact}`, 5);
}

function overlaps(a: PlanBlock, b: PlanBlock | undefined) {
  return !!b && parseHHMM(a.start) < parseHHMM(b.end) && parseHHMM(b.start) < parseHHMM(a.end);
}
