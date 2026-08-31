import { neighbours } from './board.js';
import type { GameState, Square } from './types.js';

/**
 * FR-3: revelado en cascada del Buscaminas.
 * Revela `sq` y, si no tiene minas vecinas, se propaga a las 8 contiguas.
 * AC-301: una casilla con mina nunca se revela por cascada.
 * Devuelve las casillas reveladas en esta llamada.
 */
export function revealFrom(state: GameState, sq: Square, out: Square[] = []): Square[] {
  if (state.mines[sq] || state.revealed[sq]) return out;

  const stack: Square[] = [sq];
  while (stack.length > 0) {
    const cur = stack.pop() as Square;
    if (state.revealed[cur] || state.mines[cur]) continue;
    state.revealed[cur] = true;
    out.push(cur);
    if (state.adjacency[cur] === 0) {
      for (const nb of neighbours(cur, state.config)) {
        if (!state.revealed[nb] && !state.mines[nb]) stack.push(nb);
      }
    }
  }
  return out;
}

/** AC-302: al empezar, cada pieza revela desde su casilla. */
export function revealFromAllPieces(state: GameState): Square[] {
  const out: Square[] = [];
  for (let sq = 0; sq < state.board.length; sq++) {
    if (state.board[sq] !== null) revealFrom(state, sq, out);
  }
  return out;
}

/**
 * AC-605: tras una explosion los numeros bajan y pueden aparecer ceros nuevos
 * dentro de la zona ya revelada; hay que continuar la cascada desde ellos.
 */
export function recascade(state: GameState): Square[] {
  const out: Square[] = [];
  for (let sq = 0; sq < state.board.length; sq++) {
    if (!state.revealed[sq] || state.adjacency[sq] !== 0) continue;
    for (const nb of neighbours(sq, state.config)) {
      if (!state.revealed[nb] && !state.mines[nb]) revealFrom(state, nb, out);
    }
  }
  return out;
}
