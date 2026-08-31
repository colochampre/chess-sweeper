import type { Difficulty, GameConfig } from './types.js';
import { randomSeed } from './rng.js';

/** Densidad de minas sobre las casillas centrales. Valores de partida, a afinar con tools/balance. */
export const MINE_DENSITY: Record<Difficulty, number> = {
  easy: 0.16,
  normal: 0.25,
  hard: 0.36,
};

export const DEFAULT_CONFIG: GameConfig = {
  files: 8,
  ranks: 8,
  mineRows: 4,
  mineCount: 8,
  explosionRadius: 1,
  chainExplosions: true,
  revealOnTransit: false,
  kingImmuneToMines: false,
  seed: 0,
};

/**
 * Filas centrales que pueden contener minas. Se recorta para que nunca solapen
 * las dos filas de inicio de cada bando: al empezar, ninguna pieza esta sobre una mina.
 */
export function mineRowRange(c: GameConfig): { start: number; end: number } {
  const available = Math.max(0, c.ranks - 4);
  const rows = Math.min(c.mineRows, available);
  if (rows <= 0) return { start: 0, end: -1 };
  const start = Math.floor((c.ranks - rows) / 2);
  return { start, end: start + rows - 1 };
}

export function centralSquareCount(c: GameConfig): number {
  const { start, end } = mineRowRange(c);
  return end < start ? 0 : (end - start + 1) * c.files;
}

/** Config completa a partir de una dificultad; `mineCount` sale de la densidad. */
export function configFor(
  difficulty: Difficulty,
  overrides: Partial<GameConfig> = {},
): GameConfig {
  const base: GameConfig = { ...DEFAULT_CONFIG, seed: randomSeed(), ...overrides };
  if (overrides.mineCount === undefined) {
    base.mineCount = Math.round(MINE_DENSITY[difficulty] * centralSquareCount(base));
  }
  return base;
}

export function validateConfig(c: GameConfig): GameConfig {
  if (c.files < 2) throw new Error(`files debe ser >= 2 (recibido ${c.files})`);
  if (c.ranks < 4) throw new Error(`ranks debe ser >= 4 (recibido ${c.ranks})`);
  if (c.explosionRadius < 0) throw new Error('explosionRadius debe ser >= 0');
  const max = centralSquareCount(c);
  return { ...c, mineCount: Math.max(0, Math.min(c.mineCount, max)) };
}
