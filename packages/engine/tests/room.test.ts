import { describe, expect, it } from 'vitest';
import {
  ABSENCE_FORFEIT_MS,
  ROOM_CODE_LENGTH,
  ROOM_TTL_MS,
  createRoom,
  forfeitAbsent,
  generateRoomCode,
  intentToQuery,
  isRoomError,
  isStale,
  leaveRoom,
  legalMoves,
  markDisconnected,
  parseIntent,
  playMove,
  rematch,
  resumeSeat,
  takeSeat,
  viewFor,
  type RoomSettings,
  type Seat,
} from '@cm/engine';

const SETTINGS: RoomSettings = { difficulty: 'normal', boardSize: 8, hostColor: 'w' };
const room = (overrides: Partial<RoomSettings> = {}) =>
  createRoom(generateRoomCode(), { ...SETTINGS, ...overrides });

/** `takeSeat` devuelve asiento o error; en los tests siempre esperamos asiento. */
const seatOf = (result: Seat | { error: string }): Seat => {
  if (isRoomError(result)) throw new Error(`asiento inesperado: ${result.error}`);
  return result;
};

describe('FR-1 salas', () => {
  it('AC-101: el codigo tiene 6 caracteres y evita los ambiguos', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    }
  });

  it('AC-102: el anfitrion coge su color y el segundo el que queda libre', () => {
    const r = room({ hostColor: 'b' });
    expect(seatOf(takeSeat(r)).color).toBe('b');
    expect(seatOf(takeSeat(r)).color).toBe('w');
  });

  it('AC-103: la sala llena rechaza a un tercero', () => {
    const r = room();
    takeSeat(r);
    takeSeat(r);
    const third = takeSeat(r);
    expect(isRoomError(third)).toBe(true);
  });

  it('AC-104: una sala sin nadie conectado caduca', () => {
    const r = room();
    const seat = seatOf(takeSeat(r));
    expect(isStale(r)).toBe(false); // sigue conectado
    seat.connected = false;
    expect(isStale(r)).toBe(false); // vacia pero reciente
    expect(isStale(r, Date.now() + ROOM_TTL_MS + 1000)).toBe(true);
  });
});

describe('FR-2 autoridad sobre las minas', () => {
  it('AC-201/204: cada jugador recibe su vista y ninguna lleva las minas', () => {
    const r = room();
    const white = viewFor(r, 'w');
    const black = viewFor(r, 'b');
    expect(Object.keys(white)).not.toContain('mines');
    expect(JSON.parse(JSON.stringify(black))).not.toHaveProperty('mines');
    expect(white.as).toBe('w');
    expect(black.as).toBe('b');
  });

  it('AC-202: un movimiento ilegal no toca el estado', () => {
    const r = room();
    const before = r.game;
    expect(isRoomError(playMove(r, 'w', { from: 0, to: 40 }))).toBe(true);
    expect(r.game).toBe(before);
  });

  it('AC-203: no se puede mover fuera de turno', () => {
    const r = room();
    const blackMove = legalMoves(r.game, 'b')[0];
    expect(isRoomError(playMove(r, 'b', blackMove))).toBe(true);
  });

  it('un movimiento legal avanza la partida y devuelve eventos', () => {
    const r = room();
    const result = playMove(r, 'w', legalMoves(r.game, 'w')[0]);
    expect(isRoomError(result)).toBe(false);
    if (isRoomError(result)) return;
    expect(result.events.some((e) => e.type === 'hop')).toBe(true);
    expect(r.game.turn).toBe('b');
  });
});

describe('FR-3 reconexion', () => {
  it('AC-301/302: el token recupera el asiento', () => {
    const r = room();
    const seat = seatOf(takeSeat(r));
    seat.connected = false;

    const resumed = resumeSeat(r, seat.token);
    expect(isRoomError(resumed)).toBe(false);
    if (isRoomError(resumed)) return;
    expect(resumed.color).toBe(seat.color);
    expect(resumed.connected).toBe(true);
  });

  it('AC-303: un token ajeno no recupera nada', () => {
    const r = room();
    takeSeat(r);
    expect(isRoomError(resumeSeat(r, 'token-inventado'))).toBe(true);
  });

  it('AC-304: al desconectar, el asiento queda marcado', () => {
    const r = room();
    const seat = seatOf(takeSeat(r));
    expect(markDisconnected(r, seat.color, seat.session)).toBe(true);
    expect(r.seats[seat.color]?.connected).toBe(false);
  });

  it('AC-305: el cierre de una conexion ya reemplazada no marca ausencia', () => {
    const r = room();
    const first = seatOf(takeSeat(r));
    const staleSession = first.session;

    // El jugador reconecta: se sienta una sesion nueva en el mismo asiento.
    const resumed = seatOf(resumeSeat(r, first.token));
    expect(resumed.session).not.toBe(staleSession);

    // Y ahora llega, tarde, el cierre del socket viejo. No debe echarle de la sala:
    // sin esto, reconectar te deja invisible para tu rival.
    expect(markDisconnected(r, resumed.color, staleSession)).toBe(false);
    expect(r.seats[resumed.color]?.connected).toBe(true);

    // El cierre de la sesion vigente si cuenta.
    expect(markDisconnected(r, resumed.color, resumed.session)).toBe(true);
    expect(r.seats[resumed.color]?.connected).toBe(false);
  });

  it('la revancha intercambia los colores y reparte minas nuevas', () => {
    const r = room();
    const host = seatOf(takeSeat(r));
    takeSeat(r);
    const beforeMines = r.game.mines.join('');

    rematch(r);
    expect(host.color).toBe('b');
    expect(r.seats.b).toBe(host);
    expect(r.game.history).toHaveLength(0);
    expect(r.game.mines.join('')).not.toBe(beforeMines);
  });
});

describe('FR-5 parametros de conexion', () => {
  it('AC-501: ida y vuelta de los tres tipos de intencion', () => {
    const intents = [
      { a: 'create', difficulty: 'hard', boardSize: 10, hostColor: 'random' },
      { a: 'join', code: 'ABC234' },
      { a: 'resume', code: 'ABC234', token: '2f1c9a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f' },
    ] as const;
    for (const intent of intents) {
      expect(parseIntent(new URLSearchParams(intentToQuery(intent)))).toEqual(intent);
    }
  });

  it('AC-502: se rechaza cualquier parametro que no cuadre', () => {
    const bad = [
      '', // sin accion
      'a=create&difficulty=imposible&boardSize=8&hostColor=w',
      'a=create&difficulty=normal&boardSize=999&hostColor=w', // tablero fuera de rango
      'a=create&difficulty=normal&boardSize=8&hostColor=verde',
      'a=join', // sin codigo
      'a=join&code=ABC', // codigo corto
      'a=join&code=ABC0I1', // caracteres ambiguos, fuera del alfabeto
      'a=resume&code=ABC234', // sin token
      'a=resume&code=ABC234&token=../../etc/passwd',
      'a=borrar-todo&code=ABC234',
    ];
    for (const query of bad) {
      expect(parseIntent(new URLSearchParams(query))).toBeNull();
    }
  });

  it('AC-502: el codigo se normaliza antes de validarse', () => {
    const parsed = parseIntent(new URLSearchParams('a=join&code= abc-234 '));
    expect(parsed).toEqual({ a: 'join', code: 'ABC234' });
  });
});

describe('FR-11 abandonar una partida', () => {
  /** Sala con los dos asientos ocupados y la partida en marcha. */
  const started = () => {
    const r = room();
    const host = seatOf(takeSeat(r));
    const guest = seatOf(takeSeat(r));
    return { r, host, guest };
  };

  it('AC-1102: al abandonar, la partida termina y gana el rival', () => {
    const { r, host, guest } = started();

    const result = leaveRoom(r, host.color);
    if (isRoomError(result)) throw new Error(`abandono inesperado: ${result.error}`);

    expect(r.game.status).toBe('abandoned');
    expect(r.game.winner).toBe(guest.color);
    expect(r.game.endReason).toBe('abandoned');
  });

  it('AC-1107: el final por abandono viaja en el mismo evento `end` que el resto', () => {
    const { r, host, guest } = started();

    const result = leaveRoom(r, host.color);
    if (isRoomError(result)) throw new Error(`abandono inesperado: ${result.error}`);

    expect(result.events).toEqual([
      { type: 'end', status: 'abandoned', winner: guest.color, reason: 'abandoned' },
    ]);
  });

  it('AC-1103: perder la conexion no termina la partida y el asiento se recupera', () => {
    const { r, host } = started();

    expect(markDisconnected(r, host.color, host.session)).toBe(true);
    expect(r.game.status).toBe('playing');

    const back = seatOf(resumeSeat(r, host.token));
    expect(back.color).toBe(host.color);
    expect(back.connected).toBe(true);
    expect(r.game.status).toBe('playing');
  });

  it('AC-1104: una ausencia larga da la victoria al rival sin que este pida nada', () => {
    const { r, host, guest } = started();
    const t0 = Date.now();
    markDisconnected(r, host.color, host.session, t0);

    // Todavia dentro del plazo: la partida sigue.
    expect(forfeitAbsent(r, t0 + ABSENCE_FORFEIT_MS - 1)).toBeNull();
    expect(r.game.status).toBe('playing');

    const result = forfeitAbsent(r, t0 + ABSENCE_FORFEIT_MS + 1);
    expect(result).not.toBeNull();
    expect(r.game.status).toBe('abandoned');
    expect(r.game.winner).toBe(guest.color);
  });

  it('AC-1104: volver antes del plazo cancela el abandono', () => {
    const { r, host } = started();
    const t0 = Date.now();
    markDisconnected(r, host.color, host.session, t0);
    resumeSeat(r, host.token, t0 + 1000);

    expect(forfeitAbsent(r, t0 + ABSENCE_FORFEIT_MS + 1)).toBeNull();
    expect(r.game.status).toBe('playing');
  });

  it('AC-1105: irse antes de que llegue el rival no da la victoria a nadie', () => {
    const r = room();
    const host = seatOf(takeSeat(r));

    const result = leaveRoom(r, host.color);
    if (isRoomError(result)) throw new Error(`abandono inesperado: ${result.error}`);

    expect(result.events).toEqual([]);
    expect(r.game.status).toBe('playing');
    expect(r.game.winner).toBeNull();
    // El asiento queda libre: la sala vuelve a admitir a alguien.
    expect(r.seats[host.color]).toBeUndefined();
    expect(isRoomError(takeSeat(r))).toBe(false);
  });

  it('AC-1106: una partida ya terminada no se abandona dos veces', () => {
    const { r, host, guest } = started();
    leaveRoom(r, host.color);

    expect(isRoomError(leaveRoom(r, guest.color))).toBe(true);
    expect(r.game.winner).toBe(guest.color);
  });

  it('AC-1106: una ausencia larga sobre una partida terminada no cambia el resultado', () => {
    const { r, host, guest } = started();
    leaveRoom(r, host.color);

    markDisconnected(r, guest.color, guest.session, Date.now());
    expect(forfeitAbsent(r, Date.now() + ABSENCE_FORFEIT_MS + 1)).toBeNull();
    expect(r.game.winner).toBe(guest.color);
  });
});
