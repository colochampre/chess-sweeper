import { describe, expect, it } from 'vitest';
import { centralSquares, configFor, createGame, mineRowRange, rankOf, validateConfig, DEFAULT_CONFIG } from '@cm/engine';

describe('FR-2 campo de minas', () => {
  it('AC-201: ninguna mina cae fuera de las 4 filas centrales', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = createGame({ seed, mineCount: 12 });
      const { start, end } = mineRowRange(s.config);
      expect({ start, end }).toEqual({ start: 2, end: 5 });
      s.mines.forEach((isMine, i) => {
        if (!isMine) return;
        const r = rankOf(i, s.config.files);
        expect(r).toBeGreaterThanOrEqual(start);
        expect(r).toBeLessThanOrEqual(end);
      });
    }
  });

  it('AC-202: coloca exactamente mineCount minas, sin repetir casilla', () => {
    for (const mineCount of [0, 1, 5, 8, 12, 31]) {
      const s = createGame({ seed: 42, mineCount });
      expect(s.mines.filter(Boolean)).toHaveLength(mineCount);
    }
  });

  it('AC-203: mineCount se recorta al numero de casillas centrales', () => {
    const c = validateConfig({ ...DEFAULT_CONFIG, mineCount: 999 });
    expect(c.mineCount).toBe(32);
    expect(centralSquares(c)).toHaveLength(32);
    const s = createGame({ mineCount: 999, seed: 1 });
    expect(s.mines.filter(Boolean)).toHaveLength(32);
  });

  it('AC-204: los presets dan 5 / 8 / 12 minas en un 8x8', () => {
    expect(configFor('easy', { seed: 1 }).mineCount).toBe(5);
    expect(configFor('normal', { seed: 1 }).mineCount).toBe(8);
    expect(configFor('hard', { seed: 1 }).mineCount).toBe(12);
  });

  it('AC-203: las filas de minas nunca solapan las filas de inicio', () => {
    const small = createGame({ ranks: 6, mineCount: 99, seed: 2 });
    const range = mineRowRange(small.config);
    expect(range.start).toBeGreaterThanOrEqual(2);
    expect(range.end).toBeLessThanOrEqual(small.config.ranks - 3);
  });
});
