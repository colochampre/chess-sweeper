import { neighbours, squareCount, sqOf } from './board.js';
import { mineRowRange } from './config.js';
import type { Rng } from './rng.js';
import type { GameConfig, Square } from './types.js';

/** FR-2: casillas candidatas a contener mina (solo las filas centrales). */
export function centralSquares(c: GameConfig): Square[] {
  const { start, end } = mineRowRange(c);
  const out: Square[] = [];
  for (let r = start; r <= end; r++) {
    for (let f = 0; f < c.files; f++) out.push(sqOf(f, r, c.files));
  }
  return out;
}

/** AC-201/202/203: `mineCount` minas distintas, todas en las filas centrales. */
export function placeMines(c: GameConfig, rng: Rng): boolean[] {
  const mines = new Array<boolean>(squareCount(c)).fill(false);
  const pool = centralSquares(c);
  const count = Math.max(0, Math.min(c.mineCount, pool.length));
  // Fisher-Yates parcial: sin repeticiones y determinista con la semilla.
  for (let i = 0; i < count; i++) {
    const j = i + rng.int(pool.length - i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    mines[pool[i]] = true;
  }
  return mines;
}

/** Numero de minas vecinas por casilla. Se recalcula tras cada cadena de explosiones. */
export function computeAdjacency(mines: boolean[], c: GameConfig): number[] {
  const adjacency = new Array<number>(mines.length).fill(0);
  for (let sq = 0; sq < mines.length; sq++) {
    let n = 0;
    for (const nb of neighbours(sq, c)) if (mines[nb]) n++;
    adjacency[sq] = n;
  }
  return adjacency;
}

export function countMines(mines: boolean[]): number {
  let n = 0;
  for (const m of mines) if (m) n++;
  return n;
}
