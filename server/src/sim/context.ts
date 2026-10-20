// What the behaviour/cognition/social modules need from the running sim.
import type { Server } from 'socket.io';
import type { ClientToServerEvents, Memory, ServerToClientEvents } from '@pixel-town/shared';
import type { MemoryType, Stores } from '../store/types';
import type { NewMemoryOptions } from './memory';
import type { WorldState } from './types';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** Event log kinds; `payload` carries the ids a later recap needs. */
export type EventKind =
  | 'system' | 'sleep' | 'wake' | 'plan' | 'replan' | 'priority'
  | 'talk' | 'talk_declined' | 'talk_interrupted' | 'told' | 'seed' | 'snapshot';

export interface SimContext {
  readonly world: WorldState;
  readonly io: IO;
  readonly stores: Stores;
  /** False once the world has been replaced (snapshot load); async work should drop its results. */
  isCurrent(world: WorldState): boolean;
  log(text: string, kind: EventKind, payload?: Record<string, unknown>): void;
  addMemory(agentId: string, type: MemoryType, text: string, opts?: NewMemoryOptions): Promise<Memory>;
}
