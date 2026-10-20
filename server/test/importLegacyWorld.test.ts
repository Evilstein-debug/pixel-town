import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDING_MODEL } from '../src/config/embedding';
import {
  countSim, countsOf, DuplicateImportError, hashFile, legacyWorldSchema, planLegacyImport, writeImport,
  type LegacyWorld,
} from '../src/setup/importLegacyWorld';
import { pairKey } from '../src/sim/types';
import type { Stores } from '../src/store/types';
import { storeFactories, vec } from './support/stores';

/** A legacy world in the exact shape the old server wrote to world.json. */
function legacyWorld(): LegacyWorld {
  const agent = (id: string, homeId: string, tileX: number, tileY: number) => ({
    id, name: id[0].toUpperCase() + id.slice(1), age: 30, occupation: 'Tester', bio: `${id} bio`,
    relationships: '', homeId, appearance: { shirt: '#000000', hair: '#111111', skin: '#222222', pants: '#333333' },
    tileX, tileY, facing: 'down', path: [], stepMs: 0, targetLocationId: homeId, action: 'Sleeping', plan: [] as unknown[],
    planDay: 0, asleep: true, talkingWith: null, talkUntil: 0, busy: false,
    lastPerceived: { locationId: homeId, nearby: [] as string[] }, lastReplanAt: -Infinity,
  });
  const asha = agent('asha', 'asha_house', 5, 4);
  asha.plan = [{ start: '07:00', end: '22:00', locationId: 'cafe', activity: 'Run the café', priority: true }];
  asha.planDay = 1;
  asha.asleep = false;
  asha.lastPerceived.nearby = ['meera'];
  const w = {
    version: 1, clock: 900, paused: false, speed: 1,
    agents: [asha, agent('rohan', 'rohan_house', 34, 4), agent('meera', 'meera_house', 5, 24)],
    memories: [
      { id: 'm1', agentId: 'asha', createdAt: 500, lastAccessed: 520, type: 'seeded', text: 'free samosas at 3pm', importance: 8, embedding: vec(1), seedId: 'm1' },
      { id: 'm2', agentId: 'meera', createdAt: 600, lastAccessed: 600, type: 'conversation', text: 'Asha said free samosas', importance: 0, embedding: [], seedId: 'm1' },
      { id: 'm3', agentId: 'rohan', createdAt: 610, lastAccessed: 610, type: 'observation', text: 'Arrived at the library.', importance: 2, embedding: [0.1, 0.2] },
      { id: 'm4', agentId: 'rohan', createdAt: 620, lastAccessed: 620, type: 'plan', text: 'Plan', importance: 3, embedding: vec(4), seedId: 'gone' },
    ],
    log: [{ ts: 420, text: 'Simulation started' }, { ts: 590, text: 'Asha and Meera are chatting' }],
    conversations: [{
      id: 'c5', participants: ['asha', 'meera'], ts: 590, locationId: 'cafe',
      lines: [{ speakerId: 'asha', text: 'Samosas!' }, { speakerId: 'meera', text: 'Lovely.' }],
    }],
    lastTalk: { [pairKey('asha', 'meera')]: 610 },
    seq: 5,
  };
  // Round-trip through JSON like the real file (-Infinity becomes null).
  return legacyWorldSchema.parse(JSON.parse(JSON.stringify(w)));
}

const fakeEmbed = async (text: string) => (text.includes('Arrived') ? vec(9) : []);

describe('legacy world mapping', () => {
  it('maps agents, memories, plans, conversations and events with fresh ids', async () => {
    const world = legacyWorld();
    const plan = await planLegacyImport(world, { name: 'imp', importHash: 'h', embed: fakeEmbed });
    const bySlug = new Map(plan.agents.map((a) => [a.slug, a.id]));

    expect(countsOf(plan)).toEqual({
      agents: 3, agentStates: 3, memories: 4, plans: 1, conversations: 1, conversationLines: 2, events: 2,
    });
    expect(plan.sim).toMatchObject({ gameMinutes: 900, status: 'running', importHash: 'h' });
    expect(plan.sim.runtime.lastTalk).toEqual({ [pairKey(bySlug.get('asha')!, bySlug.get('meera')!)]: 610 });

    const asha = plan.states.find((s) => s.agentId === bySlug.get('asha'))!;
    expect(asha).toMatchObject({ awake: true, statusIcon: 'none', runtime: { planDay: 1, lastReplanAt: null } });
    expect(asha.runtime.lastPerceived.nearby).toEqual([bySlug.get('meera')]);

    const [seed, heard, observed, planned] = plan.memories;
    expect(seed).toMatchObject({ type: 'seeded', importance: 8, embeddingModel: EMBEDDING_MODEL, sourceRef: { legacyId: 'm1' } });
    expect(seed.seedId).toBe(seed.id);
    // Unscored (0) becomes null; a missing embedding the model can't produce stays null.
    expect(heard).toMatchObject({ importance: null, embedding: null, embeddingModel: null, seedId: seed.id });
    // A wrong-size embedding is re-embedded.
    expect(observed.embedding).toEqual(vec(9));
    // A seed reference to a memory that isn't in the file is dropped.
    expect(planned.seedId).toBeNull();
    expect(plan.stats).toEqual({ reembedded: 1, unembedded: 1, droppedSeedRefs: 1 });

    expect(plan.plans[0]).toMatchObject({ agentId: bySlug.get('asha'), day: 1, createdAtGame: 900 });
    expect(plan.conversations[0].lines.map((l) => l.seq)).toEqual([0, 1]);
    expect(plan.events.map((e) => e.kind)).toEqual(['log', 'log']);
  });

  it('rejects a file that references an unknown agent', async () => {
    const world = legacyWorld();
    world.memories[0].agentId = 'nobody';
    await expect(planLegacyImport(world, { name: 'x', importHash: 'h', embed: fakeEmbed })).rejects.toThrow(/nobody/);
  });
});

describe.each(storeFactories)('legacy import into $name store', (factory) => {
  let stores: Stores;
  const created: string[] = [];
  beforeAll(async () => {
    stores = await factory.create();
  });
  afterAll(async () => {
    for (const id of created) await stores.world.deleteSim(id);
    await stores.close();
  });

  it('writes everything, and the stored counts match the reported ones', async () => {
    const contents = JSON.stringify(legacyWorld());
    const plan = await planLegacyImport(legacyWorld(), { name: 'imp', importHash: hashFile(contents + Math.random()), embed: fakeEmbed });
    const simId = await writeImport(stores, plan);
    created.push(simId);
    expect(await countSim(stores, simId)).toEqual(countsOf(plan));
    const agents = await stores.world.listAgents(simId);
    // Agents written in one batch come back in slug order.
    expect(agents.map((a) => a.slug)).toEqual(['asha', 'meera', 'rohan']);
  });

  it('refuses to import the same file twice and writes nothing the second time', async () => {
    const hash = hashFile(`dup-${Math.random()}`);
    const first = await planLegacyImport(legacyWorld(), { name: 'a', importHash: hash, embed: fakeEmbed });
    created.push(await writeImport(stores, first));
    const second = await planLegacyImport(legacyWorld(), { name: 'b', importHash: hash, embed: fakeEmbed });
    await expect(writeImport(stores, second)).rejects.toBeInstanceOf(DuplicateImportError);
    expect(await stores.world.getSim(second.sim.id)).toBeNull();
  });

  it('is all-or-nothing when a write fails part-way', async () => {
    const plan = await planLegacyImport(legacyWorld(), { name: 'c', importHash: hashFile(`bad-${Math.random()}`), embed: fakeEmbed });
    plan.events[1] = { ...plan.events[1], simId: '00000000-0000-0000-0000-000000000000' };
    await expect(writeImport(stores, plan)).rejects.toThrow();
    expect(await stores.world.getSim(plan.sim.id)).toBeNull();
  });
});
