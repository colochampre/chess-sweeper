import { useEffect, useState } from 'react';
import type { Color, EndReason } from '@cm/engine';
import { MINE_SRC } from '../theme.js';
import { useGame } from '../store.js';
import { drawButton } from '../online.js';
import { stallCounter } from '../counters.js';

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
  timeout: 'Se acabo el tiempo',
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

/**
 * El riel de la partida. Los relojes y los cementerios ya no viven aqui: se fueron a las
 * tiras de cada jugador, a los lados del tablero (FR-7), que es donde se miran sin apartar
 * la vista de la posicion.
 */
export function Hud() {
  const s = useGame();
  const secondsLeft = useSecondsLeft(s.online.opponentDeadline);
  const view = s.view;
  if (view === null) return null;

  const stall = stallCounter(view.halfmoveClock);

  const draw = drawButton({
    mode: s.mode,
    status: view.status,
    mine: s.online.drawMine,
    theirs: s.online.drawTheirs,
    movesLeft: s.online.drawMovesLeft,
    yourTurn: view.turn === s.humanColor,
    armed: s.online.drawArmed,
  });

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
        {/* Su propio contador y no un denominador de la jugada: `fullmove` no tiene techo,
            y esto vuelve a cero con cada peon, cada captura y cada detonacion (AC-707).
            Y no se ensena hasta que dice algo: que aparezca es el dato (AC-902). */}
        {stall.visible && (
          <div
            className={`counter stall${stall.close ? ' close' : ''}`}
            title="Jugadas seguidas sin mover un peon, sin capturar y sin detonar. Al llegar al limite, tablas."
          >
            <span className="label">Sin peon ni captura</span>
            <span>
              {stall.moves}/{stall.limit}
            </span>
          </div>
        )}
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

      <div className="panel actions">
        <h3>Partida</h3>
        {/* Las tablas van primero porque son lo unico de aqui que decide la partida, y
            porque hay que contestarlas cuando llegan. Vive en el HUD, jugando (AC-1313): es
            el sitio del que FR-12 quito el de revancha, porque aquel reiniciaba la partida
            del rival sin avisarle; este no hace nada sin el consentimiento del otro. */}
        {draw !== null && (
          <div className="draw-offer">
            {/* Ofrecer y aceptar mandan lo mismo: el acuerdo lo cierran los dos. */}
            <button
              className={s.online.drawTheirs || s.online.drawArmed ? 'primary' : undefined}
              disabled={draw.disabled}
              onClick={() => {
                if (draw.action === 'arm') return s.armDrawOnline(true);
                if (draw.action === 'disarm') return s.armDrawOnline(false);
                s.offerDrawOnline();
              }}
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
        {/* En online no van: la revancha se ofrece al final de la partida, y desde aqui se le
            reiniciaba la partida al rival en mitad del juego. */}
        {s.mode !== 'online' && (
          <>
            <button onClick={() => s.restart()}>Partida nueva</button>
            <button onClick={() => s.restart(undefined, s.seed)}>Reiniciar misma semilla</button>
          </>
        )}
        <button className="ghost" onClick={s.askLeave}>
          Menu
        </button>
      </div>

      {/* Aparte de las acciones: nada de aqui toca la partida, solo como se la mira. Juntas,
          "Ofrecer tablas" quedaba entre "Girar tablero" y una casilla de sonido. */}
      <div className="panel actions prefs">
        <h3>Preferencias</h3>
        <button onClick={s.flipBoard}>Girar tablero</button>
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
      </div>

      {s.error && <div className="panel error">{s.error}</div>}
    </aside>
  );
}
