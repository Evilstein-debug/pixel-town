import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@pixel-town/shared';
import { env } from './config/env';
import { loadWorld } from './persist/loadWorld';
import { seedDefaultSim } from './setup/seedSim';
import { initEmbeddings } from './sim/embeddings';
import { Sim } from './sim/sim';
import { createStores } from './store';
import type { Stores } from './store/types';

const e = env();
const stores = createStores(e);

/** Neon's free tier suspends idle compute; wake it before the tick loop depends on it. */
async function warmUp(s: Stores) {
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    try {
      await s.ping();
      console.log(`[db] ${s.kind} store ready (${Date.now() - t0} ms)`);
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`[db] warm-up attempt ${attempt} failed: ${(err as Error).message}; retrying`);
    }
  }
}

/** SIM_ID, else the newest sim that isn't archived, else a freshly seeded one. */
async function resolveSimId(s: Stores): Promise<string> {
  if (e.SIM_ID) {
    if (!(await s.world.getSim(e.SIM_ID))) throw new Error(`SIM_ID ${e.SIM_ID} does not exist`);
    return e.SIM_ID;
  }
  const latest = await s.world.latestActiveSim();
  if (latest) return latest.id;
  const { sim } = await seedDefaultSim(s, { llmModel: e.LLM_MODEL });
  console.log(`[sim] no sim found; seeded "${sim.name}" ${sim.id}`);
  return sim.id;
}

await warmUp(stores);
await initEmbeddings();
const simId = await resolveSimId(stores);
const world = await loadWorld(stores, simId);
console.log(`[sim] resuming "${world.name}" ${simId}`);

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));

const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, { cors: { origin: '*' } });
const sim = new Sim(world, io, stores);

io.on('connection', async (socket) => {
  console.log(`[io] browser connected ${socket.id}`);
  socket.emit('world:snapshot', await sim.clientSnapshot());

  socket.on('sim:control', ({ cmd, value }) => sim.control(cmd, value));
  socket.on('event:seed', ({ agentId, text }) => void sim.seed(agentId, String(text ?? '')));
  socket.on('snapshot:save', () => void sim.saveSnapshot().catch((err) => console.warn('[snapshot]', err.message)));
  socket.on('replay:load', ({ snapshotId }) =>
    void sim.loadSnapshot(String(snapshotId)).catch((err) =>
      sim.log(`Could not load snapshot: ${err.message}`, 'system')));
});

http.listen(e.PORT, () => {
  console.log(`[server] listening on http://localhost:${e.PORT}`);
  sim.start();
});

// Flush the pending batch, then close the pool. A second signal exits immediately.
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`[server] ${sig}: saving and shutting down`);
    try {
      await sim.shutdown();
      await stores.close();
    } catch (err) {
      console.error('[server] shutdown error:', (err as Error).message);
    }
    process.exit(0);
  });
}
