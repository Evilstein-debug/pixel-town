// Plays conversations as speech bubbles, one line per sim tick, pausing with the sim.
import type { ConversationRecord } from '@pixel-town/shared';
import type { AgentSprite } from './AgentSprite';

/** One line per server tick (TICK_REAL_MS) — the server holds the agents for exactly that long. */
const LINE_MS = 2500;

interface Playing { convo: ConversationRecord; elapsed: number; index: number }

export class ConversationPlayer {
  private playing: Playing[] = [];

  constructor(private sprites: Map<string, AgentSprite>) {}

  play(convo: ConversationRecord) {
    // A participant can only be in one conversation at a time.
    this.playing = this.playing.filter((p) => {
      const overlap = p.convo.participants.some((id) => convo.participants.includes(id));
      if (overlap) this.finish(p);
      return !overlap;
    });
    this.playing.push({ convo, elapsed: 0, index: -1 });
  }

  /** Stop chats the server has ended early (e.g. a seed pulled someone away). */
  syncWithTick(talking: (id: string) => boolean) {
    this.playing = this.playing.filter((p) => {
      // Give the server one tick to mark a new chat as "talk" before judging it.
      const ended = p.elapsed > LINE_MS && !p.convo.participants.some(talking);
      if (ended) this.finish(p);
      return !ended;
    });
  }

  clear() {
    this.playing.forEach((p) => this.finish(p));
    this.playing = [];
  }

  private finish(p: Playing) {
    p.convo.participants.forEach((id) => this.sprites.get(id)?.bubble.hide());
  }

  update(deltaMs: number, speed: number, paused: boolean) {
    if (paused) return;
    this.playing = this.playing.filter((p) => {
      p.elapsed += deltaMs * speed;
      const idx = Math.floor(p.elapsed / LINE_MS);
      if (idx >= p.convo.lines.length) {
        this.finish(p);
        return false;
      }
      if (idx !== p.index) {
        p.index = idx;
        const line = p.convo.lines[idx];
        for (const id of p.convo.participants) {
          const sprite = this.sprites.get(id);
          if (id === line.speakerId) sprite?.bubble.say(line.text);
          else sprite?.bubble.hide();
        }
      }
      return true;
    });
  }
}
