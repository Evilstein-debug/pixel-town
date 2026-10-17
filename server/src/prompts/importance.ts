// Batched importance scoring: one call per tick for all unscored memories.
import type { PromptSpec } from '../llm/client';
import { WORLD_BLURB, isRecord } from './common';

export interface ImportanceItem { id: string; agentName: string; type: string; text: string }
export type ImportanceCtx = { items: ImportanceItem[] };
export type ImportanceOut = Record<string, number>;

/** Keyword heuristic used for mock mode and as the safe default. */
export function heuristicImportance(item: ImportanceItem): number {
  const t = item.text.toLowerCase();
  if (item.type === 'seeded') return 8;
  if (/free|party|event|festival|samosa|surprise|news|announce/.test(t) && /told|heard|said|mentioned/.test(t)) return 8;
  if (item.type === 'conversation') return 4;
  if (item.type === 'plan') return 3;
  if (/arrived|went|reached/.test(t)) return 2;
  return 2;
}

export const importancePrompt: PromptSpec<ImportanceCtx, ImportanceOut> = {
  kind: 'importance',
  maxTokens: 1024,
  build: ({ items }) => ({
    system: WORLD_BLURB,
    user:
      'Rate how important each memory is to the character who holds it, on a scale of 1 to 10. ' +
      '1 = completely mundane (seeing a neighbour walk by, arriving somewhere routine). ' +
      '5 = a pleasant chat or minor news. 8+ = news that should change plans today (an event, an offer, something surprising). ' +
      '10 = life-changing.\n\nMemories:\n' +
      items.map((i) => `- id=${i.id} | ${i.agentName} | ${i.type} | ${i.text}`).join('\n') +
      '\n\nRespond with JSON: {"scores":[{"id":"<id>","score":<1-10>}, ...]} covering every id.',
  }),
  parse: (json, { items }) => {
    if (!isRecord(json) || !Array.isArray(json.scores)) return null;
    const out: ImportanceOut = {};
    for (const s of json.scores) {
      if (isRecord(s) && typeof s.id === 'string' && typeof s.score === 'number')
        out[s.id] = Math.max(1, Math.min(10, Math.round(s.score)));
    }
    // Fill any the model skipped.
    for (const i of items) out[i.id] ??= heuristicImportance(i);
    return out;
  },
  mock: ({ items }) => Object.fromEntries(items.map((i) => [i.id, heuristicImportance(i)])),
  fallback: ({ items }) => Object.fromEntries(items.map((i) => [i.id, heuristicImportance(i)])),
};
