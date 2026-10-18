// Default per-sim configuration, stored in `sims.config`.
import { EMBEDDING_MODEL } from '../config/embedding';
import { DEFAULT_LLM_MODEL } from '../config/env';
import type { SimConfig } from '../store/types';
import { TICK_MINUTES, TICK_REAL_MS } from './time';

export function defaultSimConfig(overrides: { llmModel?: string; speed?: number } = {}): SimConfig {
  return {
    tickMinutes: TICK_MINUTES,
    tickRealMs: TICK_REAL_MS,
    speed: overrides.speed ?? 1,
    retrieval: {
      decay: 0.995, wRecency: 1, wImportance: 1, wRelevance: 1, kSim: 40, kRecent: 15, kImp: 15, topN: 8,
    },
    models: { llm: overrides.llmModel ?? DEFAULT_LLM_MODEL, embedding: EMBEDDING_MODEL },
  };
}
