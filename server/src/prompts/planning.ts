// Plan helpers shared by the daily-plan and replan prompts.
import { parseHHMM, toHHMM, type PlanBlock } from '@pixel-town/shared';
import { SLEEP_MINUTE, WAKE_MINUTE } from '../sim/time';
import { findLocation, findTime, isRecord, locationIds } from './common';

/** Validate model output into sorted, clamped plan blocks between `from` and `until` (minutes of day). */
export function validatePlan(json: unknown, from: number, until = SLEEP_MINUTE): PlanBlock[] | null {
  if (!isRecord(json) || !Array.isArray(json.plan)) return null;
  const ids = locationIds();
  const blocks: PlanBlock[] = [];
  for (const b of json.plan) {
    if (!isRecord(b)) continue;
    const { start, end, locationId, activity } = b;
    if (typeof start !== 'string' || typeof end !== 'string' || typeof activity !== 'string') continue;
    if (typeof locationId !== 'string' || !ids.has(locationId)) continue;
    if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) continue;
    const s = Math.max(parseHHMM(start), from), e = Math.min(parseHHMM(end), until);
    if (e <= s) continue;
    blocks.push({ start: toHHMM(s), end: toHHMM(e), locationId, activity: activity.slice(0, 80) });
  }
  blocks.sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
  return blocks.length ? blocks : null;
}

/** Insert a block, trimming/splitting whatever it overlaps. */
export function insertBlock(plan: PlanBlock[], block: PlanBlock): PlanBlock[] {
  const s = parseHHMM(block.start), e = parseHHMM(block.end);
  const out: PlanBlock[] = [];
  for (const b of plan) {
    const bs = parseHHMM(b.start), be = parseHHMM(b.end);
    if (be <= s || bs >= e) { out.push(b); continue; }
    if (bs < s) out.push({ ...b, end: block.start });
    if (be > e) out.push({ ...b, start: block.end });
  }
  out.push(block);
  return out.sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
}

/** Mock/fallback reaction to news: go to the place it mentions around the time it mentions. */
export function planAroundNews(plan: PlanBlock[], fact: string, now: number, label: string): PlanBlock[] {
  const loc = findLocation(fact) ?? 'square';
  const at = findTime(fact);
  let start = at !== null ? at - 10 : now + 10;
  let end = at !== null ? at + 50 : now + 70;
  if (end <= now) return plan; // already over
  start = Math.max(start, now);
  end = Math.min(end, SLEEP_MINUTE);
  if (end <= start) return plan;
  return insertBlock(plan, { start: toHHMM(start), end: toHHMM(end), locationId: loc, activity: label });
}

/** Latest a top-priority block may run (it overrides bedtime). */
export const PRIORITY_UNTIL = 24 * 60 - 1;

/**
 * Top-priority reaction to a seed: a block starting right now at the place the seed
 * mentions, lasting until an hour after its time (or 90 minutes if it names none).
 */
export function priorityBlock(fact: string, now: number, fallbackLocation: string, crowd: string | null): PlanBlock {
  const at = findTime(fact);
  // "Tell everyone…" means going where the people are, not where the news is about.
  const spread = /\btell\b|everyone|announce|spread|let .+ know|warn/i.test(fact);
  const end = Math.min(at !== null && at > now ? at + 60 : now + 90, PRIORITY_UNTIL);
  return {
    start: toHHMM(now), end: toHHMM(end),
    locationId: (spread && crowd) || findLocation(fact) || fallbackLocation,
    activity: `Top priority: ${fact}`.slice(0, 80), priority: true,
  };
}

/** Re-insert still-upcoming priority blocks from `old` that `next` dropped. */
export function keepPriority(old: PlanBlock[], next: PlanBlock[], now: number): PlanBlock[] {
  let merged = next;
  for (const b of old) {
    if (!b.priority || parseHHMM(b.end) <= now) continue;
    if (merged.some((m) => m.priority && m.start === b.start && m.locationId === b.locationId)) continue;
    const start = Math.max(parseHHMM(b.start), now);
    merged = insertBlock(merged, { ...b, start: toHHMM(start) });
  }
  return merged;
}

export const DAY_START = WAKE_MINUTE;
