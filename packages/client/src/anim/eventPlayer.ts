import type { Color, GameConfig, GameEvent, GameStatus, PieceType, Square } from '@cm/engine';
import { cellTransform, toCell } from '../coords.js';
import { ANIM } from '../theme.js';
import { playCapture, playExplosion, playHop, playPath } from '../sfx.js';
import { pieceElement } from './pieceRefs.js';

/** Lo que el reproductor necesita del store para ir mostrando el movimiento. */
export interface AnimApi {
  config: GameConfig;
  orientation: () => Color;
  setPieceSquare(pieceId: string, sq: Square): void;
  removePiece(pieceId: string): void;
  markDying(pieceId: string): void;
  promote(pieceId: string, to: PieceType): void;
  setBlasts(cells: Square[]): void;
  burnCells(cells: Square[], center: Square): void;
  reveal(cells: Square[]): void;
  /** El store decide si para este jugador es victoria, derrota o tablas. */
  gameEnd(status: GameStatus, winner: Color | null): void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * En una pestana de fondo el navegador congela la linea de tiempo de las animaciones, asi
 * que `animation.finished` no resuelve nunca. Si se esperara, la partida se quedaria
 * bloqueada a media jugada mientras miras otra pestana. Aqui se salta la animacion y se
 * coloca la pieza directamente: al volver, el tablero ya esta al dia.
 */
const hidden = (): boolean => typeof document !== 'undefined' && document.hidden;

/** Un arco por casilla: la pieza avanza a saltitos en vez de deslizarse. */
async function animateHops(
  pieceId: string,
  from: Square,
  cells: Square[],
  api: AnimApi,
): Promise<void> {
  const last = cells[cells.length - 1];
  playPath(cells.length, ANIM.hop);

  const el = pieceElement(pieceId);
  if (!el || typeof el.animate !== 'function' || hidden()) {
    api.setPieceSquare(pieceId, last);
    if (!hidden()) await sleep(ANIM.hop * cells.length);
    return;
  }

  const points = [from, ...cells].map((sq) => toCell(sq, api.config));
  // El tablero de las negras esta rotado 180 grados por CSS, asi que el arco tiene que
  // ir hacia abajo en coordenadas del tablero para verse hacia arriba en pantalla.
  const arc = api.orientation() === 'w' ? -30 : 30;

  const frames: Keyframe[] = [
    { transform: cellTransform(points[0]), offset: 0, easing: 'ease-out' },
  ];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    frames.push({
      transform: `translate(${((a.col + b.col) / 2) * 100}%, ${((a.row + b.row) / 2) * 100 + arc}%)`,
      offset: (i - 0.5) / cells.length,
      easing: 'ease-in',
    });
    frames.push({
      transform: cellTransform(b),
      offset: i / cells.length,
      easing: 'ease-out',
    });
  }

  const duration = ANIM.hop * cells.length;
  const animation = el.animate(frames, { duration, fill: 'forwards' });
  // Red de seguridad: si por lo que sea la animacion no termina, la partida sigue.
  await Promise.race([animation.finished.catch(() => undefined), sleep(duration + 500)]);
  api.setPieceSquare(pieceId, last);
  requestAnimationFrame(() => animation.cancel());
}

/**
 * Reproduce la secuencia de eventos que devuelve el motor. Los saltos consecutivos de una
 * misma pieza se agrupan en una sola animacion para que el recorrido sea continuo.
 */
export async function playEvents(events: GameEvent[], api: AnimApi): Promise<void> {
  let i = 0;
  while (i < events.length) {
    const ev = events[i];

    if (ev.type === 'hop') {
      const cells: Square[] = [ev.to];
      let j = i + 1;
      while (j < events.length) {
        const nextEv = events[j];
        if (nextEv.type !== 'hop' || nextEv.pieceId !== ev.pieceId) break;
        cells.push(nextEv.to);
        j++;
      }
      await animateHops(ev.pieceId, ev.from, cells, api);
      i = j;
      continue;
    }

    switch (ev.type) {
      case 'capture':
        playCapture();
        api.markDying(ev.pieceId);
        if (!hidden()) await sleep(ANIM.capture);
        api.removePiece(ev.pieceId);
        break;
      case 'explosion':
        playExplosion();
        api.burnCells(ev.cells, ev.center);
        api.setBlasts(ev.cells);
        for (const v of ev.victims) api.markDying(v.pieceId);
        if (!hidden()) await sleep(ANIM.explosion * 0.45);
        for (const v of ev.victims) api.removePiece(v.pieceId);
        if (!hidden()) await sleep(ANIM.explosion * 0.55);
        api.setBlasts([]);
        break;
      case 'reveal':
        api.reveal(ev.cells);
        if (!hidden()) await sleep(ANIM.reveal);
        break;
      case 'promotion':
        playHop();
        api.promote(ev.pieceId, ev.to);
        break;
      case 'end':
        api.gameEnd(ev.status, ev.winner);
        break;
    }
    i++;
  }
}
