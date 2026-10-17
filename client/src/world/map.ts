// The ASCII layout + legend live in /shared so the server can pathfind over it.
// This module re-exports them and adds client-only helpers.
export * from '@pixel-town/shared/map';
import { TILE_SIZE } from '@pixel-town/shared/map';

/** World-pixel centre-bottom of a tile (where a character's feet go). */
export function tileFeet(x: number, y: number) {
  return { x: x * TILE_SIZE + TILE_SIZE / 2, y: (y + 1) * TILE_SIZE - 1 };
}
