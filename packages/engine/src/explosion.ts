import { areaAround } from './board.js';
import { computeAdjacency } from './minefield.js';
import { recascade } from './reveal.js';
import type { Color, GameEvent, GameState, PieceType, Square } from './types.js';

/**
 * FR-6: detona la mina de `origin` y propaga la cadena en anchura.
 * Destruye todas las piezas del area, de ambos colores (AC-601).
 * Devuelve los colores cuyo rey ha sido destruido.
 */
export function detonate(
  state: GameState,
  origin: Square,
  events: GameEvent[],
  revealedOut: Square[],
): Color[] {
  const c = state.config;
  const queue: Square[] = [origin];
  const done = new Set<Square>();
  const kingsDestroyed: Color[] = [];

  while (queue.length > 0) {
    const center = queue.shift() as Square;
    if (done.has(center)) continue; // AC-606: ninguna mina detona dos veces
    done.add(center);
    state.mines[center] = false;
    state.craters[center] = true;
    state.knownMines[center] = false;

    const cells = areaAround(center, c.explosionRadius, c);
    const victims: { pieceId: string; pieceType: PieceType; color: Color; at: Square }[] = [];

    for (const cell of cells) {
      state.detonated[cell] = true; // AC-604
      state.revealed[cell] = true;

      const piece = state.board[cell];
      if (piece !== null) {
        if (piece.type === 'k' && c.kingImmuneToMines) {
          // AC-705: el rey aguanta la explosion.
        } else {
          state.board[cell] = null;
          state.captured.push(piece);
          victims.push({ pieceId: piece.id, pieceType: piece.type, color: piece.color, at: cell });
          if (piece.type === 'k') kingsDestroyed.push(piece.color);
        }
      }

      if (state.mines[cell] && !done.has(cell)) {
        // AC-602/603: con cadena detona tambien; sin cadena queda a la vista pero activa.
        if (c.chainExplosions) queue.push(cell);
        else state.knownMines[cell] = true;
      }
    }

    events.push({ type: 'explosion', center, cells, victims });
  }

  // AC-605: han desaparecido minas, asi que los numeros cambian y la cascada puede continuar.
  state.adjacency = computeAdjacency(state.mines, c);
  revealedOut.push(...recascade(state));

  return kingsDestroyed;
}
