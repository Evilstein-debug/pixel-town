import { describe, expect, it } from 'vitest';
import { loadWorld } from '../src/persist/loadWorld';
import { Persister } from '../src/persist/persister';
import { seedDefaultSim } from '../src/setup/seedSim';
import { createMemory } from '../src/sim/memory';
import { createMemoryStores } from '../src/store/memory';
import type { MemoryRecord, Stores } from '../src/store/types';

/** A store whose next `failures` transactions throw, like a database that's down. */
function flaky(base: Stores) {
  const ctl = { failures: 0 };
  const stores: Stores = {
    ...base,
    transaction: async (fn) => {
      if (ctl.failures > 0) {
        ctl.failures--;
        throw new Error('connection terminated');
      }
      return base.transaction(fn);
    },
  };
  return { stores, ctl };
}

async function setup() {
  const base = createMemoryStores();
  const { sim } = await seedDefaultSim(base);
  const world = await loadWorld(base, sim.id);
  const { stores, ctl } = flaky(base);
  const scored: MemoryRecord[][] = [];
  const persister = new Persister(stores, { onScored: (_w, mems) => scored.push(mems) });
  return { base, world, persister, ctl, scored, asha: world.agents[0] };
}

describe('Persister', () => {
  it('scores unscored memories in one call and writes the batch in one transaction', async () => {
    const { base, world, persister, scored, asha } = await setup();
    await createMemory(world, asha.id, 'observation', 'Arrived at the café.');
    await createMemory(world, asha.id, 'observation', 'Saw Meera near the park.');
    await createMemory(world, asha.id, 'plan', 'Plan for today', { importance: 3 });
    world.clock += 10;
    await persister.flush(world);
    expect(scored).toHaveLength(1);
    expect(scored[0].map((m) => m.text)).toEqual(['Arrived at the café.', 'Saw Meera near the park.']);
    const saved = await base.memories.listByAgent(world.simId, asha.id);
    expect(saved).toHaveLength(3);
    expect(saved.every((m) => m.importance !== null)).toBe(true);
    expect((await base.world.getSim(world.simId))?.gameMinutes).toBe(world.clock);
  });

  it('keeps a failed batch, never throws, and retries it on the next flush', async () => {
    const { base, world, persister, ctl, scored, asha } = await setup();
    await createMemory(world, asha.id, 'observation', 'Arrived at the café.');
    ctl.failures = 1;
    await expect(persister.flush(world)).resolves.toBeUndefined();
    expect(await base.memories.listByAgent(world.simId, asha.id)).toHaveLength(0);
    expect(world.pending.unsavedMemories(asha.id)).toHaveLength(1);

    await createMemory(world, asha.id, 'observation', 'Saw Rohan near the library.');
    await persister.flush(world);
    const saved = await base.memories.listByAgent(world.simId, asha.id);
    expect(saved.map((m) => m.text).sort()).toEqual(['Arrived at the café.', 'Saw Rohan near the library.']);
    expect(world.pending.unsavedMemories(asha.id)).toHaveLength(0);
    // The first memory was scored once, before the failed write, and not again.
    expect(scored.map((batch) => batch.map((m) => m.text))).toEqual([['Arrived at the café.'], ['Saw Rohan near the library.']]);
  });

  it('runs one flush at a time; drain waits and then flushes what came after', async () => {
    const { base, world, persister, asha } = await setup();
    await createMemory(world, asha.id, 'observation', 'one');
    const first = persister.flush(world);
    expect(persister.flush(world)).toBe(first);
    await createMemory(world, asha.id, 'observation', 'two');
    await persister.drain(world);
    expect(await base.memories.listByAgent(world.simId, asha.id)).toHaveLength(2);
  });
});
