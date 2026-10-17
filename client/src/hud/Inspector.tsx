// Right sidebar: the locked agent, else the selected one.
import { parseHHMM, type PlanBlock } from '@pixel-town/shared';
import { portraitUrl } from '../game/art/portrait';
import { LOCATIONS } from '../world/map';
import { selectAgent, useWorld } from '../world/store';
import { MemoryList } from './MemoryList';
import { SectionTitle } from './ui';

const locName = (id: string | null) => LOCATIONS.find((l) => l.id === id)?.name ?? null;

function PlanTimeline({ plan, minute }: { plan: PlanBlock[]; minute: number }) {
  if (!plan.length) return <p className="font-mono text-xs opacity-60">Still asleep — plans at 07:00.</p>;
  return (
    <ol className="relative ml-1 border-l-2 border-ink/40 pl-3">
      {plan.map((b, i) => {
        const now = parseHHMM(b.start) <= minute && minute < parseHHMM(b.end);
        const past = parseHHMM(b.end) <= minute;
        return (
          <li key={`${b.start}-${i}`} className={`relative mb-1 py-0.5 ${past ? 'opacity-45' : ''}`}>
            <span className={`absolute -left-[19px] top-1.5 h-2.5 w-2.5 border-2 border-ink ${now ? 'bg-gold' : 'bg-parchment'}`} />
            <div
              className={`px-1.5 py-0.5 ${now ? 'bg-gold/40 outline-2 outline-ink' : ''} ${
                b.priority ? 'border-2 border-gold bg-[#fbeec2]' : ''
              }`}
            >
              <span className="font-pixel text-[7px]">{b.start}–{b.end}</span>
              {b.priority && <span className="ml-2 font-pixel text-[7px] text-[#9a6b00]">★ TOP PRIORITY</span>}
              <p className="font-mono text-[12px] leading-tight">
                {b.activity} <span className="opacity-60">· {locName(b.locationId)}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Inspector() {
  const w = useWorld();
  const id = w.lockedId ?? w.selectedId ?? w.order[0];
  const agent = id ? w.agents[id] : undefined;
  if (!agent) {
    return <p className="font-mono text-sm opacity-70">Waiting for the town…</p>;
  }
  const where = locName(agent.locationId);
  const doing = agent.action.startsWith('Heading') || !where ? agent.action : `${agent.action} at ${where}`;
  const convo = [...w.conversations].reverse().find((c) => c.participants.includes(agent.id));
  const name = (aid: string) => w.agents[aid]?.name ?? aid;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-3">
        <img
          src={portraitUrl(agent.id, agent.appearance)}
          alt=""
          className="pixelated h-16 w-16 shrink-0 border-2 border-ink bg-[#cfe6c1]"
        />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="font-pixel text-sm">{agent.name}</h2>
            <span className="font-mono text-xs opacity-70">{agent.age}</span>
            {w.lockedId === agent.id && <span className="font-pixel text-[7px] text-moss">● LOCKED</span>}
          </div>
          <p className="font-mono text-xs opacity-80">{agent.occupation}</p>
          <p className="mt-1 font-mono text-[13px] leading-snug">{doing}</p>
        </div>
      </div>
      <div className="mt-2 flex gap-1">
        {w.order.map((aid) => (
          <button
            key={aid}
            onClick={() => selectAgent(aid)}
            className={`border-2 border-ink px-1.5 py-0.5 font-pixel text-[7px] ${aid === agent.id ? 'bg-ink text-parchment' : 'hover:bg-parchment-dark'}`}
          >
            {name(aid)}
          </button>
        ))}
        <span className="ml-auto self-center font-pixel text-[7px] opacity-60">T = seed thought</span>
      </div>

      <div className="-mr-3 mt-1 min-h-0 flex-1 overflow-y-auto pr-3">
        <SectionTitle>Today's plan</SectionTitle>
        <PlanTimeline plan={w.plans[agent.id] ?? []} minute={w.clock % 1440} />

        <SectionTitle>Last conversation</SectionTitle>
        {convo ? (
          <ul className="space-y-1 border-2 border-ink/30 bg-white/50 p-2 font-mono text-[12px]">
            {convo.lines.map((l, i) => (
              <li key={i}>
                <b className={l.speakerId === agent.id ? 'text-moss' : ''}>{name(l.speakerId)}:</b> {l.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-mono text-xs opacity-60">Hasn't chatted with anyone yet.</p>
        )}

        <SectionTitle>Memory stream</SectionTitle>
        <MemoryList memories={w.memories[agent.id] ?? []} retrieved={w.retrieved[agent.id]} arrivedAt={w.arrivedAt} />
      </div>
    </div>
  );
}
