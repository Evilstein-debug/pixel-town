import type {
  Appearance, ConversationRecord, Facing, LogEntry, PlanBlock,
} from '@pixel-town/shared';
import type { WriteBuffer } from '../persist/writeBuffer';
import type { SimConfig } from '../store/types';

export interface Point { x: number; y: number }

export interface AgentState {
  /** Database id (uuid). */
  id: string;
  /** Stable short key ('asha'), unique within a sim; used where a model or mock needs a name-like key. */
  slug: string;
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

/**
 * The running sim's working set. The database is the source of truth; this holds
 * what the tick loop needs synchronously, plus writes not yet persisted.
 */
export interface WorldState {
  simId: string;
  name: string;
  clock: number;
  paused: boolean;
  speed: number;
  config: SimConfig;
  agents: AgentState[];
  /** pairKey → game minute of their last conversation (or declined chat). */
  lastTalk: Record<string, number>;
  /** Seeded memories (rumour sources) by memory id. */
  seeds: Record<string, { text: string; embedding: number[] }>;
  /** agentId → ids of the seeded rumours that agent has a memory of. */
  rumours: Record<string, string[]>;
  /** Recent tail of the event log, for browsers that connect later. */
  log: LogEntry[];
  /** Recent conversations, for browsers that connect later. */
  conversations: ConversationRecord[];
  /** Writes made since the last successful flush. */
  pending: WriteBuffer;
}

export const pairKey = (a: string, b: string) => [a, b].sort().join('|');

export const LOG_TAIL = 200;
export const CONVERSATION_TAIL = 50;
