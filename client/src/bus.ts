// Tiny typed event bus connecting Phaser and React. Use for discrete events,
// never for per-frame state.
import type { ConversationRecord, WorldSnapshot, WorldTick } from '@pixel-town/shared';

export type CameraMode = { kind: 'free' } | { kind: 'locked'; agentId: string };
export type InputSource = 'keyboard' | 'mouse-mock' | 'watch';

export interface BusEvents {
  'world:snapshot': WorldSnapshot;
  'world:tick': WorldTick;
  'agent:path': { agentId: string; path: { x: number; y: number }[] };
  conversation: ConversationRecord;
  'camera:mode': CameraMode;
  'camera:zoom': number;
  'input:source': InputSource;
  /** Ask the camera to lock onto an agent (from the HUD). */
  'camera:lock': string;
  /** Open the seed dialog for an agent. */
  'ui:seed': string;
  /** A text input has focus; the game must not eat keystrokes. */
  'ui:typing': boolean;
}

type Handler<T> = (payload: T) => void;

class Bus<E> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn as Handler<never>);
    return () => this.off(event, fn);
  }

  off<K extends keyof E>(event: K, fn: Handler<E[K]>) {
    this.handlers.get(event)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]) {
    this.handlers.get(event)?.forEach((fn) => (fn as Handler<E[K]>)(payload));
  }
}

export const bus = new Bus<BusEvents>();
