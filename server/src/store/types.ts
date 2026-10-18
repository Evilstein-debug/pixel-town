// Repository layer: plain records and the interfaces the sim talks to. Two
// implementations exist (postgres/, memory/); nothing outside src/store and
// src/db may import Drizzle or SQL.
import type { Appearance, Facing, MemoryType as SharedMemoryType, PlanBlock, StatusIcon } from '@pixel-town/shared';

export type MemoryType = SharedMemoryType | 'reflection';
export type SimStatus = 'running' | 'paused' | 'archived';
export type LlmPurpose = 'importance' | 'plan' | 'replan' | 'talk_decide' | 'dialogue' | 'reflect';

export interface RetrievalConfig {
  decay: number;
  wRecency: number;
  wImportance: number;
  wRelevance: number;
  kSim: number;
  kRecent: number;
  kImp: number;
  topN: number;
}

export interface SimConfig {
  tickMinutes: number;
  tickRealMs: number;
  speed: number;
  retrieval: RetrievalConfig;
  models: { llm: string; embedding: string };
}

export interface SimRuntime {
  /** pairKey(a, b) → game minute their conversation cooldown runs from. */
  lastTalk: Record<string, number>;
}

export interface SimRecord {
  id: string;
  name: string;
  seed: number;
  createdAt: Date;
  status: SimStatus;
  gameMinutes: number;
  config: SimConfig;
  runtime: SimRuntime;
  importHash: string | null;
  parentSimId: string | null;
  forkedFromSnapshotId: string | null;
}

export type NewSim = Omit<SimRecord, 'createdAt' | 'importHash' | 'parentSimId' | 'forkedFromSnapshotId'> &
  Partial<Pick<SimRecord, 'importHash' | 'parentSimId' | 'forkedFromSnapshotId'>>;

export interface AgentRecord {
  id: string;
  simId: string;
  slug: string;
  name: string;
  age: number;
  occupation: string;
  bio: string;
  relationships: string;
  traits: Record<string, unknown>;
  homeLocationId: string;
  appearance: Appearance;
  createdBy: string | null;
}

export interface AgentRuntime {
  targetLocationId: string | null;
  /** Day the current plan was made for; 0 = none. */
  planDay: number;
  talkingWith: string | null;
  talkUntil: number;
  lastPerceived: { locationId: string | null; nearby: string[] };
  /** Game minute of the last reactive replan; null = never. */
  lastReplanAt: number | null;
}

export interface AgentStateRecord {
  agentId: string;
  tileX: number;
  tileY: number;
  facing: Facing;
  currentAction: string;
  statusIcon: StatusIcon;
  locationId: string | null;
  path: { x: number; y: number }[];
  awake: boolean;
  runtime: AgentRuntime;
  updatedAtGame: number;
}

export interface MemoryRecord {
  id: string;
  simId: string;
  agentId: string;
  type: MemoryType;
  text: string;
  /** 1–10, or null while unscored. */
  importance: number | null;
  createdAtGame: number;
  lastAccessedGame: number;
  embedding: number[] | null;
  /** Set exactly when `embedding` is set. */
  embeddingModel: string | null;
  seedId: string | null;
  sourceRef: Record<string, unknown> | null;
}

export interface PlanRecord {
  id: string;
  simId: string;
  agentId: string;
  day: number;
  blocks: PlanBlock[];
  createdAtGame: number;
  supersededAtGame: number | null;
}

export interface StoredConversation {
  id: string;
  simId: string;
  locationId: string | null;
  startedAtGame: number;
  participants: string[];
  /** Ordered by `seq`. */
  lines: { seq: number; speakerId: string; text: string }[];
}

export interface EventRecord {
  simId: string;
  atGame: number;
  kind: string;
  text: string;
  payload: Record<string, unknown>;
}

export interface SnapshotRecord {
  id: string;
  simId: string;
  name: string;
  atGame: number;
  /** A checkpoint whose shape belongs to the sim layer; the store treats it as JSON. */
  state: unknown;
  createdAt: Date;
}

export interface LlmCallRecord {
  simId: string;
  purpose: LlmPurpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  ok: boolean;
}

export interface RetrievalLogRecord {
  simId: string;
  agentId: string;
  atGame: number;
  queryText: string;
  candidateCount: number;
  results: unknown;
  latencyMs: number;
}

export type SimPatch = Partial<Pick<SimRecord, 'name' | 'status' | 'gameMinutes' | 'config' | 'runtime'>>;

export interface WorldStore {
  createSim(sim: NewSim): Promise<SimRecord>;
  getSim(id: string): Promise<SimRecord | null>;
  findSimByImportHash(hash: string): Promise<SimRecord | null>;
  /** Most recently created sim with status `running`. */
  latestRunningSim(): Promise<SimRecord | null>;
  updateSim(id: string, patch: SimPatch): Promise<void>;
  /** Removes the sim and everything belonging to it. */
  deleteSim(id: string): Promise<void>;

  insertAgents(agents: AgentRecord[]): Promise<void>;
  listAgents(simId: string): Promise<AgentRecord[]>;
  upsertAgentStates(states: AgentStateRecord[]): Promise<void>;
  listAgentStates(simId: string): Promise<AgentStateRecord[]>;

  /**
   * Adds plans in order. Each new plan supersedes its agent's current plan at
   * the new plan's `createdAtGame`; history is kept.
   */
  insertPlans(plans: PlanRecord[]): Promise<void>;
  /** The one current (unsuperseded) plan per agent. */
  currentPlans(simId: string): Promise<PlanRecord[]>;
  /** Every plan for an agent, oldest first. */
  planHistory(agentId: string): Promise<PlanRecord[]>;

  insertConversations(conversations: StoredConversation[]): Promise<void>;
  /** Newest `limit` conversations, returned oldest first. */
  recentConversations(simId: string, limit: number): Promise<StoredConversation[]>;

  saveSnapshot(snapshot: Omit<SnapshotRecord, 'createdAt'>): Promise<SnapshotRecord>;
  /** Without `state`, newest first. */
  listSnapshots(simId: string): Promise<Omit<SnapshotRecord, 'state'>[]>;
  getSnapshot(id: string): Promise<SnapshotRecord | null>;
}

export interface MemoryStore {
  insertMemories(memories: MemoryRecord[]): Promise<void>;
  getMemories(ids: string[]): Promise<MemoryRecord[]>;
  /** Newest first. */
  listByAgent(simId: string, agentId: string, opts?: { limit?: number }): Promise<MemoryRecord[]>;
  /** Memory count per agent id. */
  countByAgent(simId: string): Promise<Record<string, number>>;
  setImportance(updates: { id: string; importance: number }[]): Promise<void>;
  /** Bump `last_accessed_game` for retrieved memories in one statement. */
  touch(ids: string[], atGame: number): Promise<void>;
  insertEvidence(links: { reflectionId: string; evidenceId: string }[]): Promise<void>;
  /** Evidence memory ids for a reflection. */
  evidenceFor(reflectionId: string): Promise<string[]>;
}

export interface LogStore {
  appendEvents(events: EventRecord[]): Promise<void>;
  /** Newest `limit` events, returned oldest first. */
  recentEvents(simId: string, limit: number): Promise<EventRecord[]>;
  recordLlmCalls(calls: LlmCallRecord[]): Promise<void>;
  recordRetrievals(logs: RetrievalLogRecord[]): Promise<void>;
}

export interface Stores {
  readonly kind: 'postgres' | 'memory';
  readonly world: WorldStore;
  readonly memories: MemoryStore;
  readonly log: LogStore;
  /** Runs `fn` atomically: all writes made through the given stores commit or none do. */
  transaction<T>(fn: (tx: Stores) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
