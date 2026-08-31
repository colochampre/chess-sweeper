import { useGame } from '../store.js';
import { COLOR_NAME, END_TEXT } from './Hud.js';

export function GameOver() {
  const s = useGame();
  const view = s.view;
  if (view === null || view.status === 'playing' || s.animating) return null;

  const youWon = s.mode !== 'hotseat' && view.winner === s.humanColor;
  const youLost = s.mode !== 'hotseat' && view.winner !== null && view.winner !== s.humanColor;

  return (
    <div className="game-over">
      <div className="card">
        <h2>{view.endReason ? END_TEXT[view.endReason] : 'Fin de la partida'}</h2>
        <p>
          {view.winner === null
            ? 'Nadie gana: la partida acaba en tablas.'
            : youWon
              ? 'Ganas tu.'
              : youLost
                ? 'Gana la maquina.'
                : `Ganan las ${COLOR_NAME[view.winner].toLowerCase()}.`}
        </p>
        <div className="row">
          <button className="primary" onClick={() => s.restart()}>
            {s.mode === 'online' ? 'Revancha' : 'Otra partida'}
          </button>
          {s.mode !== 'online' && (
            <button onClick={() => s.restart(undefined, s.seed)}>Repetir semilla</button>
          )}
          <button className="ghost" onClick={s.backToMenu}>
            Menu
          </button>
        </div>
      </div>
    </div>
  );
}
