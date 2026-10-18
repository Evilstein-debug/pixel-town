import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { memories, memoryEvidence } from '../../db/schema';
import type { MemoryRecord, MemoryStore } from '../types';

/** Rows per multi-row INSERT; keeps well under postgres' 65k bind-parameter limit. */
const CHUNK = 500;

const toMemory = (r: typeof memories.$inferSelect): MemoryRecord => r;

export function postgresMemoryStore(db: Executor): MemoryStore {
  return {
    async insertMemories(rows) {
      for (let i = 0; i < rows.length; i += CHUNK) await db.insert(memories).values(rows.slice(i, i + CHUNK));
    },

    async getMemories(ids) {
      if (!ids.length) return [];
      const rows = await db.select().from(memories).where(inArray(memories.id, ids));
      const byId = new Map(rows.map((r) => [r.id, toMemory(r)]));
      return ids.flatMap((id) => byId.get(id) ?? []);
    },

    async listByAgent(simId, agentId, opts = {}) {
      const q = db
        .select()
        .from(memories)
        .where(and(eq(memories.simId, simId), eq(memories.agentId, agentId)))
        .orderBy(desc(memories.createdAtGame));
      const rows = opts.limit === undefined ? await q : await q.limit(opts.limit);
      return rows.map(toMemory);
    },

    async countByAgent(simId) {
      const rows = await db
        .select({ agentId: memories.agentId, n: sql<number>`count(*)::int` })
        .from(memories)
        .where(eq(memories.simId, simId))
        .groupBy(memories.agentId);
      return Object.fromEntries(rows.map((r) => [r.agentId, r.n]));
    },

    async setImportance(updates) {
      if (!updates.length) return;
      // One statement for the whole batch.
      await db.execute(sql`
        update ${memories} as m set importance = v.importance
        from (
          select unnest(${sql.param(updates.map((u) => u.id))}::uuid[]) as id,
                 unnest(${sql.param(updates.map((u) => u.importance))}::smallint[]) as importance
        ) as v
        where m.id = v.id`);
    },

    async touch(ids, atGame) {
      if (!ids.length) return;
      await db
        .update(memories)
        .set({ lastAccessedGame: atGame })
        .where(sql`${memories.id} = any(${sql.param(ids)}::uuid[])`);
    },

    async insertEvidence(links) {
      if (links.length) await db.insert(memoryEvidence).values(links).onConflictDoNothing();
    },

    async evidenceFor(reflectionId) {
      const rows = await db
        .select({ id: memoryEvidence.evidenceId })
        .from(memoryEvidence)
        .where(eq(memoryEvidence.reflectionId, reflectionId));
      return rows.map((r) => r.id);
    },
  };
}
