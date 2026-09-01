/** Tipos compartidos por todo el motor. Ver specs/001-core-rules/spec.md */

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/** Indice de casilla: `rank * files + file`, con rank 0 = primera fila de las blancas. */
export type Square = number;

export interface Piece {
  /** Estable durante toda la partida; la UI lo usa para animar. */
  readonly id: string;
  readonly type: PieceType;
  readonly color: Color;
  readonly hasMoved: boolean;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface GameConfig {
  files: number;
  ranks: number;
  /** Filas centrales donde pueden aparecer minas (se recorta para no tocar las filas de inicio). */
  mineRows: number;
  mineCount: number;
  /** 1 => area de 3x3 centrada en la mina. */
  explosionRadius: number;
  chainExplosions: boolean;
  /** Si las casillas atravesadas se revelan al pasar por encima. */
  revealOnTransit: boolean;
  kingImmuneToMines: boolean;
  seed: number;
}

export interface Move {
  from: Square;
  to: Square;
  promotion?: PieceType;
}

export interface MoveRecord extends Move {
  pieceId: string;
  pieceType: PieceType;
  color: Color;
  captured?: PieceType;
  /** Casilla donde la pieza piso una mina y murio, si ocurrio. */
  detonatedAt?: Square;
  castle?: 'k' | 'q';
  enPassant?: boolean;
}

/** Por que termino la partida. Se usa en el mensaje final y en las metricas de balance. */
export type EndReason =
  | 'checkmate'
  | 'stalemate'
  | 'king-destroyed'
  | 'both-kings-destroyed'
  | 'insufficient-material'
  | 'fifty-move'
  /** Un jugador se fue de la partida, o se ausento el tiempo suficiente. Solo en online. */
  | 'abandoned';

export type GameStatus =
  | 'playing'
  | 'checkmate'
  | 'stalemate'
  | 'king-destroyed'
  | 'draw'
  | 'abandoned';

export interface CastlingRights {
  w: { k: boolean; q: boolean };
  b: { k: boolean; q: boolean };
}

export interface GameState {
  config: GameConfig;
  board: (Piece | null)[];
  /** VERDAD OCULTA. Nunca debe salir del motor hacia un cliente o un bot. */
  mines: boolean[];
  /** Conocimiento compartido por ambos jugadores. */
  revealed: boolean[];
  /** Minas vecinas por casilla; se recalcula tras cada explosion. */
  adjacency: number[];
  /** Crateres: casillas alcanzadas por una explosion. */
  detonated: boolean[];
  /** Casillas exactas donde habia una mina que ya ha detonado (para dibujar el crater). */
  craters: boolean[];
  /**
   * Minas cuya posicion es publica: quedaron a la vista dentro del area de una explosion
   * sin llegar a detonar (solo ocurre con `chainExplosions: false`).
   */
  knownMines: boolean[];
  /** Banderas rojas, privadas de cada jugador. */
  flags: Record<Color, boolean[]>;
  turn: Color;
  castling: CastlingRights;
  enPassant: Square | null;
  halfmoveClock: number;
  fullmove: number;
  status: GameStatus;
  winner: Color | null;
  endReason: EndReason | null;
  inCheck: boolean;
  captured: Piece[];
  history: MoveRecord[];
}

/** Proyeccion del estado para un jugador concreto: sin minas y solo con sus banderas. */
export interface PlayerView
  extends Omit<GameState, 'mines' | 'flags'> {
  as: Color;
  flags: boolean[];
  /** Minas que quedan sin detonar: informacion publica, como el contador del Buscaminas. */
  minesRemaining: number;
}

export type GameEvent =
  | { type: 'hop'; pieceId: string; from: Square; to: Square }
  | { type: 'capture'; pieceId: string; pieceType: PieceType; color: Color; at: Square }
  | {
      type: 'explosion';
      center: Square;
      cells: Square[];
      victims: { pieceId: string; pieceType: PieceType; color: Color; at: Square }[];
    }
  | { type: 'reveal'; cells: Square[] }
  | { type: 'promotion'; pieceId: string; at: Square; to: PieceType }
  | { type: 'end'; status: GameStatus; winner: Color | null; reason: EndReason };

export interface MoveResult {
  state: GameState;
  events: GameEvent[];
}
