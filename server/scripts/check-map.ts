// Sanity-checks the ASCII map: row widths, legend coverage, zone reachability.
import { LEGEND, LOCATIONS, MAP_LAYOUT, MAP_WIDTH, isWalkable, walkableTilesIn } from '@pixel-town/shared';

let ok = true;
const fail = (msg: string) => { ok = false; console.error('✗', msg); };

MAP_LAYOUT.forEach((row, y) => {
  if (row.length !== MAP_WIDTH) fail(`row ${y} has width ${row.length}, expected ${MAP_WIDTH}`);
  for (const ch of row) if (!LEGEND[ch]) fail(`row ${y} has unknown char '${ch}'`);
});

// Flood fill from the first zone's first walkable tile.
const start = walkableTilesIn(LOCATIONS[0])[0];
const seen = new Set<string>([`${start.x},${start.y}`]);
const queue = [start];
while (queue.length) {
  const { x, y } = queue.shift()!;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
    if (!seen.has(key) && isWalkable(nx, ny)) { seen.add(key); queue.push({ x: nx, y: ny }); }
  }
}
for (const z of LOCATIONS) {
  const tiles = walkableTilesIn(z);
  const reachable = tiles.filter((t) => seen.has(`${t.x},${t.y}`)).length;
  if (!reachable) fail(`zone ${z.id} is unreachable`);
  console.log(`${z.id.padEnd(12)} ${reachable}/${tiles.length} walkable tiles reachable`);
}
console.log(ok ? '✓ map OK' : 'map has problems');
process.exit(ok ? 0 : 1);
