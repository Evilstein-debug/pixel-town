import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WriteBuffer } from '../src/persist/writeBuffer';
import { newMemory } from './support/stores';

const SIM = randomUUID();
const ASHA = randomUUID();
const mem = (over = {}) => newMemory(SIM, ASHA, over);
const event = (text: string) => ({ simId: SIM, atGame: 500, kind: 'system', text, payload: {} });

describe('WriteBuffer', () => {
  it('moves pending writes into one in-flight batch and clears them on commit', () => {
    const b = new WriteBuffer();
    const m = mem();
    b.addMemory(m);
    b.addEvent(event('a'));
    const batch = b.take();
    expect(batch.memories).toEqual([m]);
    expect(batch.events.map((e) => e.text)).toEqual(['a']);
    expect(b.isFlushing).toBe(true);
    // Still visible to retrieval while in flight.
    expect(b.unsavedMemories(ASHA)).toEqual([m]);
    b.commit();
    expect(b.unsavedMemories(ASHA)).toEqual([]);
    expect(b.take().memories).toEqual([]);
  });

  it('refuses a second take while a batch is in flight', () => {
    const b = new WriteBuffer();
    b.take();
    expect(() => b.take()).toThrow();
  });

  it('puts a failed batch back in front of newer writes', () => {
    const b = new WriteBuffer();
    const older = mem({ text: 'older' });
    b.addMemory(older);
    b.addEvent(event('first'));
    b.touch(['saved-1'], 500);
    b.take();
    const newer = mem({ text: 'newer' });
    b.addMemory(newer);
    b.addEvent(event('second'));
    b.touch(['saved-1'], 600);
    b.restore();
    const retry = b.take();
    expect(retry.memories.map((m) => m.text)).toEqual(['older', 'newer']);
    expect(retry.events.map((e) => e.text)).toEqual(['first', 'second']);
    // The newer access time wins.
    expect(retry.touches.get('saved-1')).toBe(600);
  });

  it('applies importance and access bumps to unsaved memories directly', () => {
    const b = new WriteBuffer();
    const m = mem({ importance: null });
    b.addMemory(m);
    b.setImportance(m.id, 7);
    b.touch([m.id], 900);
    expect(m.importance).toBe(7);
    expect(m.lastAccessedGame).toBe(900);
    const batch = b.take();
    expect(batch.importance.size).toBe(0);
    expect(batch.touches.size).toBe(0);
  });

  it('records updates for saved memories, and repeats them for in-flight ones', () => {
    const b = new WriteBuffer();
    const inflight = mem();
    b.addMemory(inflight);
    b.take();
    b.touch([inflight.id, 'saved'], 700);
    b.setImportance('saved', 4);
    expect(inflight.lastAccessedGame).toBe(700);
    expect(b.touchedAt('saved')).toBe(700);
    b.commit();
    const next = b.take();
    // The insert may already have gone out, so the bump is sent again as an update.
    expect([...next.touches.keys()].sort()).toEqual([inflight.id, 'saved'].sort());
    expect(next.importance.get('saved')).toBe(4);
  });
});
