// Shared prompt fragments.
import { LOCATIONS, formatClock, type Memory } from '@pixel-town/shared';
import type { AgentState } from '../sim/types';

export const WORLD_BLURB =
  'You are simulating characters in "Pixel Town", a small, friendly Indian town with a café ' +
  '(Chai & Co.), a library, a central park with a pond, a town square with a notice board, and a few houses. ' +
  'Stay in character, keep things grounded and everyday, and reply with JSON only (no prose, no code fences).';

export const locationList = () => LOCATIONS.map((l) => `- ${l.id}: ${l.name}`).join('\n');
export const locationIds = () => new Set(LOCATIONS.map((l) => l.id));
export const locationName = (id: string | null) => LOCATIONS.find((l) => l.id === id)?.name ?? 'a path in town';

export const describeAgent = (a: AgentState) =>
  `${a.name} (${a.age}, ${a.occupation}). ${a.bio} Relationships: ${a.relationships} Home location id: ${a.homeId}.`;

export function formatMemories(mems: Memory[]): string {
  if (!mems.length) return '(nothing notable)';
  return mems.map((m) => `- [${formatClock(m.createdAt)}] ${m.text}`).join('\n');
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Find "3pm", "3:30 pm", "15:00" in text → minute of day. */
export function findTime(text: string): number | null {
  const ampm = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === 'pm') h += 12;
    return h * 60 + Number(ampm[2] ?? 0);
  }
  const h24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return h24 ? Number(h24[1]) * 60 + Number(h24[2]) : null;
}

/** Guess a location id from free text. */
export function findLocation(text: string): string | null {
  const t = text.toLowerCase();
  if (/caf[eé]|chai|samosa/.test(t)) return 'cafe';
  if (/library|book/.test(t)) return 'library';
  if (/park|pond|flower/.test(t)) return 'park';
  if (/square|notice/.test(t)) return 'square';
  return null;
}
