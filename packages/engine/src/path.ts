import { fileOf, rankOf, sqOf } from './board.js';
import type { GameConfig, PieceType, Square } from './types.js';

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * FR-4: casillas que recorre una pieza, en orden, sin incluir el origen y
 * si incluyendo el destino. El caballo salta (AC-402): solo su destino.
 */
export function movePath(
  from: Square,
  to: Square,
  type: PieceType,
  c: GameConfig,
): Square[] {
  if (type === 'n') return [to];

  const ff = fileOf(from, c.files);
  const fr = rankOf(from, c.files);
  const tf = fileOf(to, c.files);
  const tr = rankOf(to, c.files);
  const df = sign(tf - ff);
  const dr = sign(tr - fr);

  // Movimiento no rectilineo (no deberia ocurrir con movimientos legales): solo el destino.
  const steps = Math.max(Math.abs(tf - ff), Math.abs(tr - fr));
  if (steps === 0) return [];
  if (Math.abs(tf - ff) !== 0 && Math.abs(tr - fr) !== 0 && Math.abs(tf - ff) !== Math.abs(tr - fr)) {
    return [to];
  }

  const out: Square[] = [];
  let f = ff;
  let r = fr;
  for (let i = 0; i < steps; i++) {
    f += df;
    r += dr;
    out.push(sqOf(f, r, c.files));
  }
  return out;
}
