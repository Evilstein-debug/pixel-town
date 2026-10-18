// Local sentence embeddings via transformers.js (all-MiniLM-L6-v2). If the model
// can't load (offline, etc.) relevance falls back to keyword overlap.
import { EMBEDDING_MODEL } from '../config/embedding';

type Extractor = (text: string, opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array }>;

let extractor: Extractor | null = null;
let status: 'loading' | 'ready' | 'fallback' = 'loading';

export async function initEmbeddings() {
  try {
    const { pipeline } = await import('@huggingface/transformers');
    extractor = (await pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'fp32' })) as unknown as Extractor;
    status = 'ready';
    console.log(`[embed] ${EMBEDDING_MODEL} loaded`);
  } catch (err) {
    status = 'fallback';
    console.warn('[embed] model failed to load, using keyword relevance:', (err as Error).message);
  }
}

export const embeddingsReady = () => status === 'ready';

/** Returns [] when the model isn't available; callers then use keyword relevance. */
export async function embed(text: string): Promise<number[]> {
  if (!extractor) return [];
  try {
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data, (v) => Math.round(v * 1e4) / 1e4);
  } catch {
    return [];
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const STOP = new Set('a an the and or of to in at on for is are was were be it i me my he she his her they them with about from that this as by'.split(' '));
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Jaccard-ish overlap in [0,1]. */
export function keywordSimilarity(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

/** Relevance in [0,1] using embeddings when both exist, else keywords. */
export function similarity(textA: string, embA: number[], textB: string, embB: number[]): number {
  if (embA.length && embB.length && embA.length === embB.length) return (cosine(embA, embB) + 1) / 2;
  return keywordSimilarity(textA, textB);
}
