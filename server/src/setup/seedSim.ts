// Creates a fresh sim (Day 1, 07:00, everyone asleep at home) from the built-in
// agents, with a "fresh start" snapshot to come back to.
import { randomUUID } from 'node:crypto';
import { AGENT_SEEDS } from '../agents/seed';
import { initialAgentState } from '../persist/records';
import { FRESH_START_SNAPSHOT, type SnapshotState } from '../persist/snapshots';
import { defaultSimConfig } from '../sim/config';
import { START_CLOCK } from '../sim/time';
import type { AgentRecord, SimRecord, Stores } from '../store/types';

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

    const states = AGENT_SEEDS.map((s, i) => initialAgentState(agents[i], { x: s.tileX, y: s.tileY }, START_CLOCK));
    await tx.world.upsertAgentStates(states);

    const state: SnapshotState = {
      version: 2, gameMinutes: START_CLOCK, paused: false, speed: 1, runtime: { lastTalk: {} }, agents: states, plans: [],
    };
    await tx.world.saveSnapshot({ id: randomUUID(), simId: sim.id, name: FRESH_START_SNAPSHOT, atGame: START_CLOCK, state });

    return { sim, agents };
  });
}
