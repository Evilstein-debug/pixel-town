// "Seed a thought" input (T key): inserts a seeded observation into an agent's memory.
import { useEffect, useRef, useState } from 'react';
import { bus } from '../bus';
import { socket } from '../net/socket';
import { useWorld } from '../world/store';

export function SeedDialog() {
  const w = useWorld();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => bus.on('ui:seed', (id) => setAgentId(id)), []);
  useEffect(() => {
    if (agentId) inputRef.current?.focus();
  }, [agentId]);

  if (!agentId) return null;
  const close = () => {
    setAgentId(null);
    setText('');
    bus.emit('ui:typing', false);
  };
  const submit = () => {
    if (text.trim()) socket.emit('event:seed', { agentId, text: text.trim() });
    close();
  };

  return (
    <div className="absolute inset-x-0 top-1/3 flex justify-center">
      <div className="pixel-panel w-[440px] p-4">
        <h3 className="font-pixel text-[10px] text-moss">Seed a thought into {w.agents[agentId]?.name}</h3>
        <p className="mt-1 font-mono text-xs opacity-70">Becomes a “seeded” memory with importance 8.</p>
        <input
          ref={inputRef}
          value={text}
          placeholder="free samosas at the café at 3pm"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => bus.emit('ui:typing', true)}
          onBlur={() => bus.emit('ui:typing', false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') close();
          }}
          className="mt-3 w-full border-2 border-ink bg-white px-2 py-2 font-mono text-sm outline-none focus:border-moss"
        />
        <p className="mt-2 font-pixel text-[7px] opacity-60">ENTER to seed · ESC to cancel</p>
      </div>
    </div>
  );
}
