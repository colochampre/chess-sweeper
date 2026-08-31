import { fileOf, inBounds, pawnDirection, pawnStartRank, promotionRank, rankOf, sqOf } from './board.js';
import type { Color, GameState, Move, PieceType, Square } from './types.js';

const KNIGHT_DELTAS: readonly [number, number][] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const ORTHOGONAL: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL: readonly [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ALL_DIRS: readonly [number, number][] = [...ORTHOGONAL, ...DIAGONAL];

export const PROMOTION_CHOICES: readonly PieceType[] = ['q', 'r', 'b', 'n'];

function slide(
  state: GameState,
  from: Square,
  color: Color,
  dirs: readonly [number, number][],
  out: Move[],
): void {
  const c = state.config;
  const f0 = fileOf(from, c.files);
  const r0 = rankOf(from, c.files);
  for (const [df, dr] of dirs) {
    let f = f0 + df;
    let r = r0 + dr;
    while (inBounds(f, r, c)) {
      const sq = sqOf(f, r, c.files);
      const target = state.board[sq];
      if (target === null) {
        out.push({ from, to: sq });
      } else {
        if (target.color !== color) out.push({ from, to: sq });
        break;
      }
      f += df;
      r += dr;
    }
  }
}

function step(
  state: GameState,
  from: Square,
  color: Color,
  deltas: readonly [number, number][],
  out: Move[],
): void {
  const c = state.config;
  const f0 = fileOf(from, c.files);
  const r0 = rankOf(from, c.files);
  for (const [df, dr] of deltas) {
    const f = f0 + df;
    const r = r0 + dr;
    if (!inBounds(f, r, c)) continue;
    const sq = sqOf(f, r, c.files);
    const target = state.board[sq];
    if (target === null || target.color !== color) out.push({ from, to: sq });
  }
}

function pawnMoves(state: GameState, from: Square, color: Color, out: Move[]): void {
  const c = state.config;
  const dir = pawnDirection(color);
  const f0 = fileOf(from, c.files);
  const r0 = rankOf(from, c.files);
  const promo = promotionRank(color, c);

  const push = (to: Square): void => {
    if (rankOf(to, c.files) === promo) {
      for (const p of PROMOTION_CHOICES) out.push({ from, to, promotion: p });
    } else {
      out.push({ from, to });
    }
  };

  const r1 = r0 + dir;
  if (inBounds(f0, r1, c)) {
    const one = sqOf(f0, r1, c.files);
    if (state.board[one] === null) {
      push(one);
      const r2 = r0 + 2 * dir;
      if (r0 === pawnStartRank(color, c) && inBounds(f0, r2, c)) {
        const two = sqOf(f0, r2, c.files);
        if (state.board[two] === null) out.push({ from, to: two });
      }
    }
    for (const df of [-1, 1]) {
      const f = f0 + df;
      if (!inBounds(f, r1, c)) continue;
      const sq = sqOf(f, r1, c.files);
      const target = state.board[sq];
      if ((target !== null && target.color !== color) || state.enPassant === sq) push(sq);
    }
  }
}

/** AC-405: incluye enroque; la seguridad de las casillas se comprueba en legality.ts. */
function castlingMoves(state: GameState, color: Color, out: Move[]): void {
  const c = state.config;
  const rights = state.castling[color];
  const rank = color === 'w' ? 0 : c.ranks - 1;
  const king = findKingOnHomeRank(state, color, rank);
  if (king === -1) return;
  const kf = fileOf(king, c.files);

  const tryCastle = (side: 'k' | 'q'): void => {
    if (!rights[side]) return;
    const rookFile = side === 'k' ? c.files - 1 : 0;
    const rookSq = sqOf(rookFile, rank, c.files);
    const rook = state.board[rookSq];
    if (rook === null || rook.type !== 'r' || rook.color !== color || rook.hasMoved) return;
    const dir = side === 'k' ? 1 : -1;
    const destFile = kf + 2 * dir;
    if (!inBounds(destFile, rank, c)) return;
    // Todo lo que hay entre rey y torre debe estar vacio.
    for (let f = Math.min(kf, rookFile) + 1; f < Math.max(kf, rookFile); f++) {
      if (state.board[sqOf(f, rank, c.files)] !== null) return;
    }
    out.push({ from: king, to: sqOf(destFile, rank, c.files) });
  };

  tryCastle('k');
  tryCastle('q');
}

function findKingOnHomeRank(state: GameState, color: Color, rank: number): Square {
  const c = state.config;
  for (let f = 0; f < c.files; f++) {
    const sq = sqOf(f, rank, c.files);
    const p = state.board[sq];
    if (p !== null && p.type === 'k' && p.color === color && !p.hasMoved) return sq;
  }
  return -1;
}

/** Movimientos pseudo-legales: sin filtrar por jaque propio y siempre ignorando las minas. */
export function pseudoLegalMoves(state: GameState, color: Color): Move[] {
  const out: Move[] = [];
  for (let sq = 0; sq < state.board.length; sq++) {
    const p = state.board[sq];
    if (p === null || p.color !== color) continue;
    switch (p.type) {
      case 'p': pawnMoves(state, sq, color, out); break;
      case 'n': step(state, sq, color, KNIGHT_DELTAS, out); break;
      case 'b': slide(state, sq, color, DIAGONAL, out); break;
      case 'r': slide(state, sq, color, ORTHOGONAL, out); break;
      case 'q': slide(state, sq, color, ALL_DIRS, out); break;
      case 'k': step(state, sq, color, ALL_DIRS, out); break;
    }
  }
  castlingMoves(state, color, out);
  return out;
}

export { KNIGHT_DELTAS, ORTHOGONAL, DIAGONAL, ALL_DIRS };
