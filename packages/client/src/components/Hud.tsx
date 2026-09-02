import { useEffect, useState } from 'react';
import type { Color, EndReason, PieceType } from '@cm/engine';
import { MINE_SRC, PIECE_VALUE, pieceSrc } from '../theme.js';
import { useGame } from '../store.js';
import { drawButton } from '../online.js';

export const COLOR_NAME: Record<Color, string> = { w: 'Blancas', b: 'Negras' };

export const END_TEXT: Record<EndReason, string> = {
  checkmate: 'Jaque mate',
  stalemate: 'Rey ahogado: tablas',
  'king-destroyed': 'El rey ha volado por los aires',
  'both-kings-destroyed': 'Los dos reyes han volado: tablas',
  'insufficient-material': 'Tablas por material insuficiente',
  'fifty-move': 'Tablas por la regla de 50 jugadas',
  abandoned: 'Partida abandonada',
  'agreed-draw': 'Tablas acordadas',
};

/**
 * Cuenta atras hasta `deadline`, refrescada cada segundo. El store guarda el instante y no
 * los segundos que faltan, asi que solo late este componente y no todo el estado.
 */
function useSecondsLeft(deadline: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
      setLeft(null);
      return;
    }
    const tick = (): void => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [deadline]);

  return left;
}

export function Hud() {
  const s = useGame();
  const secondsLeft = useSecondsLeft(s.online.opponentDeadline);
  const view = s.view;
  if (view === null) return null;

  const draw = drawButton({
    mine: s.online.drawMine,
    theirs: s.online.drawTheirs,
    movesLeft: s.online.drawMovesLeft,
  });

  const lost = (color: Color): PieceType[] =>
    view.captured.filter((p) => p.color === color).map((p) => p.type);
  const materialDiff =
    lost('b').reduce((n, t) => n + PIECE_VALUE[t], 0) -
    lost('w').reduce((n, t) => n + PIECE_VALUE[t], 0);

  const graveyard = (color: Color) => (
    <div className="graveyard">
      {lost(color)
        .sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a])
        .map((t, i) => (
          <img key={`${t}${i}`} src={pieceSrc(t, color)} alt={t} />
        ))}
    </div>
  );

  return (
    <aside className="hud">
      {s.mode === 'online' && (
        <div className="panel online-bar">
          <span className="label">Sala</span>
          <strong className="code">{s.online.code ?? '—'}</strong>
          <span className={`status ${s.online.opponentConnected ? 'on' : 'off'}`}>
            {!s.online.connected
              ? 'Reconectando…'
              : s.online.opponentConnected
                ? 'Rival conectado'
                : secondsLeft === null
                  ? 'Esperando al rival…'
                  : `Esperando al rival… ${secondsLeft}s`}
          </span>
        </div>
      )}

      <div className="panel counters">
        <div className="counter" title="Minas sin detonar">
          <img src={MINE_SRC} alt="minas" />
          <span>{String(view.minesRemaining).padStart(2, '0')}</span>
        </div>
        <div className="counter" title="Jugada">
          <span className="label">Jugada</span>
          <span>{view.fullmove}</span>
        </div>
      </div>

      <div className="panel turn">
        {view.status === 'playing' ? (
          <>
            <span className={`dot ${view.turn}`} />
            <strong>
              {s.mode === 'hotseat' || view.turn !== s.humanColor
                ? `Turno de ${COLOR_NAME[view.turn].toLowerCase()}`
                : 'Te toca'}
            </strong>
            {view.inCheck && <span className="check">JAQUE</span>}
          </>
        ) : (
          <strong>
            {view.endReason ? END_TEXT[view.endReason] : 'Fin'}
            {view.winner && ` — ganan las ${COLOR_NAME[view.winner].toLowerCase()}`}
          </strong>
        )}
      </div>

      <div className="panel captures">
        <div className="side">
          <span className="label">Negras perdidas</span>
          {graveyard('b')}
        </div>
        <div className="side">
          <span className="label">Blancas perdidas</span>
          {graveyard('w')}
        </div>
        <div className="material">
          Material:{' '}
          {materialDiff > 0
            ? `+${materialDiff} blancas`
            : materialDiff < 0
              ? `+${-materialDiff} negras`
              : 'igualado'}
        </div>
      </div>

      <div className="panel actions">
        {/* En online no va: la revancha se ofrece al final de la partida, y desde aqui se le
            reiniciaba la partida al rival en mitad del juego. */}
        {s.mode !== 'online' && (
          <>
            <button onClick={() => s.restart()}>Partida nueva</button>
            <button onClick={() => s.restart(undefined, s.seed)}>Reiniciar misma semilla</button>
          </>
        )}
        <button onClick={s.flipBoard}>Girar tablero</button>
        {/* Las tablas se ofrecen jugando, asi que el boton vive con el resto de acciones del
            tablero y no en el final. Es el sitio del que FR-12 quito el de revancha, porque
            aquel reiniciaba la partida del rival sin avisarle; este no hace nada sin el
            consentimiento del otro. */}
        {s.mode === 'online' && view.status === 'playing' && (
          <div className="draw-offer">
            {/* Ofrecer y aceptar mandan lo mismo: el acuerdo lo cierran los dos. */}
            <button
              className={s.online.drawTheirs ? 'primary' : undefined}
              disabled={draw.disabled}
              onClick={s.offerDrawOnline}
            >
              {draw.label}
            </button>
            {s.online.drawTheirs && (
              <button className="danger" onClick={s.declineDrawOnline}>
                Rechazar
              </button>
            )}
          </div>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={s.flipEachTurn}
            disabled={s.mode !== 'hotseat'}
            onChange={(e) => s.setFlipEachTurn(e.target.checked)}
          />
          Girar en cada turno
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={s.soundOn}
            onChange={(e) => s.setSoundOn(e.target.checked)}
          />
          Sonido
        </label>
        {s.mode !== 'online' && (
          <button onClick={s.toggleBalancePanel}>
            {s.showBalance ? 'Ocultar' : 'Mostrar'} panel de balance
          </button>
        )}
        <button className="ghost" onClick={s.askLeave}>
          Menu
        </button>
      </div>

      <p className="hint">Clic derecho: poner o quitar una bandera roja.</p>
      {s.error && <div className="panel error">{s.error}</div>}
    </aside>
  );
}
