// Reactive replan: when an important memory (≥7) arrives, rewrite the rest of today.
// Seeded thoughts are top priority: the agent acts on them immediately.
import { parseHHMM, toHHMM, type Memory, type PlanBlock } from '@pixel-town/shared';
import type { PromptSpec } from '../llm/client';
import type { AgentState } from '../sim/types';
import { WORLD_BLURB, describeAgent, formatMemories, locationList } from './common';
import { insertBlock, planAroundNews, PRIORITY_UNTIL, priorityBlock, validatePlan } from './planning';

export interface ReplanCtx {
  agent: AgentState;
  now: number; // minute of day
  trigger: Memory;
  /** The fact to act on (the rumour text when known). */
  fact: string;
  memories: Memory[];
  /** Seeded thought: must be acted on right now, above everything else. */
  priority: boolean;
  /** Zone to use when the seed doesn't name a place. */
  here: string;
  /** Where most other agents are right now (for "tell everyone" seeds). */
  crowd: string | null;
}

const remaining = (plan: PlanBlock[], now: number) =>
  plan.filter((b) => parseHHMM(b.end) > now).map((b) => (parseHHMM(b.start) < now ? { ...b, start: toHHMM(now) } : b));

function heuristic(ctx: ReplanCtx): PlanBlock[] {
  const rest = remaining(ctx.agent.plan, ctx.now);
  if (ctx.priority) return insertBlock(rest, priorityBlock(ctx.fact, ctx.now, ctx.here, ctx.crowd));
  return planAroundNews(rest, ctx.fact, ctx.now, `Going for: ${ctx.fact}`.slice(0, 80));
}

const planJson =
  'Respond with JSON: {"plan":[{"start":"HH:MM","end":"HH:MM","locationId":"<id>","activity":"<phrase>"}]}';

export const replanPrompt: PromptSpec<ReplanCtx, PlanBlock[]> = {
  kind: 'replan',
  maxTokens: 1200,
  build: ({ agent, now, trigger, memories, priority, crowd }) => {
    const current = remaining(agent.plan, now).map((b) => `- ${b.start}-${b.end} ${b.locationId}: ${b.activity}`).join('\n');
    const head =
      `It is ${toHHMM(now)}. ${describeAgent(agent)}\n\n` +
      (priority
        ? `This thought just became ${agent.name}'s TOP PRIORITY, above everything else today:\n"${trigger.text}"\n\n`
        : `${agent.name} just learned something important:\n"${trigger.text}"\n\n`) +
      `Other relevant memories:\n${formatMemories(memories)}\n\n` +
      `Current plan for the rest of today:\n${current || '(nothing planned)'}\n\n` +
      `Locations (use these ids):\n${locationList()}\n\n`;
    const task = priority
      ? `Rewrite the plan starting at ${toHHMM(now)}. The FIRST block must start at exactly ${toHHMM(now)} and be ${agent.name} ` +
        `acting on this priority immediately (going where it matters, preparing it, and/or telling people about it). ` +
        `Keep that focus until it is done — if it names a time, stay on it until then. ` +
        (crowd ? `(Right now most other people are at ${crowd}, if they need to be found.) ` : '') +
        `Fit the rest of the day around it; ` +
        `the last block is at home (${agent.homeId}). Activities under 8 words.\n\n`
      : `Rewrite the plan from ${toHHMM(now)} to 22:00 so it reacts sensibly to the news (e.g. show up at the right place and time), ` +
        `keeping everything else about their day. The last block must be at home (${agent.homeId}). Activities under 8 words.\n\n`;
    return { system: WORLD_BLURB, user: head + task + planJson };
  },
  parse: (json, { now, priority }) => {
    const plan = validatePlan(json, now, priority ? PRIORITY_UNTIL : undefined);
    if (!plan || !priority) return plan;
    // Enforce "right now": the first block starts at the current minute and is the priority.
    plan[0] = { ...plan[0], start: toHHMM(now), priority: true };
    return plan;
  },
  mock: heuristic,
  fallback: heuristic,
};
