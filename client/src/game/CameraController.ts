// Single place that moves the camera. Input (keyboard) feeds a normalised pan
// velocity in [-1, 1]; this class turns it into smooth, map-clamped camera motion.
import Phaser from 'phaser';
import { bus, type CameraMode } from '../bus';

export const ZOOM_LEVELS = [2, 3, 4, 5];
const DEFAULT_ZOOM = 3;
/** Pan speed at full input, in screen pixels per second. */
const MAX_SCREEN_SPEED = 700;
/** Higher = snappier acceleration. */
const RESPONSE = 10;

export class CameraController {
  private cam: Phaser.Cameras.Scene2D.Camera;
  private input = new Phaser.Math.Vector2();
  private vel = new Phaser.Math.Vector2();
  private zoomIdx = ZOOM_LEVELS.indexOf(DEFAULT_ZOOM);
  private zoomTween?: Phaser.Tweens.Tween;
  private mode: CameraMode = { kind: 'free' };

  constructor(private scene: Phaser.Scene, worldW: number, worldH: number) {
    this.cam = scene.cameras.main;
    this.cam.setBounds(0, 0, worldW, worldH);
    this.cam.setZoom(DEFAULT_ZOOM);
    this.cam.setRoundPixels(true);
    this.cam.centerOn(worldW / 2, worldH / 2);
  }

  get zoom() {
    return this.cam.zoom;
  }

  get lockedId(): string | null {
    return this.mode.kind === 'locked' ? this.mode.agentId : null;
  }

  /** Follow a target with a soft lerp, which also eases the transition in. */
  lock(agentId: string, target: Phaser.GameObjects.Components.Transform) {
    this.vel.set(0, 0);
    this.cam.startFollow(target, true, 0.1, 0.1);
    this.setMode({ kind: 'locked', agentId });
  }

  /** Back to free pan; the camera stays where it is. */
  unlock() {
    if (this.mode.kind === 'free') return;
    this.cam.stopFollow();
    this.vel.set(0, 0);
    this.setMode({ kind: 'free' });
  }

  private setMode(mode: CameraMode) {
    this.mode = mode;
    bus.emit('camera:mode', mode);
  }

  /** Normalised pan input; each axis in [-1, 1]. */
  setPanInput(x: number, y: number) {
    this.input.set(Phaser.Math.Clamp(x, -1, 1), Phaser.Math.Clamp(y, -1, 1));
  }

  zoomStep(dir: 1 | -1) {
    const next = Phaser.Math.Clamp(this.zoomIdx + dir, 0, ZOOM_LEVELS.length - 1);
    if (next === this.zoomIdx) return;
    this.zoomIdx = next;
    this.zoomTween?.stop();
    this.zoomTween = this.scene.tweens.add({
      targets: this.cam,
      zoom: ZOOM_LEVELS[next],
      duration: 220,
      ease: 'Sine.easeOut',
      onComplete: () => bus.emit('camera:zoom', ZOOM_LEVELS[next]),
    });
  }

  update(dtMs: number) {
    if (this.mode.kind === 'locked') return;
    const dt = dtMs / 1000;
    const speed = MAX_SCREEN_SPEED / this.cam.zoom;
    const k = 1 - Math.exp(-RESPONSE * dt);
    this.vel.x += (this.input.x * speed - this.vel.x) * k;
    this.vel.y += (this.input.y * speed - this.vel.y) * k;
    if (Math.abs(this.vel.x) < 0.5 && this.input.x === 0) this.vel.x = 0;
    if (Math.abs(this.vel.y) < 0.5 && this.input.y === 0) this.vel.y = 0;
    this.cam.scrollX += this.vel.x * dt;
    this.cam.scrollY += this.vel.y * dt;
    this.clampScroll();
  }

  /** Keep scroll inside bounds ourselves so velocity doesn't build up against the edge. */
  private clampScroll() {
    const b = this.cam.getBounds();
    const viewW = this.cam.width / this.cam.zoom, viewH = this.cam.height / this.cam.zoom;
    const offX = (this.cam.width - viewW) / 2, offY = (this.cam.height - viewH) / 2;
    const clamp = (v: number, min: number, span: number, view: number) =>
      span <= view ? min + (span - view) / 2 : Phaser.Math.Clamp(v, min, min + span - view);
    const sx = clamp(this.cam.scrollX + offX, b.x, b.width, viewW) - offX;
    const sy = clamp(this.cam.scrollY + offY, b.y, b.height, viewH) - offY;
    if (sx !== this.cam.scrollX) this.vel.x = 0;
    if (sy !== this.cam.scrollY) this.vel.y = 0;
    this.cam.setScroll(sx, sy);
  }
}
