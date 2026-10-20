// Runs the real sim headless (mock LLM, ticks stepped by hand) against each store,
// then checks that a restart resumes exactly and that restoring a snapshot forks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorld } from '../src/persist/loadWorld';
import { FRESH_START_SNAPSHOT, listLineageSnapshots } from '../src/persist/snapshots';
import { seedDefaultSim } from '../src/setup/seedSim';
import type { IO } from '../src/sim/context';
import { Sim } from '../src/sim/sim';
import { dayOf, TICK_REAL_MS } from '../src/sim/time';
import type { WorldState } from '../src/sim/types';
import type { Stores } from '../src/store/types';
import { storeFactories } from './support/stores';

const io = { emit: () => true } as unknown as IO;

/**
 * Lets work started by a tick finish before the next one: plans and chats keep an
 * agent busy across store round trips (hundreds of ms against a remote database).
 */
async function settle(sim: Sim) {
  const deadline = Date.now() + 20_000;
  do {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    if (!sim.world.agents.some((a) => a.busy)) return;
    await new Promise((r) => setTimeout(r, 10));
  } while (Date.now() < deadline);
  throw new Error('agents still busy after 20 s');
}

/** Steps like the real loops: a tick's worth of walking, then the tick. */
async function run(sim: Sim, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    sim.walk(TICK_REAL_MS);
    sim.tick();
    await settle(sim);
  }
  await sim.drain();
}

/** Everything a resume must reproduce (a deep copy; the live world keeps changing). */
const fingerprint = (w: WorldState) => structuredClone({
  clock: w.clock,
  paused: w.paused,
  lastTalk: w.lastTalk,
  // Order within an agent's rumour list carries no meaning (and isn't preserved by SQL).
  rumours: Object.fromEntries(Object.entries(w.rumours).map(([k, v]) => [k, [...v].sort()])),
  seeds: Object.keys(w.seeds).sort(),
  agents: w.agents.map((a) => ({
    id: a.id, tileX: a.tileX, tileY: a.tileY, facing: a.facing, path: a.path, action: a.action, plan: a.plan,
    planDay: a.planDay, asleep: a.asleep, talkingWith: a.talkingWith, talkUntil: a.talkUntil,
    targetLocationId: a.targetLocationId, lastPerceived: a.lastPerceived, lastReplanAt: a.lastReplanAt,
  })),
});

/** The same, with agent ids replaced by slugs and seeds by their text, to compare across a fork. */
function portable(w: WorldState) {
  const slug = (id: string | null) => w.agents.find((a) => a.id === id)?.slug ?? id;
  const f = fingerprint(w);
  return {
    ...f,
    lastTalk: Object.fromEntries(Object.entries(f.lastTalk).map(([k, v]) => [k.split('|').map(slug).sort().join('|'), v])),
    rumours: Object.fromEntries(Object.entries(f.rumours).map(([k, v]) => [slug(k), v.map((id) => w.seeds[id].text)])),
    seeds: Object.values(w.seeds).map((x) => x.text).sort(),
    agents: f.agents.map(({ id, talkingWith, lastPerceived, ...a }) => ({
      ...a, slug: slug(id), talkingWith: slug(talkingWith),
      lastPerceived: { ...lastPerceived, nearby: lastPerceived.nearby.map(slug) },
    })),
  };
}

async function memoryCount(stores: Stores, simId: string) {
  return Object.values(await stores.memories.countByAgent(simId)).reduce((a, b) => a + b, 0);
}

describe.each(storeFactories)('sim persistence on $name store', (factory) => {
  let stores: Stores;
  const sims: string[] = [];
  beforeAll(async () => {
    stores = await factory.create();
  });
  afterAll(async () => {
    for (const id of sims) await stores.world.deleteSim(id);
    await stores.close();
  });

  it('persists a morning with a seeded rumour, and a restart resumes exactly', async () => {
    const { sim: row } = await seedDefaultSim(stores);
    sims.push(row.id);
    const sim = new Sim(await loadWorld(stores, row.id), io, stores);
    const [asha, rohan, meera] = sim.world.agents;

    await run(sim, 9); // 07:00 → 08:30
    await sim.seed(asha.id, 'free samosas at the café at 3pm');
    await run(sim, 36); // → 14:30
    expect(sim.world.clock).toBe(14 * 60 + 30);

    // The rumour spread by conversation, and everything landed in the store.
    const seedId = Object.keys(sim.world.seeds)[0];
    const told = [rohan, meera].filter((a) => sim.world.rumours[a.id]?.includes(seedId));
    expect(told.length).toBeGreaterThan(0);
    expect(await memoryCount(stores, row.id)).toBeGreaterThan(20);
    expect((await stores.world.recentConversations(row.id, 100)).length).toBeGreaterThan(0);
    expect((await stores.world.planHistory(asha.id)).length).toBeGreaterThan(1); // daily plan + priority replan
    const kinds = new Set((await stores.log.recentEvents(row.id, 1000)).map((e) => e.kind));
    expect([...kinds]).toEqual(expect.arrayContaining(['plan', 'seed', 'priority', 'talk', 'told']));
    expect(sim.world.pending.unsavedMemories(asha.id)).toEqual([]);

    // "Restart": a new runtime built only from the store.
    const resumed = await loadWorld(stores, row.id);
    expect(fingerprint(resumed)).toEqual(fingerprint(sim.world));
    const again = new Sim(resumed, io, stores);
    await run(again, 6);
    expect(again.world.clock).toBe(15 * 60 + 30);
  });

  it('restoring a snapshot forks a new sim with history up to the snapshot', async () => {
    const { sim: row } = await seedDefaultSim(stores);
    sims.push(row.id);
    const sim = new Sim(await loadWorld(stores, row.id), io, stores);
    await run(sim, 12); // → 09:00
    const snapId = await sim.saveSnapshot();
    const atSnapshot = portable(sim.world);
    const countAtSnapshot = await memoryCount(stores, row.id);
    await run(sim, 12); // → 11:00
    expect(await memoryCount(stores, row.id)).toBeGreaterThan(countAtSnapshot);

    await sim.loadSnapshot(snapId);
    const forkId = sim.world.simId;
    sims.push(forkId);
    expect(forkId).not.toBe(row.id);
    expect((await stores.world.getSim(row.id))?.status).toBe('archived');
    expect(await stores.world.getSim(forkId)).toMatchObject({ parentSimId: row.id, forkedFromSnapshotId: snapId });
    expect(await memoryCount(stores, forkId)).toBe(countAtSnapshot);
    // Same state as at the snapshot, under the fork's own ids.
    expect(portable(sim.world)).toEqual(atSnapshot);
    expect(sim.world.agents.map((a) => a.slug)).toEqual(['asha', 'meera', 'rohan']);
    // The fork can still go back to its parent's restore points.
    const names = (await listLineageSnapshots(stores, forkId)).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining([FRESH_START_SNAPSHOT]));
    expect((await stores.world.latestActiveSim())?.id).toBe(forkId);
    await run(sim, 3);
  });

  it.runIf(factory.name === 'memory')('runs a full game day and plans the next one', async () => {
    const { sim: row } = await seedDefaultSim(stores);
    sims.push(row.id);
    const sim = new Sim(await loadWorld(stores, row.id), io, stores);
    await run(sim, 24 * 6 + 3); // 07:00 day 1 → 07:30 day 2
    expect(dayOf(sim.world.clock)).toBe(2);
    expect(sim.world.agents.every((a) => a.planDay === 2 && a.plan.length > 0)).toBe(true);
    const kinds = (await stores.log.recentEvents(row.id, 10_000)).map((e) => e.kind);
    expect(kinds.filter((k) => k === 'sleep')).toHaveLength(3);
    const resumed = await loadWorld(stores, row.id);
    expect(fingerprint(resumed)).toEqual(fingerprint(sim.world));
  });
});
