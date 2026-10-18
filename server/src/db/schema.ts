// Drizzle schema: the single source of truth for world state and agent memory.
// Only the postgres store (src/store/postgres) and db tooling may import this.
// Game times (`*_game`, `game_minutes`) are game minutes since Day 1 00:00.
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, smallint, text, timestamp,
  uniqueIndex, uuid, vector, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { Appearance, Facing, PlanBlock, StatusIcon } from '@pixel-town/shared';
import { EMBEDDING_DIMENSIONS } from '../config/embedding';
import type { AgentRuntime, SimConfig, SimRuntime } from '../store/types';

export const simStatus = pgEnum('sim_status', ['running', 'paused', 'archived']);
export const memoryType = pgEnum('memory_type', ['observation', 'conversation', 'seeded', 'plan', 'reflection']);
export const llmPurpose = pgEnum('llm_purpose', ['importance', 'plan', 'replan', 'talk_decide', 'dialogue', 'reflect']);

export const sims = pgTable('sims', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  seed: integer('seed').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  status: simStatus('status').notNull().default('running'),
  gameMinutes: integer('game_minutes').notNull(),
  config: jsonb('config').$type<SimConfig>().notNull(),
  /** Small sim-wide runtime state (conversation cooldowns), rewritten with each tick. */
  runtime: jsonb('runtime').$type<SimRuntime>().notNull(),
  /** sha256 of an imported world.json; makes `db:import-json` refuse duplicates. */
  importHash: text('import_hash').unique(),
  /** Set when this sim was forked from another sim's snapshot. */
  parentSimId: uuid('parent_sim_id').references((): AnyPgColumn => sims.id, { onDelete: 'set null' }),
  forkedFromSnapshotId: uuid('forked_from_snapshot_id').references((): AnyPgColumn => snapshots.id, { onDelete: 'set null' }),
}, (t) => [
  index('sims_status_created_idx').on(t.status, t.createdAt.desc()),
]);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  simId: uuid('sim_id').notNull().references(() => sims.id, { onDelete: 'cascade' }),
  /** Stable human key ('asha'), unique within a sim. */
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  age: smallint('age').notNull(),
  occupation: text('occupation').notNull(),
  bio: text('bio').notNull(),
  relationships: text('relationships').notNull().default(''),
  traits: jsonb('traits').$type<Record<string, unknown>>().notNull().default({}),
  homeLocationId: text('home_location_id').notNull(),
  appearance: jsonb('appearance').$type<Appearance>().notNull(),
  /** Null for built-in agents; a visitor id for visitor-created agents later. */
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('agents_sim_slug_uq').on(t.simId, t.slug),
]);

export const agentState = pgTable('agent_state', {
  agentId: uuid('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  tileX: smallint('tile_x').notNull(),
  tileY: smallint('tile_y').notNull(),
  facing: text('facing').$type<Facing>().notNull(),
  currentAction: text('current_action').notNull(),
  statusIcon: text('status_icon').$type<StatusIcon>().notNull(),
  locationId: text('location_id'),
  path: jsonb('path').$type<{ x: number; y: number }[]>().notNull().default([]),
  awake: boolean('awake').notNull(),
  /** Behaviour bookkeeping needed for an exact resume (target, cooldowns, perception). */
  runtime: jsonb('runtime').$type<AgentRuntime>().notNull(),
  updatedAtGame: integer('updated_at_game').notNull(),
});

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  simId: uuid('sim_id').notNull().references(() => sims.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  type: memoryType('type').notNull(),
  text: text('text').notNull(),
  /** 1–10; null until the batched importance call has scored it. */
  importance: smallint('importance'),
  createdAtGame: integer('created_at_game').notNull(),
  lastAccessedGame: integer('last_accessed_game').notNull(),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
  embeddingModel: text('embedding_model'),
  /** The seeded memory whose rumour this memory carries. */
  seedId: uuid('seed_id').references((): AnyPgColumn => memories.id, { onDelete: 'set null' }),
  sourceRef: jsonb('source_ref').$type<Record<string, unknown>>(),
}, (t) => [
  index('memories_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  index('memories_agent_recent_idx').on(t.simId, t.agentId, t.createdAtGame.desc()),
  index('memories_agent_importance_idx').on(t.simId, t.agentId, t.importance.desc()),
  index('memories_agent_seed_idx').on(t.simId, t.agentId).where(sql`${t.seedId} is not null`),
  check('memories_importance_range', sql`${t.importance} between 1 and 10`),
  check('memories_embedding_model_pair', sql`(${t.embedding} is null) = (${t.embeddingModel} is null)`),
]);

export const memoryEvidence = pgTable('memory_evidence', {
  reflectionId: uuid('reflection_id').notNull().references(() => memories.id, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id').notNull().references(() => memories.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.reflectionId, t.evidenceId] }),
  index('memory_evidence_evidence_idx').on(t.evidenceId),
]);

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  simId: uuid('sim_id').notNull().references(() => sims.id, { onDelete: 'cascade' }),
  day: smallint('day').notNull(),
  blocks: jsonb('blocks').$type<PlanBlock[]>().notNull(),
  createdAtGame: integer('created_at_game').notNull(),
  /** Null = the agent's current plan. Older plans are kept as history. */
  supersededAtGame: integer('superseded_at_game'),
}, (t) => [
  index('plans_agent_created_idx').on(t.agentId, t.createdAtGame),
  uniqueIndex('plans_one_current_uq').on(t.agentId).where(sql`${t.supersededAtGame} is null`),
]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  simId: uuid('sim_id').notNull().references(() => sims.id, { onDelete: 'cascade' }),
  locationId: text('location_id'),
  startedAtGame: integer('started_at_game').notNull(),
  /** Agent ids. An array (not a pair) so group chats need no schema change. */
  participants: uuid('participants').array().notNull(),
}, (t) => [
  index('conversations_sim_started_idx').on(t.simId, t.startedAtGame),
]);

export const conversationLines = pgTable('conversation_lines', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  seq: smallint('seq').notNull(),
  speakerId: uuid('speaker_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
}, (t) => [
  uniqueIndex('conversation_lines_seq_uq').on(t.conversationId, t.seq),
]);

export const events = pgTable('events', {
  /** Identity, so events at the same game minute keep insertion order. */
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  simId: uuid('sim_id').notNull().references(() => sims.id, { onDelete: 'cascade' }),
  atGame: integer('at_game').notNull(),
  kind: text('kind').notNull(),
  text: text('text').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  index('events_sim_at_idx').on(t.simId, t.atGame),
]);

export const snapshots = pgTable('snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  simId: uuid('sim_id').notNull().references(() => sims.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  atGame: integer('at_game').notNull(),
  state: jsonb('state').$type<unknown>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('snapshots_sim_name_uq').on(t.simId, t.name),
]);

export const llmCalls = pgTable('llm_calls', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  simId: uuid('sim_id').notNull().references(() => sims.id, { onDelete: 'cascade' }),
  purpose: llmPurpose('purpose').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  ok: boolean('ok').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('llm_calls_sim_purpose_idx').on(t.simId, t.purpose),
]);

export const retrievalLogs = pgTable('retrieval_logs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  simId: uuid('sim_id').notNull().references(() => sims.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  atGame: integer('at_game').notNull(),
  queryText: text('query_text').notNull(),
  candidateCount: integer('candidate_count').notNull(),
  results: jsonb('results').$type<unknown>().notNull(),
  /** Float: retrieval is often sub-millisecond in memory mode. */
  latencyMs: real('latency_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('retrieval_logs_sim_at_idx').on(t.simId, t.atGame),
]);
