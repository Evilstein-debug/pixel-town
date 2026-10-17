// Front-facing idle frame as a data URL, for the React inspector portrait.
import type { Appearance } from '@pixel-town/shared';
import { drawCharacter } from './characters';

const cache = new Map<string, string>();

export function portraitUrl(agentId: string, look: Appearance): string {
  let url = cache.get(agentId);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    c.getContext('2d')!.drawImage(drawCharacter(look), 0, 0, 16, 16, 0, 0, 16, 16);
    url = c.toDataURL();
    cache.set(agentId, url);
  }
  return url;
}
