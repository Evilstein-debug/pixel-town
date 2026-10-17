// Procedural 16×16 character frames: 4 directions × (idle + 2-frame walk).
import type { Appearance, Facing } from '@pixel-town/shared';
import { PAL } from './palette';
import { makeCanvas, outline, px, type Ctx } from './pixels';

export const DIRS: Facing[] = ['down', 'up', 'left', 'right'];
export const POSES = ['idle', 'walkA', 'walkB'] as const;
export type Pose = (typeof POSES)[number];

export const charFrame = (dir: Facing, pose: Pose) => `${dir}-${pose}`;

const SHOE = '#3a2a20';

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function frontOrBack(ctx: Ctx, ox: number, a: Appearance, pose: Pose, back: boolean) {
  const shirtDark = shade(a.shirt, -0.25);
  // Head
  px(ctx, ox + 5, 3, a.skin, 6, 5);
  px(ctx, ox + 5, 1, a.hair, 6, 2);
  px(ctx, ox + 4, 2, a.hair, 8, 2);
  if (back) {
    px(ctx, ox + 4, 2, a.hair, 8, 5);
  } else {
    px(ctx, ox + 4, 4, a.hair, 1, 2);
    px(ctx, ox + 11, 4, a.hair, 1, 2);
    px(ctx, ox + 6, 5, PAL.ink);
    px(ctx, ox + 9, 5, PAL.ink);
    px(ctx, ox + 5, 6, shade(a.skin, 0.12));
    px(ctx, ox + 10, 6, shade(a.skin, 0.12));
  }
  // Body + arms
  px(ctx, ox + 4, 8, a.shirt, 8, 4);
  px(ctx, ox + 4, 11, shirtDark, 8, 1);
  px(ctx, ox + 3, 8, shirtDark, 1, 3);
  px(ctx, ox + 12, 8, shirtDark, 1, 3);
  px(ctx, ox + 3, 11, a.skin);
  px(ctx, ox + 12, 11, a.skin);
  // Legs
  px(ctx, ox + 5, 12, a.pants, 6, 1);
  const leftDown = pose !== 'walkB', rightDown = pose !== 'walkA';
  px(ctx, ox + 5, 13, a.pants, 2, 1);
  px(ctx, ox + 9, 13, a.pants, 2, 1);
  px(ctx, ox + 5, leftDown ? 14 : 13, SHOE, 2, 1);
  px(ctx, ox + 9, rightDown ? 14 : 13, SHOE, 2, 1);
}

function side(ctx: Ctx, ox: number, a: Appearance, pose: Pose) {
  const shirtDark = shade(a.shirt, -0.25);
  // Head, facing left
  px(ctx, ox + 5, 3, a.skin, 6, 5);
  px(ctx, ox + 5, 1, a.hair, 6, 2);
  px(ctx, ox + 5, 3, a.hair, 6, 1);
  px(ctx, ox + 8, 3, a.hair, 4, 4);
  px(ctx, ox + 6, 5, PAL.ink);
  px(ctx, ox + 4, 5, a.skin);
  // Body + arm (arm swings with the stride)
  px(ctx, ox + 5, 8, a.shirt, 6, 4);
  px(ctx, ox + 5, 11, shirtDark, 6, 1);
  const armX = pose === 'walkA' ? 6 : pose === 'walkB' ? 8 : 7;
  px(ctx, ox + armX, 8, shirtDark, 2, 3);
  px(ctx, ox + armX, 11, a.skin, 2, 1);
  // Legs
  px(ctx, ox + 5, 12, a.pants, 6, 1);
  if (pose === 'walkA') {
    px(ctx, ox + 5, 13, a.pants, 2, 1); px(ctx, ox + 4, 14, SHOE, 3, 1);
    px(ctx, ox + 9, 13, a.pants, 2, 1); px(ctx, ox + 9, 14, SHOE, 2, 1);
  } else {
    px(ctx, ox + 6, 13, a.pants, 4, 1); px(ctx, ox + 5, 14, SHOE, 5, 1);
  }
}

/** Returns a 16·12 × 16 canvas; frame i = DIRS[i/3] × POSES[i%3]. */
export function drawCharacter(a: Appearance): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(16 * DIRS.length * POSES.length, 16);
  DIRS.forEach((dir, d) =>
    POSES.forEach((pose, p) => {
      const ox = (d * POSES.length + p) * 16;
      if (dir === 'down' || dir === 'up') frontOrBack(ctx, ox, a, pose, dir === 'up');
      else if (dir === 'left') side(ctx, ox, a, pose);
      else {
        const [tmp, tctx] = makeCanvas(16, 16);
        side(tctx, 0, a, pose);
        ctx.save();
        ctx.translate(ox + 16, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(tmp, 0, 0);
        ctx.restore();
      }
      outline(ctx, ox, 0, 16, 16, PAL.ink);
    }),
  );
  return canvas;
}
