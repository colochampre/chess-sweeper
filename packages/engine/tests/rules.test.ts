import { describe, expect, it } from 'vitest';
import { applyMove, legalMoves, type GameEvent } from '@cm/engine';
import { at, emptyGame, put, sq } from './helpers.js';

const hops = (events: GameEvent[]) =>
  events.filter((e): e is Extract<GameEvent, { type: 'hop' }> => e.type === 'hop');

describe('FR-4 reglas de ajedrez estandar (AC-405)', () => {
  it('AC-405/404: enroque corto, primero el rey y despues la torre', () => {
    const s = emptyGame();
    put(s, 'e1', 'k', 'w', false);
    put(s, 'h1', 'r', 'w', false);
    put(s, 'a8', 'k', 'b');

    const { state, events } = applyMove(s, { from: sq(s, 'e1'), to: sq(s, 'g1') });
    expect(at(state, 'g1')).toMatchObject({ type: 'k', color: 'w' });
    expect(at(state, 'f1')).toMatchObject({ type: 'r', color: 'w' });
    expect(at(state, 'h1')).toBeNull();
    expect(hops(events).map((h) => [h.from, h.to])).toEqual([
      [sq(s, 'e1'), sq(s, 'f1')],
      [sq(s, 'f1'), sq(s, 'g1')],
      [sq(s, 'h1'), sq(s, 'g1')],
      [sq(s, 'g1'), sq(s, 'f1')],
    ]);
    expect(state.history.at(-1)?.castle).toBe('k');
  });

  it('AC-405: enroque largo', () => {
    const s = emptyGame();
    put(s, 'e1', 'k', 'w', false);
    put(s, 'a1', 'r', 'w', false);
    put(s, 'h8', 'k', 'b');

    const { state } = applyMove(s, { from: sq(s, 'e1'), to: sq(s, 'c1') });
    expect(at(state, 'c1')).toMatchObject({ type: 'k' });
    expect(at(state, 'd1')).toMatchObject({ type: 'r' });
  });

  it('AC-405: no se puede enrocar atravesando una casilla atacada', () => {
    const s = emptyGame();
    put(s, 'e1', 'k', 'w', false);
    put(s, 'h1', 'r', 'w', false);
    put(s, 'f8', 'r', 'b');
    put(s, 'a8', 'k', 'b');
    const moves = legalMoves(s, 'w');
    expect(moves.some((m) => m.from === sq(s, 'e1') && m.to === sq(s, 'g1'))).toBe(false);
  });

  it('AC-405: captura al paso', () => {
    const s = emptyGame();
    s.turn = 'b';
    put(s, 'e5', 'p', 'w');
    put(s, 'd7', 'p', 'b');
    put(s, 'h1', 'k', 'w');
    put(s, 'a8', 'k', 'b');

    const black = applyMove(s, { from: sq(s, 'd7'), to: sq(s, 'd5') });
    expect(black.state.enPassant).toBe(sq(s, 'd6'));

    const white = applyMove(black.state, { from: sq(s, 'e5'), to: sq(s, 'd6') });
    expect(at(white.state, 'd6')).toMatchObject({ type: 'p', color: 'w' });
    expect(at(white.state, 'd5')).toBeNull();
    expect(white.state.history.at(-1)?.enPassant).toBe(true);
  });

  it('AC-405: promocion, explicita y por defecto a dama', () => {
    const build = () => {
      const s = emptyGame();
      put(s, 'a7', 'p', 'w');
      put(s, 'h1', 'k', 'w');
      put(s, 'h8', 'k', 'b');
      return s;
    };

    const knight = applyMove(build(), {
      from: sq(build(), 'a7'),
      to: sq(build(), 'a8'),
      promotion: 'n',
    });
    expect(at(knight.state, 'a8')).toMatchObject({ type: 'n', color: 'w' });
    expect(knight.events.some((e) => e.type === 'promotion' && e.to === 'n')).toBe(true);

    const s = build();
    const queen = applyMove(s, { from: sq(s, 'a7'), to: sq(s, 'a8') });
    expect(at(queen.state, 'a8')).toMatchObject({ type: 'q' });
  });

  it('la legalidad ignora las minas por completo (informacion oculta)', () => {
    const clean = emptyGame();
    put(clean, 'e1', 'k', 'w');
    put(clean, 'd1', 'r', 'w');
    put(clean, 'a8', 'k', 'b');
    const before = legalMoves(clean, 'w').length;

    const mined = emptyGame();
    put(mined, 'e1', 'k', 'w');
    put(mined, 'd1', 'r', 'w');
    put(mined, 'a8', 'k', 'b');
    mined.mines[sq(mined, 'd4')] = true;
    expect(legalMoves(mined, 'w')).toHaveLength(before);
  });
});
