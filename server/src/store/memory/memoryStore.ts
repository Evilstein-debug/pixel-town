import type { MemoryRecord, MemoryStore } from '../types';
import { checkMemory, ConstraintError, copy, toFloat32, type Db } from './data';

export function memoryMemoryStore(db: Db): MemoryStore {
  const t = () => db.t;

  return {
    async insertMemories(memories: MemoryRecord[]) {
      const batch = new Set(memories.map((m) => m.id));
      for (const m of memories) {
        checkMemory(m, t());
        if (t().memories.has(m.id)) throw new ConstraintError(`memory ${m.id} already exists`);
        if (m.seedId && !t().memories.has(m.seedId) && !batch.has(m.seedId))
          throw new ConstraintError(`memory ${m.id}: unknown seed ${m.seedId}`);
      }
      for (const m of memories) t().memories.set(m.id, { ...copy(m), embedding: toFloat32(m.embedding) });
    },

    async getMemories(ids) {
      return ids.flatMap((id) => {
        const m = t().memories.get(id);
        return m ? [copy(m)] : [];
      });
    },

    async listByAgent(simId, agentId, opts = {}) {
      const rows = [...t().memories.values()]
        .filter((m) => m.simId === simId && m.agentId === agentId)
        .sort((a, b) => b.createdAtGame - a.createdAtGame);
      return (opts.limit === undefined ? rows : rows.slice(0, opts.limit)).map(copy);
    },

    async countByAgent(simId) {
      const out: Record<string, number> = {};
      for (const m of t().memories.values()) if (m.simId === simId) out[m.agentId] = (out[m.agentId] ?? 0) + 1;
      return out;
    },

    async setImportance(updates) {
      for (const { id, importance } of updates) {
        const m = t().memories.get(id);
        if (!m) continue;
        checkMemory({ ...m, importance }, t());
        m.importance = importance;
      }
    },

    async touch(ids, atGame) {
      for (const id of ids) {
        const m = t().memories.get(id);
        if (m) m.lastAccessedGame = atGame;
      }
    },

    async insertEvidence(links) {
      for (const l of links) {
        if (!t().memories.has(l.reflectionId) || !t().memories.has(l.evidenceId))
          throw new ConstraintError(`evidence link ${l.reflectionId} → ${l.evidenceId} references a missing memory`);
        if (!t().evidence.some((e) => e.reflectionId === l.reflectionId && e.evidenceId === l.evidenceId))
          t().evidence.push({ ...l });
      }
    },

    async evidenceFor(reflectionId) {
      return t().evidence.filter((e) => e.reflectionId === reflectionId).map((e) => e.evidenceId);
    },

    async listEvidence(simId) {
      return t().evidence.filter((e) => t().memories.get(e.reflectionId)?.simId === simId).map(copy);
    },

    async listSeeded(simId) {
      return [...t().memories.values()].filter((m) => m.simId === simId && m.type === 'seeded').map(copy);
    },

    async rumourLinks(simId) {
      const seen = new Map<string, { agentId: string; seedId: string }>();
      for (const m of t().memories.values())
        if (m.simId === simId && m.seedId) seen.set(`${m.agentId}|${m.seedId}`, { agentId: m.agentId, seedId: m.seedId });
      return [...seen.values()];
    },
  };
}
