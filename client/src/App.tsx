import { GameCanvas } from './game/GameCanvas';
import { EventLog } from './hud/EventLog';
import { TopLeftHud, TopRightHud } from './hud/Hud';
import { Inspector } from './hud/Inspector';
import { SeedDialog } from './hud/SeedDialog';

export function App() {
  return (
    <div className="flex h-full w-full">
      <main className="relative min-w-0 flex-1 overflow-hidden">
        <GameCanvas />
        <TopLeftHud />
        <TopRightHud />
        <EventLog />
        <SeedDialog />
      </main>
      <aside className="pixel-panel m-2 ml-0 flex w-[360px] shrink-0 flex-col p-4">
        <h2 className="mb-3 font-pixel text-[10px] text-moss">Agent Inspector</h2>
        <Inspector />
      </aside>
    </div>
  );
}
