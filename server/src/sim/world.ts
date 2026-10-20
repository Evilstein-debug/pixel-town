// Public projections of runtime agents (what browsers see).
import { locationAt, type AgentPublic, type StatusIcon, type TickAgent } from '@pixel-town/shared';
import type { AgentState } from './types';

export function statusIcon(a: AgentState): StatusIcon {
  if (a.asleep) return 'sleep';
  if (a.talkingWith) return 'talk';
  if (a.path.length) return 'none';
  const loc = locationAt(a.tileX, a.tileY)?.id;
  if (loc === 'cafe') return 'coffee';
  if (loc === 'library') return 'book';
  return 'none';
}

export function tickAgent(a: AgentState): TickAgent {
  return {
    id: a.id, tileX: a.tileX, tileY: a.tileY, facing: a.facing, action: a.action,
    statusIcon: statusIcon(a), locationId: locationAt(a.tileX, a.tileY)?.id ?? null,
  };
}

export function publicAgent(a: AgentState): AgentPublic {
  return {
    name: a.name, age: a.age, occupation: a.occupation, bio: a.bio, appearance: a.appearance,
    ...tickAgent(a),
  };
}
