// pnpm db:seed [name]   Creates a fresh, runnable sim in the database.
import 'dotenv/config';
import { env } from '../src/config/env';
import { seedDefaultSim } from '../src/setup/seedSim';
import { createPostgresStores } from '../src/store/postgres';

const { DATABASE_URL, LLM_MODEL } = env();
if (!DATABASE_URL) {
  console.error('[db:seed] DATABASE_URL is not set (see server/.env.example)');
  process.exit(1);
}

const stores = createPostgresStores(DATABASE_URL);
try {
  const { sim, agents } = await seedDefaultSim(stores, { name: process.argv[2], llmModel: LLM_MODEL });
  console.log(`[db:seed] created sim "${sim.name}" ${sim.id} with ${agents.map((a) => a.name).join(', ')}`);
} catch (err) {
  console.error('[db:seed] failed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await stores.close();
}
