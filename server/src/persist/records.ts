// Conversions between the runtime world and store records.
import { locationAt, type ConversationRecord, type Memory } from '@pixel-town/shared';
import { dayOf } from '../sim/time';
import type { AgentState, WorldState } from '../sim/types';
import { statusIcon } from '../sim/world';
import type {
  AgentRecord, AgentStateRecord, MemoryRecord, PlanRecord, SimPatch, StoredConversation,
} from '../store/types';

export function agentStateRecord(a: AgentState, clock: number): AgentStateRecord {
  return {
    agentId: a.id,
    tileX: a.tileX,
    tileY: a.tileY,
    facing: a.facing,
    currentAction: a.action,
    statusIcon: statusIcon(a),
    locationId: locationAt(a.tileX, a.tileY)?.id ?? null,
    path: a.path,
    awake: !a.asleep,
    runtime: {
      targetLocationId: a.targetLocationId,
      planDay: a.planDay,
      talkingWith: a.talkingWith,
      talkUntil: a.talkUntil,
      lastPerceived: a.lastPerceived,
      lastReplanAt: Number.isFinite(a.lastReplanAt) ? a.lastReplanAt : null,
    },
    updatedAtGame: clock,
  };
}

/** The sim row's mutable fields, as of now. */
export function simPatch(w: WorldState): SimPatch {
  return {
    gameMinutes: w.clock,
    status: w.paused ? 'paused' : 'running',
    config: { ...w.config, speed: w.speed },
    runtime: { lastTalk: w.lastTalk },
  };
}

/** Rebuilds a runtime agent. `plan` is used only if it was made for the agent's current plan day. */
export function agentFromRecords(
  a: AgentRecord, s: AgentStateRecord, plan: PlanRecord | undefined, clock: number,
): AgentState {
  const rt = s.runtime;
  const agent: AgentState = {
    id: a.id,
    slug: a.slug,
    name: a.name,
    age: a.age,
    occupation: a.occupation,
    bio: a.bio,
    relationships: a.relationships,
    homeId: a.homeLocationId,
    appearance: a.appearance,
    tileX: s.tileX,
    tileY: s.tileY,
    facing: s.facing,
    path: s.path,
    stepMs: 0,
    targetLocationId: rt.targetLocationId,
    action: s.currentAction,
    plan: plan && plan.day === rt.planDay ? plan.blocks : [],
    planDay: rt.planDay,
    asleep: !s.awake,
    talkingWith: rt.talkingWith,
    talkUntil: rt.talkUntil,
    busy: false,
    lastPerceived: rt.lastPerceived,
    lastReplanAt: rt.lastReplanAt ?? -Infinity,
  };
  // Stopped while the day's plan was still being made: plan again.
  if (!agent.asleep && agent.planDay === dayOf(clock) && !agent.plan.length) agent.planDay = 0;
  return agent;
}

/** A just-created agent with no saved state yet: asleep at home. */
export function initialAgentState(a: AgentRecord, tile: { x: number; y: number }, clock: number): AgentStateRecord {
  return {
    agentId: a.id,
    tileX: tile.x,
    tileY: tile.y,
    facing: 'down',
    currentAction: 'Sleeping',
    statusIcon: 'sleep',
    locationId: locationAt(tile.x, tile.y)?.id ?? null,
    path: [],
    awake: false,
    runtime: {
      targetLocationId: a.homeLocationId,
      planDay: 0,
      talkingWith: null,
      talkUntil: 0,
      lastPerceived: { locationId: a.homeLocationId, nearby: [] },
      lastReplanAt: null,
    },
    updatedAtGame: clock,
  };
}

/** What browsers see: no embedding; unscored importance is 0 ("scoring…"). */
export function publicMemory(m: MemoryRecord): Memory {
  return {
    id: m.id,
    agentId: m.agentId,
    createdAt: m.createdAtGame,
    lastAccessed: m.lastAccessedGame,
    // Reflections arrive in Phase 4; until then every stored type is a shared type.
    type: m.type as Memory['type'],
    text: m.text,
    importance: m.importance ?? 0,
    embedding: [],
    ...(m.seedId ? { seedId: m.seedId } : {}),
  };
}

export const conversationRecord = (c: StoredConversation): ConversationRecord => ({
  id: c.id,
  participants: [c.participants[0], c.participants[1]],
  lines: c.lines.map((l) => ({ speakerId: l.speakerId, text: l.text })),
  ts: c.startedAtGame,
  locationId: c.locationId,
});
