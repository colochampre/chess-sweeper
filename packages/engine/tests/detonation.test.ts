import { describe, expect, it } from 'vitest';
import { applyMove, type GameEvent } from '@cm/engine';
import { at, emptyGame, mine, put, sq } from './helpers.js';

const explosions = (events: GameEvent[]) =>
  events.filter((e): e is Extract<GameEvent, { type: 'explosion' }> => e.type === 'explosion');

describe('FR-5 detonacion en el trayecto', () => {
  it('AC-501/503: la torre muere en la primera mina del trayecto y no captura en el destino', () => {
    const s = emptyGame();
    put(s, 'a1', 'r', 'w');
    put(s, 'h1', 'k', 'w');
    put(s, 'h8', 'k', 'b');
    put(s, 'a5', 'p', 'b');
    mine(s, 'a3');

    const { state } = applyMove(s, { from: sq(s, 'a1'), to: sq(s, 'a5') });

    expect(at(state, 'a5')).toMatchObject({ type: 'p', color: 'b' }); // el peon sobrevive
    expect(at(state, 'a3')).toBeNull(); // la torre murio donde detono
    expect(state.board.some((p) => p?.type === 'r')).toBe(false);
    expect(state.history.at(-1)?.detonatedAt).toBe(sq(s, 'a3'));
  });

  it('AC-502: el caballo salta por encima de una mina y solo detona en su destino', () => {
    const jumped = emptyGame();
    put(jumped, 'b1', 'n', 'w');
    put(jumped, 'h1', 'k', 'w');
    put(jumped, 'h8', 'k', 'b');
    mine(jumped, 'c2');
    const a = applyMove(jumped, { from: sq(jumped, 'b1'), to: sq(jumped, 'c3') });
    expect(at(a.state, 'c3')).toMatchObject({ type: 'n' });
    expect(a.state.mines[sq(jumped, 'c2')]).toBe(true);

    const landed = emptyGame();
    put(landed, 'b1', 'n', 'w');
    put(landed, 'h1', 'k', 'w');
    put(landed, 'h8', 'k', 'b');
    mine(landed, 'c3');
    const b = applyMove(landed, { from: sq(landed, 'b1'), to: sq(landed, 'c3') });
    expect(b.state.board.some((p) => p?.type === 'n')).toBe(false);
    expect(explosions(b.events)).toHaveLength(1);
  });

  it('AC-504: revealOnTransit controla si se revelan las casillas de paso', () => {
    const build = (revealOnTransit: boolean) => {
      const s = emptyGame({ revealOnTransit });
      put(s, 'a1', 'r', 'w');
      put(s, 'h1', 'k', 'w');
      put(s, 'h8', 'k', 'b');
      mine(s, 'b3');
      return applyMove(s, { from: sq(s, 'a1'), to: sq(s, 'a4') }).state;
    };

    const off = build(false);
    expect(off.revealed[sq(off, 'a4')]).toBe(true);
    expect(off.revealed[sq(off, 'a2')]).toBe(false);

    const on = build(true);
    expect(on.revealed[sq(on, 'a2')]).toBe(true);
    expect(on.revealed[sq(on, 'a3')]).toBe(true);
  });

  it('AC-505: revelar el trayecto es el defecto, y el caballo sigue sin destapar lo que sobrevuela', () => {
    // Sin override: lo que se afirma aqui es DEFAULT_CONFIG, que es con lo que se juega. El
    // defecto anterior no lo afirmaba ningun test, asi que cambiarlo no rompia nada — que es
    // justo como un defecto se cambia sin querer.
    const rook = emptyGame();
    put(rook, 'a1', 'r', 'w');
    put(rook, 'h1', 'k', 'w');
    put(rook, 'h8', 'k', 'b');
    // La mina acota la cascada: deja a2, a3 y a4 con adyacencia 1, asi que si aparecen
    // reveladas es por el trayecto y no porque el destapado se haya ido por todo el tablero.
    mine(rook, 'b3');
    const slid = applyMove(rook, { from: sq(rook, 'a1'), to: sq(rook, 'a4') }).state;

    expect(slid.revealed[sq(slid, 'a2')]).toBe(true);
    expect(slid.revealed[sq(slid, 'a3')]).toBe(true);

    // El caballo no: su trayecto es solo el destino (AC-402), y lo que sobrevuela sigue
    // tapado igual que sigue sin detonarlo (AC-502).
    const knight = emptyGame();
    put(knight, 'b1', 'n', 'w');
    put(knight, 'h1', 'k', 'w');
    put(knight, 'h8', 'k', 'b');
    mine(knight, 'd4'); // deja c3 con adyacencia 1: aterriza y no cascadea
    const hopped = applyMove(knight, { from: sq(knight, 'b1'), to: sq(knight, 'c3') }).state;

    expect(hopped.revealed[sq(hopped, 'c3')]).toBe(true);
    expect(hopped.revealed[sq(hopped, 'c2')]).toBe(false);
  });
});

describe('FR-6 explosion y reaccion en cadena', () => {
  const scenario = (overrides = {}) => {
    const s = emptyGame(overrides);
    put(s, 'd1', 'r', 'w');
    put(s, 'c3', 'b', 'w');
    put(s, 'e5', 'n', 'b');
    put(s, 'h1', 'k', 'w');
    put(s, 'h8', 'k', 'b');
    return s;
  };

  it('AC-601/604: la explosion destruye piezas de ambos colores y marca el area', () => {
    const s = scenario();
    mine(s, 'd4');
    const { state, events } = applyMove(s, { from: sq(s, 'd1'), to: sq(s, 'd4') });

    expect(at(state, 'c3')).toBeNull(); // alfil blanco
    expect(at(state, 'e5')).toBeNull(); // caballo negro
    expect(at(state, 'd4')).toBeNull(); // la torre que piso la mina
    expect(state.detonated[sq(s, 'c3')]).toBe(true);
    expect(state.revealed[sq(s, 'c3')]).toBe(true);
    expect(explosions(events)[0].cells).toHaveLength(9);
  });

  it('AC-602: dos minas contiguas producen una unica cadena', () => {
    const s = scenario();
    mine(s, 'd4', 'd5');
    const { state, events } = applyMove(s, { from: sq(s, 'd1'), to: sq(s, 'd4') });

    const centers = explosions(events).map((e) => e.center);
    expect(centers).toEqual([sq(s, 'd4'), sq(s, 'd5')]);
    expect(state.detonated[sq(s, 'c3')]).toBe(true);
    expect(state.detonated[sq(s, 'c6')]).toBe(true);
    expect(state.mines.filter(Boolean)).toHaveLength(0);
  });

  it('AC-603: sin cadena solo detona la mina pisada', () => {
    const s = scenario({ chainExplosions: false });
    mine(s, 'd4', 'd5');
    const { state, events } = applyMove(s, { from: sq(s, 'd1'), to: sq(s, 'd4') });

    expect(explosions(events)).toHaveLength(1);
    expect(state.mines[sq(s, 'd5')]).toBe(true);
    expect(state.detonated[sq(s, 'c6')]).toBe(false);
  });

  it('AC-605: tras la explosion se recalculan los numeros y sigue la cascada', () => {
    const s = emptyGame();
    put(s, 'a4', 'r', 'w');
    put(s, 'h1', 'k', 'w');
    put(s, 'h8', 'k', 'b');
    mine(s, 'd4');
    s.revealed[sq(s, 'c4')] = true;
    expect(s.adjacency[sq(s, 'c4')]).toBe(1);

    const { state } = applyMove(s, { from: sq(s, 'a4'), to: sq(s, 'd4') });
    expect(state.adjacency[sq(s, 'c4')]).toBe(0);
    expect(state.revealed.every(Boolean)).toBe(true);
  });

  it('AC-606: una cadena densa termina y ninguna mina detona dos veces', () => {
    const s = emptyGame();
    put(s, 'd1', 'r', 'w');
    put(s, 'h1', 'k', 'w');
    put(s, 'h8', 'k', 'b');
    mine(s, 'c3', 'c4', 'c5', 'd3', 'd4', 'd5', 'e3', 'e4', 'e5');

    const { state, events } = applyMove(s, { from: sq(s, 'd1'), to: sq(s, 'd3') });
    const centers = explosions(events).map((e) => e.center);
    expect(centers).toHaveLength(9);
    expect(new Set(centers).size).toBe(9);
    expect(state.mines.filter(Boolean)).toHaveLength(0);
  });
});
