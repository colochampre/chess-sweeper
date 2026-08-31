import {
  areaAround,
  fileOf,
  movePath,
  rankOf,
  type Color,
  type GameState,
  type Move,
  type PieceType,
  type Square,
} from '@cm/engine';
import type { MineBelief } from './probability.js';

export const VALUE: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

export const MATE = 1_000_000;

/** Cuanto se acerca una casilla al centro del tablero, de 0 (esquina) a 1 (centro). */
function centrality(sq: Square, files: number, ranks: number): number {
  const f = fileOf(sq, files);
  const r = Math.floor(sq / files);
  const df = Math.abs(f - (files - 1) / 2) / ((files - 1) / 2 || 1);
  const dr = Math.abs(r - (ranks - 1) / 2) / ((ranks - 1) / 2 || 1);
  return 1 - (df + dr) / 2;
}

/**
 * Evaluacion estatica desde el punto de vista de `color`, en centipeones.
 * Material, control del centro y avance de peones; el riesgo de minas se suma aparte,
 * por movimiento, en la busqueda.
 */
export function evaluate(state: GameState, color: Color): number {
  const c = state.config;
  let score = 0;

  for (let sq = 0; sq < state.board.length; sq++) {
    const piece = state.board[sq];
    if (piece === null) continue;
    const sign = piece.color === color ? 1 : -1;
    let value = VALUE[piece.type];

    if (piece.type === 'n' || piece.type === 'b' || piece.type === 'q') {
      value += 24 * centrality(sq, c.files, c.ranks);
    }
    if (piece.type === 'p') {
      const rank = rankOf(sq, c.files);
      const advance = piece.color === 'w' ? rank - 1 : c.ranks - 2 - rank;
      value += 9 * Math.max(0, advance);
      value += 10 * centrality(sq, c.files, c.ranks);
    }
    if (piece.type === 'k') {
      // Rey lejos del centro mientras queden piezas pesadas: menos expuesto a explosiones.
      value -= 18 * centrality(sq, c.files, c.ranks);
    }
    score += sign * value;
  }

  return score;
}

/**
 * FR-3: perdida material esperada de un movimiento por culpa de las minas.
 * Recorre el trayecto acumulando la probabilidad de que la primera mina este en
 * cada casilla, y valora el area de explosion que provocaria.
 */
export function moveRisk(state: GameState, move: Move, belief: MineBelief): number {
  const piece = state.board[move.from];
  if (piece === null) return 0;
  const c = state.config;
  const path = movePath(move.from, move.to, piece.type, c); // AC-302: el caballo solo su destino

  let survive = 1;
  let risk = 0;

  for (const cell of path) {
    const p = belief.probability[cell];
    if (p > 0) {
      risk += survive * p * blastCost(state, cell, piece.color, piece.type, move.from);
      survive *= 1 - p;
      if (survive <= 0.0001) break;
    }
  }
  return risk; // AC-303: si todo el trayecto tiene probabilidad 0, sale 0
}

/** Material propio menos material rival dentro del area de una explosion en `center`. */
function blastCost(
  state: GameState,
  center: Square,
  mover: Color,
  movingType: PieceType,
  from: Square,
): number {
  const c = state.config;
  let own = VALUE[movingType]; // la pieza que pisa la mina muere siempre
  let enemy = 0;

  for (const cell of areaAround(center, c.explosionRadius, c)) {
    if (cell === from) continue; // la pieza que se mueve ya no esta en su casilla de origen
    const piece = state.board[cell];
    if (piece === null) continue;
    if (piece.type === 'k' && c.kingImmuneToMines) continue;
    if (piece.color === mover) own += VALUE[piece.type];
    else enemy += VALUE[piece.type];
  }

  return own - enemy;
}
