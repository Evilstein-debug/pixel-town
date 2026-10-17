import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@pixel-town/shared';
import { initEmbeddings } from './sim/embeddings';
import { Sim } from './sim/sim';
import { createWorld, listSnapshots, saveSnapshot, snapshotOf } from './sim/world';

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));

const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, { cors: { origin: '*' } });

await initEmbeddings();
const sim = new Sim(createWorld(), io);
// Always keep a clean "start of Day 1" restart point for the demo.
await saveSnapshot(sim.world, '00-fresh-start-day1-0700');

io.on('connection', async (socket) => {
  console.log(`[io] browser connected ${socket.id}`);
  socket.emit('world:snapshot', snapshotOf(sim.world, await listSnapshots()));

  socket.on('sim:control', ({ cmd, value }) => sim.control(cmd, value));
  socket.on('event:seed', ({ agentId, text }) => void sim.seed(agentId, String(text ?? '')));
  socket.on('snapshot:save', () => void sim.saveSnapshot().catch((e) => console.warn('[snapshot]', e.message)));
  socket.on('replay:load', ({ file }) =>
    void sim.loadSnapshot(String(file)).catch((e) => sim.log(`Could not load snapshot: ${e.message}`)));
});

http.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  sim.start();
});

// Exit promptly on restart (tsx watch) so the port frees up.
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));
