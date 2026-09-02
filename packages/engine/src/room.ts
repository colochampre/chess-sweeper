/**
 * Logica de una sala de juego: asientos, turnos y revanchas.
 *
 * Vive en el motor y no toca nada de Node ni del navegador, a proposito: la comparten el
 * servidor de LAN (que guarda las salas en un Map) y el Durable Object de Cloudflare (que
 * guarda una sala por objeto). Son funciones sobre datos planos, no una clase con estado,
 * para que `RoomState` se pueda serializar tal cual al almacenamiento del Durable Object.
 *
 * Aqui es donde viven las minas. Nada de lo que sale de este modulo hacia un cliente las
 * incluye: para eso esta `viewFor`.
 */
import { applyMove, createGame, toView } from './game.js';
import { configFor } from './config.js';
import { randomSeed } from './rng.js';
import type { RoomSettings } from './protocol.js';
import type { Color, GameEvent, GameState, Move, PlayerView } from './types.js';
import {
  chargeMove,
  createClock,
  flaggedColor,
  pauseClock,
  startClock,
  type ClockState,
} from './clock.js';

export interface Seat {
  color: Color;
  /** Credencial del asiento: permite recuperarlo tras una desconexion. */
  token: string;
  connected: boolean;
  /**
   * Identifica la conexion vigente. Al reconectar o abrir otra pestana se sienta una
   * sesion nueva y se echa a la anterior; el cierre de esa conexion vieja llega DESPUES
   * y no debe marcar el asiento como ausente. Sin esto, reconectarse te deja invisible
   * para tu rival.
   */
  session: string;
  /**
   * Momento en que se perdio la conexion, o `null` si esta presente. Es lo que permite
   * distinguir una caida pasajera de un abandono: ver `forfeitAbsent`.
   */
  disconnectedAt: number | null;
  /**
   * Ausencia ya gastada en esta partida, sumando todas las veces. El presupuesto es por
   * partida y no por desconexion (AC-1104): como la ausencia para el reloj (AC-1408),
   * regalarlo entero cada vez convertiria desenchufarse en dos minutos de analisis gratis
   * por jugada.
   */
  absenceSpentMs: number;
  /** Ha pedido la revancha. Se olvida al empezarla y al ausentarse. */
  wantsRematch: boolean;
  /**
   * Ha ofrecido tablas. Se olvida cuando el rival contesta —y mover es una de las
   * respuestas, ver `playMove`—, al ausentarse y al empezar una partida nueva.
   */
  offersDraw: boolean;
  /**
   * Jugada a partir de la cual puede volver a ofrecer tablas, o `null` si no debe ninguna.
   * Se mide en jugadas y no en un cupo por partida para que la espera se adapte sola a lo
   * que dure: un cupo fijo seria tacaneria en una partida larga y spam en una corta.
   */
  drawAllowedFrom: number | null;
}

export interface RoomState {
  code: string;
  settings: RoomSettings;
  /** VERDAD OCULTA: contiene el campo de minas. */
  game: GameState;
  seats: Partial<Record<Color, Seat>>;
  /** Reloj de la partida, o `null` si la sala se creo sin control de tiempo. */
  clock: ClockState | null;
  createdAt: number;
  lastActivity: number;
}

export type RoomError = { error: string };

export const isRoomError = <T>(r: T | RoomError): r is RoomError =>
  typeof r === 'object' && r !== null && 'error' in r;

/** Salas sin nadie conectado durante mas de esto se pueden descartar. */
export const ROOM_TTL_MS = 10 * 60 * 1000;

/**
 * Jugadas que hay que dejar pasar tras un rechazo antes de volver a ofrecer tablas.
 * Esperar solo a la jugada siguiente permitiria una oferta por jugada, que es acoso.
 */
export const DRAW_COOLDOWN_MOVES = 5;

/**
 * Ausencia a partir de la cual se pierde la partida.
 *
 * Aguanta una recarga de pagina, un cambio de pestana y un bache de red, y evita que
 * cerrar la pestana salga mas barato que rendirse: si irse a proposito costara la partida
 * y desaparecer no costara nada, nadie usaria nunca el boton honesto.
 */
export const ABSENCE_FORFEIT_MS = 2 * 60 * 1000;

// `crypto` es global tanto en Node 19+ como en el runtime de Workers.
const newToken = (): string => crypto.randomUUID();

const newGame = (settings: RoomSettings): GameState =>
  createGame(
    configFor(settings.difficulty, {
      files: settings.boardSize,
      ranks: settings.boardSize,
      seed: randomSeed(),
    }),
  );

export function createRoom(code: string, settings: RoomSettings, now = Date.now()): RoomState {
  return {
    code,
    settings,
    game: newGame(settings),
    seats: {},
    clock: createClock(settings.timeControl ?? 'none'),
    createdAt: now,
    lastActivity: now,
  };
}

/** Color que pidio el anfitrion, resolviendo 'random'. */
export const hostColor = (settings: RoomSettings): Color =>
  settings.hostColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.hostColor;

/**
 * Sienta a un jugador. El primero ocupa el color que pidio el anfitrion; el segundo, el que
 * quede libre. Si no queda ninguno, la sala esta completa.
 */
export function takeSeat(
  room: RoomState,
  now = Date.now(),
  preferred?: Color,
): Seat | RoomError {
  const wanted = preferred ?? hostColor(room.settings);
  const color: Color | undefined = room.seats[wanted]
    ? (['w', 'b'] as const).find((c) => !room.seats[c])
    : wanted;
  if (color === undefined) return { error: 'La sala ya esta completa' };

  const seat: Seat = {
    color,
    token: newToken(),
    connected: true,
    session: newToken(),
    disconnectedAt: null,
    absenceSpentMs: 0,
    wantsRematch: false,
    offersDraw: false,
    drawAllowedFrom: null,
  };
  room.seats[color] = seat;
  // El reloj arranca cuando estan los dos, no al crear la sala: esperar a que llegue un
  // rival no puede costar tiempo (AC-1403). "Los dos" es presentes, no sentados: un asiento
  // ocupado por alguien ausente no deja correr el reloj (AC-1408).
  if (room.clock !== null && bothPresent(room)) startClock(room.clock, now);
  room.lastActivity = now;
  return seat;
}

/**
 * De quien es el reloj ahora mismo, o `null` si no corre. Lo decide la sala porque es la
 * unica que sabe de quien es el turno y si estan los dos delante; el modulo del reloj solo
 * cuenta. Sin esto, cada transporte tendria su propia idea de cuando corre el tiempo.
 */
export function clockRunningFor(room: RoomState): Color | null {
  if (room.clock === null || room.game.status !== 'playing') return null;
  return room.game.turn;
}

/** Recupera un asiento con su credencial tras una desconexion. */
export function resumeSeat(room: RoomState, token: string, now = Date.now()): Seat | RoomError {
  for (const seat of Object.values(room.seats)) {
    if (seat && seat.token === token) {
      seat.connected = true;
      seat.session = newToken(); // conexion nueva: la anterior deja de mandar
      // El rato que estuvo fuera se apunta antes de olvidarlo: el presupuesto es por
      // partida, asi que volver no lo devuelve, solo detiene el gasto.
      if (seat.disconnectedAt !== null) seat.absenceSpentMs += now - seat.disconnectedAt;
      seat.disconnectedAt = null;
      // Vuelven a estar los dos: el reloj sigue donde se quedo (AC-1408).
      if (room.clock !== null && room.game.status === 'playing' && bothPresent(room)) {
        startClock(room.clock, now);
      }
      room.lastActivity = now;
      return seat;
    }
  }
  return { error: 'Ese asiento no es tuyo' };
}

/** Los dos asientos ocupados y conectados: es cuando puede correr el reloj. */
const bothPresent = (room: RoomState): boolean =>
  (['w', 'b'] as const).every((c) => room.seats[c]?.connected === true);

/**
 * Unica puerta de entrada para modificar la partida. Valida con el mismo `applyMove` del
 * motor, asi que no existe una segunda copia de las reglas que pueda desincronizarse.
 */
export function playMove(
  room: RoomState,
  color: Color,
  move: Move,
  now = Date.now(),
): { events: GameEvent[] } | RoomError {
  if (room.game.status !== 'playing') return { error: 'La partida ya ha terminado' };
  if (room.game.turn !== color) return { error: 'No es tu turno' };
  try {
    const result = applyMove(room.game, move);
    room.game = result.state;
    // Se cobra la jugada a quien la hizo y el reloj sigue, ya para el rival (AC-1404). Va
    // aqui, dentro de la unica puerta que modifica la partida, para que no exista un camino
    // por el que se pueda mover sin pagar el tiempo.
    if (room.clock !== null) chargeMove(room.clock, color, now);
    // Mover es contestar que no (AC-1306, regla FIDE): la oferta que tenia el rival en pie
    // se apaga aqui. La propia sobrevive al movimiento, porque en FIDE se ofrecen tablas
    // justo despues de mover.
    const rival = room.seats[opponentOf(color)];
    if (rival?.offersDraw) {
      rival.offersDraw = false;
      rival.drawAllowedFrom = room.game.fullmove + DRAW_COOLDOWN_MOVES;
    }
    room.lastActivity = now;
    return { events: result.events };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Movimiento invalido' };
  }
}

/** Partida nueva en la misma sala, con los colores intercambiados y minas nuevas. */
export function rematch(room: RoomState, now = Date.now()): void {
  room.game = newGame(room.settings);
  const seats = Object.values(room.seats).filter((s): s is Seat => s !== undefined);
  room.seats = {};
  for (const seat of seats) {
    seat.color = seat.color === 'w' ? 'b' : 'w';
    seat.wantsRematch = false; // la siguiente revancha hay que volver a acordarla
    seat.offersDraw = false; // partida nueva, tablero nuevo: la oferta anterior no significa nada
    seat.drawAllowedFrom = null;
    seat.absenceSpentMs = 0; // partida nueva, presupuesto nuevo (AC-1411)
    room.seats[seat.color] = seat;
  }
  // Relojes a cero y en marcha si estan los dos: es una partida nueva, no la continuacion
  // de la anterior.
  room.clock = createClock(room.settings.timeControl ?? 'none');
  if (room.clock !== null && bothPresent(room)) startClock(room.clock, now);
  room.lastActivity = now;
}

/**
 * Pide la revancha. Solo empieza cuando la han pedido los dos: reiniciar la partida es un
 * acuerdo de la mesa, no una accion de uno de los dos jugadores. Antes bastaba con que
 * llegara un mensaje, asi que se le podia reiniciar la partida al rival sin avisarle.
 */
export function requestRematch(
  room: RoomState,
  color: Color,
  now = Date.now(),
): { agreed: boolean } | RoomError {
  const seat = room.seats[color];
  if (!seat) return { error: 'No estas sentado en esta sala' };
  if (room.game.status === 'playing') return { error: 'La partida todavia no ha terminado' };

  const rival = room.seats[opponentOf(color)];
  if (!rival) return { error: 'Tu rival ya no esta en la sala' };

  seat.wantsRematch = true;
  room.lastActivity = now;
  if (!rival.wantsRematch) return { agreed: false };

  rematch(room, now);
  return { agreed: true };
}

/**
 * Ofrece tablas, o las acepta: es el mismo gesto. Las tablas se acuerdan cuando las quieren
 * los dos, igual que la revancha, pero al reves en el tiempo: la revancha se pacta con la
 * partida terminada y las tablas en mitad de ella, asi que la guarda del estado se invierte.
 *
 * Se sigue la regla FIDE (Art. 9.1.2): la oferta no se puede retirar y sigue en pie hasta
 * que el rival la conteste. Mover es una de las respuestas, y de eso se ocupa `playMove`.
 */
export function offerDraw(
  room: RoomState,
  color: Color,
  now = Date.now(),
): { agreed: boolean; events: GameEvent[] } | RoomError {
  const seat = room.seats[color];
  if (!seat) return { error: 'No estas sentado en esta sala' };
  if (room.game.status !== 'playing') return { error: 'La partida ya ha terminado' };

  const rival = room.seats[opponentOf(color)];
  if (!rival) return { error: 'Tu rival ya no esta en la sala' };
  if (seat.offersDraw) return { error: 'Ya has ofrecido tablas' };
  const left = drawMovesLeft(room, color);
  if (left > 0) {
    return { error: `Faltan ${left} ${left === 1 ? 'jugada' : 'jugadas'} para volver a ofrecer tablas` };
  }

  seat.offersDraw = true;
  room.lastActivity = now;
  if (!rival.offersDraw) return { agreed: false, events: [] };

  // Acordadas: la oferta ya se ha gastado, y dejarla en pie haria que el boton siguiera
  // diciendo "esperando" sobre una partida que ya termino.
  seat.offersDraw = false;
  rival.offersDraw = false;
  room.game.status = 'draw';
  room.game.winner = null;
  room.game.endReason = 'agreed-draw';
  // Mismo evento `end` que cualquier otro final: los transportes y el cliente no necesitan
  // un camino aparte para este caso.
  return {
    agreed: true,
    events: [{ type: 'end', status: 'draw', winner: null, reason: 'agreed-draw' }],
  };
}

/**
 * Rechaza la oferta del rival. Existe aunque mover ya sea un rechazo (AC-1306) porque un
 * "no" tiene que poder llegar en el momento: si la unica forma de negarse fuera mover, quien
 * ofrecio no distinguiria el rechazo de que el otro se lo este pensando.
 */
export function declineDraw(
  room: RoomState,
  color: Color,
  now = Date.now(),
): { declined: boolean } | RoomError {
  const seat = room.seats[color];
  if (!seat) return { error: 'No estas sentado en esta sala' };
  if (room.game.status !== 'playing') return { error: 'La partida ya ha terminado' };

  const rival = room.seats[opponentOf(color)];
  if (!rival?.offersDraw) return { error: 'No hay ninguna oferta de tablas que rechazar' };

  rival.offersDraw = false;
  // Quien se lleva el no tiene que dejar pasar unas cuantas jugadas antes de insistir.
  rival.drawAllowedFrom = room.game.fullmove + DRAW_COOLDOWN_MOVES;
  room.lastActivity = now;
  return { declined: true };
}

/**
 * Cuantas jugadas le faltan a `color` para poder volver a ofrecer tablas; 0 si ya puede.
 *
 * Vive aqui, y no en cada transporte ni en el cliente, para que la espera que se le ensena
 * al jugador y la que aplica el servidor no puedan discrepar. Es la misma razon por la que
 * `absenceMsLeft` es la unica fuente del plazo de abandono.
 */
export function drawMovesLeft(room: RoomState, color: Color): number {
  const from = room.seats[color]?.drawAllowedFrom;
  if (from === undefined || from === null) return 0;
  return Math.max(0, from - room.game.fullmove);
}

/**
 * Si `color` puede ofrecer tablas ahora mismo. Vive aqui, y no en cada transporte, para que
 * lo que el boton deja hacer y lo que el servidor acepta no puedan discrepar.
 */
export function canOfferDraw(room: RoomState, color: Color): boolean {
  const seat = room.seats[color];
  if (!seat || room.game.status !== 'playing') return false;
  if (!room.seats[opponentOf(color)]) return false;
  return !seat.offersDraw && drawMovesLeft(room, color) === 0;
}

/** Proyeccion que se envia a un jugador. Nunca incluye el campo de minas. */
export const viewFor = (room: RoomState, color: Color): PlayerView => toView(room.game, color);

/**
 * Marca el asiento como ausente, pero solo si quien se va es la conexion vigente.
 * Devuelve si ha cambiado algo, para no difundir presencia de mas.
 */
export function markDisconnected(
  room: RoomState,
  color: Color,
  session: string,
  now = Date.now(),
): boolean {
  const seat = room.seats[color];
  if (!seat || seat.session !== session) return false;
  // El reloj se para antes de tocar el asiento, para cobrarle a quien corria lo que llevaba
  // consumido hasta este instante y no un milisegundo mas (AC-1408).
  if (room.clock !== null) pauseClock(room.clock, clockRunningFor(room), now);
  seat.connected = false;
  seat.disconnectedAt = now;
  // Una revancha no puede arrancar con alguien que ya no esta delante.
  seat.wantsRematch = false;
  // Ni unas tablas: quien esta a punto de perder por ausencia no se lleva medio punto de
  // una partida que ya estaba cediendo.
  seat.offersDraw = false;
  room.lastActivity = now;
  return true;
}

/** Termina la partida dando la victoria al rival de `loser`. */
function endByAbandon(room: RoomState, loser: Color, now: number): GameEvent[] {
  const winner = opponentOf(loser);
  room.game.status = 'abandoned';
  room.game.winner = winner;
  room.game.endReason = 'abandoned';
  room.lastActivity = now;
  // Mismo evento que cualquier otro final: los transportes y el cliente no necesitan un
  // camino aparte para este caso.
  return [{ type: 'end', status: 'abandoned', winner, reason: 'abandoned' }];
}

/**
 * Salida voluntaria. Con el rival sentado cuesta la partida; si todavia no ha llegado
 * nadie no hay nada que ceder y el asiento simplemente queda libre.
 */
export function leaveRoom(
  room: RoomState,
  color: Color,
  now = Date.now(),
): { events: GameEvent[] } | RoomError {
  if (!room.seats[color]) return { error: 'No estas sentado en esta sala' };
  if (room.game.status !== 'playing') return { error: 'La partida ya ha terminado' };

  const events = room.seats[opponentOf(color)] ? endByAbandon(room, color, now) : [];
  // En los dos casos el asiento queda libre: quien se va deja de ocupar sitio. Si no lo
  // soltara, no podria ni volver a entrar por el codigo de su propia sala.
  delete room.seats[color];
  room.lastActivity = now;
  return { events };
}

/**
 * Da por abandonada la partida de quien lleve ausente mas de `ABSENCE_FORFEIT_MS`. La
 * llaman los dos transportes desde el reloj que ya tenian, de modo que el rival no tiene
 * que reclamar nada: el resultado llega solo.
 */
export function forfeitAbsent(
  room: RoomState,
  now = Date.now(),
): { events: GameEvent[] } | null {
  for (const color of ['w', 'b'] as const) {
    if (absenceMsLeft(room, color, now) === 0) {
      return { events: endByAbandon(room, color, now) };
    }
  }
  return null;
}

/**
 * Da por perdida la partida de quien se quedo sin tiempo. La llaman los dos transportes
 * desde su propio reloj, de modo que la bandera cae sola y el rival no reclama nada
 * (AC-1405/1406), igual que `forfeitAbsent` con la ausencia.
 */
export function forfeitTimeout(
  room: RoomState,
  now = Date.now(),
): { events: GameEvent[] } | null {
  if (room.clock === null || room.game.status !== 'playing') return null;
  const flagged = flaggedColor(room.clock, clockRunningFor(room), now);
  if (flagged === null) return null;

  const winner = opponentOf(flagged);
  room.clock.left[flagged] = 0;
  room.clock.runningSince = null;
  room.game.status = 'timeout';
  room.game.winner = winner;
  room.game.endReason = 'timeout';
  room.lastActivity = now;
  // Mismo evento `end` que cualquier otro final (AC-1107).
  return { events: [{ type: 'end', status: 'timeout', winner, reason: 'timeout' }] };
}

/**
 * Cuanto le queda a `color` antes de perder por ausencia, o `null` si no corre ningun plazo
 * (esta presente, la partida termino, o no hay rival a quien dar la victoria).
 *
 * El cobro de `forfeitAbsent` sale de aqui a proposito: si el plazo que se le ensena al
 * jugador y el que aplica el servidor se calcularan por separado, podrian discrepar y la
 * cuenta llegaria a cero sin que pasara nada.
 */
export function absenceMsLeft(
  room: RoomState,
  color: Color,
  now = Date.now(),
): number | null {
  if (room.game.status !== 'playing') return null;
  const seat = room.seats[color];
  if (!seat || seat.connected || seat.disconnectedAt === null) return null;
  // Sin rival sentado no hay a quien dar la victoria: de esa sala se ocupa `isStale`.
  if (!room.seats[opponentOf(color)]) return null;
  // Lo gastado en ausencias anteriores cuenta: el presupuesto es de la partida, no de esta
  // desconexion. Ver AC-1104.
  const spent = seat.absenceSpentMs + (now - seat.disconnectedAt);
  return Math.max(0, ABSENCE_FORFEIT_MS - spent);
}

export const opponentOf = (color: Color): Color => (color === 'w' ? 'b' : 'w');

export const isEmpty = (room: RoomState): boolean =>
  Object.values(room.seats).every((s) => !s || !s.connected);

export const isStale = (room: RoomState, now = Date.now(), ttl = ROOM_TTL_MS): boolean =>
  isEmpty(room) && now - room.lastActivity > ttl;
