// A few butterflies drifting on lazy random paths. Purely decorative.
import Phaser from 'phaser';
import { PROPS_KEY } from './textures';
import { DEPTH } from './WorldRenderer';

const TINTS = [0xf4d04c, 0xffffff, 0xf49ac1, 0x9fd8f5, 0xf7a64a];

export class Butterflies {
  private flies: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene, private w: number, private h: number, count = 6) {
    for (let i = 0; i < count; i++) {
      const fly = scene.add.image(Phaser.Math.Between(0, w), Phaser.Math.Between(0, h), PROPS_KEY, 'butterfly-0')
        .setTint(TINTS[i % TINTS.length])
        .setDepth(DEPTH.overlay - 1);
      this.flies.push(fly);
      this.drift(fly);
    }
  }

  private drift(fly: Phaser.GameObjects.Image) {
    const x = Phaser.Math.Clamp(fly.x + Phaser.Math.Between(-90, 90), 8, this.w - 8);
    const y = Phaser.Math.Clamp(fly.y + Phaser.Math.Between(-70, 70), 8, this.h - 8);
    fly.setFlipX(x < fly.x);
    this.scene.tweens.add({
      targets: fly, x, y, ease: 'Sine.easeInOut',
      duration: Phaser.Math.Between(3500, 7000),
      onComplete: () => this.drift(fly),
    });
  }

  update(time: number) {
    this.flies.forEach((f, i) => f.setFrame(Math.floor((time + i * 70) / 140) % 2 ? 'butterfly-1' : 'butterfly-0'));
  }
}
