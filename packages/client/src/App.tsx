import { useEffect } from 'react';
import { Board } from './components/Board.js';
import { Hud } from './components/Hud.js';
import { Menu } from './components/Menu.js';
import { Lobby } from './components/Lobby.js';
import { BalancePanel } from './components/BalancePanel.js';
import { GameOver } from './components/GameOver.js';
import { useGame } from './store.js';

export function App() {
  const screen = useGame((s) => s.screen);
  const toggleBalancePanel = useGame((s) => s.toggleBalancePanel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName)) return;
      if (e.key === 'b' || e.key === 'B') toggleBalancePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleBalancePanel]);

  if (screen === 'menu') return <Menu />;
  if (screen === 'lobby') return <Lobby />;

  return (
    <div className="game">
      <div className="board-area">
        <Board />
        <GameOver />
      </div>
      <div className="side">
        <Hud />
        <BalancePanel />
      </div>
    </div>
  );
}
