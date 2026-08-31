import { describe, expect, it } from 'vitest';
import { applyMove } from '@cm/engine';
import { at, emptyGame, mine, put, sq } from './helpers.js';

/** Torre blanca en a4 que va a pisar la mina de d4; los reyes se colocan en cada caso. */
const mineRun = (overrides = {}) => {
  const s = emptyGame(overrides);
  put(s, 'a4', 'r', 'w');
  mine(s, 'd4');
  return s;
};

describe('FR-7 fin de partida', () => {
  it('AC-701: si el rey muere en la explosion, gana el rival al instante', () => {
    const s = mineRun();
    put(s, 'c3', 'k', 'b');
    put(s, 'h1', 'k', 'w');

    const { state, events } = applyMove(s, { from: sq(s, 'a4'), to: sq(s, 'd4') });
    expect(state.status).toBe('king-destroyed');
    expect(state.winner).toBe('w');
    expect(events.at(-1)).toMatchObject({ type: 'end', status: 'king-destroyed' });
  });

  it('AC-702: si mueren los dos reyes en la misma cadena, tablas', () => {
    const s = mineRun();
    put(s, 'c3', 'k', 'w');
    put(s, 'e5', 'k', 'b');

    const { state } = applyMove(s, { from: sq(s, 'a4'), to: sq(s, 'd4') });
    expect(state.status).toBe('draw');
    expect(state.winner).toBeNull();
  });

  it('AC-705: con kingImmuneToMines el rey sobrevive a la explosion', () => {
    const s = mineRun({ kingImmuneToMines: true });
    put(s, 'c3', 'k', 'b');
    put(s, 'h1', 'k', 'w');

    const { state } = applyMove(s, { from: sq(s, 'a4'), to: sq(s, 'd4') });
    expect(at(state, 'c3')).toMatchObject({ type: 'k', color: 'b' });
    expect(state.winner).toBeNull();
  });

  it('AC-703: jaque mate clasico', () => {
    const s = emptyGame();
    put(s, 'a8', 'k', 'b');
    put(s, 'b6', 'k', 'w');
    put(s, 'h1', 'r', 'w');

    const { state } = applyMove(s, { from: sq(s, 'h1'), to: sq(s, 'h8') });
    expect(state.status).toBe('checkmate');
    expect(state.winner).toBe('w');
    expect(state.inCheck).toBe(true);
  });

  it('AC-704: rey ahogado', () => {
    const s = emptyGame();
    put(s, 'a8', 'k', 'b');
    put(s, 'c6', 'q', 'w');
    put(s, 'h1', 'k', 'w');

    const { state } = applyMove(s, { from: sq(s, 'c6'), to: sq(s, 'c7') });
    expect(state.status).toBe('stalemate');
    expect(state.winner).toBeNull();
    expect(state.inCheck).toBe(false);
  });

  it('AC-706: no se acepta ningun movimiento con la partida terminada', () => {
    const s = emptyGame();
    put(s, 'a8', 'k', 'b');
    put(s, 'b6', 'k', 'w');
    put(s, 'h1', 'r', 'w');
    const { state } = applyMove(s, { from: sq(s, 'h1'), to: sq(s, 'h8') });

    expect(() => applyMove(state, { from: sq(s, 'a8'), to: sq(s, 'b8') })).toThrow(/terminado/);
  });

  it('tablas por material insuficiente: reyes y una pieza menor', () => {
    const s = emptyGame();
    put(s, 'a1', 'k', 'w');
    put(s, 'd6', 'n', 'w');
    put(s, 'h8', 'k', 'b');
    put(s, 'b7', 'n', 'b');
    const { state } = applyMove(s, { from: sq(s, 'd6'), to: sq(s, 'b7') });
    expect(state.status).toBe('draw');
    expect(state.winner).toBeNull();
  });
});
