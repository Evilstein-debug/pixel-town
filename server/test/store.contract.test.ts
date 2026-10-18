// The same suite runs against every store implementation.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Stores } from '../src/store/types';
import { newAgent, newMemory, newSim, storeFactories, vec } from './support/stores';

describe.each(storeFactories)('$name store', (factory) => {
  let stores: Stores;
  const created: string[] = [];

  beforeAll(async () => {
    stores = await factory.create();
  });
  afterEach(async () => {
    for (const id of created.splice(0)) await stores.world.deleteSim(id);
  });
  afterAll(async () => {
    await stores.close();
  });

  /** A sim with two agents, cleaned up after the test. */
  async function setup() {
    const sim = await stores.world.createSim(newSim());
    created.push(sim.id);
    const asha = newAgent(sim.id, 'asha');
    const rohan = newAgent(sim.id, 'rohan');
    await stores.world.insertAgents([asha, rohan]);
    return { sim, asha, rohan };
  }

  describe('sims', () => {
    it('round-trips a sim, including jsonb config and runtime', async () => {
      const input = newSim({ runtime: { lastTalk: { 'a|b': 500 } } });
      const sim = await stores.world.createSim(input);
      created.push(sim.id);
      expect(sim).toMatchObject({ ...input, importHash: null, parentSimId: null, forkedFromSnapshotId: null });
      expect(sim.createdAt).toBeInstanceOf(Date);
      expect(await stores.world.getSim(sim.id)).toEqual(sim);
      expect(await stores.world.getSim(randomUUID())).toBeNull();
    });

    it('applies partial updates', async () => {
      const { sim } = await setup();
      await stores.world.updateSim(sim.id, { gameMinutes: 900, status: 'paused', runtime: { lastTalk: { x: 1 } } });
      expect(await stores.world.getSim(sim.id)).toMatchObject({
        gameMinutes: 900, status: 'paused', runtime: { lastTalk: { x: 1 } }, name: sim.name,
      });
    });

    it('finds the newest running sim', async () => {
      const older = await stores.world.createSim(newSim());
      created.push(older.id);
      const newer = await stores.world.createSim(newSim());
      created.push(newer.id);
      const paused = await stores.world.createSim(newSim({ status: 'paused' }));
      created.push(paused.id);
      expect((await stores.world.latestRunningSim())?.id).toBe(newer.id);
    });

    it('enforces a unique import hash', async () => {
      const hash = `hash-${randomUUID()}`;
      const sim = await stores.world.createSim(newSim({ importHash: hash }));
      created.push(sim.id);
      expect((await stores.world.findSimByImportHash(hash))?.id).toBe(sim.id);
      await expect(stores.world.createSim(newSim({ importHash: hash }))).rejects.toThrow();
    });

    it('deleteSim removes everything that belongs to the sim', async () => {
      const { sim, asha } = await setup();
      const m = newMemory(sim.id, asha.id);
      await stores.memories.insertMemories([m]);
      await stores.log.appendEvents([{ simId: sim.id, atGame: 420, kind: 'log', text: 'hi', payload: {} }]);
      const snap = await stores.world.saveSnapshot({ id: randomUUID(), simId: sim.id, name: 's', atGame: 420, state: {} });
      await stores.world.deleteSim(sim.id);
      expect(await stores.world.getSim(sim.id)).toBeNull();
      expect(await stores.world.listAgents(sim.id)).toEqual([]);
      expect(await stores.memories.getMemories([m.id])).toEqual([]);
      expect(await stores.log.recentEvents(sim.id, 10)).toEqual([]);
      expect(await stores.world.getSnapshot(snap.id)).toBeNull();
    });
  });

  describe('agents', () => {
    it('lists agents in insertion order, then slug', async () => {
      const { sim, asha, rohan } = await setup();
      const meera = newAgent(sim.id, 'meera', { createdBy: 'visitor-1', traits: { curious: true } });
      await stores.world.insertAgents([meera]);
      const listed = await stores.world.listAgents(sim.id);
      expect(listed.map((a) => a.slug)).toEqual(['asha', 'rohan', 'meera']);
      expect(listed[0]).toEqual(asha);
      expect(listed[1]).toEqual(rohan);
      expect(listed[2]).toEqual(meera);
    });

    it('rejects a duplicate slug within a sim', async () => {
      const { sim } = await setup();
      await expect(stores.world.insertAgents([newAgent(sim.id, 'asha')])).rejects.toThrow();
    });

    it('upserts agent state', async () => {
      const { sim, asha } = await setup();
      const state = {
        agentId: asha.id, tileX: 1, tileY: 2, facing: 'down' as const, currentAction: 'Sleeping',
        statusIcon: 'sleep' as const, locationId: 'asha_house', path: [], awake: false,
        runtime: {
          targetLocationId: 'asha_house', planDay: 0, talkingWith: null, talkUntil: 0,
          lastPerceived: { locationId: 'asha_house', nearby: [] }, lastReplanAt: null,
        },
        updatedAtGame: 420,
      };
      await stores.world.upsertAgentStates([state]);
      const moved = { ...state, tileX: 9, path: [{ x: 10, y: 2 }], awake: true, updatedAtGame: 430 };
      await stores.world.upsertAgentStates([moved]);
      expect(await stores.world.listAgentStates(sim.id)).toEqual([moved]);
    });
  });

  describe('memories', () => {
    it('round-trips memories with float4 embeddings, nullable importance and seed links', async () => {
      const { sim, asha, rohan } = await setup();
      const seed = newMemory(sim.id, asha.id, { type: 'seeded', importance: 8, embedding: vec(2) });
      const heard = newMemory(sim.id, rohan.id, {
        type: 'conversation', importance: null, seedId: seed.id, sourceRef: { conversationId: 'c1' },
        embedding: null, embeddingModel: null,
      });
      // The seed and the memory citing it arrive in the same batch.
      await stores.memories.insertMemories([seed, heard]);
      const [s, h] = await stores.memories.getMemories([seed.id, heard.id]);
      expect(h).toEqual(heard);
      expect({ ...s, embedding: null }).toEqual({ ...seed, embedding: null });
      expect(s.embedding).toHaveLength(384);
      s.embedding!.forEach((x, i) => expect(x).toBeCloseTo(seed.embedding![i], 6));
    });

    it('returns float4 values the way pgvector prints them', async () => {
      const { sim, asha } = await setup();
      const embedding = vec(3);
      embedding[0] = 0.123456789;
      embedding[1] = 0.1234;
      const m = newMemory(sim.id, asha.id, { embedding });
      await stores.memories.insertMemories([m]);
      const [back] = await stores.memories.getMemories([m.id]);
      expect(back.embedding!.slice(0, 2)).toEqual([0.12345679, 0.1234]);
    });

    it('enforces memory constraints', async () => {
      const { sim, asha } = await setup();
      await expect(stores.memories.insertMemories([newMemory(sim.id, asha.id, { importance: 11 })])).rejects.toThrow();
      await expect(stores.memories.insertMemories([newMemory(sim.id, asha.id, { embeddingModel: null })])).rejects.toThrow();
      await expect(stores.memories.insertMemories([newMemory(sim.id, asha.id, { embedding: [1, 2, 3] })])).rejects.toThrow();
      await expect(stores.memories.insertMemories([newMemory(sim.id, asha.id, { seedId: randomUUID() })])).rejects.toThrow();
      await expect(stores.memories.insertMemories([newMemory(sim.id, randomUUID())])).rejects.toThrow();
    });

    it('lists newest first, limits, and counts per agent', async () => {
      const { sim, asha, rohan } = await setup();
      const rows = [430, 450, 440].map((t) => newMemory(sim.id, asha.id, { createdAtGame: t, text: `at ${t}` }));
      await stores.memories.insertMemories([...rows, newMemory(sim.id, rohan.id)]);
      const listed = await stores.memories.listByAgent(sim.id, asha.id);
      expect(listed.map((m) => m.createdAtGame)).toEqual([450, 440, 430]);
      expect((await stores.memories.listByAgent(sim.id, asha.id, { limit: 2 })).map((m) => m.createdAtGame)).toEqual([450, 440]);
      expect(await stores.memories.countByAgent(sim.id)).toEqual({ [asha.id]: 3, [rohan.id]: 1 });
    });

    it('sets importance and bumps last access in batches', async () => {
      const { sim, asha } = await setup();
      const [a, b, c] = [1, 2, 3].map(() => newMemory(sim.id, asha.id, { importance: null }));
      await stores.memories.insertMemories([a, b, c]);
      await stores.memories.setImportance([{ id: a.id, importance: 2 }, { id: b.id, importance: 9 }]);
      await stores.memories.touch([a.id, c.id], 777);
      const [ra, rb, rc] = await stores.memories.getMemories([a.id, b.id, c.id]);
      expect([ra.importance, rb.importance, rc.importance]).toEqual([2, 9, null]);
      expect([ra.lastAccessedGame, rb.lastAccessedGame, rc.lastAccessedGame]).toEqual([777, 420, 777]);
      await stores.memories.touch([], 900);
      await stores.memories.setImportance([]);
    });

    it('links reflections to evidence', async () => {
      const { sim, asha } = await setup();
      const e1 = newMemory(sim.id, asha.id);
      const e2 = newMemory(sim.id, asha.id);
      const r = newMemory(sim.id, asha.id, { type: 'reflection', importance: 6 });
      await stores.memories.insertMemories([e1, e2, r]);
      await stores.memories.insertEvidence([{ reflectionId: r.id, evidenceId: e1.id }, { reflectionId: r.id, evidenceId: e2.id }]);
      await stores.memories.insertEvidence([{ reflectionId: r.id, evidenceId: e1.id }]); // duplicate is ignored
      expect((await stores.memories.evidenceFor(r.id)).sort()).toEqual([e1.id, e2.id].sort());
    });
  });

  describe('plans', () => {
    it('keeps history: each new plan supersedes the current one', async () => {
      const { sim, asha, rohan } = await setup();
      const block = { start: '07:00', end: '22:00', locationId: 'cafe', activity: 'Work' };
      const p1 = { id: randomUUID(), simId: sim.id, agentId: asha.id, day: 1, blocks: [block], createdAtGame: 420, supersededAtGame: null };
      const p2 = { ...p1, id: randomUUID(), blocks: [{ ...block, priority: true }], createdAtGame: 600 };
      const p3 = { ...p1, id: randomUUID(), agentId: rohan.id };
      await stores.world.insertPlans([p1]);
      await stores.world.insertPlans([p2, p3]);
      const current = await stores.world.currentPlans(sim.id);
      expect(current.map((p) => p.id).sort()).toEqual([p2.id, p3.id].sort());
      const history = await stores.world.planHistory(asha.id);
      expect(history).toEqual([{ ...p1, supersededAtGame: 600 }, p2]);
    });

    it('handles two plans for one agent in a single batch', async () => {
      const { sim, asha } = await setup();
      const base = { simId: sim.id, agentId: asha.id, day: 1, blocks: [], supersededAtGame: null };
      await stores.world.insertPlans([
        { ...base, id: randomUUID(), createdAtGame: 420 },
        { ...base, id: randomUUID(), createdAtGame: 430 },
      ]);
      const history = await stores.world.planHistory(asha.id);
      expect(history.map((p) => p.supersededAtGame)).toEqual([430, null]);
    });
  });

  describe('conversations, events, snapshots, logs', () => {
    it('stores conversations with ordered lines and returns the newest N oldest-first', async () => {
      const { sim, asha, rohan } = await setup();
      const convo = (t: number) => ({
        id: randomUUID(), simId: sim.id, locationId: 'cafe', startedAtGame: t, participants: [asha.id, rohan.id],
        lines: [
          { seq: 1, speakerId: rohan.id, text: `reply ${t}` },
          { seq: 0, speakerId: asha.id, text: `hello ${t}` },
        ],
      });
      const [c1, c2, c3] = [500, 600, 700].map(convo);
      await stores.world.insertConversations([c1, c2]);
      await stores.world.insertConversations([c3]);
      const recent = await stores.world.recentConversations(sim.id, 2);
      expect(recent.map((c) => c.startedAtGame)).toEqual([600, 700]);
      expect(recent[1].lines.map((l) => l.text)).toEqual(['hello 700', 'reply 700']);
      expect(recent[1]).toMatchObject({ id: c3.id, participants: [asha.id, rohan.id], locationId: 'cafe' });
    });

    it('keeps event order within the same game minute', async () => {
      const { sim } = await setup();
      const ev = (atGame: number, text: string) => ({ simId: sim.id, atGame, kind: 'log', text, payload: { text } });
      await stores.log.appendEvents([ev(500, 'a'), ev(500, 'b'), ev(400, 'early')]);
      await stores.log.appendEvents([ev(500, 'c')]);
      expect((await stores.log.recentEvents(sim.id, 10)).map((e) => e.text)).toEqual(['early', 'a', 'b', 'c']);
      expect((await stores.log.recentEvents(sim.id, 2)).map((e) => e.text)).toEqual(['b', 'c']);
    });

    it('saves, lists and loads snapshots; names are unique per sim', async () => {
      const { sim } = await setup();
      const state = { agents: [{ id: 'x', plan: [] }], clock: 500 };
      const s1 = await stores.world.saveSnapshot({ id: randomUUID(), simId: sim.id, name: 'first', atGame: 500, state });
      await stores.world.saveSnapshot({ id: randomUUID(), simId: sim.id, name: 'second', atGame: 600, state: {} });
      const listed = await stores.world.listSnapshots(sim.id);
      expect(listed.map((s) => s.name)).toEqual(['second', 'first']);
      expect(listed[0]).not.toHaveProperty('state');
      expect((await stores.world.getSnapshot(s1.id))?.state).toEqual(state);
      await expect(
        stores.world.saveSnapshot({ id: randomUUID(), simId: sim.id, name: 'first', atGame: 700, state: {} }),
      ).rejects.toThrow();
    });

    it('records llm calls and retrieval logs', async () => {
      const { sim, asha } = await setup();
      await stores.log.recordLlmCalls([{
        simId: sim.id, purpose: 'importance', model: 'mock', inputTokens: 0, outputTokens: 0, latencyMs: 3, ok: true,
      }]);
      await stores.log.recordRetrievals([{
        simId: sim.id, agentId: asha.id, atGame: 420, queryText: 'q', candidateCount: 5, results: [], latencyMs: 0.4,
      }]);
    });
  });

  describe('transactions', () => {
    it('commits all writes together', async () => {
      const sim = newSim();
      await stores.transaction(async (tx) => {
        await tx.world.createSim(sim);
        await tx.world.insertAgents([newAgent(sim.id, 'asha')]);
      });
      created.push(sim.id);
      expect(await stores.world.listAgents(sim.id)).toHaveLength(1);
    });

    it('rolls back every write when the callback throws', async () => {
      const sim = newSim();
      await expect(stores.transaction(async (tx) => {
        await tx.world.createSim(sim);
        await tx.world.insertAgents([newAgent(sim.id, 'asha')]);
        throw new Error('boom');
      })).rejects.toThrow('boom');
      expect(await stores.world.getSim(sim.id)).toBeNull();
    });

    it('rolls back when a constraint fails mid-transaction', async () => {
      const sim = newSim();
      await expect(stores.transaction(async (tx) => {
        await tx.world.createSim(sim);
        await tx.world.insertAgents([newAgent(sim.id, 'asha'), newAgent(sim.id, 'asha')]);
      })).rejects.toThrow();
      expect(await stores.world.getSim(sim.id)).toBeNull();
    });
  });
});
