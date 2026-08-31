import {
  createRng,
  hypotheticalState,
  type Difficulty,
  type Move,
  type PlayerView,
} from '@cm/engine';
import { estimateMines, type BeliefMode, type MineBelief } from './probability.js';
import { searchBestMove, type SearchResult } from './search.js';

export interface BotOptions {
  level: Difficulty;
  /** Semilla para el ruido de los niveles bajos; si falta se deriva de la propia posicion. */
  seed?: number;
}

interface LevelProfile {
  depth: number;
  nodeBudget: number;
  riskWeight: number;
  noise: number;
  belief: BeliefMode;
}

/** FR-4: la dificultad es profundidad + calidad del modelo de minas, nunca hacer trampa. */
export const LEVELS: Record<Difficulty, LevelProfile> = {
  easy: { depth: 1, nodeBudget: 30_000, riskWeight: 0.35, noise: 110, belief: 'prior' },
  normal: { depth: 3, nodeBudget: 150_000, riskWeight: 1, noise: 0, belief: 'heuristic' },
  hard: { depth: 4, nodeBudget: 500_000, riskWeight: 1, noise: 0, belief: 'exact' },
};

export interface Analysis extends SearchResult {
  belief: MineBelief;
}

/**
 * Analiza la posicion desde la vista del jugador al que le toca mover.
 * Solo recibe `PlayerView`: sin `mines`, no hay forma de hacer trampa (AC-101).
 */
export function analyze(view: PlayerView, options: BotOptions): Analysis {
  const profile = LEVELS[options.level];
  const belief = estimateMines(view, profile.belief);
  // La busqueda razona sobre un tablero sin minas; el peligro entra como penalizacion
  // por movimiento, calculada con `belief`.
  const position = hypotheticalState(view);
  const seed = options.seed ?? view.history.length * 2654435761 + view.fullmove;
  const result = searchBestMove(position, {
    depth: profile.depth,
    nodeBudget: profile.nodeBudget,
    riskWeight: profile.riskWeight,
    noise: profile.noise,
    belief,
    rng: createRng(seed >>> 0),
  });
  return { ...result, belief };
}

export function chooseMove(view: PlayerView, options: BotOptions): Move | null {
  return analyze(view, options).move;
}
