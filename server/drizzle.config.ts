// drizzle-kit config. Migrations use the direct (unpooled) Neon connection;
// the running app uses the pooled DATABASE_URL instead.
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL_UNPOOLED;
const needsDatabase = process.argv.some((a) => ['migrate', 'push', 'pull', 'studio'].includes(a));
if (needsDatabase && !url) {
  console.error('[drizzle] DATABASE_URL_UNPOOLED is not set (see server/.env.example)');
  process.exit(1);
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: url ?? '' },
  strict: true,
  verbose: true,
});
