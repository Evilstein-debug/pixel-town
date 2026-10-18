import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env';

const pooled = 'postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';

describe('parseEnv', () => {
  it('defaults to the postgres store and requires DATABASE_URL for it', () => {
    const r = parseEnv({});
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual(['DATABASE_URL']);
  });

  it('accepts postgres with a connection string', () => {
    const r = parseEnv({ DATABASE_URL: pooled });
    expect(r.data).toMatchObject({ STORE: 'postgres', DATABASE_URL: pooled, MOCK_LLM: '0', PORT: 3001 });
  });

  it('runs without a database when STORE=memory, treating empty values as unset', () => {
    const r = parseEnv({ STORE: 'memory', DATABASE_URL: '', PORT: '4000', MOCK_LLM: '1' });
    expect(r.data).toMatchObject({ STORE: 'memory', PORT: 4000, MOCK_LLM: '1' });
    expect(r.data?.DATABASE_URL).toBeUndefined();
  });

  it('rejects bad values', () => {
    expect(parseEnv({ STORE: 'sqlite' }).success).toBe(false);
    expect(parseEnv({ STORE: 'memory', DATABASE_URL: 'mysql://x' }).success).toBe(false);
    expect(parseEnv({ STORE: 'memory', MOCK_LLM: 'yes' }).success).toBe(false);
  });
});
