// The town map as ASCII, one character per 16×16 tile. Edit by hand; see LEGEND.
// Shared by the client (rendering) and server (pathfinding, location zones).

export type TileKind =
  | 'grass' | 'path' | 'plaza' | 'water' | 'tree' | 'bush' | 'fence'
  | 'wall' | 'floor' | 'door' | 'bench' | 'table' | 'bookshelf' | 'counter' | 'notice';

export type GroundKind = 'grass' | 'path' | 'plaza' | 'water' | 'floor' | 'wall';

export interface TileDef {
  kind: TileKind;
  walkable: boolean;
  /** Ground drawn beneath this tile (decor tiles sit on top of it). */
  ground: GroundKind;
}

export const LEGEND: Record<string, TileDef> = {
  '.': { kind: 'grass', walkable: true, ground: 'grass' },
  ':': { kind: 'path', walkable: true, ground: 'path' },
  '#': { kind: 'plaza', walkable: true, ground: 'plaza' },
  '~': { kind: 'water', walkable: false, ground: 'water' },
  'T': { kind: 'tree', walkable: false, ground: 'grass' },
  'b': { kind: 'bush', walkable: false, ground: 'grass' },
  'f': { kind: 'fence', walkable: false, ground: 'grass' },
  'W': { kind: 'wall', walkable: false, ground: 'wall' },
  '_': { kind: 'floor', walkable: true, ground: 'floor' },
  'D': { kind: 'door', walkable: true, ground: 'floor' },
  '=': { kind: 'bench', walkable: true, ground: 'grass' },
  't': { kind: 'table', walkable: false, ground: 'floor' },
  'B': { kind: 'bookshelf', walkable: false, ground: 'floor' },
  'C': { kind: 'counter', walkable: false, ground: 'floor' },
  'N': { kind: 'notice', walkable: false, ground: 'plaza' },
};

// prettier-ignore
export const MAP_LAYOUT: string[] = [
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT', // 0
  'T...T..........T.........T.....T.......T', // 1
  'T.WWWWWWW......WWWWWWWWWWW.....WWWWWWW.T', // 2
  'T.W__t__W......W_BBB_BBB_W.....W__t__W.T', // 3
  'T.W_____W......W_________W.....W_____W.T', // 4
  'T.W_____W..b...W_BBB_BBB_W.....W_____W.T', // 5
  'T.WWWDWWW......W_________W..b..WWWDWWW.T', // 6
  'T....:.........W__t___t__W........:....T', // 7
  'T....:.........WWWWWDWWWWW........:....T', // 8
  'T....::::::::::::::::::::::::::::::....T', // 9
  'T.....:.....:.......:............:.....T', // 10
  'T.WWWWDWWWW.:.......:.......fffff:fffffT', // 11
  'T.WCC_____W.:..###########..f....:....fT', // 12
  'T.W_______W.:..###########..fT...:..T.fT', // 13
  'T.W_t___t_W.:..###########..f....:~~~~fT', // 14
  'T.W_______W::::#####N#####..f=...:~~~~fT', // 15
  'T.W_t___t_W.:..###########..f=...:~~~~fT', // 16
  'T.W_______W.:..###########..f....:~~~~fT', // 17
  'T.WWWWWWWWW.:..###########..fT...:...TfT', // 18
  'T...........:...............f.=..:.=..fT', // 19
  'T....::::::::..b.....b......f....:....fT', // 20
  'T....:......................fT...:...TfT', // 21
  'T.WWWDWWW...................f....:....fT', // 22
  'T.W___t_W.....bb............f....:..T.fT', // 23
  'T.W_____W...................fT...:....fT', // 24
  'T.W_____W.......T...........f..=.:.=..fT', // 25
  'T.WWWWWWW...................f..T.:....fT', // 26
  'T.....b.....T.......b.......fffffffffffT', // 27
  'T.......T..........T..............T....T', // 28
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT', // 29
];

export const MAP_ID = 'pixel-town-v1';
export const TILE_SIZE = 16;
export const MAP_WIDTH = MAP_LAYOUT[0].length;
export const MAP_HEIGHT = MAP_LAYOUT.length;

export function tileAt(x: number, y: number): TileDef | undefined {
  const ch = MAP_LAYOUT[y]?.[x];
  return ch === undefined ? undefined : LEGEND[ch];
}

export function isWalkable(x: number, y: number): boolean {
  return tileAt(x, y)?.walkable ?? false;
}

/** walkGrid[y][x] === true when the tile can be walked on. */
export function buildWalkGrid(): boolean[][] {
  return MAP_LAYOUT.map((row, y) => [...row].map((_, x) => isWalkable(x, y)));
}

export interface LocationZone {
  id: string;
  name: string;
  /** Inclusive tile rectangle. */
  x0: number; y0: number; x1: number; y1: number;
}

export const LOCATIONS: LocationZone[] = [
  { id: 'cafe', name: 'Chai & Co. Café', x0: 3, y0: 12, x1: 9, y1: 17 },
  { id: 'library', name: 'Town Library', x0: 16, y0: 3, x1: 24, y1: 7 },
  { id: 'park', name: 'Central Park', x0: 29, y0: 12, x1: 37, y1: 26 },
  { id: 'square', name: 'Town Square', x0: 15, y0: 12, x1: 25, y1: 18 },
  { id: 'asha_house', name: "Asha's House", x0: 3, y0: 3, x1: 7, y1: 5 },
  { id: 'rohan_house', name: "Rohan's House", x0: 32, y0: 3, x1: 36, y1: 5 },
  { id: 'meera_house', name: "Meera's House", x0: 3, y0: 23, x1: 7, y1: 25 },
];

export function locationAt(x: number, y: number): LocationZone | undefined {
  return LOCATIONS.find((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1);
}

export function walkableTilesIn(zone: LocationZone): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = zone.y0; y <= zone.y1; y++)
    for (let x = zone.x0; x <= zone.x1; x++) if (isWalkable(x, y)) out.push({ x, y });
  return out;
}
