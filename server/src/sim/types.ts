import type {
  Appearance, ConversationRecord, Facing, LogEntry, Memory, PlanBlock,
} from '@pixel-town/shared';

export interface Point { x: number; y: number }

export interface AgentState {
  id: string;
  name: string;
  age: number;
  occupation: string;
  bio: string;
  relationships: string;
  homeId: string;
  appearance: Appearance;
  tileX: number;
  tileY: number;
  facing: Facing;
  /** Remaining tiles to walk, excluding the current one. */
  path: Point[];
  /** Real ms (at 1×) accumulated toward the next step. */
  stepMs: number;
  /** Zone the agent is currently heading to / staying in. */
  targetLocationId: string | null;
  action: string;
  plan: PlanBlock[];
  /** Day number (1-based) the current plan was made for; 0 = none. */
  planDay: number;
  asleep: boolean;
  talkingWith: string | null;
  /** Game minute when the current conversation ends. */
  talkUntil: number;
  /** An LLM call that should freeze the agent is in flight (planning, deciding to talk). */
  busy: boolean;
  lastPerceived: { locationId: string | null; nearby: string[] };
  /** Game minute of the last reactive replan (rate limit). */
  lastReplanAt: number;
}

export interface WorldState {
  version: 1;
  clock: number;
  paused: boolean;
  speed: number;
  agents: AgentState[];
  memories: Memory[];
  log: LogEntry[];
  conversations: ConversationRecord[];
  /** pairKey → game minute of their last conversation (or declined chat). */
  lastTalk: Record<string, number>;
  seq: number;
}

export const pairKey = (a: string, b: string) => [a, b].sort().join('|');
