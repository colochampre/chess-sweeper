import { describe, expect, it } from 'vitest';
import { applyMove, createGame, toView, toggleFlag } from '@cm/engine';
import { emptyGame, mine, put, sq } from './helpers.js';

describe('FR-9 informacion oculta', () => {
  it('AC-901: la vista no lleva el campo de minas', () => {
    const s = createGame({ seed: 4, mineCount: 8 });
    const view = toView(s, 'w');
    expect(Object.keys(view)).not.toContain('mines');
    expect(JSON.parse(JSON.stringify(view))).not.toHaveProperty('mines');
    expect(view.minesRemaining).toBe(8);
  });

  it('AC-902: la vista solo lleva las banderas del jugador que la pide', () => {
    let s = createGame({ seed: 4, mineCount: 8 });
    s = toggleFlag(s, 'w', 20);
    s = toggleFlag(s, 'b', 21);

    const white = toView(s, 'w');
    const black = toView(s, 'b');
    expect(white.flags[20]).toBe(true);
    expect(white.flags[21]).toBe(false);
    expect(black.flags[21]).toBe(true);
    expect(black.flags[20]).toBe(false);
  });

  it('AC-903: una mina ya detonada si aparece en la vista', () => {
    const s = emptyGame();
    put(s, 'd1', 'r', 'w');
    put(s, 'h1', 'k', 'w');
    put(s, 'h8', 'k', 'b');
    mine(s, 'd4');

    const { state } = applyMove(s, { from: sq(s, 'd1'), to: sq(s, 'd4') });
    const view = toView(state, 'b');
    expect(view.detonated[sq(s, 'd4')]).toBe(true);
    expect(view.revealed[sq(s, 'd4')]).toBe(true);
    expect(view.minesRemaining).toBe(0);
  });

  it('la vista es una copia: mutarla no afecta al estado real', () => {
    const s = createGame({ seed: 4, mineCount: 8 });
    const view = toView(s, 'w');
    view.board[0] = null;
    view.flags[5] = true;
    expect(s.board[0]).not.toBeNull();
    expect(s.flags.w[5]).toBe(false);
  });
});
