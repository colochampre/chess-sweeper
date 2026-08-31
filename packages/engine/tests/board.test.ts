import { describe, expect, it } from 'vitest';
import { backRankOrder, createGame, parseSquare, squareName } from '@cm/engine';

describe('FR-1 tablero y configuracion', () => {
  it('AC-101: un tablero 8x8 nuevo tiene la posicion inicial estandar', () => {
    const s = createGame({ seed: 7 });
    expect(s.board.filter((p) => p !== null)).toHaveLength(32);
    expect(backRankOrder(8)).toEqual(['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']);
    expect(s.board[parseSquare('e1', s.config)]).toMatchObject({ type: 'k', color: 'w' });
    expect(s.board[parseSquare('d8', s.config)]).toMatchObject({ type: 'q', color: 'b' });
    expect(s.board[parseSquare('a2', s.config)]).toMatchObject({ type: 'p', color: 'w' });
    expect(squareName(parseSquare('h5', s.config), s.config)).toBe('h5');
  });

  it('AC-102: acepta tableros de otros tamanos y coloca rey y dama en el centro', () => {
    for (const files of [4, 6, 10]) {
      const order = backRankOrder(files);
      expect(order).toHaveLength(files);
      expect(order.filter((t) => t === 'k')).toHaveLength(1);
      expect(order[0]).toBe('r');
      expect(order[files - 1]).toBe('r');
    }
    const s = createGame({ files: 6, ranks: 10, seed: 3 });
    expect(s.board.filter((p) => p !== null)).toHaveLength(24);
    expect(s.board.length).toBe(60);
  });

  it('AC-103: la misma semilla produce partidas identicas', () => {
    const a = createGame({ seed: 12345 });
    const b = createGame({ seed: 12345 });
    const c = createGame({ seed: 999 });
    expect(a.mines).toEqual(b.mines);
    expect(a.revealed).toEqual(b.revealed);
    expect(a.mines).not.toEqual(c.mines);
  });
});
