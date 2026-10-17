// Core domain types shared by client and server.

export type Facing = 'up' | 'down' | 'left' | 'right';

export type StatusIcon = 'none' | 'coffee' | 'book' | 'sleep' | 'talk';

export type MemoryType = 'observation' | 'conversation' | 'seeded' | 'plan';

export interface Memory {
  id: string;
  agentId: string;
  /** Game minutes since Day 1 00:00. */
  createdAt: number;
  lastAccessed: number;
  type: MemoryType;
  text: string;
  importance: number;
  /** Empty when sent to browsers (embeddings stay on the server). */
  embedding: number[];
  /** Set when this memory carries a seeded rumour (the seed's memory id). */
  seedId?: string;
}

export interface PlanBlock {
  /** "HH:MM" game time. */
  start: string;
  end: string;
  locationId: string;
  activity: string;
  /** Acting on a seeded thought: done first, and protected from later replans. */
  priority?: boolean;
}

export interface Appearance {
  shirt: string;
  hair: string;
  skin: string;
  pants: string;
}

/** Everything the client needs to know about an agent. */
export interface AgentPublic {
  id: string;
  name: string;
  age: number;
  occupation: string;
  bio: string;
  appearance: Appearance;
  tileX: number;
  tileY: number;
  facing: Facing;
  action: string;
  statusIcon: StatusIcon;
  locationId: string | null;
}

export interface LogEntry {
  /** Game minutes. */
  ts: number;
  text: string;
}

export interface ConversationLine {
  speakerId: string;
  text: string;
}

export interface ConversationRecord {
  id: string;
  participants: [string, string];
  lines: ConversationLine[];
  /** Game minutes when it started. */
  ts: number;
  locationId: string | null;
}

/** Game minutes since Day 1 00:00. */
export type GameClock = number;

export function formatClock(minutes: GameClock): string {
  const day = Math.floor(minutes / 1440) + 1;
  const m = minutes % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `Day ${day} · ${hh}:${mm}`;
}

/** "HH:MM" → minutes into the day. */
export function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function toHHMM(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
