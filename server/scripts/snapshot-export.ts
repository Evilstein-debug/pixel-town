// pnpm snapshot:export <snapshotId> [out.json]
// Writes a snapshot plus the history it stands on as JSON, for sharing or debugging.
// This is a convenience, not a persistence path: the database stays the source of truth.
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../src/config/env';
import { buildBundle } from '../src/persist/snapshots';
import { createStores } from '../src/store';

const [snapshotId, out] = process.argv.slice(2);
if (!snapshotId) {
  console.error('usage: pnpm snapshot:export <snapshotId> [out.json]');
  process.exit(1);
}

const stores = createStores(env());
try {
  const bundle = await buildBundle(stores, snapshotId);
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), out ?? `snapshot-${bundle.snapshot.name}.json`);
  await writeFile(file, JSON.stringify(bundle));
  console.log(`[export] ${bundle.snapshot.name}: ${bundle.agents.length} agents, ${bundle.memories.length} memories, ` +
    `${bundle.conversations.length} conversations, ${bundle.events.length} events → ${file}`);
} catch (err) {
  console.error('[export] failed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await stores.close();
}
