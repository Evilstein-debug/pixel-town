// Conversations: nearby awake agents may chat; the chat spreads information.
import { formatClock, locationAt, toHHMM, type ConversationRecord } from '@pixel-town/shared';
import { runPrompt } from '../llm/client';
import { locationName } from '../prompts/common';
import { conversationPrompt } from '../prompts/conversation';
import { shouldTalkPrompt } from '../prompts/shouldTalk';
import { chebyshev, currentBlock, halt } from './behavior';
import { knownRumours, recall } from './cognition';
import type { SimContext } from './context';
import { minuteOfDay, TICK_MINUTES } from './time';
import { pairKey, type AgentState } from './types';

const TALK_DISTANCE = 2;
const TALK_COOLDOWN_MIN = 60;
/** Unshared seeded news waits only this long between chats — spreading it is urgent. */
const NEWS_COOLDOWN_MIN = 20;

const available = (a: AgentState) => !a.asleep && !a.busy && !a.talkingWith && a.plan.length > 0;

export function checkConversations(ctx: SimContext) {
  const { agents, clock, lastTalk } = ctx.world;
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i], b = agents[j];
      if (!available(a) || !available(b)) continue;
      if (chebyshev({ x: a.tileX, y: a.tileY }, { x: b.tileX, y: b.tileY }) > TALK_DISTANCE) continue;
      const aHasNews = hasNewsFor(ctx, a, b), bHasNews = hasNewsFor(ctx, b, a);
      const cooldown = aHasNews || bHasNews ? NEWS_COOLDOWN_MIN : TALK_COOLDOWN_MIN;
      if (clock - (lastTalk[pairKey(a.id, b.id)] ?? -Infinity) < cooldown) continue;
      // Whoever has news opens.
      void converse(ctx, bHasNews && !aHasNews ? b : a, bHasNews && !aHasNews ? a : b);
    }
  }
}

function newsFor(ctx: SimContext, from: AgentState, to: AgentState): string[] {
  const theirs = knownRumours(ctx.world, to.id);
  return [...knownRumours(ctx.world, from.id)].filter(([id]) => !theirs.has(id)).map(([, text]) => text);
}
const hasNewsFor = (ctx: SimContext, from: AgentState, to: AgentState) => newsFor(ctx, from, to).length > 0;

function face(a: AgentState, b: AgentState) {
  const dx = b.tileX - a.tileX, dy = b.tileY - a.tileY;
  a.facing = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';
}

async function converse(ctx: SimContext, a: AgentState, b: AgentState) {
  const world = ctx.world;
  world.lastTalk[pairKey(a.id, b.id)] = world.clock;
  a.busy = b.busy = true;
  halt(ctx, a);
  halt(ctx, b);
  face(a, b);
  face(b, a);
  const placeId = locationAt(a.tileX, a.tileY)?.id ?? null;
  const place = locationName(placeId);
  try {
    const aAboutB = await recall(ctx, a, `${b.name}`, 5);
    const aNews = newsFor(ctx, a, b), bNews = newsFor(ctx, b, a);
    // Someone carrying unshared seeded news always stops to pass it on.
    const ok = aNews.length > 0 || bNews.length > 0 || (await runPrompt(shouldTalkPrompt, { a, b, place, aAboutB }));
    if (!ctx.isCurrent(world)) return;
    if (!ok) {
      ctx.log(`${a.name} waved at ${b.name} but kept going`);
      return;
    }
    const situation = (x: AgentState) => `${x.action} at ${place}; news worth sharing`;
    const [aSituation, bAboutA, bSituation] = await Promise.all([
      recall(ctx, a, situation(a), 5), recall(ctx, b, `${a.name}`, 5), recall(ctx, b, situation(b), 5),
    ]);
    const convo = await runPrompt(conversationPrompt, {
      a, b, place, timeLabel: toHHMM(minuteOfDay(world.clock)),
      aAboutB, aSituation, bAboutA, bSituation, aNews, bNews,
      hurry: [a, b].some((x) => currentBlock(x, world.clock)?.priority),
    });
    if (!ctx.isCurrent(world)) return;

    const record: ConversationRecord = {
      id: `c${++world.seq}`, participants: [a.id, b.id], lines: convo.lines, ts: world.clock, locationId: placeId,
    };
    world.conversations.push(record);
    if (world.conversations.length > 50) world.conversations.shift();
    // One line per tick keeps speech bubbles readable at any sim speed.
    a.talkingWith = b.id;
    b.talkingWith = a.id;
    a.talkUntil = b.talkUntil = world.clock + convo.lines.length * TICK_MINUTES;
    // Cooldown runs from the end of the chat, so they part ways before chatting again.
    world.lastTalk[pairKey(a.id, b.id)] = a.talkUntil;
    ctx.io.emit('conversation', record);
    ctx.log(`${a.name} and ${b.name} are chatting${placeId ? ` at ${place}` : ' on the way'}`);
    for (const [self, other] of [[a, b], [b, a]] as const) {
      const learned = convo.learned[self.id];
      if (learned) ctx.log(`${other.name} told ${self.name}: ${learned}`);
      // The teller's own news counts too, so both sides' memories carry the rumour tag.
      await ctx.addMemory(self.id, 'conversation', convo.summaries[self.id], undefined, learned ?? convo.learned[other.id] ?? undefined);
    }
    console.log(`[talk] ${formatClock(world.clock)} ${a.name} ↔ ${b.name}: ${convo.lines.length} lines`);
  } finally {
    a.busy = b.busy = false;
  }
}
