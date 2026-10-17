// Pixel-styled HUD primitives.
import type { ReactNode } from 'react';

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`pixel-panel px-3 py-2 font-pixel text-[10px] leading-4 ${className}`}>{children}</div>;
}

export function PixelButton({
  children, onClick, active = false, title,
}: { children: ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`border-2 border-ink px-2 py-1 font-pixel text-[9px] leading-3 transition-transform active:translate-x-px active:translate-y-px ${
        active ? 'bg-moss text-parchment' : 'bg-parchment text-ink hover:bg-parchment-dark'
      }`}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-4 font-pixel text-[9px] uppercase tracking-wide text-moss">{children}</h3>;
}
