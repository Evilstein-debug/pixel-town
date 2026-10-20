// pnpm snapshot:import <file.json> [name]
// Creates a new sim from an exported snapshot (one transaction). It becomes the
// newest active sim, so the next server start resumes it unless SIM_ID says otherwise.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../src/config/env';
import { createSimFromBundle, simBundleSchema, type SimBundle } from '../src/persist/snapshots';
import { createStores } from '../src/store';

const [file, name] = process.argv.slice(2);
if (!file) {
  console.error('usage: pnpm snapshot:import <file.json> [name]');
  process.exit(1);
}

const raw = JSON.parse(await readFile(path.resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8'));
const parsed = simBundleSchema.safeParse(raw);
if (!parsed.success) {
  console.error('[import] not a Pixel Town snapshot export:\n' + parsed.error.issues.slice(0, 5)
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

const bundle = raw as SimBundle;
const stores = createStores(env());
try {
  const sim = await createSimFromBundle(stores, bundle, { name: name ?? `${bundle.sim.name} (imported ${bundle.snapshot.name})` });
  console.log(`[import] created sim "${sim.name}" ${sim.id} with ${bundle.memories.length} memories`);
} catch (err) {
  console.error('[import] failed, nothing was written:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await stores.close();
}
