import { useEffect, useState, type ReactNode } from 'react';
import { TIME_CONTROLS, type Color, type PieceType, type TimeControl } from '@cm/engine';
import { pieceSrc } from '../theme.js';
import { useGame } from '../store.js';
import { clockRemaining, formatClock, type ClockView } from '../online.js';
import { playerStrip } from '../players.js';
import { Board } from './Board.js';
import { GameOver } from './GameOver.js';
import { ConfirmLeave } from './ConfirmLeave.js';
import { COLOR_NAME } from './Hud.js';

/** Un lado de la mesa. Ni store ni partida: lo que se dibuja y nada mas. */
export interface SideModel {
  color: Color;
  label: string;
  /** Piezas que capturo este jugador. Vacio antes de empezar. */
  taken: PieceType[];
  advantage: number;
  /** Milisegundos a mostrar, o `null` si la sala se juega sin reloj. */
  clockMs: number | null;
  ticking: boolean;
}

function Side({ color, label, taken, advantage, clockMs, ticking }: SideModel) {
  return (
    <div className="side-bar">
      <span className={`dot ${color}`} />
      <span className="who">{label}</span>
      <div className="graveyard">
        {taken.map((t, i) => (
          <img key={`${t}${i}`} src={pieceSrc(t, color === 'w' ? 'b' : 'w')} alt={t} />
        ))}
      </div>
      {advantage > 0 && <span className="advantage">+{advantage}</span>}
      {clockMs !== null && (
        <div className={`clock${ticking ? ' ticking' : ''}${clockMs <= 10_000 ? ' low' : ''}`}>
          <strong>{formatClock(clockMs)}</strong>
        </div>
      )}
    </div>
  );
}

/**
 * El tablero con un jugador a cada lado. Lo usan las tres pantallas: en el menu y en el
 * lobby con las tiras en su estado de salida, y jugando con lo que va pasando.
 *
 * Las tiras no aparecen y desaparecen segun la pantalla: donde hay tablero, hay mesa. Si en
 * el menu no estuviesen, entrar a jugar movería el tablero de sitio.
 */
export function TableView({
  top,
  bottom,
  note,
  children,
}: {
  top: SideModel;
  bottom: SideModel;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="table">
      <Side {...top} />
      <div className="board-area">{children}</div>
      <Side {...bottom} />
      {note !== undefined && <span className="hint table-note">{note}</span>}
    </div>
  );
}

/**
 * Las tiras antes de que empiece la partida: sin botin, sin ventaja, y con el reloj que se
 * eligio puesto en su valor inicial. Elegir 10+5 y ver 10:00 en los dos lados es la misma
 * idea que ver espesarse la niebla al subir las minas (AC-106): la eleccion se ve donde va
 * a importar.
 */
export function openingSides(
  timeControl: TimeControl,
  yourColor: Color,
): { top: SideModel; bottom: SideModel } {
  const setting = TIME_CONTROLS[timeControl];
  const clockMs = setting === null ? null : setting.initialMs;
  const rival: Color = yourColor === 'w' ? 'b' : 'w';
  const side = (color: Color, label: string): SideModel => ({
    color,
    label,
    taken: [],
    advantage: 0,
    clockMs,
    // Nadie corre todavia: el reloj arranca con la primera jugada de las blancas (AC-1403).
    ticking: false,
  });

  return { top: side(rival, 'Tu rival'), bottom: side(yourColor, 'Vos') };
}

/**
 * Late mientras el reloj corre y se para cuando no. Se refresca cada decima porque por
 * debajo de diez segundos se muestran decimas; con el reloj parado no hay nada que refrescar
 * y el intervalo ni se crea.
 *
 * Vive en el padre de las dos tiras para que los dos relojes se dibujen del MISMO instante
 * (AC-704). Uno por tira serian dos intervalos desfasados leyendo dos `Date.now()`.
 */
function useClockTick(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);

  return running ? now : Date.now();
}

/** La mesa de la partida en curso. */
export function Table() {
  const s = useGame();
  // El reloj es de online: hotseat y bot no tienen todavia (FR-14). Y lo que se dibuja es lo
  // ultimo que dijo el servidor, que el cliente no lleva su cuenta (AC-1412).
  const clock: ClockView | null = s.mode === 'online' ? s.online.clock : null;
  const now = useClockTick(clock !== null && clock.running !== null);

  const view = s.view;
  if (view === null) return null;

  // Abajo va quien tiene el tablero orientado hacia si, no quien sea el humano: en hotseat
  // las tiras se dan la vuelta con el tablero y siguen diciendo la verdad (AC-703).
  const bottom = s.orientation;
  const top: Color = bottom === 'w' ? 'b' : 'w';
  const name = (c: Color): string =>
    s.mode === 'hotseat' || c !== s.humanColor ? COLOR_NAME[c] : 'Vos';
  const side = (color: Color): SideModel => ({
    color,
    label: name(color),
    ...playerStrip(view.captured, color),
    clockMs: clock === null ? null : clockRemaining(clock, color, now),
    ticking: clock?.running === color,
  });

  return (
    <TableView
      top={side(top)}
      bottom={side(bottom)}
      note={clock !== null && clock.running === null ? 'Reloj en pausa' : undefined}
    >
      <Board />
      <GameOver />
      <ConfirmLeave />
    </TableView>
  );
}
