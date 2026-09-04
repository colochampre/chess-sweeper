import { useEffect } from 'react';
import { Table } from './components/Table.js';
import { Hud } from './components/Hud.js';
import { Menu } from './components/Menu.js';
import { Lobby } from './components/Lobby.js';
import { BalancePanel } from './components/BalancePanel.js';
import { MINE_SRC } from './theme.js';
import { useGame } from './store.js';

/**
 * El armazon que comparten las tres pantallas: la misma cabecera, la misma rejilla y el
 * mismo riel a la derecha. Antes cada una traia el suyo —el menu con su titulo, el lobby con
 * otro, la partida sin ninguno— y pasar de una a otra parecia cambiar de aplicacion.
 */
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

  return (
    <div className="app">
      <header className="app-head">
        <img src={MINE_SRC} alt="" className="logo" />
        <h1>Chess Minesweeper</h1>
      </header>
      {screen === 'menu' ? <Menu /> : screen === 'lobby' ? <Lobby /> : <Game />}
    </div>
  );
}

function Game() {
  return (
    <div className="app-body">
      <div className="stage">
        <Table />
        {/* Mismo sitio que la ayuda del menu: lo que se cuenta del tablero va bajo el
            tablero. Estaba al final del HUD, que es la columna de al lado. */}
        <p className="stage-caption">Clic derecho: poner o quitar una bandera roja.</p>
      </div>
      <div className="rail">
        <Hud />
        <BalancePanel />
      </div>
    </div>
  );
}
