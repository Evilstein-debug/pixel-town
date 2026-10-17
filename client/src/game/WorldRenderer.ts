// Builds the static town from the ASCII map: ground + decor tile layers,
// individual tree sprites (so they can sway), and the water shimmer.
import Phaser from 'phaser';
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE, tileAt, type TileKind } from '../world/map';
import { hash2 } from './art/pixels';
import type { TileFrame } from './art/tiles';
import { PROPS_KEY, TILES_KEY, tileIndex } from './textures';

export const DEPTH = { ground: 0, decor: 1, actorsBase: 10, overlay: 100000 } as const;

const DECOR: Partial<Record<TileKind, TileFrame>> = {
  bush: 'bush', bench: 'bench', table: 'table', bookshelf: 'bookshelf',
  counter: 'counter', notice: 'notice', door: 'door',
};

export class WorldRenderer {
  readonly widthPx = MAP_WIDTH * TILE_SIZE;
  readonly heightPx = MAP_HEIGHT * TILE_SIZE;
  private ground: Phaser.Tilemaps.TilemapLayer;
  private waterFrame = 0;

  constructor(private scene: Phaser.Scene) {
    const map = scene.make.tilemap({
      tileWidth: TILE_SIZE, tileHeight: TILE_SIZE, width: MAP_WIDTH, height: MAP_HEIGHT,
    });
    const tileset = map.addTilesetImage(TILES_KEY, TILES_KEY, TILE_SIZE, TILE_SIZE, 0, 0)!;
    this.ground = map.createBlankLayer('ground', tileset)!.setDepth(DEPTH.ground);
    const decor = map.createBlankLayer('decor', tileset)!.setDepth(DEPTH.decor);

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const def = tileAt(x, y)!;
        this.ground.putTileAt(tileIndex(this.groundFrame(def.ground, x, y)), x, y);
        const d = this.decorFrame(def.kind, x, y);
        if (d) decor.putTileAt(tileIndex(d), x, y);
        if (def.kind === 'tree') this.addTree(x, y);
      }
    }

    scene.time.addEvent({ delay: 650, loop: true, callback: () => this.shimmerWater() });
  }

  private groundFrame(ground: string, x: number, y: number): TileFrame {
    if (ground === 'grass') {
      const h = hash2(x, y);
      return h < 0.35 ? 'grass0' : h < 0.65 ? 'grass1' : h < 0.88 ? 'grass2' : 'grass3';
    }
    if (ground === 'water') return 'water0';
    return ground as TileFrame;
  }

  private decorFrame(kind: TileKind, x: number, y: number): TileFrame | null {
    if (kind === 'fence') {
      const f = (dx: number, dy: number) => tileAt(x + dx, y + dy)?.kind === 'fence';
      const mask = (f(0, -1) ? 1 : 0) | (f(1, 0) ? 2 : 0) | (f(0, 1) ? 4 : 0) | (f(-1, 0) ? 8 : 0);
      return `fence${mask}` as TileFrame;
    }
    if (kind === 'grass') {
      const h = hash2(x * 7 + 3, y * 13 + 1);
      return h < 0.1 ? (`flowers${Math.floor(h * 40)}` as TileFrame) : null;
    }
    return DECOR[kind] ?? null;
  }

  private addTree(x: number, y: number) {
    const baseX = x * TILE_SIZE + TILE_SIZE / 2;
    const bottom = (y + 1) * TILE_SIZE;
    const tree = this.scene.add.image(baseX, bottom, PROPS_KEY, 'tree')
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.actorsBase + bottom);
    this.scene.tweens.add({
      targets: tree,
      x: baseX + 1,
      duration: 1400 + hash2(x, y) * 900,
      delay: hash2(y, x) * 1500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }

  private shimmerWater() {
    this.waterFrame ^= 1;
    const from = tileIndex(this.waterFrame ? 'water0' : 'water1');
    const to = tileIndex(this.waterFrame ? 'water1' : 'water0');
    this.ground.replaceByIndex(from, to);
  }
}
