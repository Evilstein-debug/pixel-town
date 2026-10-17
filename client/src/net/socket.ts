// Single Socket.IO connection to the sim server (proxied by Vite in dev).
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@pixel-town/shared';
import { bus } from '../bus';
import { addLog, applySnapshot, applyTick, changed, upsertMemory, world } from '../world/store';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();

socket.on('connect', () => {
  world.connected = true;
  changed();
});
socket.on('disconnect', () => {
  world.connected = false;
  changed();
});
socket.on('world:snapshot', (s) => {
  applySnapshot(s);
  bus.emit('world:snapshot', s);
});
socket.on('world:tick', (t) => {
  applyTick(t);
  bus.emit('world:tick', t);
});
socket.on('agent:path', (p) => bus.emit('agent:path', p));
socket.on('memory:add', ({ memory }) => upsertMemory(memory));
socket.on('memory:retrieved', ({ agentId, query, results }) => {
  world.retrieved = { ...world.retrieved, [agentId]: { query, results, at: Date.now() } };
  changed();
});
socket.on('conversation', (c) => {
  world.conversations = [...world.conversations.slice(-49), c];
  changed();
  bus.emit('conversation', c);
});
socket.on('plan:update', ({ agentId, plan }) => {
  world.plans = { ...world.plans, [agentId]: plan };
  changed();
});
socket.on('log', addLog);
socket.on('snapshots:list', (files) => {
  world.snapshots = files;
  changed();
});
