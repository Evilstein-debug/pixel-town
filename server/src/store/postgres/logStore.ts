import { desc, eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { events, llmCalls, retrievalLogs } from '../../db/schema';
import type { LogStore } from '../types';

export function postgresLogStore(db: Executor): LogStore {
  return {
    async appendEvents(rows) {
      if (rows.length) await db.insert(events).values(rows);
    },

    async recentEvents(simId, limit) {
      const rows = await db
        .select({
          simId: events.simId, atGame: events.atGame, kind: events.kind, text: events.text, payload: events.payload,
        })
        .from(events)
        .where(eq(events.simId, simId))
        .orderBy(desc(events.atGame), desc(events.id))
        .limit(limit);
      return rows.reverse();
    },

    async recordLlmCalls(rows) {
      if (rows.length) await db.insert(llmCalls).values(rows);
    },

    async recordRetrievals(rows) {
      if (rows.length) await db.insert(retrievalLogs).values(rows);
    },
  };
}
