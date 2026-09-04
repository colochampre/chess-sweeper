/**
 * FR-7: tablas por repeticion y por las cien medias jugadas.
 *
 * Las dos son automaticas: aqui no hay reclamacion. Un arbitro al que hay que llamar es una
 * regla que se aplica solo cuando alguien se da cuenta.
 */
import { describe, expect, it } from 'vitest';
import {
  applyMove,
  computeCastlingRights,
  positionKey,
  toView,
  type GameState,
  type Square,
} from '@cm/engine';
import { emptyGame, put, sq } from './helpers.js';

/**
 * Los tests arman la posicion mutando el tablero DESPUES de `createGame`, asi que la cuenta
 * que sembro `createGame` es la de la posicion inicial de verdad y no la de esta. Se vuelve a
 * sembrar al terminar de colocar. En una partida no hace falta: nadie toca el tablero por
 * fuera de `applyMove`.
 */
function seal(s: GameState): GameState {
  // Los derechos de enroque se deducen del tablero en cada jugada, asi que hay que deducirlos
  // tambien aqui: sin torres son todos falsos, y dejarlos afirmados dejaria la posicion de
  // partida con una clave que ninguna jugada posterior puede volver a producir.
  s.castling = computeCastlingRights(s);
  s.positions = { [positionKey(s)]: 1 };
  return s;
}

/** Dos reyes y dos caballos: hay con que ir y volver sin capturar ni tocar un peon. */
function shuffleGame(): GameState {
  const s = emptyGame();
  put(s, 'h1', 'k', 'w');
  put(s, 'h8', 'k', 'b');
  put(s, 'b1', 'n', 'w');
  put(s, 'b8', 'n', 'b');
  return seal(s);
}

/** Una vuelta completa de los dos caballos: sale y vuelve a la posicion de partida. */
function lap(state: GameState): GameState {
  const moves: [string, string][] = [
    ['b1', 'c3'],
    ['b8', 'c6'],
    ['c3', 'b1'],
    ['c6', 'b8'],
  ];
  let s = state;
  for (const [from, to] of moves) {
    s = applyMove(s, { from: sq(s, from), to: sq(s, to) }).state;
  }
  return s;
}

/** Lo mismo, pero empezando por las negras: se usa cuando el turno quedo del otro lado. */
function lapFromBlack(state: GameState): GameState {
  const moves: [string, string][] = [
    ['b8', 'c6'],
    ['b1', 'c3'],
    ['c6', 'b8'],
    ['c3', 'b1'],
  ];
  let s = state;
  for (const [from, to] of moves) {
    s = applyMove(s, { from: sq(s, from), to: sq(s, to) }).state;
  }
  return s;
}

describe('FR-7 tablas por repeticion', () => {
  it('AC-708: la tercera vez que se repite la posicion, tablas', () => {
    const start = shuffleGame();

    // La posicion de partida ya cuenta como la primera.
    const second = lap(start);
    expect(second.status).toBe('playing');

    const third = lap(second);
    expect(third.status).toBe('draw');
    expect(third.winner).toBeNull();
    expect(third.endReason).toBe('threefold');
  });

  it('AC-708: el final viaja en el mismo evento end que cualquier otro', () => {
    let s = lap(shuffleGame());
    const moves: [string, string][] = [
      ['b1', 'c3'],
      ['b8', 'c6'],
      ['c3', 'b1'],
      ['c6', 'b8'],
    ];
    let events: ReturnType<typeof applyMove>['events'] = [];
    for (const [from, to] of moves) {
      const result = applyMove(s, { from: sq(s, from), to: sq(s, to) });
      s = result.state;
      events = result.events;
    }

    expect(events.filter((e) => e.type === 'end')).toEqual([
      { type: 'end', status: 'draw', winner: null, reason: 'threefold' },
    ]);
  });

  it('AC-709: la posicion es donde estan las piezas, quien mueve, enroque y al paso', () => {
    const s = shuffleGame();
    const key = positionKey(s);

    // Quien mueve forma parte de la posicion: el mismo tablero con el otro en juego es otra.
    expect(positionKey({ ...s, turn: 'b' })).not.toBe(key);
    // Y los derechos de enroque tambien, aunque no se vea nada distinto en el tablero.
    expect(
      positionKey({ ...s, castling: { w: { k: false, q: true }, b: { k: true, q: true } } }),
    ).not.toBe(key);
    expect(positionKey({ ...s, enPassant: 20 as Square })).not.toBe(key);
  });

  it('AC-709: lo que se sabe del terreno no cambia la posicion', () => {
    const s = shuffleGame();
    const key = positionKey(s);

    // La legalidad ignora las minas, asi que saber donde estan no cambia que se puede jugar.
    const revealed = { ...s, revealed: s.revealed.map(() => true) };
    expect(positionKey(revealed)).toBe(key);

    const flagged = { ...s, flags: { w: s.flags.w.map(() => true), b: s.flags.b } };
    expect(positionKey(flagged)).toBe(key);
  });

  it('AC-709: las piezas se comparan por tipo y color, nunca por su id', () => {
    const a = emptyGame();
    put(a, 'h1', 'k', 'w');
    put(a, 'h8', 'k', 'b');
    put(a, 'b1', 'n', 'w');
    put(a, 'g1', 'n', 'w');

    // El mismo tablero con los dos caballos intercambiados es la MISMA posicion: ninguna
    // jugada distingue un caballo de otro.
    const b = { ...a, board: a.board.slice() };
    const first = sq(a, 'b1');
    const second = sq(a, 'g1');
    b.board[first] = a.board[second];
    b.board[second] = a.board[first];

    expect(positionKey(b)).toBe(positionKey(a));
  });

  it('AC-710: mover un peon vacia la cuenta, porque esa posicion ya no puede volver', () => {
    const build = (): GameState => {
      const g = emptyGame();
      put(g, 'h1', 'k', 'w');
      put(g, 'h8', 'k', 'b');
      put(g, 'b1', 'n', 'w');
      put(g, 'b8', 'n', 'b');
      put(g, 'a2', 'p', 'w', false);
      return seal(g);
    };

    // Sin tocar el peon, dos vueltas dejan la posicion de partida en su tercera vez.
    expect(lap(lap(build())).status).toBe('draw');

    // Con el peon avanzado en medio, las mismas vueltas no terminan nada: lo que se conto
    // antes del avance ya no cuenta, porque ninguna de esas posiciones puede volver a darse.
    let other = lap(build());
    other = applyMove(other, { from: sq(other, 'a2'), to: sq(other, 'a3') }).state;
    other = lapFromBlack(other);

    expect(other.status).toBe('playing');
  });

  it('AC-711: la cuenta no sale del motor', () => {
    const s = shuffleGame();

    expect(s.positions).toBeDefined();
    expect(toView(s, 'w')).not.toHaveProperty('positions');
  });
});

describe('FR-7 tablas por las cien medias jugadas', () => {
  it('AC-707: cien medias jugadas sin peon, captura ni detonacion son tablas', () => {
    // El contador se hereda: llegar a cien moviendo de verdad son cincuenta vueltas, y lo
    // que se comprueba aqui es el corte, no el paseo.
    const s = shuffleGame();
    s.halfmoveClock = 99;

    const end = applyMove(s, { from: sq(s, 'b1'), to: sq(s, 'c3') }).state;

    expect(end.status).toBe('draw');
    expect(end.winner).toBeNull();
    expect(end.endReason).toBe('fifty-move');
  });

  it('AC-707/AC-710: un peon lo pone a cero, y con el se va la cuenta de posiciones', () => {
    const s = emptyGame();
    put(s, 'h1', 'k', 'w');
    put(s, 'h8', 'k', 'b');
    put(s, 'a2', 'p', 'w', false);
    seal(s);
    s.halfmoveClock = 99;

    const after = applyMove(s, { from: sq(s, 'a2'), to: sq(s, 'a3') }).state;

    expect(after.status).toBe('playing');
    expect(after.halfmoveClock).toBe(0);
    // La misma jugada que reinicia el reloj vacia la cuenta: solo queda la posicion nueva.
    expect(Object.values(after.positions)).toEqual([1]);
  });
});
