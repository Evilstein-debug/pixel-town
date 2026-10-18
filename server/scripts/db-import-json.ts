// pnpm db:import-json <path/to/world.json> [name]
// One-time import of a legacy world.json (or snapshot file) as a new sim. Runs in
// one transaction; importing the same file twice is refused.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EMBEDDING_DIMENSIONS } from '../src/config/embedding';
import { env } from '../src/config/env';
import {
  countSim, countsOf, DuplicateImportError, hashFile, legacyWorldSchema, planLegacyImport, writeImport,
} from '../src/setup/importLegacyWorld';
import { embed, initEmbeddings } from '../src/sim/embeddings';
import { createPostgresStores } from '../src/store/postgres';

const [file, name] = process.argv.slice(2);
if (!file) {
  console.error('usage: pnpm db:import-json <path/to/world.json> [name]');
  process.exit(1);
}
const { DATABASE_URL } = env();
if (!DATABASE_URL) {
  console.error('[import] DATABASE_URL is not set (see server/.env.example)');
  process.exit(1);
}

const contents = await readFile(path.resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8');
const parsed = legacyWorldSchema.safeParse(JSON.parse(contents));
if (!parsed.success) {
  console.error('[import] not a Pixel Town world file:\n' + parsed.error.issues.slice(0, 5)
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

const world = parsed.data;
const needsEmbedding = world.memories.some((m) => m.embedding.length !== EMBEDDING_DIMENSIONS);
if (needsEmbedding) await initEmbeddings();

const stores = createPostgresStores(DATABASE_URL);
try {
  const plan = await planLegacyImport(world, {
    name: name ?? `Imported ${path.basename(file)}`,
    importHash: hashFile(contents),
    embed,
  });
  const simId = await writeImport(stores, plan);
  const reported = countsOf(plan);
  const stored = await countSim(stores, simId);
  console.log(`[import] created sim ${simId}`);
  console.table({ imported: reported, inDatabase: stored });
  const { reembedded, unembedded, droppedSeedRefs } = plan.stats;
  console.log(`[import] re-embedded ${reembedded}, left without embedding ${unembedded}, dropped seed refs ${droppedSeedRefs}`);
  if (JSON.stringify(reported) !== JSON.stringify(stored)) {
    console.error('[import] counts do not match');
    process.exitCode = 1;
  }
} catch (err) {
  if (err instanceof DuplicateImportError) console.error(`[import] ${err.message}`);
  else console.error('[import] failed, nothing was written:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await stores.close();
}
