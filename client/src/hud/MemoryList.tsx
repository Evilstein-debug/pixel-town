// Memory stream rows: newest first, with retrieval score highlights and rumour styling.
import { formatClock, type Memory, type RetrievalResult } from '@pixel-town/shared';
import type { Retrieved } from '../world/store';
import { useNow } from './useNow';

const HIGHLIGHT_MS = 4000;
const FLASH_MS = 1500;

const BADGE: Record<Memory['type'], string> = {
  observation: 'bg-[#cfe6c1] text-moss',
  conversation: 'bg-[#cfe0f3] text-[#27527d]',
  seeded: 'bg-gold text-ink',
  plan: 'bg-[#eadcf2] text-[#5b3a73]',
};

function Pips({ n }: { n: number }) {
  if (!n) return <span className="font-pixel text-[7px] opacity-50">scoring…</span>;
  return (
    <span className="flex gap-[2px]" title={`Importance ${n}/10`}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`h-[6px] w-[6px] border border-ink ${i < n ? (n >= 7 ? 'bg-red-500' : 'bg-leaf') : 'bg-transparent'}`} />
      ))}
    </span>
  );
}

function ScoreBars({ r }: { r: RetrievalResult }) {
  const bar = (label: string, v: number, color: string) => (
    <div className="flex items-center gap-1" title={`${label} ${v.toFixed(2)}`}>
      <span className="w-3 font-pixel text-[7px]">{label[0]}</span>
      <span className="h-[6px] w-16 border border-ink bg-white">
        <span className={`block h-full ${color}`} style={{ width: `${Math.round(v * 100)}%` }} />
      </span>
    </div>
  );
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
      {bar('recency', r.recency, 'bg-sky-500')}
      {bar('importance', r.importance, 'bg-red-500')}
      {bar('relevance', r.relevance, 'bg-leaf')}
    </div>
  );
}

export function MemoryList({
  memories, retrieved, arrivedAt,
}: { memories: Memory[]; retrieved?: Retrieved; arrivedAt: Record<string, number> }) {
  const now = useNow(500);
  const live = retrieved && now - retrieved.at < HIGHLIGHT_MS ? retrieved : undefined;
  const scores = new Map(live?.results.map((r) => [r.memoryId, r]));

  return (
    <div>
      {live && (
        <p className="mb-2 truncate font-mono text-[11px] text-moss" title={live.query}>
          ⌕ recalled for: “{live.query}”
        </p>
      )}
      <ul className="space-y-2">
        {memories.map((m) => {
          const score = scores.get(m.id);
          const rumour = !!m.seedId;
          const border = m.type === 'seeded'
            ? 'border-gold border-[3px] bg-[#fbeec2]'
            : rumour ? 'border-gold border-[3px] border-dashed' : 'border-ink/30';
          const fresh = now - (arrivedAt[m.id] ?? 0) < FLASH_MS;
          return (
            <li
              key={score ? `${m.id}@${live!.at}` : m.id}
              className={`border-2 px-2 py-1.5 ${border} ${fresh ? 'flash-in' : ''} ${score ? 'retrieved-hl' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-pixel text-[7px] opacity-70">{formatClock(m.createdAt)}</span>
                <span className="flex items-center gap-1">
                  {rumour && m.type !== 'seeded' && <span className="font-pixel text-[7px] text-[#9a6b00]">RUMOUR</span>}
                  <span className={`px-1 font-pixel text-[7px] uppercase ${BADGE[m.type]}`}>{m.type}</span>
                </span>
              </div>
              <p className="my-1 font-mono text-[12.5px] leading-snug">{m.text}</p>
              <Pips n={m.importance} />
              {score && <ScoreBars r={score} />}
            </li>
          );
        })}
        {!memories.length && <li className="font-mono text-xs opacity-60">No memories yet.</li>}
      </ul>
    </div>
  );
}
