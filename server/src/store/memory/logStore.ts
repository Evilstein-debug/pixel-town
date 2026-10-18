import type { LogStore } from '../types';
import { ConstraintError, copy, type Db } from './data';

export function memoryLogStore(db: Db): LogStore {
  const t = () => db.t;
  /** Foreign keys, checked for the whole batch before anything is written. */
  const requireRefs = (rows: { simId: string; agentId?: string }[]) => {
    for (const r of rows) {
      if (!t().sims.has(r.simId)) throw new ConstraintError(`unknown sim ${r.simId}`);
      if (r.agentId !== undefined && !t().agents.has(r.agentId)) throw new ConstraintError(`unknown agent ${r.agentId}`);
    }
  };

  return {
    async appendEvents(events) {
      requireRefs(events);
      t().events.push(...events.map(copy));
    },
    async recentEvents(simId, limit) {
      // Stable sort keeps insertion order within a game minute, like the identity column.
      return t().events.filter((e) => e.simId === simId).sort((a, b) => a.atGame - b.atGame).slice(-limit).map(copy);
    },
    async recordLlmCalls(calls) {
      requireRefs(calls);
      t().llmCalls.push(...calls.map(copy));
    },
    async recordRetrievals(logs) {
      requireRefs(logs);
      t().retrievals.push(...logs.map(copy));
    },
  };
}
