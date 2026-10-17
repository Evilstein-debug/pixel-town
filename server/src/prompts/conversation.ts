// Generate a whole short conversation plus what each participant takes away from it.
import type { ConversationLine, Memory } from '@pixel-town/shared';
import type { PromptSpec } from '../llm/client';
import type { AgentState } from '../sim/types';
import { WORLD_BLURB, describeAgent, formatMemories, isRecord } from './common';

export interface ConversationCtx {
  a: AgentState;
  b: AgentState;
  place: string;
  timeLabel: string;
  aAboutB: Memory[];
  aSituation: Memory[];
  bAboutA: Memory[];
  bSituation: Memory[];
  /** Seeded news each side holds that the other lacks — must be passed on. */
  aNews: string[];
  bNews: string[];
  /** Someone is on a top-priority errand: keep it short. */
  hurry: boolean;
}

export interface ConversationOut {
  lines: ConversationLine[];
  /** agentId → first-person-free summary memory of what they learned. */
  summaries: Record<string, string>;
  /** agentId → new fact learned, or null. */
  learned: Record<string, string | null>;
}

function mock(ctx: ConversationCtx): ConversationOut {
  const { a, b } = ctx;
  const hello = ctx.timeLabel < '12:00' ? 'Morning' : ctx.timeLabel < '17:00' ? 'Afternoon' : 'Evening';
  const lines: ConversationLine[] = [
    { speakerId: a.id, text: `${hello}, ${b.name}! How's your day going?` },
    { speakerId: b.id, text: `Not bad at all! Just ${b.action.toLowerCase()}.` },
  ];
  const learned: Record<string, string | null> = { [a.id]: null, [b.id]: null };
  const aNews = ctx.aNews[0], bNews = ctx.bNews[0];
  if (aNews) {
    lines.push({ speakerId: a.id, text: `Did you hear? ${aNews}!` });
    lines.push({ speakerId: b.id, text: `Really? I'll be there, thanks for telling me!` });
    learned[b.id] = aNews;
  }
  if (bNews) {
    lines.push({ speakerId: b.id, text: `Oh, and have you heard? ${bNews}!` });
    lines.push({ speakerId: a.id, text: `No way! Good to know.` });
    learned[a.id] = bNews;
  }
  if (!aNews && !bNews) {
    lines.push({ speakerId: a.id, text: `Lovely weather today, isn't it?` });
    lines.push({ speakerId: b.id, text: `Perfect for a walk by the pond.` });
  }
  if (ctx.hurry) {
    // Skip the pleasantries: news first, then off they go.
    lines.splice(0, 2, { speakerId: a.id, text: `${b.name}! Can't stop long.` });
    lines.push({ speakerId: a.id, text: `Gotta run — see you!` });
  } else {
    lines.push({ speakerId: a.id, text: `Anyway, see you around!` });
    lines.push({ speakerId: b.id, text: `Take care, ${a.name}!` });
  }
  const summary = (self: AgentState, other: AgentState) =>
    `Chatted with ${other.name} at ${ctx.place}.` +
    (learned[self.id] ? ` ${other.name} told me: ${learned[self.id]}.` : ' Just friendly small talk.');
  return { lines, summaries: { [a.id]: summary(a, b), [b.id]: summary(b, a) }, learned };
}

/** Seeded news is non-negotiable: it must come up early. */
function mustShare(c: ConversationCtx): string {
  const out: string[] = [];
  for (const [who, to, news] of [[c.a, c.b, c.aNews], [c.b, c.a, c.bNews]] as const)
    for (const n of news) out.push(`IMPORTANT: ${who.name} must tell ${to.name} this news within their first two lines, with its details: "${n}".`);
  return out.length ? out.join('\n') + '\n\n' : '';
}

export const conversationPrompt: PromptSpec<ConversationCtx, ConversationOut> = {
  kind: 'conversation',
  maxTokens: 1500,
  build: (c) => ({
    system: WORLD_BLURB,
    user:
      `It is ${c.timeLabel} at ${c.place}. ${c.a.name} and ${c.b.name} bump into each other and chat.\n\n` +
      `${describeAgent(c.a)}\n${c.a.name} is: ${c.a.action}.\n` +
      `${c.a.name}'s memories about ${c.b.name}:\n${formatMemories(c.aAboutB)}\n` +
      `${c.a.name}'s memories about the current situation:\n${formatMemories(c.aSituation)}\n\n` +
      `${describeAgent(c.b)}\n${c.b.name} is: ${c.b.action}.\n` +
      `${c.b.name}'s memories about ${c.a.name}:\n${formatMemories(c.bAboutA)}\n` +
      `${c.b.name}'s memories about the current situation:\n${formatMemories(c.bSituation)}\n\n` +
      mustShare(c) +
      `Write a natural, in-character conversation of ${c.hurry ? '3-4' : '4-8'} short lines (each under 15 words), ${c.a.name} speaking first. ` +
      (c.hurry ? `Someone is in a hurry on an urgent errand, so it's quick. ` : '') +
      `If either of them knows interesting news the other doesn't (an event, an offer, gossip), they should mention it with its specifics (what, where, when).\n\n` +
      `Then, for each person, write a one-sentence memory of the chat from their point of view in third person, ` +
      `including any NEW facts they learned with the exact details (e.g. "Asha told Rohan there are free samosas at Chai & Co. at 3pm."). ` +
      `Also give the new fact each learned, or null.\n\n` +
      `Respond with JSON: {"lines":[{"speaker":"${c.a.id}"|"${c.b.id}","text":"..."}],` +
      `"summaries":{"${c.a.id}":"...","${c.b.id}":"..."},"learned":{"${c.a.id}":"..."|null,"${c.b.id}":"..."|null}}`,
  }),
  parse: (json, { a, b, hurry }) => {
    if (!isRecord(json) || !Array.isArray(json.lines) || !isRecord(json.summaries)) return null;
    const ids = new Set([a.id, b.id]);
    const lines = json.lines
      .filter((l): l is { speaker: string; text: string } => isRecord(l) && ids.has(l.speaker as string) && typeof l.text === 'string')
      .map((l) => ({ speakerId: l.speaker, text: l.text.trim().slice(0, 140) }))
      .slice(0, 10);
    const s = json.summaries;
    if (hurry) lines.splice(5);
    if (lines.length < 2 || typeof s[a.id] !== 'string' || typeof s[b.id] !== 'string') return null;
    const learnedIn = isRecord(json.learned) ? json.learned : {};
    const learned = (id: string) => (typeof learnedIn[id] === 'string' && learnedIn[id] ? (learnedIn[id] as string) : null);
    return {
      lines,
      summaries: { [a.id]: s[a.id] as string, [b.id]: s[b.id] as string },
      learned: { [a.id]: learned(a.id), [b.id]: learned(b.id) },
    };
  },
  mock,
  fallback: mock,
};
