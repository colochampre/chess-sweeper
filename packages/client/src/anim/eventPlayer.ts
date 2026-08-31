import type { Color, GameConfig, GameEvent, PieceType, Square } from '@cm/engine';
import { cellTransform, toCell } from '../coords.js';
import { ANIM } from '../theme.js';
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
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Un arco por casilla: la pieza avanza a saltitos en vez de deslizarse. */
async function animateHops(
  pieceId: string,
  from: Square,
  cells: Square[],
  api: AnimApi,
): Promise<void> {
  const last = cells[cells.length - 1];
  const el = pieceElement(pieceId);
  if (!el || typeof el.animate !== 'function') {
    api.setPieceSquare(pieceId, last);
    await sleep(ANIM.hop * cells.length);
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

  const animation = el.animate(frames, {
    duration: ANIM.hop * cells.length,
    fill: 'forwards',
  });
  await animation.finished.catch(() => undefined);
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
        api.markDying(ev.pieceId);
        await sleep(ANIM.capture);
        api.removePiece(ev.pieceId);
        break;
      case 'explosion':
        api.burnCells(ev.cells, ev.center);
        api.setBlasts(ev.cells);
        for (const v of ev.victims) api.markDying(v.pieceId);
        await sleep(ANIM.explosion * 0.45);
        for (const v of ev.victims) api.removePiece(v.pieceId);
        await sleep(ANIM.explosion * 0.55);
        api.setBlasts([]);
        break;
      case 'reveal':
        api.reveal(ev.cells);
        await sleep(ANIM.reveal);
        break;
      case 'promotion':
        api.promote(ev.pieceId, ev.to);
        break;
      case 'end':
        break;
    }
    i++;
  }
}
