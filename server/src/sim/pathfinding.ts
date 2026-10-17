// Tile-based A* (4-neighbour, Manhattan heuristic) over the shared walk grid.
import { buildWalkGrid, MAP_HEIGHT, MAP_WIDTH } from '@pixel-town/shared';
import type { Point } from './types';

const grid = buildWalkGrid();

export function findPath(from: Point, to: Point): Point[] | null {
  if (!grid[to.y]?.[to.x]) return null;
  const idx = (x: number, y: number) => y * MAP_WIDTH + x;
  const g = new Map<number, number>([[idx(from.x, from.y), 0]]);
  const came = new Map<number, number>();
  const open: { i: number; f: number }[] = [{ i: idx(from.x, from.y), f: 0 }];
  const closed = new Set<number>();
  const goal = idx(to.x, to.y);

  while (open.length) {
    let best = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[best].f) best = k;
    const { i } = open.splice(best, 1)[0];
    if (i === goal) {
      const out: Point[] = [];
      for (let c: number | undefined = i; c !== undefined && c !== idx(from.x, from.y); c = came.get(c))
        out.unshift({ x: c % MAP_WIDTH, y: Math.floor(c / MAP_WIDTH) });
      return out;
    }
    if (closed.has(i)) continue;
    closed.add(i);
    const x = i % MAP_WIDTH, y = Math.floor(i / MAP_WIDTH);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT || !grid[ny][nx]) continue;
      const ni = idx(nx, ny);
      const ng = g.get(i)! + 1;
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng);
        came.set(ni, i);
        open.push({ i: ni, f: ng + Math.abs(nx - to.x) + Math.abs(ny - to.y) });
      }
    }
  }
  return null;
}
