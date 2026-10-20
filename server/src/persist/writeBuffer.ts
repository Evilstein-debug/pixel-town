// Writes made by the sim between flushes. A flush takes the pending writes as one
// batch; if persisting fails the batch goes back in front of newer writes and is
// retried by the next flush. Until then, unsaved memories stay visible to retrieval.
import type { EventRecord, MemoryRecord, PlanRecord, StoredConversation } from '../store/types';

export interface Batch {
  /** New memories, in creation order (a seed always precedes memories citing it). */
  memories: MemoryRecord[];
  /** Importance for memories already in the database. */
  importance: Map<string, number>;
  /** Last-accessed game minute for memories already in the database. */
  touches: Map<string, number>;
  events: EventRecord[];
  conversations: StoredConversation[];
  /** In order; each supersedes its agent's previous plan. */
  plans: PlanRecord[];
}

const emptyBatch = (): Batch => ({
  memories: [], importance: new Map(), touches: new Map(), events: [], conversations: [], plans: [],
});

export class WriteBuffer {
  private pending = emptyBatch();
  private inflight: Batch | null = null;

  addMemory(m: MemoryRecord) {
    this.pending.memories.push(m);
  }

  addEvent(e: EventRecord) {
    this.pending.events.push(e);
  }

  addConversation(c: StoredConversation) {
    this.pending.conversations.push(c);
  }

  addPlan(p: PlanRecord) {
    this.pending.plans.push(p);
  }

  setImportance(id: string, importance: number) {
    const unsaved = this.findUnsaved(id);
    if (unsaved) unsaved.record.importance = importance;
    // An in-flight insert may already have been sent; update again next flush.
    if (!unsaved || unsaved.inflight) this.pending.importance.set(id, importance);
  }

  /** Bump last access for retrieved memories. */
  touch(ids: string[], atGame: number) {
    for (const id of ids) {
      const unsaved = this.findUnsaved(id);
      if (unsaved) unsaved.record.lastAccessedGame = atGame;
      if (!unsaved || unsaved.inflight) this.pending.touches.set(id, atGame);
    }
  }

  /** Unsaved memories (pending and in flight) for an agent: live objects, oldest first. */
  unsavedMemories(agentId: string): MemoryRecord[] {
    return [...(this.inflight?.memories ?? []), ...this.pending.memories].filter((m) => m.agentId === agentId);
  }

  /** A pending last-access bump for a saved memory, if any. */
  touchedAt(id: string): number | undefined {
    return this.pending.touches.get(id) ?? this.inflight?.touches.get(id);
  }

  get isFlushing() {
    return this.inflight !== null;
  }

  /** Moves everything pending into a new in-flight batch. */
  take(): Batch {
    if (this.inflight) throw new Error('a batch is already in flight');
    this.inflight = this.pending;
    this.pending = emptyBatch();
    return this.inflight;
  }

  /** The in-flight batch is persisted. */
  commit() {
    this.inflight = null;
  }

  /** The in-flight batch failed: put it back in front of anything written since. */
  restore() {
    const failed = this.inflight;
    if (!failed) return;
    const newer = this.pending;
    this.pending = {
      memories: [...failed.memories, ...newer.memories],
      importance: new Map([...failed.importance, ...newer.importance]),
      touches: new Map([...failed.touches, ...newer.touches]),
      events: [...failed.events, ...newer.events],
      conversations: [...failed.conversations, ...newer.conversations],
      plans: [...failed.plans, ...newer.plans],
    };
    this.inflight = null;
  }

  private findUnsaved(id: string): { record: MemoryRecord; inflight: boolean } | undefined {
    const p = this.pending.memories.find((m) => m.id === id);
    if (p) return { record: p, inflight: false };
    const f = this.inflight?.memories.find((m) => m.id === id);
    return f ? { record: f, inflight: true } : undefined;
  }
}
