import { fileOf, initialBoard, promotionRank, rankOf, sqOf, squareCount } from './board.js';
import { DEFAULT_CONFIG, validateConfig } from './config.js';
import { detonate } from './explosion.js';
import {
  findKing,
  isCastlingMove,
  isKingInCheck,
  isMoveLegal,
  legalMoves,
  opponent,
} from './legality.js';
import { computeAdjacency, countMines, placeMines } from './minefield.js';
import { movePath } from './path.js';
import { revealFrom, revealFromAllPieces } from './reveal.js';
import { createRng } from './rng.js';
import type {
  CastlingRights,
  Color,
  GameConfig,
  GameEvent,
  GameState,
  Move,
  MoveRecord,
  MoveResult,
  Piece,
  PlayerView,
  Square,
} from './types.js';

export function createGame(overrides: Partial<GameConfig> = {}): GameState {
  const config = validateConfig({ ...DEFAULT_CONFIG, ...overrides });
  const rng = createRng(config.seed);
  const mines = placeMines(config, rng);
  const n = squareCount(config);

  const state: GameState = {
    config,
    board: initialBoard(config),
    mines,
    revealed: new Array<boolean>(n).fill(false),
    adjacency: computeAdjacency(mines, config),
    detonated: new Array<boolean>(n).fill(false),
    craters: new Array<boolean>(n).fill(false),
    knownMines: new Array<boolean>(n).fill(false),
    flags: { w: new Array<boolean>(n).fill(false), b: new Array<boolean>(n).fill(false) },
    turn: 'w',
    castling: { w: { k: true, q: true }, b: { k: true, q: true } },
    enPassant: null,
    halfmoveClock: 0,
    fullmove: 1,
    status: 'playing',
    winner: null,
    endReason: null,
    inCheck: false,
    captured: [],
    history: [],
  };

  revealFromAllPieces(state); // AC-302
  return state;
}

export function cloneState(s: GameState): GameState {
  return {
    config: s.config,
    board: s.board.slice(),
    mines: s.mines.slice(),
    revealed: s.revealed.slice(),
    adjacency: s.adjacency.slice(),
    detonated: s.detonated.slice(),
    craters: s.craters.slice(),
    knownMines: s.knownMines.slice(),
    flags: { w: s.flags.w.slice(), b: s.flags.b.slice() },
    turn: s.turn,
    castling: { w: { ...s.castling.w }, b: { ...s.castling.b } },
    enPassant: s.enPassant,
    halfmoveClock: s.halfmoveClock,
    fullmove: s.fullmove,
    status: s.status,
    winner: s.winner,
    endReason: s.endReason,
    inCheck: s.inCheck,
    captured: s.captured.slice(),
    history: s.history.slice(),
  };
}

/** Derechos de enroque deducidos del tablero: sobreviven a capturas y explosiones. */
export function computeCastlingRights(state: GameState): CastlingRights {
  const c = state.config;
  const rights: CastlingRights = { w: { k: false, q: false }, b: { k: false, q: false } };
  for (const color of ['w', 'b'] as const) {
    const rank = color === 'w' ? 0 : c.ranks - 1;
    let kingUnmoved = false;
    for (let f = 0; f < c.files; f++) {
      const p = state.board[sqOf(f, rank, c.files)];
      if (p !== null && p.type === 'k' && p.color === color && !p.hasMoved) kingUnmoved = true;
    }
    if (!kingUnmoved) continue;
    for (const side of ['k', 'q'] as const) {
      const rookFile = side === 'k' ? c.files - 1 : 0;
      const rook = state.board[sqOf(rookFile, rank, c.files)];
      rights[color][side] =
        rook !== null && rook.type === 'r' && rook.color === color && !rook.hasMoved;
    }
  }
  return rights;
}

/**
 * Si `color` conserva material con el que sea posible dar mate. Un rey solo no puede, y un
 * rey con una sola pieza menor tampoco; con dos ya hay posiciones de mate.
 *
 * Es por color, a diferencia de `insufficientMaterial`, que mira el tablero entero: al
 * caerse una bandera la pregunta no es si alguien puede ganar, sino si puede el que todavia
 * tiene tiempo. Ver AC-1407.
 */
export function canDeliverMate(state: GameState, color: Color): boolean {
  let minors = 0;
  for (const p of state.board) {
    if (p === null || p.color !== color || p.type === 'k') continue;
    if (p.type === 'n' || p.type === 'b') minors++;
    else return true; // peon, torre o dama: con eso se da mate
  }
  return minors >= 2;
}

/** Solo reyes, o rey contra rey y una pieza menor: nadie puede dar mate. */
function insufficientMaterial(state: GameState): boolean {
  let minors = 0;
  for (const p of state.board) {
    if (p === null || p.type === 'k') continue;
    if (p.type === 'n' || p.type === 'b') minors++;
    else return false;
  }
  return minors <= 1;
}

/** Mueve la torre del enroque. Devuelve la casilla donde detono, si detono. */
function moveRook(
  next: GameState,
  events: GameEvent[],
  revealedCells: Square[],
  from: Square,
  to: Square,
): Square | null {
  const rook = next.board[from];
  if (rook === null) return null;
  next.board[from] = null;
  let cursor = from;
  for (const cell of movePath(from, to, 'r', next.config)) {
    events.push({ type: 'hop', pieceId: rook.id, from: cursor, to: cell });
    cursor = cell;
    if (next.mines[cell]) {
      next.board[cell] = { ...rook, hasMoved: true };
      return cell;
    }
  }
  next.board[to] = { ...rook, hasMoved: true };
  revealFrom(next, to, revealedCells);
  return null;
}

/**
 * Aplica un movimiento legal y devuelve el estado resultante mas la secuencia de eventos que
 * la capa visual reproduce. La secuencia completa esta en specs/001-core-rules/spec.md (FR-5).
 */
export function applyMove(state: GameState, move: Move): MoveResult {
  if (state.status !== 'playing') throw new Error('La partida ya ha terminado'); // AC-706
  const piece = state.board[move.from];
  if (piece === null) throw new Error(`No hay ninguna pieza en la casilla ${move.from}`);
  if (piece.color !== state.turn) throw new Error('No es el turno de esa pieza');
  if (!isMoveLegal(state, move)) throw new Error(`Movimiento ilegal: ${move.from} -> ${move.to}`);

  const c = state.config;
  const next = cloneState(state);
  const events: GameEvent[] = [];
  const revealedCells: Square[] = [];

  const castle = isCastlingMove(state, move)
    ? fileOf(move.to, c.files) > fileOf(move.from, c.files)
      ? ('k' as const)
      : ('q' as const)
    : undefined;
  const enPassantCapture =
    piece.type === 'p' && move.to === state.enPassant && state.board[move.to] === null;

  const record: MoveRecord = {
    ...move,
    pieceId: piece.id,
    pieceType: piece.type,
    color: piece.color,
  };
  if (castle) record.castle = castle;
  if (enPassantCapture) record.enPassant = true;

  const moved: Piece = { ...piece, hasMoved: true };
  const path = movePath(move.from, move.to, piece.type, c);
  next.board[move.from] = null;

  let cursor = move.from;
  let detonatedAt: Square | null = null;
  let landed = false;
  let captureHappened = false;

  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    events.push({ type: 'hop', pieceId: piece.id, from: cursor, to: cell }); // AC-801
    cursor = cell;

    if (i < path.length - 1) {
      // Casilla de paso: la primera mina del trayecto mata a la pieza aqui mismo (AC-501).
      if (c.revealOnTransit && !next.mines[cell]) revealFrom(next, cell, revealedCells); // AC-504
      if (next.mines[cell]) {
        next.board[cell] = moved; // muere en el centro de su propia explosion (AC-503)
        detonatedAt = cell;
        break;
      }
      continue;
    }

    // Aterrizaje.
    const occupant = next.board[cell];
    if (occupant !== null) {
      next.board[cell] = null;
      next.captured.push(occupant);
      record.captured = occupant.type;
      captureHappened = true;
      events.push({
        type: 'capture', // AC-802
        pieceId: occupant.id,
        pieceType: occupant.type,
        color: occupant.color,
        at: cell,
      });
    }

    if (enPassantCapture) {
      const victimSq = sqOf(fileOf(cell, c.files), rankOf(move.from, c.files), c.files);
      const victim = next.board[victimSq];
      if (victim !== null) {
        next.board[victimSq] = null;
        next.captured.push(victim);
        record.captured = victim.type;
        captureHappened = true;
        events.push({
          type: 'capture',
          pieceId: victim.id,
          pieceType: victim.type,
          color: victim.color,
          at: victimSq,
        });
      }
    }

    let placed = moved;
    if (piece.type === 'p' && rankOf(cell, c.files) === promotionRank(piece.color, c)) {
      const promoted = move.promotion ?? 'q';
      placed = { ...moved, type: promoted };
      record.promotion = promoted;
      events.push({ type: 'promotion', pieceId: piece.id, at: cell, to: promoted });
    }
    next.board[cell] = placed;
    landed = true;

    if (next.mines[cell]) detonatedAt = cell;
    else revealFrom(next, cell, revealedCells);
  }

  if (castle && landed && detonatedAt === null) {
    const rank = rankOf(move.from, c.files);
    const kingSide = castle === 'k';
    const rookFrom = sqOf(kingSide ? c.files - 1 : 0, rank, c.files);
    const rookTo = sqOf(fileOf(move.to, c.files) + (kingSide ? -1 : 1), rank, c.files);
    detonatedAt = moveRook(next, events, revealedCells, rookFrom, rookTo);
  }

  let kingsDestroyed: Color[] = [];
  if (detonatedAt !== null) {
    record.detonatedAt = detonatedAt;
    kingsDestroyed = detonate(next, detonatedAt, events, revealedCells);
  }
  if (revealedCells.length > 0) events.push({ type: 'reveal', cells: revealedCells });

  // Casilla de captura al paso para el turno siguiente.
  next.enPassant = null;
  if (piece.type === 'p' && landed && detonatedAt === null) {
    const dr = rankOf(move.to, c.files) - rankOf(move.from, c.files);
    if (Math.abs(dr) === 2) {
      next.enPassant = sqOf(
        fileOf(move.from, c.files),
        rankOf(move.from, c.files) + dr / 2,
        c.files,
      );
    }
  }

  next.castling = computeCastlingRights(next);
  next.halfmoveClock =
    piece.type === 'p' || captureHappened || detonatedAt !== null ? 0 : next.halfmoveClock + 1;
  if (state.turn === 'b') next.fullmove += 1;
  next.history.push(record);

  // --- Estado terminal (FR-7)
  if (kingsDestroyed.length >= 2) {
    next.status = 'draw'; // AC-702
    next.winner = null;
    next.endReason = 'both-kings-destroyed';
  } else if (kingsDestroyed.length === 1) {
    next.status = 'king-destroyed'; // AC-701
    next.winner = opponent(kingsDestroyed[0]);
    next.endReason = 'king-destroyed';
  } else {
    next.turn = opponent(state.turn);
    next.inCheck = isKingInCheck(next, next.turn);
    if (findKing(next, next.turn) === -1) {
      next.status = 'king-destroyed';
      next.winner = state.turn;
      next.endReason = 'king-destroyed';
    } else if (legalMoves(next, next.turn).length === 0) {
      next.status = next.inCheck ? 'checkmate' : 'stalemate'; // AC-703 / AC-704
      next.winner = next.inCheck ? state.turn : null;
      next.endReason = next.inCheck ? 'checkmate' : 'stalemate';
    } else if (insufficientMaterial(next)) {
      next.status = 'draw';
      next.winner = null;
      next.endReason = 'insufficient-material';
    } else if (next.halfmoveClock >= 100) {
      next.status = 'draw';
      next.winner = null;
      next.endReason = 'fifty-move';
    }
  }

  if (next.status !== 'playing' && next.endReason !== null) {
    // AC-804
    events.push({ type: 'end', status: next.status, winner: next.winner, reason: next.endReason });
  }

  return { state: next, events };
}

/** FR-9: unica proyeccion que sale del motor hacia el cliente y el bot. */
export function toView(state: GameState, as: Color): PlayerView {
  const clone = cloneState(state);
  return {
    config: clone.config,
    board: clone.board,
    revealed: clone.revealed,
    adjacency: clone.adjacency,
    detonated: clone.detonated,
    craters: clone.craters,
    knownMines: clone.knownMines,
    turn: clone.turn,
    castling: clone.castling,
    enPassant: clone.enPassant,
    halfmoveClock: clone.halfmoveClock,
    fullmove: clone.fullmove,
    status: clone.status,
    winner: clone.winner,
    endReason: clone.endReason,
    inCheck: clone.inCheck,
    captured: clone.captured,
    history: clone.history,
    as,
    flags: clone.flags[as],
    // Publico, como el contador de minas del Buscaminas.
    minesRemaining: countMines(state.mines),
  };
}

/**
 * Estado jugable reconstruido desde una vista, con una hipotesis sobre donde estan las minas
 * (por defecto: ninguna). Es lo que usa el bot para buscar sin ver el campo real.
 */
export function hypotheticalState(view: PlayerView, mines?: boolean[]): GameState {
  const n = view.board.length;
  const minefield = mines ? mines.slice() : new Array<boolean>(n).fill(false);
  return {
    config: view.config,
    board: view.board.slice(),
    mines: minefield,
    revealed: view.revealed.slice(),
    adjacency: computeAdjacency(minefield, view.config),
    detonated: view.detonated.slice(),
    craters: view.craters.slice(),
    knownMines: view.knownMines.slice(),
    flags: { w: new Array<boolean>(n).fill(false), b: new Array<boolean>(n).fill(false) },
    turn: view.turn,
    castling: { w: { ...view.castling.w }, b: { ...view.castling.b } },
    enPassant: view.enPassant,
    halfmoveClock: view.halfmoveClock,
    fullmove: view.fullmove,
    status: view.status,
    winner: view.winner,
    endReason: view.endReason,
    inCheck: view.inCheck,
    captured: view.captured.slice(),
    history: view.history.slice(),
  };
}

export function toggleFlag(state: GameState, color: Color, sq: Square): GameState {
  const next = cloneState(state);
  next.flags[color][sq] = !next.flags[color][sq];
  return next;
}
