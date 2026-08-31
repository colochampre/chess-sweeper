import {
  boardAfter,
  computeCastlingRights,
  fileOf,
  isCastlingMove,
  isKingInCheck,
  legalMoves,
  opponent,
  rankOf,
  sqOf,
  type GameState,
  type Move,
  type Piece,
} from '@cm/engine';
import type { Rng } from '@cm/engine';
import { MATE, VALUE, evaluate, moveRisk } from './evaluate.js';
import type { MineBelief } from './probability.js';

export interface SearchOptions {
  depth: number;
  /** Tope de nodos: garantiza que la busqueda siempre devuelve a tiempo (AC-405). */
  nodeBudget: number;
  /** Cuanto pesa el riesgo de minas frente al material. */
  riskWeight: number;
  belief: MineBelief;
  /** Ruido en centipeones para que los niveles bajos no jueguen siempre perfecto. */
  noise: number;
  rng: Rng;
}

export interface SearchResult {
  move: Move | null;
  score: number;
  nodes: number;
}

interface Ctx {
  nodes: number;
  budget: number;
  riskWeight: number;
  belief: MineBelief;
}

/**
 * Posicion hija. Solo se copia lo que la generacion de movimientos mira; el resto de arrays
 * del estado (minas, revelado, crateres) se comparten porque la busqueda nunca los toca.
 */
function childState(pos: GameState, move: Move): GameState {
  const c = pos.config;
  const board = boardAfter(pos, move);

  const moved = board[move.to];
  if (moved !== null && !moved.hasMoved) board[move.to] = { ...moved, hasMoved: true };

  if (isCastlingMove(pos, move)) {
    const rank = rankOf(move.from, c.files);
    const kingSide = fileOf(move.to, c.files) > fileOf(move.from, c.files);
    const rookTo = sqOf(fileOf(move.to, c.files) + (kingSide ? -1 : 1), rank, c.files);
    const rook = board[rookTo];
    if (rook !== null) board[rookTo] = { ...rook, hasMoved: true };
  }

  const piece = pos.board[move.from] as Piece;
  let enPassant: number | null = null;
  if (piece.type === 'p' && Math.abs(rankOf(move.to, c.files) - rankOf(move.from, c.files)) === 2) {
    enPassant = sqOf(
      fileOf(move.from, c.files),
      (rankOf(move.from, c.files) + rankOf(move.to, c.files)) / 2,
      c.files,
    );
  }

  const next: GameState = { ...pos, board, turn: opponent(pos.turn), enPassant };
  next.castling = computeCastlingRights(next);
  return next;
}

/** Capturas primero, de victima mas valiosa a menos (MVV-LVA). */
function orderMoves(pos: GameState, moves: Move[]): Move[] {
  const score = (m: Move): number => {
    const victim = pos.board[m.to];
    const attacker = pos.board[m.from];
    if (victim === null || attacker === null) return 0;
    return 10 * VALUE[victim.type] - VALUE[attacker.type];
  };
  return moves
    .map((m) => ({ m, s: score(m) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function negamax(pos: GameState, depth: number, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  ctx.nodes++;
  // La hoja se evalua sin generar movimientos: generarlos costaria mas que evaluar.
  if (depth <= 0 || ctx.nodes > ctx.budget) return evaluate(pos, pos.turn);

  const moves = legalMoves(pos, pos.turn);
  if (moves.length === 0) return isKingInCheck(pos, pos.turn) ? -(MATE - ply) : 0;

  let best = -Infinity;
  for (const move of orderMoves(pos, moves)) {
    const risk = ctx.riskWeight * moveRisk(pos, move, ctx.belief);
    const value = -negamax(childState(pos, move), depth - 1, -beta, -alpha, ply + 1, ctx) - risk;
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Negamax con poda alfa-beta y penalizacion por riesgo de mina en cada movimiento. */
export function searchBestMove(pos: GameState, options: SearchOptions): SearchResult {
  const ctx: Ctx = {
    nodes: 0,
    budget: options.nodeBudget,
    riskWeight: options.riskWeight,
    belief: options.belief,
  };

  const moves = orderMoves(pos, legalMoves(pos, pos.turn));
  if (moves.length === 0) return { move: null, score: 0, nodes: 0 }; // AC-104

  let bestMove = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;

  // Con ruido no se poda en la raiz: la comparacion final no usa el valor exacto.
  const prune = options.noise === 0;

  for (const move of moves) {
    const risk = ctx.riskWeight * moveRisk(pos, move, ctx.belief);
    const window = prune ? -alpha : Infinity;
    const raw = -negamax(childState(pos, move), options.depth - 1, -Infinity, window, 1, ctx) - risk;
    const value = options.noise > 0 ? raw + (options.rng.next() * 2 - 1) * options.noise : raw;

    if (value > bestScore) {
      bestScore = value;
      bestMove = move;
    }
    if (value > alpha) alpha = value;
    if (ctx.nodes > ctx.budget) break;
  }

  return { move: bestMove, score: bestScore, nodes: ctx.nodes };
}
