import Phaser from 'phaser';
import { bus } from '../bus';
import { socket } from '../net/socket';
import { changed, selectAgent, world } from '../world/store';
import { AgentSprite } from './AgentSprite';
import { Butterflies } from './Butterflies';
import { CameraController } from './CameraController';
import { ConversationPlayer } from './ConversationPlayer';
import { KeyboardControls } from './KeyboardControls';
import { createTextures, preloadTextures } from './textures';
import { WorldRenderer } from './WorldRenderer';

export class TownScene extends Phaser.Scene {
  private cameraCtl!: CameraController;
  private keyboard!: KeyboardControls;
  private agents = new Map<string, AgentSprite>();
  private convos!: ConversationPlayer;
  private butterflies!: Butterflies;
  private lastZoom = 0;
  private unsubs: (() => void)[] = [];

  constructor() {
    super('town');
  }

  preload() {
    preloadTextures(this);
  }

  create() {
    createTextures(this);
    const town = new WorldRenderer(this);
    this.cameraCtl = new CameraController(this, town.widthPx, town.heightPx);
    this.convos = new ConversationPlayer(this.agents);
    this.butterflies = new Butterflies(this, town.widthPx, town.heightPx);
    this.keyboard = new KeyboardControls(this, this.cameraCtl, {
      togglePause: () => socket.emit('sim:control', { cmd: world.paused ? 'play' : 'pause' }),
      setSpeed: (value) => socket.emit('sim:control', { cmd: 'speed', value }),
      cycleLock: () => this.cycleLock(),
      openSeed: () => {
        const id = this.cameraCtl.lockedId ?? world.selectedId;
        if (id) bus.emit('ui:seed', id);
      },
    });

    this.unsubs.push(
      bus.on('world:snapshot', () => this.applySnapshot()),
      bus.on('world:tick', (t) => {
        t.agents.forEach((a) => this.agents.get(a.id)?.applyTick(a));
        this.convos.syncWithTick((id) => t.agents.find((a) => a.id === id)?.statusIcon === 'talk');
      }),
      bus.on('agent:path', ({ agentId, path }) => this.agents.get(agentId)?.walkPath(path)),
      bus.on('conversation', (c) => this.convos.play(c)),
      bus.on('camera:lock', (id) => this.lockOn(id)),
      bus.on('camera:mode', (m) => {
        world.lockedId = m.kind === 'locked' ? m.agentId : null;
        if (world.lockedId) world.selectedId = world.lockedId;
        changed();
      }),
    );
    if (world.loaded) this.applySnapshot();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubs.forEach((u) => u()));
  }

  private applySnapshot() {
    const locked = this.cameraCtl.lockedId;
    this.cameraCtl.unlock();
    this.convos.clear();
    this.agents.forEach((a) => a.destroy());
    this.agents.clear();
    for (const id of world.order) {
      const sprite = new AgentSprite(this, world.agents[id]);
      sprite.body.on('pointerdown', () => selectAgent(id));
      sprite.setZoom(this.cameraCtl.zoom);
      this.agents.set(id, sprite);
    }
    if (locked) this.lockOn(locked);
  }

  private lockOn(id: string) {
    const sprite = this.agents.get(id);
    if (sprite) this.cameraCtl.lock(id, sprite.body);
  }

  private cycleLock() {
    const ids = world.order;
    if (!ids.length) return;
    const cur = this.cameraCtl.lockedId;
    this.lockOn(ids[(cur ? ids.indexOf(cur) + 1 : 0) % ids.length]);
  }

  update(time: number, delta: number) {
    this.keyboard.update();
    this.cameraCtl.update(delta);
    const zoom = this.cameraCtl.zoom;
    if (zoom !== this.lastZoom) {
      this.lastZoom = zoom;
      this.agents.forEach((a) => a.setZoom(zoom));
    }
    const { speed, paused } = world;
    this.agents.forEach((a) => a.update(delta, speed, paused, time));
    this.convos.update(delta, speed, paused);
    this.butterflies.update(time);
  }
}
