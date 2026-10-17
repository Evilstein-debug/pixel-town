// Bottom event log: a one-line ticker, expandable to recent history.
import { useEffect, useRef, useState } from 'react';
import { formatClock } from '@pixel-town/shared';
import { useWorld } from '../world/store';

const HIGHLIGHT = /told|seeded|changed plans|drops everything|urgent|short/i;

export function EventLog() {
  const w = useWorld();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const latest = w.log[w.log.length - 1];

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, w.log.length]);

  return (
    <div className="pixel-panel absolute bottom-3 left-3 right-3 font-mono text-[13px]">
      {open && (
        <ul ref={listRef} className="max-h-48 overflow-y-auto border-b-2 border-ink px-3 py-2">
          {w.log.slice(-80).map((e, i) => (
            <li key={i} className={HIGHLIGHT.test(e.text) ? 'font-bold text-moss' : ''}>
              <span className="mr-2 font-pixel text-[7px] opacity-60">{formatClock(e.ts)}</span>
              {e.text}
            </li>
          ))}
        </ul>
      )}
      <button className="flex w-full items-center gap-3 px-3 py-2 text-left" onClick={() => setOpen(!open)}>
        <span className="font-pixel text-[9px] text-moss">{open ? '▾' : '▸'} EVENTS</span>
        {latest && (
          <span key={w.log.length} className={`flash-in truncate ${HIGHLIGHT.test(latest.text) ? 'font-bold' : ''}`}>
            <span className="mr-2 font-pixel text-[7px] opacity-60">{formatClock(latest.ts)}</span>
            {latest.text}
          </span>
        )}
        <span className="ml-auto shrink-0 font-pixel text-[7px] opacity-60">
          WASD pan · Q/E zoom · Tab lock · Esc free · Space pause · 1/2/3 speed · T seed
        </span>
      </button>
    </div>
  );
}
