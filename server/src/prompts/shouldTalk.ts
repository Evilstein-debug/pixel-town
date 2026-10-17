// Decide whether two nearby agents strike up a conversation.
import type { Memory } from '@pixel-town/shared';
import type { PromptSpec } from '../llm/client';
import type { AgentState } from '../sim/types';
import { WORLD_BLURB, describeAgent, formatMemories, isRecord } from './common';

export interface ShouldTalkCtx {
  a: AgentState;
  b: AgentState;
  place: string;
  aAboutB: Memory[];
}

export const shouldTalkPrompt: PromptSpec<ShouldTalkCtx, boolean> = {
  kind: 'should-talk',
  maxTokens: 200,
  build: ({ a, b, place, aAboutB }) => ({
    system: WORLD_BLURB,
    user:
      `${describeAgent(a)}\n${a.name} is currently: ${a.action}.\n\n` +
      `${a.name} notices ${b.name} nearby at ${place}. ${b.name} is: ${b.action}.\n` +
      `What ${a.name} remembers about ${b.name}:\n${formatMemories(aAboutB)}\n\n` +
      `In a small town, neighbours usually stop for a quick chat unless they are very busy or barely know each other ` +
      `(even then, having news to share is a good reason). Would ${a.name} start a conversation now?\n\n` +
      'Respond with JSON: {"shouldTalk": true|false, "reason": "<short>"}',
  }),
  parse: (json) => (isRecord(json) && typeof json.shouldTalk === 'boolean' ? json.shouldTalk : null),
  mock: () => true,
  fallback: () => true,
};
