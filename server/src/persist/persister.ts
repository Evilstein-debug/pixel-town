// Per-tick write path. Each flush takes the buffered writes, embeds new memories
// in one batch, scores unscored ones with one importance call, and persists it all
// in one transaction. At most one flush runs at a time; writes made meanwhile wait
// for the next. A failed transaction is logged and its batch retried next flush.
// A flush never throws, so the tick loop can't crash on it.
import type { AgentStateRecord, MemoryRecord, SimPatch, Stores } from '../store/types';
import { runPrompt } from '../llm/client';
import { importancePrompt } from '../prompts/importance';
import { embedMissing } from '../sim/memory';
import type { WorldState } from '../sim/types';
import { agentStateRecord, simPatch } from './records';
import type { Batch } from './writeBuffer';

export interface PersisterHooks {
  /** Memories that just got an importance score (before they are written). */
  onScored(world: WorldState, memories: MemoryRecord[]): void;
}

const SUMMARY_EVERY = 50;

export class Persister {
  private running: Promise<void> | null = null;
  private stats = { flushes: 0, failures: 0, totalMs: 0, maxMs: 0 };

  constructor(private stores: Stores, private hooks: PersisterHooks) {}

  /** Starts a flush unless one is running; resolves when the running flush ends. */
  flush(world: WorldState): Promise<void> {
    this.running ??= this.flushOnce(world).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Waits for any running flush, then flushes everything written up to now. */
  async drain(world: WorldState): Promise<void> {
    await this.running;
    await this.flush(world);
  }

  private async flushOnce(world: WorldState) {
    const t0 = Date.now();
    const batch = world.pending.take();
    // State is captured at the same instant as the batch, so after a crash the saved
    // state never includes effects (e.g. a perception) whose memories weren't saved.
    const states = world.agents.map((a) => agentStateRecord(a, world.clock));
    const sim = simPatch(world);
    try {
      await embedMissing(batch.memories);
      await this.scoreImportance(world, batch.memories);
      await this.stores.transaction((tx) => write(tx, world.simId, batch, states, sim));
      world.pending.commit();
      this.record(Date.now() - t0, batch);
    } catch (err) {
      world.pending.restore();
      this.stats.failures++;
      console.warn(`[persist] flush failed (${this.stats.failures} so far), retrying next tick:`, (err as Error).message);
    }
  }

  /** One LLM call for every unscored memory in the batch. */
  private async scoreImportance(world: WorldState, memories: MemoryRecord[]) {
    const unscored = memories.filter((m) => m.importance === null);
    if (!unscored.length) return;
    const name = (id: string) => world.agents.find((a) => a.id === id)?.name ?? 'someone';
    // Short positional ids keep uuids out of the prompt.
    const scores = await runPrompt(importancePrompt, {
      items: unscored.map((m, i) => ({ id: String(i + 1), agentName: name(m.agentId), type: m.type, text: m.text })),
    });
    unscored.forEach((m, i) => {
      m.importance = scores[String(i + 1)] ?? 3;
    });
    this.hooks.onScored(world, unscored);
  }

  private record(ms: number, batch: Batch) {
    const s = this.stats;
    s.flushes++;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    if (ms > 2000) console.warn(`[persist] slow flush: ${ms} ms (${batch.memories.length} memories)`);
    if (s.flushes % SUMMARY_EVERY === 0) {
      console.log(`[persist] ${s.flushes} flushes, avg ${Math.round(s.totalMs / s.flushes)} ms, max ${s.maxMs} ms, ${s.failures} failed`);
    }
  }
}

async function write(tx: Stores, simId: string, b: Batch, states: AgentStateRecord[], sim: SimPatch) {
  await tx.memories.insertMemories(b.memories);
  if (b.importance.size)
    await tx.memories.setImportance([...b.importance].map(([id, importance]) => ({ id, importance })));
  // One UPDATE … WHERE id = ANY($ids) per distinct access time (usually one).
  const byTime = new Map<number, string[]>();
  for (const [id, at] of b.touches) byTime.set(at, [...(byTime.get(at) ?? []), id]);
  for (const [at, ids] of byTime) await tx.memories.touch(ids, at);
  await tx.world.insertConversations(b.conversations);
  await tx.log.appendEvents(b.events);
  await tx.world.insertPlans(b.plans);
  await tx.world.upsertAgentStates(states);
  await tx.world.updateSim(simId, sim);
}
