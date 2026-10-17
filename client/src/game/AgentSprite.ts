// One agent on screen: shadow, animated body, name tag, status icon, speech bubble.
// Walks the tile paths the server sends, tile to tile, at the sim's speed.
import Phaser from 'phaser';
import type { AgentPublic, Facing, StatusIcon, TickAgent } from '@pixel-town/shared';
import { TILE_SIZE, tileFeet } from '../world/map';
import { charFrame } from './art/characters';
import { SpeechBubble, TEXT_SCREEN_SCALE } from './SpeechBubble';
import { ensureAgentTexture, PROPS_KEY } from './textures';
import { DEPTH } from './WorldRenderer';

/** Must match the server's STEP_REAL_MS. */
const STEP_MS = 400;
const TAG_OFFSET = 17;

type Point = { x: number; y: number };

export class AgentSprite {
  readonly id: string;
  readonly body: Phaser.GameObjects.Sprite;
  readonly bubble: SpeechBubble;
  private shadow: Phaser.GameObjects.Image;
  private tag: Phaser.GameObjects.Text;
  private icon: Phaser.GameObjects.Image;
  private texKey: string;
  private facing: Facing;
  private tile: Point;
  private queue: Point[] = [];
  private status: StatusIcon = 'none';
  private zoom = 3;
  private walking = false;

  constructor(scene: Phaser.Scene, agent: AgentPublic) {
    this.id = agent.id;
    this.facing = agent.facing;
    this.tile = { x: agent.tileX, y: agent.tileY };
    this.texKey = ensureAgentTexture(scene, agent.id, agent.appearance);
    const { x, y } = tileFeet(agent.tileX, agent.tileY);

    this.shadow = scene.add.image(x, y, PROPS_KEY, 'shadow');
    this.body = scene.add.sprite(x, y, this.texKey, charFrame(this.facing, 'idle')).setOrigin(0.5, 1);
    this.body.setInteractive({ useHandCursor: true });
    this.tag = scene.add.text(x, y, agent.name, {
      fontFamily: '"Press Start 2P"', fontSize: '8px', color: '#f6ecc9',
      backgroundColor: 'rgba(31,42,38,0.8)', padding: { x: 2, y: 2 }, resolution: TEXT_SCREEN_SCALE,
    }).setOrigin(0.5, 1).setDepth(DEPTH.overlay);
    this.icon = scene.add.image(x, y, PROPS_KEY, 'icon-coffee').setOrigin(0, 1).setDepth(DEPTH.overlay).setVisible(false);
    this.bubble = new SpeechBubble(scene);
    this.setStatus(agent.statusIcon);
    this.sync(0);
  }

  get tileX() { return this.tile.x; }
  get tileY() { return this.tile.y; }

  setZoom(zoom: number) {
    this.zoom = zoom;
    this.tag.setScale(TEXT_SCREEN_SCALE / zoom);
  }

  /** Server path: first point is where the server thinks the agent is now. */
  walkPath(path: Point[]) {
    this.queue = path.slice(1);
    const start = path[0];
    // If we've drifted, glide to the server's start tile first.
    if (start && (start.x !== this.tile.x || start.y !== this.tile.y)) this.queue.unshift(start);
  }

  /** Reconcile with the authoritative tick. */
  applyTick(t: TickAgent) {
    this.setStatus(t.statusIcon);
    if (this.queue.length) return;
    const far = Math.abs(t.tileX - this.tile.x) + Math.abs(t.tileY - this.tile.y);
    if (far === 1) this.queue.push({ x: t.tileX, y: t.tileY });
    else if (far > 1) this.snapTo(t.tileX, t.tileY);
    if (!this.queue.length) this.face(t.facing);
  }

  snapTo(x: number, y: number) {
    this.queue = [];
    this.tile = { x, y };
    const p = tileFeet(x, y);
    this.body.setPosition(p.x, p.y);
  }

  private face(f: Facing) {
    if (f === this.facing && !this.walking) return;
    this.facing = f;
    if (!this.walking) this.body.setFrame(charFrame(f, 'idle'));
  }

  private setStatus(s: StatusIcon) {
    this.status = s;
    if (s !== 'none') this.icon.setFrame(`icon-${{ coffee: 'coffee', book: 'book', sleep: 'sleep', talk: 'talk' }[s]}`);
  }

  update(deltaMs: number, speed: number, paused: boolean, time: number) {
    if (!paused && this.queue.length) {
      const target = tileFeet(this.queue[0].x, this.queue[0].y);
      const dx = target.x - this.body.x, dy = target.y - this.body.y;
      const dist = Math.hypot(dx, dy);
      const stepPx = (TILE_SIZE / STEP_MS) * deltaMs * speed;
      const dir: Facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      if (!this.walking || dir !== this.facing) {
        this.facing = dir;
        this.body.play(`${this.texKey}-walk-${dir}`, true);
      }
      this.walking = true;
      if (dist <= stepPx) {
        this.body.setPosition(target.x, target.y);
        this.tile = this.queue.shift()!;
      } else {
        this.body.setPosition(this.body.x + (dx / dist) * stepPx, this.body.y + (dy / dist) * stepPx);
      }
    } else if (this.walking && (paused || !this.queue.length)) {
      this.walking = false;
      this.body.stop().setFrame(charFrame(this.facing, 'idle'));
    }
    this.body.anims.timeScale = speed;
    this.bubble.update(paused ? 0 : deltaMs, speed);
    this.sync(time);
  }

  /** Re-position attached objects to follow the body. */
  private sync(time: number) {
    const { x, y } = this.body;
    this.body.setDepth(DEPTH.actorsBase + y);
    this.shadow.setPosition(x, y).setDepth(DEPTH.actorsBase + y - 0.5);
    this.tag.setPosition(x, y - TAG_OFFSET);
    const tagTop = y - TAG_OFFSET - this.tag.displayHeight;
    const showIcon = this.status !== 'none' && !this.bubble.visible;
    const bob = Math.sin(time / 280) > 0 ? 0 : -1;
    this.icon.setVisible(showIcon).setPosition(x + this.tag.displayWidth / 2 + 1, y - TAG_OFFSET + bob);
    this.bubble.place(x, tagTop - 1, this.zoom);
  }

  destroy() {
    this.body.destroy();
    this.shadow.destroy();
    this.tag.destroy();
    this.icon.destroy();
    this.bubble.destroy();
  }
}
