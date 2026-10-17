// Mounts the Phaser game inside React. React never touches game state per frame.
import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { TownScene } from './TownScene';

export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: Phaser.Game | null = null;
    let cancelled = false;
    // In-canvas text uses Press Start 2P; wait for it so name tags don't render in a fallback font.
    document.fonts.load('8px "Press Start 2P"').finally(() => {
      if (cancelled || !hostRef.current) return;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        backgroundColor: '#3f8a3c',
        pixelArt: true,
        roundPixels: true,
        scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
        scene: [TownScene],
      });
    });
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0 game-host" />;
}
