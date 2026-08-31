import { describe, expect, it } from 'vitest';
import { createGame, rankOf, revealFrom, sqOf } from '@cm/engine';
import { emptyGame, mine, sq } from './helpers.js';

describe('FR-3 revelado en cascada', () => {
  it('AC-301: la cascada nunca revela una casilla con mina', () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = createGame({ seed, mineCount: 8 });
      s.mines.forEach((isMine, i) => {
        if (isMine) expect(s.revealed[i]).toBe(false);
      });
    }
  });

  it('AC-302: al empezar, las dos filas traseras de cada bando estan reveladas', () => {
    const s = createGame({ seed: 5, mineCount: 8 });
    for (let f = 0; f < s.config.files; f++) {
      for (const r of [0, 1, s.config.ranks - 2, s.config.ranks - 1]) {
        expect(s.revealed[sqOf(f, r, s.config.files)]).toBe(true);
      }
    }
    // Las filas centrales no pueden estar reveladas por completo.
    const central = s.revealed.filter((v, i) => v && rankOf(i, s.config.files) === 3);
    expect(central.length).toBeLessThan(s.config.files);
  });

  it('AC-303: una casilla con numero se revela pero no propaga', () => {
    const s = emptyGame();
    mine(s, 'd4');
    const revealed = revealFrom(s, sq(s, 'c4'));
    expect(s.adjacency[sq(s, 'c4')]).toBe(1);
    expect(revealed).toEqual([sq(s, 'c4')]);
    expect(s.revealed[sq(s, 'b4')]).toBe(false);
  });

  it('AC-303: una casilla con cero propaga a todo el area libre', () => {
    const s = emptyGame();
    mine(s, 'd4');
    revealFrom(s, sq(s, 'a1'));
    expect(s.revealed[sq(s, 'h8')]).toBe(true);
    expect(s.revealed[sq(s, 'd4')]).toBe(false);
  });

  it('AC-304: revelar una casilla ya revelada no cambia nada', () => {
    const s = emptyGame();
    mine(s, 'd4');
    revealFrom(s, sq(s, 'c4'));
    expect(revealFrom(s, sq(s, 'c4'))).toEqual([]);
  });
});
