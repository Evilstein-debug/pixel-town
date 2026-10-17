// Daily plan, generated once per agent at wake-up.
import { toHHMM, type Memory, type PlanBlock } from '@pixel-town/shared';
import type { PromptSpec } from '../llm/client';
import type { AgentState } from '../sim/types';
import { WORLD_BLURB, describeAgent, formatMemories, locationList } from './common';
import { DAY_START, planAroundNews, validatePlan } from './planning';

export interface DailyPlanCtx { agent: AgentState; day: number; memories: Memory[]; seedTexts: string[] }

const b = (start: string, end: string, locationId: string, activity: string): PlanBlock => ({ start, end, locationId, activity });

const CANNED: Record<string, PlanBlock[]> = {
  asha: [
    b('07:00', '07:50', 'asha_house', 'Getting ready and making breakfast'),
    b('07:50', '12:00', 'cafe', 'Opening Chai & Co. and brewing chai'),
    b('12:00', '12:40', 'square', 'Lunch break by the notice board'),
    b('12:40', '17:30', 'cafe', 'Serving regulars at the café'),
    b('17:30', '19:00', 'park', 'Evening stroll around the pond'),
    b('19:00', '22:00', 'asha_house', 'Relaxing at home'),
  ],
  rohan: [
    b('07:00', '08:30', 'rohan_house', 'Tinkering with a robot arm'),
    b('08:30', '09:30', 'cafe', 'Morning cutting chai'),
    b('09:30', '12:00', 'library', 'Studying control systems'),
    b('12:00', '13:00', 'cafe', 'Lunch at the café'),
    b('13:00', '17:30', 'library', 'Reading robotics papers'),
    b('17:30', '19:00', 'park', 'Evening jog'),
    b('19:00', '22:00', 'rohan_house', 'Coding at home'),
  ],
  meera: [
    b('07:00', '07:30', 'meera_house', 'Morning tea'),
    b('07:30', '09:30', 'park', 'Tending the park flowers'),
    b('09:30', '10:30', 'square', 'Reading the notice board'),
    b('10:30', '12:00', 'cafe', 'Chai with Asha'),
    b('12:00', '14:00', 'meera_house', 'Lunch and a rest'),
    b('14:00', '16:00', 'park', 'Sitting by the pond'),
    b('16:00', '17:00', 'square', 'Chatting with neighbours'),
    b('17:00', '22:00', 'meera_house', 'Reading at home'),
  ],
};

function canned(ctx: DailyPlanCtx): PlanBlock[] {
  let plan = CANNED[ctx.agent.id] ?? [b('07:00', '22:00', ctx.agent.homeId, 'Pottering about')];
  for (const fact of ctx.seedTexts) plan = planAroundNews(plan, fact, DAY_START, `Going for: ${fact}`);
  return plan;
}

export const dailyPlanPrompt: PromptSpec<DailyPlanCtx, PlanBlock[]> = {
  kind: 'daily-plan',
  maxTokens: 1200,
  build: ({ agent, day, memories }) => ({
    system: WORLD_BLURB,
    user:
      `It is Day ${day}, ${toHHMM(DAY_START)}. ${agent.name} just woke up.\n\n${describeAgent(agent)}\n\n` +
      `Relevant memories:\n${formatMemories(memories)}\n\nLocations (use these ids):\n${locationList()}\n\n` +
      `Write ${agent.name}'s plan for today from 07:00 to 22:00 as 6-8 consecutive blocks. ` +
      `Keep it true to their routine, but if a memory mentions an event or news worth acting on, include it at the right time and place. ` +
      `The last block must be at home (${agent.homeId}) ending at 22:00. Activities are short phrases (under 8 words).\n\n` +
      'Respond with JSON: {"plan":[{"start":"HH:MM","end":"HH:MM","locationId":"<id>","activity":"<phrase>"}]}',
  }),
  parse: (json) => {
    const plan = validatePlan(json, DAY_START);
    return plan && plan.length >= 3 ? plan : null;
  },
  mock: canned,
  fallback: canned,
};
