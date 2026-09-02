import { useGame } from '../store.js';
import { COLOR_NAME, END_TEXT } from './Hud.js';

export function GameOver() {
  const s = useGame();
  const view = s.view;
  if (view === null || view.status === 'playing' || s.animating) return null;

  const youWon = s.mode !== 'hotseat' && view.winner === s.humanColor;
  const youLost = s.mode !== 'hotseat' && view.winner !== null && view.winner !== s.humanColor;
  // En online el rival es una persona. Llamarlo "la maquina" solo tiene sentido contra el bot.
  const defeatText = s.mode === 'bot' ? 'Gana la maquina.' : 'Gana tu rival.';

  // La revancha se acuerda entre dos: el boton dice en que punto esta el acuerdo, porque un
  // boton que no responde no se distingue de uno roto.
  const rematchPending = s.mode === 'online' && s.online.rematchMine;
  const rematchLabel =
    s.mode !== 'online'
      ? 'Otra partida'
      : s.online.rematchMine
        ? 'Esperando a tu rival…'
        : s.online.rematchTheirs
          ? 'Tu rival quiere la revancha'
          : 'Revancha';

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
                ? defeatText
                : `Ganan las ${COLOR_NAME[view.winner].toLowerCase()}.`}
        </p>
        <div className="row">
          <button className="primary" onClick={() => s.restart()} disabled={rematchPending}>
            {rematchLabel}
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
