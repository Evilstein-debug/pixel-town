// Procedural 16×16 tiles, drawn once at boot into a single-row tileset canvas.
import { PAL } from './palette';
import { blit, makeCanvas, px, rng, type Ctx } from './pixels';

export const T = 16;

const FENCE_FRAMES = Array.from({ length: 16 }, (_, m) => `fence${m}` as const);

/** Order defines the tileset index of each frame. */
export const TILE_FRAMES = [
  'grass0', 'grass1', 'grass2', 'grass3',
  'path', 'plaza', 'water0', 'water1', 'floor', 'wall', 'door',
  'flowers0', 'flowers1', 'flowers2', 'flowers3', 'bush', 'bench', 'table', 'bookshelf', 'counter', 'notice',
  ...FENCE_FRAMES,
] as const;

export type TileFrame = (typeof TILE_FRAMES)[number];

const SHADOW = 'rgba(20,40,20,0.22)';

function grass(ctx: Ctx, ox: number, seed: number) {
  const r = rng(seed);
  px(ctx, ox, 0, PAL.grass, T, T);
  for (let i = 0; i < 14; i++) {
    const x = ox + Math.floor(r() * T), y = Math.floor(r() * (T - 1));
    px(ctx, x, y, r() < 0.6 ? PAL.grassDark : PAL.grassLight, 1, 2);
  }
  for (let i = 0; i < 3; i++) px(ctx, ox + Math.floor(r() * T), Math.floor(r() * T), PAL.grassPale);
}

function path(ctx: Ctx, ox: number) {
  const r = rng(77);
  px(ctx, ox, 0, PAL.dirt, T, T);
  for (let i = 0; i < 12; i++) px(ctx, ox + Math.floor(r() * T), Math.floor(r() * T), PAL.dirtDark);
  for (let i = 0; i < 4; i++) px(ctx, ox + Math.floor(r() * T), Math.floor(r() * T), PAL.cream);
}

function plaza(ctx: Ctx, ox: number) {
  px(ctx, ox, 0, PAL.stone, T, T);
  for (const y of [0, 8]) px(ctx, ox, y, PAL.stoneDark, T, 1);
  for (const x of [0, 8]) px(ctx, ox + x, 1, PAL.stoneDark, 1, 7);
  for (const x of [4, 12]) px(ctx, ox + x, 9, PAL.stoneDark, 1, 7);
  for (const [x, y] of [[1, 1], [9, 1], [5, 9], [13, 9], [1, 9]]) px(ctx, ox + x, y, PAL.white, 2, 1);
}

function water(ctx: Ctx, ox: number, phase: number) {
  px(ctx, ox, 0, PAL.water, T, T);
  const r = rng(5);
  for (let i = 0; i < 6; i++) px(ctx, ox + Math.floor(r() * T), Math.floor(r() * T), PAL.waterDark, 2, 1);
  const waves = phase === 0 ? [[2, 3], [9, 7], [4, 12]] : [[5, 4], [11, 9], [1, 13]];
  for (const [x, y] of waves) {
    px(ctx, ox + x, y, PAL.waterLight, 3, 1);
    px(ctx, ox + x - 1, y + 1, PAL.waterLight);
    px(ctx, ox + x + 3, y + 1, PAL.waterLight);
  }
}

function floor(ctx: Ctx, ox: number) {
  px(ctx, ox, 0, PAL.plank, T, T);
  for (let y = 3; y < T; y += 4) px(ctx, ox, y, PAL.plankDark, T, 1);
  for (const [x, y] of [[5, 0], [12, 4], [3, 8], [10, 12]]) px(ctx, ox + x, y, PAL.plankDark, 1, 3);
}

function wall(ctx: Ctx, ox: number) {
  px(ctx, ox, 0, PAL.brick, T, T);
  px(ctx, ox, 0, PAL.brickLight, T, 2);
  for (const y of [5, 9, 13]) px(ctx, ox, y, PAL.brickDark, T, 1);
  for (const [x, y] of [[4, 2], [12, 2], [0, 6], [8, 6], [4, 10], [12, 10], [0, 14], [8, 14]])
    px(ctx, ox + x, y, PAL.brickDark, 1, 3);
  px(ctx, ox, 15, PAL.ink, T, 1);
}

function door(ctx: Ctx, ox: number) {
  floor(ctx, ox);
  px(ctx, ox + 2, 3, PAL.red, 12, 10);
  px(ctx, ox + 3, 4, PAL.cream, 10, 1);
  px(ctx, ox + 3, 11, PAL.cream, 10, 1);
}

function flowers(ctx: Ctx, ox: number, seed: number) {
  grass(ctx, ox, seed);
  const r = rng(seed * 31);
  const n = 1 + (seed % 3);
  for (let i = 0; i < n; i++) {
    const x = ox + 2 + Math.floor(r() * 11), y = 2 + Math.floor(r() * 11);
    const petal = [PAL.red, PAL.white, PAL.yellow][i % 3];
    px(ctx, x - 1, y, petal); px(ctx, x + 1, y, petal);
    px(ctx, x, y - 1, petal); px(ctx, x, y + 1, petal);
    px(ctx, x, y, i % 3 === 2 ? PAL.red : PAL.yellow);
  }
}

const OBJ = { o: PAL.ink, W: PAL.woodLight, B: PAL.wood, b: PAL.wood, s: SHADOW, c: PAL.cream, w: PAL.white,
  r: PAL.red, y: PAL.yellow, g: PAL.grassDark, k: PAL.ink, u: PAL.waterDark };

const BUSH = [
  '................', '................', '.....oooooo.....', '...ooGGGGGGoo...',
  '..oGGGLLGGGGGo..', '..oGLLGGGGLLGo..', '.oGGGGGGGGLGGGo.', '.oGLGGGrGGGGGGo.',
  '.oGGGGGGGGGGLGo.', '.oGGGLGGGGGGGGo.', '..oGGGGGGrGGGo..', '..oDGGGGGGGGDo..',
  '...ooDDDDDDoo...', '.....oooooo.....', '....ssssssss....',
];
const BENCH = [
  '', '', '', '', 'oooooooooooooooo', 'oWWWWWWWWWWWWWWo', 'oBBBBBBBBBBBBBBo', 'oooooooooooooooo',
  'oWWWWWWWWWWWWWWo', 'oWWWWWWWWWWWWWWo', 'oBBBBBBBBBBBBBBo', 'oooooooooooooooo',
  '.ob..........bo.', '.ob..........bo.', '.oo..........oo.', '.ssssssssssssss.',
];
const TABLE = [
  '', '', '...oooooooooo...', '..oWWWWWWWWWWo..', '..oWWccWWWWWWo..', '..oWWccWWWWWWo..',
  '..oWWWWWWWWWWo..', '..oWWWWWWWccWo..', '..oBBBBBBBBBBo..', '..oooooooooooo..',
  '...ob......bo...', '...ob......bo...', '...oo......oo...', '....ssssssss....',
];
const BOOKSHELF = [
  'oooooooooooooooo', 'oBBBBBBBBBBBBBBo',
  'oBrrbyyggrbbyyBo', 'oBrrbyyggrbbyyBo', 'oBrrbyyggrbbyyBo', 'oBrrbyyggrbbyyBo', 'oBBBBBBBBBBBBBBo',
  'oBggyrrbbyyrggBo', 'oBggyrrbbyyrggBo', 'oBggyrrbbyyrggBo', 'oBggyrrbbyyrggBo', 'oBBBBBBBBBBBBBBo',
  'oBWWWWWWWWWWWWBo', 'oooooooooooooooo', 'ssssssssssssssss',
];
const COUNTER = [
  '', '', '', '', 'oooooooooooooooo', 'cccccccccccccccc', 'cccccccccccccccc', 'oooooooooooooooo',
  'WWWWWWWWWWWWWWWW', 'WBWWWWWWWBWWWWWW', 'WBWWWWWWWBWWWWWW', 'WBWWWWWWWBWWWWWW',
  'BBBBBBBBBBBBBBBB', 'oooooooooooooooo', 'ssssssssssssssss',
];
const NOTICE = [
  '', 'oooooooooooooooo', 'oBBBBBBBBBBBBBBo', 'oBccccBBwwwwwBBo', 'oBcrrcBBwkkkwBBo', 'oBccccBBwwwwwBBo',
  'oBcrrcBByyyyBBBo', 'oBccccBByyyyBBBo', 'oBBBBBBBBBBBBBBo', 'oooooooooooooooo',
  '...ob......bo...', '...ob......bo...', '...ob......bo...', '...oo......oo...', '..ssssssssssss..',
];

/** Fence frame for a neighbour bitmask: up=1, right=2, down=4, left=8. */
function fence(ctx: Ctx, ox: number, mask: number) {
  if (mask & 8) { px(ctx, ox, 6, PAL.woodLight, 8, 2); px(ctx, ox, 10, PAL.woodLight, 8, 2); }
  if (mask & 2) { px(ctx, ox + 8, 6, PAL.woodLight, 8, 2); px(ctx, ox + 8, 10, PAL.woodLight, 8, 2); }
  if (mask & 1) px(ctx, ox + 7, 0, PAL.woodLight, 2, 5);
  if (mask & 4) px(ctx, ox + 7, 12, PAL.woodLight, 2, 4);
  px(ctx, ox + 6, 3, PAL.ink, 4, 11);
  px(ctx, ox + 7, 4, PAL.wood, 2, 9);
  px(ctx, ox + 7, 4, PAL.woodLight, 2, 1);
  px(ctx, ox + 6, 14, SHADOW, 4, 1);
}

export function drawTileset(): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(T * TILE_FRAMES.length, T);
  const bushColors = { o: '#24502a', G: PAL.grassDark, L: PAL.grass, D: '#2f6b31', r: PAL.red, s: SHADOW };
  TILE_FRAMES.forEach((name, i) => {
    const ox = i * T;
    if (name.startsWith('grass')) return grass(ctx, ox, 11 + i * 17);
    if (name.startsWith('flowers')) return flowers(ctx, ox, 3 + Number(name.slice(7)) * 5);
    if (name.startsWith('fence')) return fence(ctx, ox, Number(name.slice(5)));
    switch (name) {
      case 'path': return path(ctx, ox);
      case 'plaza': return plaza(ctx, ox);
      case 'water0': return water(ctx, ox, 0);
      case 'water1': return water(ctx, ox, 1);
      case 'floor': return floor(ctx, ox);
      case 'wall': return wall(ctx, ox);
      case 'door': return door(ctx, ox);
      case 'bush': return blit(ctx, ox, 0, BUSH, bushColors);
      case 'bench': return blit(ctx, ox, 0, BENCH, OBJ);
      case 'table': return blit(ctx, ox, 0, TABLE, OBJ);
      case 'bookshelf': return blit(ctx, ox, 0, BOOKSHELF, { ...OBJ, b: PAL.waterDark });
      case 'counter': return blit(ctx, ox, 0, COUNTER, OBJ);
      case 'notice': return blit(ctx, ox, 0, NOTICE, OBJ);
    }
  });
  return canvas;
}

const TREE = [
  '......oooo......', '....ooLLGGoo....', '...oLLLGGGGGo...', '..oLLGGGGGGGGo..',
  '.oLLGGGGLGGGGDo.', '.oLGGGGGGGGGGDo.', 'oLGGGLGGGGGGGDDo', 'oGGGGGGGGGLGGGDo',
  'oGGLGGGGGGGGGDDo', 'oGGGGGGGGGGGDDDo', '.oGGGGGLGGGDDDo.', '.oDGGGGGGGDDDDo.',
  '..oDDDGGDDDDDo..', '...ooDDDDDDoo...', '.....oobboo.....', '......obbo......',
  '......obbo......', '......obbo......', '....ssobbosss...', '.....ssssss.....',
];

/** Props that are larger than a tile or need individual sprites. Frame: name → [x, y, w, h]. */
export const PROP_FRAMES: Record<string, [number, number, number, number]> = {
  tree: [0, 0, 16, 20],
  shadow: [16, 0, 12, 4],
  'icon-coffee': [28, 0, 11, 10],
  'icon-book': [39, 0, 11, 10],
  'icon-sleep': [50, 0, 11, 10],
  'icon-talk': [61, 0, 11, 10],
  'butterfly-0': [72, 0, 5, 4],
  'butterfly-1': [77, 0, 5, 4],
};

const ICONS: Record<string, string[]> = {
  coffee: ['..k.k..', '.k.k...', 'bbbbbb.', 'bccccbb', 'bccccb.', '.bbbb..'],
  book: ['.uuuuu.', 'uwwwwwu', 'uukkkuu', 'uwwwwwu', 'uuuuuuu', '.kkkkk.'],
  sleep: ['kkkkk..', '...k...', '..k.kkk', '.k....k', 'kkkkkk.', '....kkk'],
  talk: ['.kkkkk.', 'kkkkkkk', 'kwkwkwk', 'kkkkkkk', '.kk....', '.k.....'],
};

const BUTTERFLY = [
  ['w.k.w', 'wwkww', '.wkw.', 'w.k.w'],
  ['..k..', '.wkw.', '.wkw.', '..k..'],
];

export function drawProps(): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(84, 20);
  blit(ctx, 0, 0, TREE, { o: '#1f4a28', G: PAL.grassDark, L: PAL.grass, D: '#2f6b31', b: PAL.wood, s: SHADOW });
  ctx.fillStyle = 'rgba(20,40,20,0.28)';
  ctx.fillRect(18, 0, 8, 1);
  ctx.fillRect(17, 1, 10, 2);
  ctx.fillRect(18, 3, 8, 1);
  const iconColors = { k: PAL.ink, b: PAL.wood, c: PAL.dirt, u: PAL.waterDark, w: PAL.white, r: PAL.red };
  ['coffee', 'book', 'sleep', 'talk'].forEach((name, i) => {
    const ox = 28 + i * 11;
    px(ctx, ox + 1, 0, PAL.ink, 9, 1);
    px(ctx, ox + 1, 9, PAL.ink, 9, 1);
    px(ctx, ox, 1, PAL.ink, 1, 8);
    px(ctx, ox + 10, 1, PAL.ink, 1, 8);
    px(ctx, ox + 1, 1, PAL.cream, 9, 8);
    blit(ctx, ox + 2, 2, ICONS[name], iconColors);
  });
  BUTTERFLY.forEach((rows, i) => blit(ctx, 72 + i * 5, 0, rows, { w: PAL.white, k: PAL.ink }));
  return canvas;
}
