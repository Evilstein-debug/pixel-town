// In-process tables for the memory store. Mirrors the postgres constraints that
// the sim relies on, so both stores pass the same contract tests.
import { EMBEDDING_DIMENSIONS } from '../../config/embedding';
import type {
  AgentRecord, AgentStateRecord, EventRecord, LlmCallRecord, MemoryRecord, PlanRecord, RetrievalLogRecord,
  SimRecord, SnapshotRecord, StoredConversation,
} from '../types';

export interface Tables {
  sims: Map<string, SimRecord>;
  agents: Map<string, AgentRecord>;
  agentStates: Map<string, AgentStateRecord>;
  memories: Map<string, MemoryRecord>;
  evidence: { reflectionId: string; evidenceId: string }[];
  plans: PlanRecord[];
  conversations: StoredConversation[];
  events: EventRecord[];
  snapshots: Map<string, SnapshotRecord>;
  llmCalls: LlmCallRecord[];
  retrievals: RetrievalLogRecord[];
}

export const emptyTables = (): Tables => ({
  sims: new Map(), agents: new Map(), agentStates: new Map(), memories: new Map(), evidence: [], plans: [],
  conversations: [], events: [], snapshots: new Map(), llmCalls: [], retrievals: [],
});

/** Mutable handle so a failed transaction can swap the tables back. */
export interface Db { t: Tables }

/** Copies in and out, like a database round trip, so callers can't alias stored rows. */
export const copy = <T>(v: T): T => structuredClone(v);

export class ConstraintError extends Error {}

export function checkMemory(m: MemoryRecord, t: Tables) {
  if (!t.sims.has(m.simId)) throw new ConstraintError(`memory ${m.id}: unknown sim ${m.simId}`);
  if (!t.agents.has(m.agentId)) throw new ConstraintError(`memory ${m.id}: unknown agent ${m.agentId}`);
  if (m.importance !== null && (m.importance < 1 || m.importance > 10))
    throw new ConstraintError(`memory ${m.id}: importance ${m.importance} outside 1–10`);
  if ((m.embedding === null) !== (m.embeddingModel === null))
    throw new ConstraintError(`memory ${m.id}: embedding and embedding_model must be set together`);
  if (m.embedding && m.embedding.length !== EMBEDDING_DIMENSIONS)
    throw new ConstraintError(`memory ${m.id}: expected ${EMBEDDING_DIMENSIONS} dimensions, not ${m.embedding.length}`);
}

/** Shortest decimal that round-trips through float4, which is what pgvector prints. */
function float4(x: number): number {
  const f = Math.fround(x);
  for (let p = 1; p < 9; p++) {
    const d = Number(f.toPrecision(p));
    if (Math.fround(d) === f) return d;
  }
  return Number(f.toPrecision(9));
}

/** pgvector stores float4; round the same way so both stores return equal vectors. */
export const toFloat32 = (v: number[] | null) => (v ? v.map(float4) : null);
