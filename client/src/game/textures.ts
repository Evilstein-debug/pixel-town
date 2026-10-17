// Texture loader. The rest of the game only uses the keys/frames exported here,
// so procedural art can be swapped for a real tileset (e.g. Kenney "Tiny Town")
// by switching TEXTURE_SOURCE to 'spritesheet' and filling in the frame map.
import Phaser from 'phaser';
import type { Appearance } from '@pixel-town/shared';
import { drawCharacter, DIRS, POSES, charFrame } from './art/characters';
import { drawProps, drawTileset, PROP_FRAMES, TILE_FRAMES, type TileFrame } from './art/tiles';

export const TILES_KEY = 'tiles';
export const PROPS_KEY = 'props';
export const agentTextureKey = (agentId: string) => `agent-${agentId}`;

type TextureSource =
  | { mode: 'procedural' }
  | {
      mode: 'spritesheet';
      /** Path under client/public, e.g. '/assets/tiny-town.png'. 16×16 frames, no spacing. */
      tilesetPath: string;
      /** Index of each logical frame in the spritesheet. */
      frameIndex: Record<TileFrame, number>;
    };

export const TEXTURE_SOURCE: TextureSource = { mode: 'procedural' };

/** Call from Scene.preload(). */
export function preloadTextures(scene: Phaser.Scene) {
  if (TEXTURE_SOURCE.mode === 'spritesheet') {
    scene.load.spritesheet(TILES_KEY, TEXTURE_SOURCE.tilesetPath, { frameWidth: 16, frameHeight: 16 });
  }
}

/** Call from Scene.create(). Builds anything not loaded from disk. */
export function createTextures(scene: Phaser.Scene) {
  if (TEXTURE_SOURCE.mode === 'procedural' && !scene.textures.exists(TILES_KEY)) {
    scene.textures.addCanvas(TILES_KEY, drawTileset());
  }
  if (!scene.textures.exists(PROPS_KEY)) {
    const tex = scene.textures.addCanvas(PROPS_KEY, drawProps())!;
    for (const [name, [x, y, w, h]] of Object.entries(PROP_FRAMES)) tex.add(name, 0, x, y, w, h);
  }
}

/** Tileset index for a logical tile frame. */
export function tileIndex(frame: TileFrame): number {
  return TEXTURE_SOURCE.mode === 'spritesheet'
    ? TEXTURE_SOURCE.frameIndex[frame]
    : TILE_FRAMES.indexOf(frame);
}

/** Build (once) the character sheet + walk animations for an agent. */
export function ensureAgentTexture(scene: Phaser.Scene, agentId: string, look: Appearance): string {
  const key = agentTextureKey(agentId);
  if (scene.textures.exists(key)) return key;
  const canvas = drawCharacter(look);
  const tex = scene.textures.addCanvas(key, canvas)!;
  DIRS.forEach((dir, d) =>
    POSES.forEach((pose, p) => tex.add(charFrame(dir, pose), 0, (d * POSES.length + p) * 16, 0, 16, 16)),
  );
  for (const dir of DIRS) {
    scene.anims.create({
      key: `${key}-walk-${dir}`,
      frames: [{ key, frame: charFrame(dir, 'walkA') }, { key, frame: charFrame(dir, 'walkB') }],
      frameRate: 6,
      repeat: -1,
    });
  }
  return key;
}
