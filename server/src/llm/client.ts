// LLM access: a 2-wide request queue, JSON-only parsing with one retry and a
// safe default, token logging, and a deterministic mock (MOCK_LLM=1).
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.LLM_MODEL || 'claude-haiku-4-5-20251001';
const MAX_CONCURRENT = 2;

export interface PromptSpec<Ctx, Out> {
  kind: string;
  maxTokens: number;
  build(ctx: Ctx): { system: string; user: string };
  /** Validate parsed JSON; return null if unusable. */
  parse(json: unknown, ctx: Ctx): Out | null;
  /** Deterministic canned answer for MOCK_LLM=1. */
  mock(ctx: Ctx): Out;
  /** Used when the real call fails twice. */
  fallback(ctx: Ctx): Out;
}

const mockRequested = process.env.MOCK_LLM === '1';
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
export const MOCK = mockRequested || !hasKey;
if (!mockRequested && !hasKey) console.warn('[llm] ANTHROPIC_API_KEY not set — running with MOCK_LLM');
console.log(`[llm] mode: ${MOCK ? 'MOCK' : `live (${MODEL})`}`);

const client = MOCK ? null : new Anthropic();

// ---- queue ----
let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
export const queueDepth = () => waiting.length;

let totals = { calls: 0, input: 0, output: 0 };

/** Strip code fences / prose around the outermost JSON object and parse it. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callOnce(system: string, user: string, maxTokens: number, kind: string): Promise<string> {
  const t0 = Date.now();
  const res = await client!.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const { input_tokens, output_tokens } = res.usage;
  totals = { calls: totals.calls + 1, input: totals.input + input_tokens, output: totals.output + output_tokens };
  console.log(
    `[llm] ${kind.padEnd(12)} in=${input_tokens} out=${output_tokens} ${Date.now() - t0}ms` +
      `  (total ${totals.calls} calls, ${totals.input}/${totals.output} tok)`,
  );
  if (res.stop_reason === 'refusal') throw new Error('model refused');
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

export async function runPrompt<Ctx, Out>(spec: PromptSpec<Ctx, Out>, ctx: Ctx): Promise<Out> {
  if (MOCK) {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    return spec.mock(ctx);
  }
  const { system, user } = spec.build(ctx);
  return withSlot(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const note = attempt ? '\n\nYour previous reply was not valid. Reply with a single JSON object only.' : '';
        const out = spec.parse(extractJson(await callOnce(system, user + note, spec.maxTokens, spec.kind)), ctx);
        if (out !== null) return out;
        console.warn(`[llm] ${spec.kind}: reply failed validation (attempt ${attempt + 1})`);
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) {
          console.error('[llm] authentication failed — check ANTHROPIC_API_KEY');
          break;
        }
        console.warn(`[llm] ${spec.kind}: ${(err as Error).message} (attempt ${attempt + 1})`);
      }
    }
    console.warn(`[llm] ${spec.kind}: using safe default`);
    return spec.fallback(ctx);
  });
}
