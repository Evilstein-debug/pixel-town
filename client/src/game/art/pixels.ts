// Tiny helpers for drawing pixel art into offscreen canvases.

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function px(ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Deterministic PRNG so textures look the same every boot. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

/** Stable hash of tile coordinates → [0,1). */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

/**
 * Draw a 16-px-wide colour-indexed bitmap. `rows` are strings; each char maps
 * through `colors` ('.' or missing = transparent).
 */
export function blit(ctx: Ctx, ox: number, oy: number, rows: string[], colors: Record<string, string>) {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = colors[ch];
      if (c) px(ctx, ox + x, oy + y, c);
    });
  });
}

/** Add a 1-px outline around every opaque pixel in a w×h region. */
export function outline(ctx: Ctx, ox: number, oy: number, w: number, h: number, color: string) {
  const img = ctx.getImageData(ox, oy, w, h);
  const a = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? img.data[(y * w + x) * 4 + 3] : 0;
  const edge: [number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!a(x, y) && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) px(ctx, ox + x, oy + y, color);
}
