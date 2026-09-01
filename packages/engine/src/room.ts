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
}

export interface RoomState {
  code: string;
  settings: RoomSettings;
  /** VERDAD OCULTA: contiene el campo de minas. */
  game: GameState;
  seats: Partial<Record<Color, Seat>>;
  createdAt: number;
  lastActivity: number;
}

export type RoomError = { error: string };

export const isRoomError = <T>(r: T | RoomError): r is RoomError =>
  typeof r === 'object' && r !== null && 'error' in r;

/** Salas sin nadie conectado durante mas de esto se pueden descartar. */
export const ROOM_TTL_MS = 10 * 60 * 1000;

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
  };
  room.seats[color] = seat;
  room.lastActivity = now;
  return seat;
}

/** Recupera un asiento con su credencial tras una desconexion. */
export function resumeSeat(room: RoomState, token: string, now = Date.now()): Seat | RoomError {
  for (const seat of Object.values(room.seats)) {
    if (seat && seat.token === token) {
      seat.connected = true;
      seat.session = newToken(); // conexion nueva: la anterior deja de mandar
      seat.disconnectedAt = null; // ha vuelto: el plazo de abandono deja de correr
      room.lastActivity = now;
      return seat;
    }
  }
  return { error: 'Ese asiento no es tuyo' };
}

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
    room.seats[seat.color] = seat;
  }
  room.lastActivity = now;
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
  seat.connected = false;
  seat.disconnectedAt = now;
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
  if (room.game.status !== 'playing') return null;

  for (const color of ['w', 'b'] as const) {
    const seat = room.seats[color];
    if (!seat || seat.connected || seat.disconnectedAt === null) continue;
    if (now - seat.disconnectedAt <= ABSENCE_FORFEIT_MS) continue;
    // Sin rival sentado no hay a quien dar la victoria: de esa sala se ocupa `isStale`.
    if (!room.seats[opponentOf(color)]) continue;
    return { events: endByAbandon(room, color, now) };
  }
  return null;
}

export const opponentOf = (color: Color): Color => (color === 'w' ? 'b' : 'w');

export const isEmpty = (room: RoomState): boolean =>
  Object.values(room.seats).every((s) => !s || !s.connected);

export const isStale = (room: RoomState, now = Date.now(), ttl = ROOM_TTL_MS): boolean =>
  isEmpty(room) && now - room.lastActivity > ttl;
