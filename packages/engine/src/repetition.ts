import type { GameState } from './types.js';

/**
 * Clave de una posicion, para las tablas por repeticion (AC-709).
 *
 * Son las cuatro de siempre: donde esta cada pieza, quien mueve, los derechos de enroque y
 * la captura al paso. Ni el revelado, ni las banderas, ni los crateres, ni las minas: la
 * legalidad ignora las minas, asi que si los movimientos posibles son identicos la posicion
 * es la misma, sepas lo que sepas del terreno.
 *
 * Las piezas van por tipo y color y nunca por su `id`. Dos caballos que se intercambian las
 * casillas dejan la misma posicion, no una nueva: ninguna jugada los distingue.
 */
export function positionKey(state: GameState): string {
  let board = '';
  for (const piece of state.board) {
    board +=
      piece === null ? '.' : piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
  }

  const { w, b } = state.castling;
  const castling =
    `${w.k ? 'K' : ''}${w.q ? 'Q' : ''}${b.k ? 'k' : ''}${b.q ? 'q' : ''}` || '-';

  return `${board} ${state.turn} ${castling} ${state.enPassant ?? '-'}`;
}

/** Cuantas veces se ha dado ya la posicion en la que esta la partida. */
export const timesSeen = (state: GameState): number =>
  state.positions[positionKey(state)] ?? 0;
