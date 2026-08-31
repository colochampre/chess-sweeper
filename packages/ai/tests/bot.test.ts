import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createGame,
  createRng,
  hypotheticalState,
  legalMoves,
  movePath,
  toView,
} from '@cm/engine';
import { LEVELS, VALUE, analyze, chooseMove, moveRisk, searchBestMove } from '@cm/ai';
import { beliefWith, emptyGame, put, sq, view } from './helpers.js';

const LEVEL_LIST = ['easy', 'normal', 'hard'] as const;

describe('FR-1 el bot solo ve lo que veria un jugador', () => {
  it('AC-101: no muta la vista que recibe ni necesita mas que ella', () => {
    const s = createGame({ seed: 21, mineCount: 8 });
    const v = toView(s, 'w');
    const snapshot = JSON.stringify(v);
    expect(Object.keys(v)).not.toContain('mines');

    chooseMove(v, { level: 'hard' });
    expect(JSON.stringify(v)).toBe(snapshot);
  });

  it('AC-103: siempre devuelve un movimiento legal, en cualquier nivel', () => {
    for (const level of LEVEL_LIST) {
      let state = createGame({ seed: 4, mineCount: 8 });
      for (let ply = 0; ply < 10 && state.status === 'playing'; ply++) {
        const move = chooseMove(toView(state, state.turn), { level });
        expect(move).not.toBeNull();
        const legal = legalMoves(state, state.turn);
        expect(legal.some((m) => m.from === move!.from && m.to === move!.to)).toBe(true);
        state = applyMove(state, move!).state;
      }
    }
  });

  it('AC-102: mismo estado, nivel y semilla dan siempre el mismo movimiento', () => {
    const s = createGame({ seed: 33, mineCount: 10 });
    const v = toView(s, 'w');
    for (const level of LEVEL_LIST) {
      const a = chooseMove(v, { level, seed: 7 });
      const b = chooseMove(v, { level, seed: 7 });
      expect(a).toEqual(b);
    }
  });

  it('AC-104: devuelve null si no hay movimientos legales', () => {
    const s = emptyGame();
    put(s, 'a8', 'k', 'b');
    put(s, 'b6', 'k', 'w');
    put(s, 'h1', 'r', 'w');
    const mated = applyMove(s, { from: sq(s, 'h1'), to: sq(s, 'h8') }).state;
    expect(mated.status).toBe('checkmate');
    expect(chooseMove(toView(mated, 'b'), { level: 'normal' })).toBeNull();
  });
});

describe('FR-3 riesgo de un movimiento', () => {
  it('AC-303: si todo el trayecto es seguro, el riesgo es cero', () => {
    const s = emptyGame();
    put(s, 'b1', 'n', 'w');
    const belief = beliefWith(s, {});
    expect(moveRisk(s, { from: sq(s, 'b1'), to: sq(s, 'c3') }, belief)).toBe(0);
  });

  it('AC-302: el caballo solo arriesga en su casilla de destino', () => {
    const s = emptyGame();
    put(s, 'b1', 'n', 'w');
    const overflown = beliefWith(s, { c2: 1, b2: 1 });
    expect(moveRisk(s, { from: sq(s, 'b1'), to: sq(s, 'c3') }, overflown)).toBe(0);

    const landing = beliefWith(s, { c3: 1 });
    expect(moveRisk(s, { from: sq(s, 'b1'), to: sq(s, 'c3') }, landing)).toBe(VALUE.n);
  });

  it('AC-301: el riesgo es la perdida material esperada del area de explosion', () => {
    const s = emptyGame();
    put(s, 'a1', 'r', 'w');
    put(s, 'b2', 'q', 'w'); // propia, dentro del area de a3
    put(s, 'b4', 'n', 'b'); // rival, dentro del area de a3
    const belief = beliefWith(s, { a3: 1 });

    const risk = moveRisk(s, { from: sq(s, 'a1'), to: sq(s, 'a5') }, belief);
    expect(risk).toBe(VALUE.r + VALUE.q - VALUE.n);
  });

  it('la primera mina del trayecto es la que cuenta', () => {
    const s = emptyGame();
    put(s, 'a1', 'r', 'w');
    const belief = beliefWith(s, { a2: 0.5, a3: 0.5 });
    // 0.5 en a2 + 0.5 x 0.5 en a3, ambas con el mismo coste (solo muere la torre).
    expect(moveRisk(s, { from: sq(s, 'a1'), to: sq(s, 'a4') }, belief)).toBeCloseTo(
      0.75 * VALUE.r,
      6,
    );
  });
});

describe('FR-4 dificultades', () => {
  it('AC-401/402/403: los perfiles crecen en profundidad y en calidad del modelo', () => {
    expect(LEVELS.easy.depth).toBe(1);
    expect(LEVELS.easy.noise).toBeGreaterThan(0);
    expect(LEVELS.easy.belief).toBe('prior');
    expect(LEVELS.normal.depth).toBeGreaterThan(LEVELS.easy.depth);
    expect(LEVELS.normal.belief).toBe('heuristic');
    expect(LEVELS.hard.depth).toBeGreaterThan(LEVELS.normal.depth);
    expect(LEVELS.hard.belief).toBe('exact');
  });

  it('AC-403: hard explora mas que normal y este mas que easy', () => {
    const s = createGame({ seed: 8, mineCount: 8 });
    const v = toView(s, 'w');
    const easy = analyze(v, { level: 'easy' }).nodes;
    const normal = analyze(v, { level: 'normal' }).nodes;
    const hard = analyze(v, { level: 'hard' }).nodes;
    expect(normal).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(normal);
  });

  it('AC-405: ninguna busqueda se pasa del presupuesto de nodos', () => {
    const s = createGame({ seed: 2, mineCount: 8 });
    for (const level of LEVEL_LIST) {
      const result = analyze(toView(s, 'w'), { level });
      expect(result.nodes).toBeLessThanOrEqual(LEVELS[level].nodeBudget * 1.2);
    }
  });

  it('normal y hard capturan una dama colgada; el riesgo no se lo impide', () => {
    const s = emptyGame();
    put(s, 'e1', 'k', 'w');
    put(s, 'd1', 'r', 'w');
    put(s, 'd5', 'q', 'b');
    put(s, 'h8', 'k', 'b');
    const v = view(s, 'w');
    for (const level of ['normal', 'hard'] as const) {
      const move = chooseMove(v, { level });
      expect(move).toMatchObject({ from: sq(s, 'd1'), to: sq(s, 'd5') });
    }
  });

  it('el bot esquiva una casilla que sabe minada', () => {
    const s = emptyGame();
    put(s, 'e1', 'k', 'w');
    put(s, 'd1', 'r', 'w');
    put(s, 'c3', 'b', 'w'); // dentro del area de d4
    put(s, 'e5', 'n', 'w'); // dentro del area de d4
    put(s, 'h8', 'k', 'b');

    const belief = beliefWith(s, { d4: 1 });
    const state = hypotheticalState(view(s, 'w'));
    const risk = moveRisk(state, { from: sq(s, 'd1'), to: sq(s, 'd6') }, belief);
    expect(risk).toBe(VALUE.r + VALUE.b + VALUE.n);

    const best = searchBestMove(state, {
      depth: 2,
      nodeBudget: 50_000,
      riskWeight: 1,
      belief,
      noise: 0,
      rng: createRng(1),
    });
    const chosen = best.move!;
    const piece = state.board[chosen.from]!;
    expect(movePath(chosen.from, chosen.to, piece.type, state.config)).not.toContain(sq(s, 'd4'));
  });

  it('si la explosion se lleva mas material rival que propio, el riesgo es negativo', () => {
    const s = emptyGame();
    put(s, 'e1', 'k', 'w');
    put(s, 'd1', 'r', 'w');
    put(s, 'd5', 'q', 'b'); // la dama negra esta dentro del area de d4
    put(s, 'h8', 'k', 'b');

    const belief = beliefWith(s, { d4: 1 });
    const state = hypotheticalState(view(s, 'w'));
    // Sacrificar la torre para volar la dama sale a favor: el riesgo actua como incentivo.
    expect(moveRisk(state, { from: sq(s, 'd1'), to: sq(s, 'd5') }, belief)).toBe(
      VALUE.r - VALUE.q,
    );
  });
});
