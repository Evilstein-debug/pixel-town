// Keyboard → camera + sim controls. Disabled while a HUD text input has focus.
import Phaser from 'phaser';
import { bus } from '../bus';
import type { CameraController } from './CameraController';

export interface KeyActions {
  togglePause(): void;
  setSpeed(speed: number): void;
  cycleLock(): void;
  openSeed(): void;
}

export class KeyboardControls {
  private keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private kb: Phaser.Input.Keyboard.KeyboardPlugin;
  private unsub: () => void;

  constructor(scene: Phaser.Scene, private camera: CameraController, actions: KeyActions) {
    const kb = (this.kb = scene.input.keyboard!);
    this.keys = kb.addKeys('W,A,S,D') as KeyboardControls['keys'];
    kb.addCapture('TAB,SPACE');
    kb.on('keydown-Q', () => camera.zoomStep(-1));
    kb.on('keydown-E', () => camera.zoomStep(1));
    kb.on('keydown-SPACE', () => actions.togglePause());
    kb.on('keydown-ONE', () => actions.setSpeed(1));
    kb.on('keydown-TWO', () => actions.setSpeed(2));
    kb.on('keydown-THREE', () => actions.setSpeed(4));
    kb.on('keydown-TAB', () => actions.cycleLock());
    kb.on('keydown-ESC', () => camera.unlock());
    kb.on('keydown-T', (e: KeyboardEvent) => {
      e.preventDefault(); // don't type "t" into the dialog that opens
      actions.openSeed();
    });

    this.unsub = bus.on('ui:typing', (typing) => {
      kb.enabled = !typing;
      if (typing) {
        kb.disableGlobalCapture();
        kb.resetKeys();
      } else kb.enableGlobalCapture();
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsub());
  }

  update() {
    if (!this.kb.enabled) return this.camera.setPanInput(0, 0);
    const k = this.keys;
    const x = (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0);
    const y = (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0);
    if ((x || y) && this.camera.lockedId) this.camera.unlock(); // any WASD breaks the lock
    const len = Math.hypot(x, y) || 1;
    this.camera.setPanInput(x / len, y / len);
  }
}
