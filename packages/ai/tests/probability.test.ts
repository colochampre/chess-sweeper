import { describe, expect, it } from 'vitest';
import { createGame, rankOf, toView } from '@cm/engine';
import { estimateMines } from '@cm/ai';
import { emptyGame, mine, reveal, sq, view } from './helpers.js';

describe('FR-2 creencia sobre las minas', () => {
  it('AC-201/202/207: sin pistas, prior uniforme solo en las casillas centrales', () => {
    const s = createGame({ seed: 3, mineCount: 8 });
    s.revealed.fill(false);
    const belief = estimateMines(toView(s, 'w'));

    expect(belief.remaining).toBe(8);
    let central = 0;
    belief.probability.forEach((p, i) => {
      const r = rankOf(i, s.config.files);
      if (r >= 2 && r <= 5) {
        expect(p).toBeCloseTo(8 / 32, 6); // AC-207
        central++;
      } else {
        expect(p).toBe(0); // AC-201
      }
    });
    expect(central).toBe(32);
  });

  it('AC-202: toda casilla revelada tiene probabilidad 0', () => {
    const s = createGame({ seed: 9, mineCount: 10 });
    const belief = estimateMines(toView(s, 'w'), 'exact');
    belief.probability.forEach((p, i) => {
      if (s.revealed[i]) expect(p).toBe(0);
    });
  });

  it('AC-205: una casilla revelada con 0 deja seguras a todas sus vecinas', () => {
    const s = emptyGame();
    mine(s, 'd4');
    reveal(s, 'g4');
    expect(s.adjacency[sq(s, 'g4')]).toBe(0);

    const belief = estimateMines(view(s, 'w'));
    for (const name of ['f3', 'g3', 'h3', 'f4', 'h4', 'f5', 'g5', 'h5']) {
      expect(belief.probability[sq(s, name)]).toBe(0);
    }
    expect(belief.probability[sq(s, 'd4')]).toBeGreaterThan(0);
  });

  it('AC-204: si el numero iguala a las vecinas desconocidas, todas son mina', () => {
    const s = emptyGame();
    mine(s, 'c3', 'c4', 'c5', 'd3', 'd5', 'e3', 'e4', 'e5');
    reveal(s, 'd4');
    expect(s.adjacency[sq(s, 'd4')]).toBe(8);

    const belief = estimateMines(view(s, 'w'));
    for (const name of ['c3', 'c4', 'c5', 'd3', 'd5', 'e3', 'e4', 'e5']) {
      expect(belief.probability[sq(s, name)]).toBe(1);
    }
  });

  it('AC-203: una mina descubierta pero sin detonar tiene probabilidad 1', () => {
    const s = emptyGame();
    mine(s, 'd4', 'f4');
    reveal(s, 'd4');
    s.knownMines[sq(s, 'd4')] = true;

    const belief = estimateMines(view(s, 'w'));
    expect(belief.probability[sq(s, 'd4')]).toBe(1);
    expect(belief.remaining).toBe(1);
  });

  it('AC-206: en modo exacto las probabilidades suman las minas que quedan', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const s = createGame({ seed, mineCount: 8 });
      const belief = estimateMines(toView(s, 'w'), 'exact');
      const total = belief.probability.reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(belief.remaining, 4);
    }
  });

  it('el modo exacto deduce mas que el heuristico en la apertura', () => {
    const s = createGame({ seed: 5, mineCount: 8 });
    const v = toView(s, 'w');
    const heur = estimateMines(v, 'heuristic');
    const exact = estimateMines(v, 'exact');
    const certain = (p: number[]) => p.filter((x) => x === 0 || x === 1).length;
    expect(certain(exact.probability)).toBeGreaterThanOrEqual(certain(heur.probability));
  });
});
