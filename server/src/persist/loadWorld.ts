// Rebuilds the runtime world for a sim from the store (boot, restart, snapshot fork).
import { LOCATIONS, walkableTilesIn } from '@pixel-town/shared';
import { CONVERSATION_TAIL, LOG_TAIL, type WorldState } from '../sim/types';
import type { Stores } from '../store/types';
import { agentFromRecords, conversationRecord, initialAgentState } from './records';
import { WriteBuffer } from './writeBuffer';

function homeTile(locationId: string) {
  const zone = LOCATIONS.find((l) => l.id === locationId);
  const tile = zone && walkableTilesIn(zone)[0];
  if (!tile) throw new Error(`home location '${locationId}' has no walkable tile`);
  return tile;
}

export async function loadWorld(stores: Stores, simId: string): Promise<WorldState> {
  const sim = await stores.world.getSim(simId);
  if (!sim) throw new Error(`no sim ${simId}`);
  const [agents, states, plans, seeds, links, events, conversations] = await Promise.all([
    stores.world.listAgents(simId),
    stores.world.listAgentStates(simId),
    stores.world.currentPlans(simId),
    stores.memories.listSeeded(simId),
    stores.memories.rumourLinks(simId),
    stores.log.recentEvents(simId, LOG_TAIL),
    stores.world.recentConversations(simId, CONVERSATION_TAIL),
  ]);

  const stateOf = new Map(states.map((s) => [s.agentId, s]));
  const planOf = new Map(plans.map((p) => [p.agentId, p]));
  const runtimeAgents = agents.map((a) => {
    // An agent without saved state (e.g. added mid-run) starts asleep at home.
    const state = stateOf.get(a.id) ?? initialAgentState(a, homeTile(a.homeLocationId), sim.gameMinutes);
    return agentFromRecords(a, state, planOf.get(a.id), sim.gameMinutes);
  });

  const rumours: Record<string, string[]> = Object.fromEntries(agents.map((a) => [a.id, []]));
  for (const l of links) (rumours[l.agentId] ??= []).push(l.seedId);

  return {
    simId,
    name: sim.name,
    clock: sim.gameMinutes,
    paused: sim.status === 'paused',
    speed: sim.config.speed,
    config: sim.config,
    agents: runtimeAgents,
    lastTalk: sim.runtime.lastTalk,
    seeds: Object.fromEntries(seeds.map((m) => [m.id, { text: m.text, embedding: m.embedding ?? [] }])),
    rumours,
    log: events.map((e) => ({ ts: e.atGame, text: e.text })),
    conversations: conversations.map(conversationRecord),
    pending: new WriteBuffer(),
  };
}
