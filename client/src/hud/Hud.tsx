// HUD overlays drawn on top of the game canvas.
import { useEffect, useRef, useState } from 'react';
import { formatClock } from '@pixel-town/shared';
import { bus, type CameraMode } from '../bus';
import { socket } from '../net/socket';
import { useWorld } from '../world/store';
import { Chip, PixelButton } from './ui';

function useBusState<T>(subscribe: (set: (v: T) => void) => () => void, initial: T): T {
  const [v, setV] = useState(initial);
  useEffect(() => subscribe(setV), []); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

export function TopLeftHud() {
  const w = useWorld();
  const speedCtl = (value: number) => socket.emit('sim:control', { cmd: 'speed', value });
  return (
    <div className="absolute left-3 top-3 flex items-start gap-2">
      <Chip>{w.loaded ? formatClock(w.clock) : 'Day - · --:--'}</Chip>
      <div className="pixel-panel flex items-center gap-1 p-1">
        <PixelButton
          title="Space"
          active={w.paused}
          onClick={() => socket.emit('sim:control', { cmd: w.paused ? 'play' : 'pause' })}
        >
          {w.paused ? '▶ PLAY' : '❚❚ PAUSE'}
        </PixelButton>
        {[1, 2, 4].map((s, i) => (
          <PixelButton key={s} title={`Key ${i + 1}`} active={w.speed === s} onClick={() => speedCtl(s)}>
            {s}×
          </PixelButton>
        ))}
      </div>
      <SnapshotMenu />
      {!w.connected && <Chip className="text-red-700">SERVER OFFLINE</Chip>}
    </div>
  );
}

function SnapshotMenu() {
  const w = useWorld();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div className="pixel-panel p-1">
        <PixelButton active={open} onClick={() => setOpen(!open)}>SNAPSHOTS ▾</PixelButton>
      </div>
      {open && (
        <div className="pixel-panel absolute left-0 top-full z-20 mt-2 w-72 p-2">
          <PixelButton onClick={() => socket.emit('snapshot:save')}>+ SAVE CURRENT</PixelButton>
          <ul className="mt-2 max-h-64 overflow-y-auto font-mono text-xs">
            {w.snapshots.length === 0 && <li className="px-1 py-2 opacity-60">No snapshots yet.</li>}
            {w.snapshots.map((f) => (
              <li key={f}>
                <button
                  className="w-full truncate px-1 py-1 text-left hover:bg-parchment-dark"
                  title={`Load ${f}`}
                  onClick={() => {
                    socket.emit('replay:load', { file: f });
                    setOpen(false);
                  }}
                >
                  ↺ {f.replace(/\.json$/, '')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TopRightHud() {
  const w = useWorld();
  const mode = useBusState<CameraMode>((set) => bus.on('camera:mode', set), { kind: 'free' });
  const lockedName = mode.kind === 'locked' ? w.agents[mode.agentId]?.name ?? mode.agentId : null;
  return (
    <div className="absolute right-3 top-3 flex gap-2">
      <Chip className={lockedName ? 'bg-moss! text-parchment!' : ''}>
        {lockedName ? `LOCKED: ${lockedName}` : 'FREE'}
      </Chip>
    </div>
  );
}
