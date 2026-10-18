// Creates a fresh sim (Day 1, 07:00, everyone asleep at home) from the built-in agents.
import { randomUUID } from 'node:crypto';
import { locationAt } from '@pixel-town/shared';
import { AGENT_SEEDS } from '../agents/seed';
import { defaultSimConfig } from '../sim/config';
import { START_CLOCK } from '../sim/time';
import type { AgentRecord, AgentStateRecord, SimRecord, Stores } from '../store/types';

export interface SeedResult {
  sim: SimRecord;
  agents: AgentRecord[];
}

export function seedDefaultSim(
  stores: Stores, opts: { name?: string; llmModel?: string } = {},
): Promise<SeedResult> {
  return stores.transaction(async (tx) => {
    const sim = await tx.world.createSim({
      id: randomUUID(),
      name: opts.name ?? 'Pixel Town',
      seed: 0,
      status: 'running',
      gameMinutes: START_CLOCK,
      config: defaultSimConfig({ llmModel: opts.llmModel }),
      runtime: { lastTalk: {} },
    });

    const agents: AgentRecord[] = AGENT_SEEDS.map((s) => ({
      id: randomUUID(),
      simId: sim.id,
      slug: s.id,
      name: s.name,
      age: s.age,
      occupation: s.occupation,
      bio: s.bio,
      relationships: s.relationships,
      traits: {},
      homeLocationId: s.homeId,
      appearance: s.appearance,
      createdBy: null,
    }));
    await tx.world.insertAgents(agents);

    const states: AgentStateRecord[] = AGENT_SEEDS.map((s, i) => ({
      agentId: agents[i].id,
      tileX: s.tileX,
      tileY: s.tileY,
      facing: 'down',
      currentAction: 'Sleeping',
      statusIcon: 'sleep',
      locationId: locationAt(s.tileX, s.tileY)?.id ?? null,
      path: [],
      awake: false,
      runtime: {
        targetLocationId: s.homeId,
        planDay: 0,
        talkingWith: null,
        talkUntil: 0,
        lastPerceived: { locationId: s.homeId, nearby: [] },
        lastReplanAt: null,
      },
      updatedAtGame: START_CLOCK,
    }));
    await tx.world.upsertAgentStates(states);

    return { sim, agents };
  });
}
