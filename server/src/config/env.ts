// Server environment, validated once with zod. Fails fast with a readable message.
// Nothing here may be imported by the client: these are server-only secrets.
import { z } from 'zod';

export const DEFAULT_LLM_MODEL = 'claude-haiku-4-5-20251001';

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// connection string');

const schema = z
  .object({
    STORE: z.enum(['postgres', 'memory']).default('postgres'),
    /** Pooled connection string (Neon host with `-pooler`), used by the running app. */
    DATABASE_URL: postgresUrl.optional(),
    /** Direct, unpooled connection string, used only by drizzle-kit migrations. */
    DATABASE_URL_UNPOOLED: postgresUrl.optional(),
    /** Resume this sim instead of the newest non-archived one. */
    SIM_ID: z.uuid().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    MOCK_LLM: z.enum(['0', '1']).default('0'),
    LLM_MODEL: z.string().min(1).default(DEFAULT_LLM_MODEL),
    /** Fixed mock latency in ms; unset = a random 200–500 ms, like a fast real call. */
    MOCK_LLM_LATENCY_MS: z.coerce.number().int().min(0).optional(),
    PORT: z.coerce.number().int().positive().default(3001),
  })
  .superRefine((e, ctx) => {
    if (e.STORE === 'postgres' && !e.DATABASE_URL)
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required when STORE=postgres (or set STORE=memory)' });
  });

export type Env = z.infer<typeof schema>;

/** Pure parser, for tests. Treats empty strings as unset (as `.env` files often leave them). */
export function parseEnv(raw: Record<string, string | undefined>) {
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
  return schema.safeParse(cleaned);
}

let cached: Env | undefined;

/** The validated environment. Exits the process on invalid config. */
export function env(): Env {
  if (cached) return cached;
  const result = parseEnv(process.env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    console.error(`[env] invalid configuration (see server/.env.example):\n${lines.join('\n')}`);
    process.exit(1);
  }
  cached = result.data;
  if (cached.STORE === 'postgres' && /neon\.tech/.test(cached.DATABASE_URL!) && !/-pooler\./.test(cached.DATABASE_URL!))
    console.warn('[env] DATABASE_URL looks like a direct Neon host; the app should use the pooled (-pooler) one');
  return cached;
}
