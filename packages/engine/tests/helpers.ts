import {
  computeAdjacency,
  createGame,
  parseSquare,
  type Color,
  type GameConfig,
  type GameState,
  type PieceType,
} from '@cm/engine';

let counter = 0;

/** Partida sin piezas ni minas, para montar posiciones concretas en los tests. */
export function emptyGame(overrides: Partial<GameConfig> = {}): GameState {
  const s = createGame({ seed: 1, mineCount: 0, ...overrides });
  s.board.fill(null);
  s.mines.fill(false);
  s.revealed.fill(false);
  s.detonated.fill(false);
  s.adjacency = computeAdjacency(s.mines, s.config);
  return s;
}

export const sq = (s: GameState, name: string): number => parseSquare(name, s.config);

export function put(
  s: GameState,
  name: string,
  type: PieceType,
  color: Color,
  hasMoved = true,
): void {
  s.board[sq(s, name)] = { id: `${color}${type}-${counter++}`, type, color, hasMoved };
}

export function mine(s: GameState, ...names: string[]): void {
  for (const name of names) s.mines[sq(s, name)] = true;
  s.adjacency = computeAdjacency(s.mines, s.config);
}

export const at = (s: GameState, name: string) => s.board[sq(s, name)];
