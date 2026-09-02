import { describe, expect, it } from 'vitest';
import {
  ABSENCE_FORFEIT_MS,
  absenceMsLeft,
  ROOM_CODE_LENGTH,
  PROTOCOL_VERSION,
  ROOM_TTL_MS,
  DRAW_COOLDOWN_MOVES,
  clockMsLeft,
  clockRunningFor,
  createRoom,
  declineDraw,
  drawMovesLeft,
  forfeitAbsent,
  forfeitTimeout,
  generateRoomCode,
  intentToQuery,
  isProtocolCurrent,
  isRoomError,
  isStale,
  leaveRoom,
  legalMoves,
  markDisconnected,
  offerDraw,
  parseIntent,
  playMove,
  rematch,
  requestRematch,
  resumeSeat,
  takeSeat,
  viewFor,
  type RoomError,
  type RoomState,
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
      { a: 'create', difficulty: 'hard', boardSize: 10, hostColor: 'random', timeControl: '10+5' },
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

  it('AC-503: la version del protocolo viaja en la query y vuelve', () => {
    const query = new URLSearchParams(intentToQuery({ a: 'join', code: 'ABC234' }));

    expect(query.get('v')).toBe(String(PROTOCOL_VERSION));
    expect(isProtocolCurrent(query)).toBe(true);
  });

  it('AC-503: una version distinta, o ninguna, no es la nuestra', () => {
    // Sin version es un cliente anterior a que existiera el campo: tambien es viejo.
    expect(isProtocolCurrent(new URLSearchParams('a=join&code=ABC234'))).toBe(false);
    expect(isProtocolCurrent(new URLSearchParams(`v=${PROTOCOL_VERSION - 1}`))).toBe(false);
    expect(isProtocolCurrent(new URLSearchParams('v=no-es-un-numero'))).toBe(false);
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

  it('AC-1109: mientras el rival esta ausente se sabe cuanto le queda', () => {
    const { r, host } = started();
    const t0 = Date.now();

    // Con todos presentes no corre ningun plazo.
    expect(absenceMsLeft(r, host.color, t0)).toBeNull();

    markDisconnected(r, host.color, host.session, t0);
    expect(absenceMsLeft(r, host.color, t0)).toBe(ABSENCE_FORFEIT_MS);
    expect(absenceMsLeft(r, host.color, t0 + 30_000)).toBe(ABSENCE_FORFEIT_MS - 30_000);
    // Nunca baja de cero, aunque la comprobacion llegue tarde.
    expect(absenceMsLeft(r, host.color, t0 + ABSENCE_FORFEIT_MS * 2)).toBe(0);

    // Y al volver deja de correr.
    resumeSeat(r, host.token, t0 + 1000);
    expect(absenceMsLeft(r, host.color, t0 + 2000)).toBeNull();
  });

  it('AC-1109: sin rival sentado no corre plazo: no hay a quien dar la victoria', () => {
    const r = room();
    const host = seatOf(takeSeat(r));
    const t0 = Date.now();
    markDisconnected(r, host.color, host.session, t0);

    expect(absenceMsLeft(r, host.color, t0 + ABSENCE_FORFEIT_MS + 1)).toBeNull();
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

  it('AC-1108: al abandonar, el asiento queda libre y se puede volver a ocupar', () => {
    const { r, host, guest } = started();

    leaveRoom(r, host.color);

    // El que se fue ya no ocupa sitio...
    expect(r.seats[host.color]).toBeUndefined();
    // ...pero el que se queda conserva el suyo, y su victoria.
    expect(r.seats[guest.color]).toBeDefined();
    expect(r.game.winner).toBe(guest.color);
    // Y la sala vuelve a admitir a alguien en el asiento vacante.
    const back = takeSeat(r);
    expect(isRoomError(back)).toBe(false);
    expect(seatOf(back).color).toBe(host.color);
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

describe('FR-12 la revancha se acuerda', () => {
  /** Sala con los dos sentados y la partida ya terminada por abandono del anfitrion. */
  const finished = () => {
    const r = room();
    const host = seatOf(takeSeat(r));
    const guest = seatOf(takeSeat(r));
    // Se termina sin que nadie deje su asiento: `rematch` necesita a los dos sentados.
    r.game.status = 'abandoned';
    r.game.winner = guest.color;
    r.game.endReason = 'abandoned';
    return { r, host, guest };
  };

  const ok = <T>(result: T | RoomError): T => {
    if (isRoomError(result)) throw new Error(`resultado inesperado: ${result.error}`);
    return result;
  };

  it('AC-1201: con una sola peticion la partida no se reinicia', () => {
    const { r, host } = finished();

    const first = ok(requestRematch(r, host.color));
    expect(first.agreed).toBe(false);
    expect(r.game.status).toBe('abandoned');
  });

  it('AC-1201: cuando la piden los dos, empieza la partida nueva', () => {
    const { r, host, guest } = finished();

    requestRematch(r, host.color);
    const second = ok(requestRematch(r, guest.color));

    expect(second.agreed).toBe(true);
    expect(r.game.status).toBe('playing');
    expect(r.game.winner).toBeNull();
  });

  it('AC-1202: la peticion queda anotada en el asiento de quien la pidio', () => {
    const { r, host, guest } = finished();

    requestRematch(r, host.color);

    expect(r.seats[host.color]?.wantsRematch).toBe(true);
    expect(r.seats[guest.color]?.wantsRematch).toBe(false);
  });

  it('AC-1203: no se puede pedir con la partida en curso', () => {
    const r = room();
    const host = seatOf(takeSeat(r));
    takeSeat(r);

    expect(isRoomError(requestRematch(r, host.color))).toBe(true);
    expect(r.game.status).toBe('playing');
  });

  it('AC-1204: no se puede pedir si el rival ya no esta sentado', () => {
    const { r, host, guest } = finished();
    delete r.seats[guest.color];

    expect(isRoomError(requestRematch(r, host.color))).toBe(true);
  });

  it('AC-1205: al empezar la revancha se olvidan las peticiones', () => {
    const { r, host, guest } = finished();

    requestRematch(r, host.color);
    requestRematch(r, guest.color);

    for (const seat of Object.values(r.seats)) expect(seat?.wantsRematch).toBe(false);
  });

  it('AC-1206: ausentarse retira la peticion', () => {
    const { r, host, guest } = finished();

    requestRematch(r, host.color);
    markDisconnected(r, host.color, host.session);
    expect(r.seats[host.color]?.wantsRematch).toBe(false);

    // Y la peticion del rival ya no alcanza para arrancar sin el.
    const alone = ok(requestRematch(r, guest.color));
    expect(alone.agreed).toBe(false);
    expect(r.game.status).toBe('abandoned');
  });
});

describe('FR-13 ofrecer tablas', () => {
  /** Sala con los dos sentados y la partida en curso: ofrecer tablas se hace jugando. */
  const playing = () => {
    const r = room();
    const host = seatOf(takeSeat(r));
    const guest = seatOf(takeSeat(r));
    return { r, host, guest };
  };

  const ok = <T>(result: T | RoomError): T => {
    if (isRoomError(result)) throw new Error(`resultado inesperado: ${result.error}`);
    return result;
  };

  it('AC-1301: con una sola oferta la partida sigue', () => {
    const { r, host } = playing();

    const first = ok(offerDraw(r, host.color));

    expect(first.agreed).toBe(false);
    expect(first.events).toEqual([]);
    expect(r.game.status).toBe('playing');
  });

  it('AC-1310: aceptadas, la partida termina en tablas por acuerdo', () => {
    const { r, host, guest } = playing();

    offerDraw(r, host.color);
    const accepted = ok(offerDraw(r, guest.color));

    expect(accepted.agreed).toBe(true);
    expect(r.game.status).toBe('draw');
    expect(r.game.winner).toBeNull();
    expect(r.game.endReason).toBe('agreed-draw');
    // Mismo evento `end` que cualquier otro final: los transportes no necesitan otro camino.
    expect(accepted.events).toEqual([
      { type: 'end', status: 'draw', winner: null, reason: 'agreed-draw' },
    ]);
  });
  it('AC-1305: rechazar retira la oferta del rival', () => {
    const { r, host, guest } = playing();

    offerDraw(r, host.color);
    ok(declineDraw(r, guest.color));

    expect(r.seats[host.color]?.offersDraw).toBe(false);
    expect(r.game.status).toBe('playing');
  });

  it('AC-1307: la oferta no se puede retirar, ni rechazandose a uno mismo', () => {
    const { r, host } = playing();

    offerDraw(r, host.color);
    // No hay mensaje para retirarla, y rechazar mira la oferta del RIVAL: rechazarse a uno
    // mismo seria la retirada por la puerta de atras.
    expect(isRoomError(declineDraw(r, host.color))).toBe(true);
    expect(r.seats[host.color]?.offersDraw).toBe(true);
  });

  it('AC-1306: que el rival mueva retira la oferta; el propio movimiento no', () => {
    const { r, host, guest } = playing();
    r.game.mines.fill(false); // sin detonaciones: aqui se mide el acuerdo, no el tablero

    offerDraw(r, host.color);
    // En FIDE se ofrecen tablas justo despues de mover, asi que mover no se autorechaza.
    ok(playMove(r, host.color, { from: 12, to: 28 }));
    expect(r.seats[host.color]?.offersDraw).toBe(true);

    // Pero el movimiento del rival SI es su respuesta: ha dicho que no.
    ok(playMove(r, guest.color, { from: 52, to: 36 }));
    expect(r.seats[host.color]?.offersDraw).toBe(false);
    expect(r.game.status).toBe('playing');
  });

  it('AC-1308: no se puede ofrecer dos veces mientras la propia sigue en pie', () => {
    const { r, host } = playing();

    offerDraw(r, host.color);

    expect(isRoomError(offerDraw(r, host.color))).toBe(true);
  });

  it('AC-1308: tras un rechazo hay que esperar 5 jugadas para volver a ofrecer', () => {
    const { r, host, guest } = playing();

    offerDraw(r, host.color);
    declineDraw(r, guest.color);

    // Esperar solo a la jugada siguiente dejaria ofrecer una vez por jugada: acoso con
    // permiso. La espera se mide en jugadas para adaptarse a lo que dure la partida.
    expect(isRoomError(offerDraw(r, host.color))).toBe(true);
    expect(drawMovesLeft(r, host.color)).toBe(DRAW_COOLDOWN_MOVES);

    r.game.fullmove += DRAW_COOLDOWN_MOVES - 1;
    expect(isRoomError(offerDraw(r, host.color))).toBe(true);
    expect(drawMovesLeft(r, host.color)).toBe(1);

    r.game.fullmove += 1;
    expect(drawMovesLeft(r, host.color)).toBe(0);
    expect(isRoomError(offerDraw(r, host.color))).toBe(false);
  });

  it('AC-1308: la primera propuesta no espera nada', () => {
    const { r, host } = playing();

    expect(drawMovesLeft(r, host.color)).toBe(0);
    expect(isRoomError(offerDraw(r, host.color))).toBe(false);
  });

  it('AC-1308: el rival rechaza moviendo y la espera corre igual', () => {
    const { r, host, guest } = playing();
    r.game.mines.fill(false);

    offerDraw(r, host.color);
    ok(playMove(r, host.color, { from: 12, to: 28 }));
    ok(playMove(r, guest.color, { from: 52, to: 36 })); // mover es rechazar

    expect(drawMovesLeft(r, host.color)).toBeGreaterThan(0);
    expect(isRoomError(offerDraw(r, host.color))).toBe(true);
  });

  it('AC-1303: no se puede ofrecer con la partida ya terminada', () => {
    const { r, host } = playing();
    r.game.status = 'checkmate';

    expect(isRoomError(offerDraw(r, host.color))).toBe(true);
  });

  it('AC-1304: no se puede ofrecer si el rival no esta sentado', () => {
    const { r, host, guest } = playing();
    delete r.seats[guest.color];

    expect(isRoomError(offerDraw(r, host.color))).toBe(true);
  });

  it('AC-1309: ausentarse retira la oferta propia', () => {
    const { r, host, guest } = playing();

    offerDraw(r, host.color);
    markDisconnected(r, host.color, host.session);

    expect(r.seats[host.color]?.offersDraw).toBe(false);
    // Y la del rival ya no alcanza para cerrar el acuerdo sin el.
    const alone = ok(offerDraw(r, guest.color));
    expect(alone.agreed).toBe(false);
    expect(r.game.status).toBe('playing');
  });
  it('AC-1311: tras unas tablas acordadas, la revancha funciona como en cualquier final', () => {
    const { r, host, guest } = playing();

    offerDraw(r, host.color);
    ok(offerDraw(r, guest.color));
    expect(r.game.status).toBe('draw');

    // La partida esta terminada, asi que la revancha se pide igual que tras un mate.
    expect(ok(requestRematch(r, host.color)).agreed).toBe(false);
    expect(ok(requestRematch(r, guest.color)).agreed).toBe(true);
    expect(r.game.status).toBe('playing');
    expect(r.game.endReason).toBeNull();
  });

  it('AC-1311: la revancha olvida tambien las ofertas de tablas', () => {
    const { r, host, guest } = playing();

    offerDraw(r, host.color);
    declineDraw(r, guest.color); // a host le queda una espera pendiente
    expect(drawMovesLeft(r, host.color)).toBeGreaterThan(0);

    r.game.status = 'checkmate';
    requestRematch(r, host.color);
    requestRematch(r, guest.color);

    // Tablero nuevo: ni ofertas en pie ni esperas heredadas de la partida anterior.
    for (const seat of Object.values(r.seats)) {
      expect(seat?.offersDraw).toBe(false);
      expect(seat?.drawAllowedFrom).toBeNull();
    }
  });
});

describe('FR-14 el reloj en la sala', () => {
  const timed = (control = '5+2') =>
    createRoom(generateRoomCode(), { ...SETTINGS, timeControl: control as never });

  const ok = <T>(result: T | RoomError): T => {
    if (isRoomError(result)) throw new Error(`resultado inesperado: ${result.error}`);
    return result;
  };

  it('AC-1401: sin control de tiempo la sala no tiene reloj y todo sigue igual', () => {
    const r = createRoom(generateRoomCode(), SETTINGS);

    expect(r.clock).toBeNull();
    // Y se puede jugar: el reloj es opcional, no un requisito nuevo.
    takeSeat(r);
    takeSeat(r);
    expect(isRoomError(playMove(r, 'w', { from: 12, to: 28 }))).toBe(false);
  });

  it('AC-1403: el reloj arranca cuando se sientan los dos, no al crear la sala', () => {
    const r = timed();
    expect(r.clock?.runningSince).toBeNull();

    takeSeat(r);
    // Con uno solo sentado no corre: esperar a que llegue alguien no puede costar tiempo.
    expect(r.clock?.runningSince).toBeNull();

    takeSeat(r);
    expect(r.clock?.runningSince).not.toBeNull();
  });

  it('AC-1404: mover descuenta del que movio y deja corriendo al rival', () => {
    const r = timed();
    takeSeat(r);
    takeSeat(r);
    r.game.mines.fill(false);
    const started = r.clock!.runningSince!;

    ok(playMove(r, 'w', { from: 12, to: 28 }, started + 10_000));

    expect(r.clock!.left.w).toBe(5 * 60_000 - 10_000 + 2_000);
    expect(r.clock!.left.b).toBe(5 * 60_000);
  });

  it('AC-1405: quedarse sin tiempo termina la partida y gana el rival', () => {
    const r = timed();
    takeSeat(r);
    takeSeat(r);
    const started = r.clock!.runningSince!;

    const out = forfeitTimeout(r, started + 6 * 60_000);

    expect(out).not.toBeNull();
    expect(r.game.status).toBe('timeout');
    expect(r.game.winner).toBe('b');
    expect(r.game.endReason).toBe('timeout');
    // Mismo evento `end` que cualquier otro final (AC-1107).
    expect(out?.events).toEqual([
      { type: 'end', status: 'timeout', winner: 'b', reason: 'timeout' },
    ]);
  });

  it('AC-1407: si al que le queda tiempo no le da el material, son tablas', () => {
    const r = timed();
    takeSeat(r);
    takeSeat(r);
    const started = r.clock!.runningSince!;
    // A las negras les queda el rey solo: con eso no se da mate ni con todo el tiempo del
    // mundo. Aqui no es una rareza de reglamento, el material lo borran las explosiones.
    r.game.board = r.game.board.map((p) => (p === null || p.type === 'k' ? p : null));

    const out = forfeitTimeout(r, started + 6 * 60_000);

    expect(r.game.status).toBe('draw');
    expect(r.game.winner).toBeNull();
    expect(r.game.endReason).toBe('insufficient-material');
    expect(out?.events).toEqual([
      { type: 'end', status: 'draw', winner: null, reason: 'insufficient-material' },
    ]);
  });

  it('AC-1407: un alfil suelto tampoco alcanza, dos piezas menores si', () => {
    const bare = (r: RoomState, keep: number[]) => {
      r.game.board = r.game.board.map((p, sq) =>
        p === null || p.type === 'k' || keep.includes(sq) ? p : null,
      );
    };
    const loneBishop = timed();
    takeSeat(loneBishop);
    takeSeat(loneBishop);
    bare(loneBishop, [58]); // un alfil negro
    forfeitTimeout(loneBishop, loneBishop.clock!.runningSince! + 6 * 60_000);
    expect(loneBishop.game.winner).toBeNull();

    const twoMinors = timed();
    takeSeat(twoMinors);
    takeSeat(twoMinors);
    bare(twoMinors, [57, 58]); // caballo y alfil negros
    forfeitTimeout(twoMinors, twoMinors.clock!.runningSince! + 6 * 60_000);
    expect(twoMinors.game.winner).toBe('b');
  });

  it('AC-1405: con tiempo de sobra no termina nada', () => {
    const r = timed();
    takeSeat(r);
    takeSeat(r);

    expect(forfeitTimeout(r, r.clock!.runningSince! + 1_000)).toBeNull();
    expect(r.game.status).toBe('playing');
  });

  it('AC-1405: una sala sin reloj nunca pierde por tiempo', () => {
    const r = createRoom(generateRoomCode(), SETTINGS);
    takeSeat(r);
    takeSeat(r);

    expect(forfeitTimeout(r, Date.now() + 999 * 60_000)).toBeNull();
    expect(r.game.status).toBe('playing');
  });
});

describe('FR-14 la ausencia para el reloj', () => {
  const timed = () => {
    const r = createRoom(generateRoomCode(), { ...SETTINGS, timeControl: '5+2' as never });
    const host = seatOf(takeSeat(r));
    const guest = seatOf(takeSeat(r));
    return { r, host, guest, t0: r.clock!.runningSince! };
  };

  it('AC-1408: al ausentarse alguien el reloj se para, y no corre el tiempo de nadie', () => {
    const { r, host, t0 } = timed();

    markDisconnected(r, host.color, host.session, t0 + 10_000);

    expect(r.clock!.runningSince).toBeNull();
    // Da igual cuanto pase: que se caiga la conexion de uno no puede costarle la partida
    // al otro, ni gastarle el reloj al que se cayo.
    expect(clockMsLeft(r.clock!, 'w', clockRunningFor(r), t0 + 999_000)).toBe(
      5 * 60_000 - 10_000,
    );
    expect(clockMsLeft(r.clock!, 'b', clockRunningFor(r), t0 + 999_000)).toBe(5 * 60_000);
  });

  it('AC-1408: sentarse frente a alguien ausente no arranca el reloj', () => {
    const r = createRoom(generateRoomCode(), { ...SETTINGS, timeControl: '5+2' as never });
    const host = seatOf(takeSeat(r));
    markDisconnected(r, host.color, host.session);

    // El asiento sigue ocupado, asi que el segundo jugador entra en el otro color. Pero
    // enfrente no hay nadie: el reloj no puede empezar a correrle a un ausente.
    takeSeat(r);

    expect(r.clock!.runningSince).toBeNull();
  });

  it('AC-1408: lo consumido antes de la caida se cobra, parar no es deshacer', () => {
    const { r, host, t0 } = timed();

    markDisconnected(r, host.color, host.session, t0 + 30_000);

    expect(r.clock!.left.w).toBe(5 * 60_000 - 30_000);
  });

  it('AC-1408: al volver, el reloj se reanuda', () => {
    const { r, host, t0 } = timed();
    markDisconnected(r, host.color, host.session, t0 + 10_000);

    resumeSeat(r, host.token, t0 + 40_000);

    expect(r.clock!.runningSince).toBe(t0 + 40_000);
    // Y no se le cobra el rato que estuvo fuera.
    expect(clockMsLeft(r.clock!, 'w', clockRunningFor(r), t0 + 40_000)).toBe(5 * 60_000 - 10_000);
  });

  it('AC-1409: el presupuesto de ausencia es por partida y se acumula', () => {
    const { r, host, t0 } = timed();

    // Primera ausencia: un minuto.
    markDisconnected(r, host.color, host.session, t0);
    resumeSeat(r, host.token, t0 + 60_000);

    // La segunda no empieza de cero: quedan los otros 60 segundos, no 2 minutos.
    const seat = r.seats[host.color]!;
    markDisconnected(r, host.color, seat.session, t0 + 70_000);
    expect(absenceMsLeft(r, host.color, t0 + 70_000)).toBe(ABSENCE_FORFEIT_MS - 60_000);
  });

  it('AC-1409: agotado el presupuesto entre varias ausencias, gana el rival', () => {
    const { r, host, guest, t0 } = timed();

    markDisconnected(r, host.color, host.session, t0);
    resumeSeat(r, host.token, t0 + 60_000);
    const seat = r.seats[host.color]!;
    markDisconnected(r, host.color, seat.session, t0 + 70_000);

    // Sin acumular, desenchufarse en cada jugada dificil daria dos minutos gratis cada vez.
    const out = forfeitAbsent(r, t0 + 70_000 + 60_001);
    expect(out).not.toBeNull();
    expect(r.game.winner).toBe(guest.color);
    expect(r.game.endReason).toBe('abandoned');
  });

  it('AC-1411: la revancha reinicia los relojes y los presupuestos', () => {
    const { r, host, t0 } = timed();
    markDisconnected(r, host.color, host.session, t0);
    resumeSeat(r, host.token, t0 + 60_000);
    r.game.status = 'checkmate';

    rematch(r, t0 + 70_000);

    expect(r.clock!.left).toEqual({ w: 5 * 60_000, b: 5 * 60_000 });
    expect(r.clock!.runningSince).toBe(t0 + 70_000);
    // Es una partida nueva, no la continuacion de la anterior.
    for (const seat of Object.values(r.seats)) {
      expect(absenceMsLeft(r, seat!.color, t0 + 70_000)).toBeNull();
      expect(seat!.absenceSpentMs).toBe(0);
    }
  });
});
