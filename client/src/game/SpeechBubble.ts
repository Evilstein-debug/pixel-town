// Pixel speech bubble with a typewriter effect. Drawn in "font pixel" units and
// scaled so it stays the same on-screen size at any zoom.
import Phaser from 'phaser';
import { PAL } from './art/palette';
import { DEPTH } from './WorldRenderer';

const WRAP = 20;
const PAD = 4;
const TAIL = 4;
const CHAR_MS = 28;
export const TEXT_SCREEN_SCALE = 2;

export function wrapText(text: string, width = WRAP): string {
  const lines: string[] = [];
  let line = '';
  for (let word of text.split(/\s+/)) {
    while (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export class SpeechBubble {
  private container: Phaser.GameObjects.Container;
  private gfx: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private full = '';
  private elapsed = 0;
  private w = 0;
  private h = 0;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics();
    this.text = scene.add.text(PAD, PAD, '', {
      fontFamily: '"Press Start 2P"', fontSize: '8px', color: PAL.ink, lineSpacing: 4,
      resolution: TEXT_SCREEN_SCALE,
    });
    this.container = scene.add.container(0, 0, [this.gfx, this.text]).setDepth(DEPTH.overlay + 1).setVisible(false);
  }

  get visible() {
    return this.container.visible;
  }

  say(line: string) {
    this.full = wrapText(line);
    this.elapsed = 0;
    // Size the box for the whole line up front so it doesn't grow while typing.
    this.text.setText(this.full);
    this.w = Math.ceil(this.text.width) + PAD * 2;
    this.h = Math.ceil(this.text.height) + PAD * 2 - 4;
    this.text.setText('');
    this.drawBox();
    this.container.setVisible(true);
  }

  hide() {
    this.container.setVisible(false);
  }

  private drawBox() {
    const g = this.gfx.clear();
    const { w, h } = this;
    const mid = Math.floor(w / 2);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(PAL.ink).color);
    g.fillRect(-1, -1, w + 2, h + 2);
    for (let i = 0; i < TAIL; i++) g.fillRect(mid - TAIL + i, h + i, (TAIL - i) * 2 + 1, 1);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(PAL.white).color);
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < TAIL - 1; i++) g.fillRect(mid - TAIL + i + 1, h + i, (TAIL - i) * 2 - 1, 1);
  }

  /** Advance the typewriter; `speed` is the sim speed multiplier. */
  update(deltaMs: number, speed: number) {
    if (!this.container.visible) return;
    this.elapsed += deltaMs * speed;
    const n = Math.min(this.full.length, Math.floor(this.elapsed / CHAR_MS));
    if (n !== this.text.text.length) this.text.setText(this.full.slice(0, n));
  }

  /** Anchor the tail at (x, bottom) in world space. */
  place(x: number, bottom: number, zoom: number) {
    const s = TEXT_SCREEN_SCALE / zoom;
    this.container.setScale(s).setPosition(x - (this.w / 2) * s, bottom - (this.h + TAIL) * s);
  }

  destroy() {
    this.container.destroy();
  }
}
