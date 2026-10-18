import type {
  AgentRecord, AgentStateRecord, NewSim, PlanRecord, SimPatch, SimRecord, SnapshotRecord, StoredConversation, WorldStore,
} from '../types';
import { ConstraintError, copy, type Db } from './data';

export function memoryWorldStore(db: Db): WorldStore {
  const t = () => db.t;
  /** Insert call number per agent: postgres orders by created_at, then slug. */
  let insertCalls = 0;
  const insertedIn = new Map<string, number>();
  const requireSim = (id: string) => {
    if (!t().sims.has(id)) throw new ConstraintError(`unknown sim ${id}`);
  };
  const requireAgent = (id: string) => {
    if (!t().agents.has(id)) throw new ConstraintError(`unknown agent ${id}`);
  };

  return {
    async createSim(sim: NewSim) {
      if (sim.importHash && [...t().sims.values()].some((s) => s.importHash === sim.importHash))
        throw new ConstraintError(`a sim with import hash ${sim.importHash} already exists`);
      const row: SimRecord = {
        importHash: null, parentSimId: null, forkedFromSnapshotId: null, ...copy(sim), createdAt: new Date(),
      };
      t().sims.set(row.id, row);
      return copy(row);
    },

    async getSim(id) {
      const s = t().sims.get(id);
      return s ? copy(s) : null;
    },

    async findSimByImportHash(hash) {
      const s = [...t().sims.values()].find((x) => x.importHash === hash);
      return s ? copy(s) : null;
    },

    async latestRunningSim() {
      // Map order is insertion order, so the last running sim is the newest.
      const s = [...t().sims.values()].filter((x) => x.status === 'running').at(-1);
      return s ? copy(s) : null;
    },

    async updateSim(id, patch: SimPatch) {
      const s = t().sims.get(id);
      if (s) Object.assign(s, copy(patch));
    },

    async deleteSim(id) {
      const tb = t();
      const agentIds = new Set([...tb.agents.values()].filter((a) => a.simId === id).map((a) => a.id));
      const memoryIds = new Set([...tb.memories.values()].filter((m) => m.simId === id).map((m) => m.id));
      tb.sims.delete(id);
      for (const a of agentIds) { tb.agents.delete(a); tb.agentStates.delete(a); }
      for (const m of memoryIds) tb.memories.delete(m);
      tb.evidence = tb.evidence.filter((e) => !memoryIds.has(e.reflectionId) && !memoryIds.has(e.evidenceId));
      tb.plans = tb.plans.filter((p) => p.simId !== id);
      tb.conversations = tb.conversations.filter((c) => c.simId !== id);
      tb.events = tb.events.filter((e) => e.simId !== id);
      for (const [k, s] of tb.snapshots) if (s.simId === id) tb.snapshots.delete(k);
      tb.llmCalls = tb.llmCalls.filter((c) => c.simId !== id);
      tb.retrievals = tb.retrievals.filter((r) => r.simId !== id);
      for (const s of tb.sims.values()) if (s.parentSimId === id) s.parentSimId = null;
    },

    async insertAgents(agents: AgentRecord[]) {
      // Validate the whole batch first: like one INSERT statement, it lands entirely or not at all.
      const existing = [...t().agents.values()];
      agents.forEach((a, i) => {
        requireSim(a.simId);
        if ([...existing, ...agents.slice(0, i)].some((x) => x.simId === a.simId && x.slug === a.slug))
          throw new ConstraintError(`agent slug '${a.slug}' already exists in sim ${a.simId}`);
      });
      insertCalls++;
      for (const a of agents) {
        t().agents.set(a.id, copy(a));
        insertedIn.set(a.id, insertCalls);
      }
    },

    async listAgents(simId) {
      return [...t().agents.values()]
        .filter((a) => a.simId === simId)
        .sort((a, b) => (insertedIn.get(a.id) ?? 0) - (insertedIn.get(b.id) ?? 0) || a.slug.localeCompare(b.slug))
        .map(copy);
    },

    async upsertAgentStates(states: AgentStateRecord[]) {
      for (const s of states) {
        requireAgent(s.agentId);
        t().agentStates.set(s.agentId, copy(s));
      }
    },

    async listAgentStates(simId) {
      return [...t().agentStates.values()].filter((s) => t().agents.get(s.agentId)?.simId === simId).map(copy);
    },

    async insertPlans(plans: PlanRecord[]) {
      for (const p of plans) {
        requireSim(p.simId);
        requireAgent(p.agentId);
        for (const old of t().plans)
          if (old.agentId === p.agentId && old.supersededAtGame === null) old.supersededAtGame = p.createdAtGame;
        t().plans.push({ ...copy(p), supersededAtGame: null });
      }
    },

    async currentPlans(simId) {
      return t().plans.filter((p) => p.simId === simId && p.supersededAtGame === null).map(copy);
    },

    async planHistory(agentId) {
      return t().plans.filter((p) => p.agentId === agentId).map(copy);
    },

    async insertConversations(conversations: StoredConversation[]) {
      for (const c of conversations) {
        requireSim(c.simId);
        for (const l of c.lines) requireAgent(l.speakerId);
        t().conversations.push({ ...copy(c), lines: [...c.lines].sort((a, b) => a.seq - b.seq).map(copy) });
      }
    },

    async recentConversations(simId, limit) {
      const all = t().conversations
        .filter((c) => c.simId === simId)
        .sort((a, b) => a.startedAtGame - b.startedAtGame);
      return all.slice(-limit).map(copy);
    },

    async saveSnapshot(s) {
      requireSim(s.simId);
      if ([...t().snapshots.values()].some((x) => x.simId === s.simId && x.name === s.name))
        throw new ConstraintError(`snapshot '${s.name}' already exists in sim ${s.simId}`);
      const row: SnapshotRecord = { ...copy(s), createdAt: new Date() };
      t().snapshots.set(row.id, row);
      return copy(row);
    },

    async listSnapshots(simId) {
      return [...t().snapshots.values()]
        .filter((s) => s.simId === simId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.atGame - a.atGame)
        .map(({ state: _state, ...rest }) => copy(rest));
    },

    async getSnapshot(id) {
      const s = t().snapshots.get(id);
      return s ? copy(s) : null;
    },
  };
}
