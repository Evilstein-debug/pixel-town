// What the behaviour/cognition/social modules need from the running sim.
import type { Server } from 'socket.io';
import type { ClientToServerEvents, Memory, MemoryType, ServerToClientEvents } from '@pixel-town/shared';
import type { WorldState } from './types';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export interface SimContext {
  readonly world: WorldState;
  readonly io: IO;
  /** False once the world has been replaced (snapshot load); async work should drop its results. */
  isCurrent(world: WorldState): boolean;
  log(text: string): void;
  addMemory(agentId: string, type: MemoryType, text: string, importance?: number, factHint?: string): Promise<Memory>;
}
