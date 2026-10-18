import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { agents, agentState, conversationLines, conversations, plans, sims, snapshots } from '../../db/schema';
import type { AgentRecord, AgentStateRecord, PlanRecord, SimRecord, StoredConversation, WorldStore } from '../types';

type SimRow = typeof sims.$inferSelect;
const toSim = (r: SimRow): SimRecord => r;

type AgentRow = typeof agents.$inferSelect;
const toAgent = ({ createdAt: _createdAt, ...r }: AgentRow): AgentRecord => r;

const toPlan = (r: typeof plans.$inferSelect): PlanRecord => r;

export function postgresWorldStore(db: Executor): WorldStore {
  async function conversationsWithLines(rows: (typeof conversations.$inferSelect)[]): Promise<StoredConversation[]> {
    if (!rows.length) return [];
    const lines = await db
      .select()
      .from(conversationLines)
      .where(inArray(conversationLines.conversationId, rows.map((r) => r.id)))
      .orderBy(asc(conversationLines.seq));
    return rows.map((r) => ({
      ...r,
      lines: lines
        .filter((l) => l.conversationId === r.id)
        .map(({ seq, speakerId, text }) => ({ seq, speakerId, text })),
    }));
  }

  return {
    async createSim(sim) {
      const [row] = await db.insert(sims).values(sim).returning();
      return toSim(row);
    },

    async getSim(id) {
      const [row] = await db.select().from(sims).where(eq(sims.id, id));
      return row ? toSim(row) : null;
    },

    async findSimByImportHash(hash) {
      const [row] = await db.select().from(sims).where(eq(sims.importHash, hash));
      return row ? toSim(row) : null;
    },

    async latestRunningSim() {
      const [row] = await db
        .select()
        .from(sims)
        .where(eq(sims.status, 'running'))
        .orderBy(desc(sims.createdAt))
        .limit(1);
      return row ? toSim(row) : null;
    },

    async updateSim(id, patch) {
      if (!Object.keys(patch).length) return;
      await db.update(sims).set(patch).where(eq(sims.id, id));
    },

    async deleteSim(id) {
      // Every child table cascades from sims.
      await db.delete(sims).where(eq(sims.id, id));
    },

    async insertAgents(rows) {
      if (rows.length) await db.insert(agents).values(rows);
    },

    async listAgents(simId) {
      // Agents inserted together share created_at; slug makes the order deterministic.
      const rows = await db
        .select()
        .from(agents)
        .where(eq(agents.simId, simId))
        .orderBy(asc(agents.createdAt), asc(agents.slug));
      return rows.map(toAgent);
    },

    async upsertAgentStates(states) {
      if (!states.length) return;
      await db
        .insert(agentState)
        .values(states)
        .onConflictDoUpdate({
          target: agentState.agentId,
          set: {
            tileX: sqlExcluded('tile_x'),
            tileY: sqlExcluded('tile_y'),
            facing: sqlExcluded('facing'),
            currentAction: sqlExcluded('current_action'),
            statusIcon: sqlExcluded('status_icon'),
            locationId: sqlExcluded('location_id'),
            path: sqlExcluded('path'),
            awake: sqlExcluded('awake'),
            runtime: sqlExcluded('runtime'),
            updatedAtGame: sqlExcluded('updated_at_game'),
          },
        });
    },

    async listAgentStates(simId) {
      const rows = await db
        .select({ s: agentState })
        .from(agentState)
        .innerJoin(agents, eq(agents.id, agentState.agentId))
        .where(eq(agents.simId, simId));
      return rows.map((r): AgentStateRecord => r.s);
    },

    async insertPlans(rows) {
      if (!rows.length) return;
      await db.transaction(async (tx) => {
        for (const p of rows) {
          await tx
            .update(plans)
            .set({ supersededAtGame: p.createdAtGame })
            .where(and(eq(plans.agentId, p.agentId), isNull(plans.supersededAtGame)));
          await tx.insert(plans).values({ ...p, supersededAtGame: null });
        }
      });
    },

    async currentPlans(simId) {
      const rows = await db
        .select()
        .from(plans)
        .where(and(eq(plans.simId, simId), isNull(plans.supersededAtGame)));
      return rows.map(toPlan);
    },

    async planHistory(agentId) {
      const rows = await db.select().from(plans).where(eq(plans.agentId, agentId)).orderBy(asc(plans.createdAtGame));
      return rows.map(toPlan);
    },

    async insertConversations(rows) {
      if (!rows.length) return;
      await db.transaction(async (tx) => {
        await tx.insert(conversations).values(rows.map(({ lines: _lines, ...c }) => c));
        const lines = rows.flatMap((c) => c.lines.map((l) => ({ conversationId: c.id, ...l })));
        if (lines.length) await tx.insert(conversationLines).values(lines);
      });
    },

    async recentConversations(simId, limit) {
      const rows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.simId, simId))
        .orderBy(desc(conversations.startedAtGame))
        .limit(limit);
      return conversationsWithLines(rows.reverse());
    },

    async saveSnapshot(s) {
      const [row] = await db.insert(snapshots).values(s).returning();
      return row;
    },

    async listSnapshots(simId) {
      return db
        .select({
          id: snapshots.id, simId: snapshots.simId, name: snapshots.name, atGame: snapshots.atGame,
          createdAt: snapshots.createdAt,
        })
        .from(snapshots)
        .where(eq(snapshots.simId, simId))
        .orderBy(desc(snapshots.createdAt), desc(snapshots.atGame));
    },

    async getSnapshot(id) {
      const [row] = await db.select().from(snapshots).where(eq(snapshots.id, id));
      return row ?? null;
    },
  };
}

/** `excluded.<column>` for ON CONFLICT DO UPDATE. */
const sqlExcluded = (column: string) => sql.raw(`excluded.${column}`);
