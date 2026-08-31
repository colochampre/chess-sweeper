import { fileOf, inBounds, pawnDirection, rankOf, sqOf } from './board.js';
import { ALL_DIRS, DIAGONAL, KNIGHT_DELTAS, ORTHOGONAL, pseudoLegalMoves } from './moves.js';
import type { Color, GameState, Move, Piece, Square } from './types.js';

export const opponent = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function findKing(state: GameState, color: Color): Square {
  for (let sq = 0; sq < state.board.length; sq++) {
    const p = state.board[sq];
    if (p !== null && p.type === 'k' && p.color === color) return sq;
  }
  return -1;
}

/** True si `byColor` ataca la casilla `sq`. Se evalua rastreando rayos desde la casilla. */
export function isAttacked(
  board: (Piece | null)[],
  sq: Square,
  byColor: Color,
  state: GameState,
): boolean {
  const c = state.config;
  const f0 = fileOf(sq, c.files);
  const r0 = rankOf(sq, c.files);

  // Peones: un peon de byColor esta una fila "por detras" en el sentido de su avance.
  const pdir = pawnDirection(byColor);
  for (const df of [-1, 1]) {
    const f = f0 + df;
    const r = r0 - pdir;
    if (!inBounds(f, r, c)) continue;
    const p = board[sqOf(f, r, c.files)];
    if (p !== null && p.color === byColor && p.type === 'p') return true;
  }

  for (const [df, dr] of KNIGHT_DELTAS) {
    const f = f0 + df;
    const r = r0 + dr;
    if (!inBounds(f, r, c)) continue;
    const p = board[sqOf(f, r, c.files)];
    if (p !== null && p.color === byColor && p.type === 'n') return true;
  }

  for (const [df, dr] of ALL_DIRS) {
    const f = f0 + df;
    const r = r0 + dr;
    if (!inBounds(f, r, c)) continue;
    const p = board[sqOf(f, r, c.files)];
    if (p !== null && p.color === byColor && p.type === 'k') return true;
  }

  const rays: [readonly [number, number][], 'r' | 'b'][] = [
    [ORTHOGONAL, 'r'],
    [DIAGONAL, 'b'],
  ];
  for (const [dirs, sliderType] of rays) {
    for (const [df, dr] of dirs) {
      let f = f0 + df;
      let r = r0 + dr;
      while (inBounds(f, r, c)) {
        const p = board[sqOf(f, r, c.files)];
        if (p !== null) {
          if (p.color === byColor && (p.type === sliderType || p.type === 'q')) return true;
          break;
        }
        f += df;
        r += dr;
      }
    }
  }
  return false;
}

export function isKingInCheck(state: GameState, color: Color): boolean {
  const king = findKing(state, color);
  if (king === -1) return false;
  return isAttacked(state.board, king, opponent(color), state);
}

export function isCastlingMove(state: GameState, move: Move): boolean {
  const p = state.board[move.from];
  if (p === null || p.type !== 'k') return false;
  const c = state.config;
  return Math.abs(fileOf(move.to, c.files) - fileOf(move.from, c.files)) === 2;
}

/** Tablero resultante de un movimiento, solo para comprobar jaques (no toca minas). */
export function boardAfter(state: GameState, move: Move): (Piece | null)[] {
  const c = state.config;
  const board = state.board.slice();
  const piece = board[move.from];
  if (piece === null) return board;

  if (piece.type === 'p' && move.to === state.enPassant && board[move.to] === null) {
    const capturedSq = sqOf(
      fileOf(move.to, c.files),
      rankOf(move.from, c.files),
      c.files,
    );
    board[capturedSq] = null;
  }

  if (isCastlingMove(state, move)) {
    const rank = rankOf(move.from, c.files);
    const kingSide = fileOf(move.to, c.files) > fileOf(move.from, c.files);
    const rookFrom = sqOf(kingSide ? c.files - 1 : 0, rank, c.files);
    const rookTo = sqOf(
      fileOf(move.to, c.files) + (kingSide ? -1 : 1),
      rank,
      c.files,
    );
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }

  board[move.to] = move.promotion ? { ...piece, type: move.promotion } : piece;
  board[move.from] = null;
  return board;
}

/**
 * FR-4: movimientos legales del ajedrez estandar. Las minas se ignoran por completo:
 * son informacion oculta, ninguna casilla es ilegal por poder explotar.
 */
export function legalMoves(state: GameState, color: Color = state.turn): Move[] {
  if (state.status !== 'playing') return [];
  const out: Move[] = [];
  const enemy = opponent(color);

  for (const move of pseudoLegalMoves(state, color)) {
    if (isCastlingMove(state, move)) {
      const c = state.config;
      const kf = fileOf(move.from, c.files);
      const rank = rankOf(move.from, c.files);
      const dir = fileOf(move.to, c.files) > kf ? 1 : -1;
      // No se puede enrocar en jaque, ni atravesando o cayendo en casilla atacada.
      if (isAttacked(state.board, move.from, enemy, state)) continue;
      let blocked = false;
      for (let i = 1; i <= 2; i++) {
        const sq = sqOf(kf + i * dir, rank, c.files);
        if (isAttacked(state.board, sq, enemy, state)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
    }

    const board = boardAfter(state, move);
    const probe: GameState = { ...state, board };
    const king = findKing(probe, color);
    if (king !== -1 && isAttacked(board, king, enemy, probe)) continue;
    out.push(move);
  }
  return out;
}

/**
 * Si el movimiento no indica pieza de promocion se acepta igualmente: `applyMove`
 * corona dama por defecto.
 */
export function isMoveLegal(state: GameState, move: Move): boolean {
  return legalMoves(state, state.turn).some(
    (m) =>
      m.from === move.from &&
      m.to === move.to &&
      (move.promotion === undefined || m.promotion === move.promotion),
  );
}
