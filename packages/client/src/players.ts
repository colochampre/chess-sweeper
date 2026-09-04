import type { Color, Piece, PieceType } from '@cm/engine';
import { PIECE_VALUE } from './theme.js';

/** Lo que se muestra al lado de un jugador: su botin y, si la tiene, su ventaja. */
export interface PlayerStrip {
  /** Piezas que capturo ESTE jugador, de la mas valiosa a la menos. */
  taken: PieceType[];
  /** Ventaja material, y solo en el lado que va ganando. Cero en el otro y en tablas. */
  advantage: number;
}

const worth = (pieces: PieceType[]): number =>
  pieces.reduce((n, t) => n + PIECE_VALUE[t], 0);

/**
 * El botin de un jugador son las piezas del OTRO color: uno no captura las suyas. Es la
 * lectura de cualquier tablero de ajedrez y la que hace falta para poner el botin al lado de
 * quien lo consiguio, en vez de dos listas de "perdidas" que hay que traducir mentalmente.
 *
 * La ventaja se muestra en un solo lado. Escribirla en los dos —"+3" arriba y "-3" abajo— es
 * decir lo mismo dos veces y obligar a leer un signo para saber quien va ganando.
 */
export function playerStrip(captured: Piece[], color: Color): PlayerStrip {
  const rival: Color = color === 'w' ? 'b' : 'w';
  const taken = captured
    .filter((p) => p.color === rival)
    .map((p) => p.type)
    .sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]);
  const lost = captured.filter((p) => p.color === color).map((p) => p.type);

  return { taken, advantage: Math.max(0, worth(taken) - worth(lost)) };
}
