import { describe, expect, it } from 'vitest';
import { movePath } from '@cm/engine';
import { emptyGame, sq } from './helpers.js';

describe('FR-4 trayecto', () => {
  const s = emptyGame();
  const c = s.config;
  const names = (list: number[]): string[] =>
    list.map((n) => `${String.fromCharCode(97 + (n % c.files))}${Math.floor(n / c.files) + 1}`);

  it('AC-401: una pieza deslizante recorre todas las casillas intermedias en orden', () => {
    expect(names(movePath(sq(s, 'a1'), sq(s, 'a4'), 'r', c))).toEqual(['a2', 'a3', 'a4']);
    expect(names(movePath(sq(s, 'c1'), sq(s, 'f4'), 'b', c))).toEqual(['d2', 'e3', 'f4']);
    expect(names(movePath(sq(s, 'd1'), sq(s, 'a4'), 'q', c))).toEqual(['c2', 'b3', 'a4']);
  });

  it('AC-402: el caballo salta, su trayecto es solo el destino', () => {
    expect(names(movePath(sq(s, 'b1'), sq(s, 'c3'), 'n', c))).toEqual(['c3']);
    expect(names(movePath(sq(s, 'g1'), sq(s, 'f3'), 'n', c))).toEqual(['f3']);
  });

  it('AC-403: el avance doble de peon incluye la casilla intermedia', () => {
    expect(names(movePath(sq(s, 'e2'), sq(s, 'e4'), 'p', c))).toEqual(['e3', 'e4']);
    expect(names(movePath(sq(s, 'e7'), sq(s, 'e5'), 'p', c))).toEqual(['e6', 'e5']);
  });

  it('el rey recorre una sola casilla', () => {
    expect(names(movePath(sq(s, 'e1'), sq(s, 'e2'), 'k', c))).toEqual(['e2']);
  });
});
