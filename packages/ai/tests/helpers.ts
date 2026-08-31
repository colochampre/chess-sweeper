import {
  computeAdjacency,
  createGame,
  parseSquare,
  toView,
  type Color,
  type GameConfig,
  type GameState,
  type PieceType,
  type PlayerView,
} from '@cm/engine';

let counter = 0;

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

export function put(s: GameState, name: string, type: PieceType, color: Color, hasMoved = true): void {
  s.board[sq(s, name)] = { id: `${color}${type}-${counter++}`, type, color, hasMoved };
}

export function mine(s: GameState, ...names: string[]): void {
  for (const name of names) s.mines[sq(s, name)] = true;
  s.adjacency = computeAdjacency(s.mines, s.config);
}

export function reveal(s: GameState, ...names: string[]): void {
  for (const name of names) s.revealed[sq(s, name)] = true;
}

export const view = (s: GameState, as: Color = s.turn): PlayerView => toView(s, as);

/** Creencia artificial para probar el calculo de riesgo sin depender del estimador. */
export function beliefWith(s: GameState, entries: Record<string, number>) {
  const probability = new Array<number>(s.board.length).fill(0);
  for (const [name, p] of Object.entries(entries)) probability[sq(s, name)] = p;
  return { probability, candidates: [], remaining: 0 };
}
