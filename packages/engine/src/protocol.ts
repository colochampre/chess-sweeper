/**
 * Protocolo cliente <-> servidor para las partidas en red.
 * Vive en el motor porque los dos extremos comparten estos tipos.
 *
 * Regla de oro: el servidor es la autoridad. Guarda el `GameState` completo (con las minas)
 * y solo envia `PlayerView`, de modo que ningun cliente puede leer donde estan las minas.
 */
import type { Color, Difficulty, GameEvent, Move, PlayerView } from './types.js';
import { isTimeControl, type TimeControl } from './clock.js';

/**
 * Version del formato del cable. Viaja en la URL de la conexion y el servidor solo acepta la
 * suya: si fuera solo un numero documentado, un cliente viejo contra un servidor nuevo no se
 * rechazaria, se rompería raro. Se sube cada vez que cambian `ClientMessage` o `ServerMessage`.
 */
export const PROTOCOL_VERSION = 4;

/** Parametro de la query donde viaja la version. */
export const PROTOCOL_PARAM = 'v';

/** El mismo motivo en los dos transportes: el arreglo lo hace el jugador, recargando. */
export const PROTOCOL_STALE_MESSAGE = 'Esta version del juego quedo vieja: recarga la pagina.';

/**
 * Si esa conexion habla nuestra misma version. Sin el parametro tampoco vale: un cliente que
 * no lo manda es anterior a que existiera, que es justamente uno viejo.
 */
export const isProtocolCurrent = (params: URLSearchParams): boolean =>
  params.get(PROTOCOL_PARAM) === String(PROTOCOL_VERSION);

export interface RoomSettings {
  difficulty: Difficulty;
  boardSize: number;
  /** Color que quiere el anfitrion; 'random' lo decide el servidor. */
  hostColor: Color | 'random';
  /** Control de tiempo. Sin el se juega sin reloj, que es lo que hacian todas las salas. */
  timeControl?: TimeControl;
}

/**
 * A que sala se entra y como. Va en la URL de la conexion, no como mensaje, porque el
 * enrutado hacia el Durable Object de la sala tiene que decidirse antes de aceptar el
 * WebSocket. El servidor de LAN lee exactamente los mismos parametros.
 */
export type ConnectIntent =
  | ({ a: 'create' } & RoomSettings)
  | { a: 'join'; code: string }
  | { a: 'resume'; code: string; token: string };

/** Mensajes que se mandan una vez sentado en la sala. */
export type ClientMessage =
  /**
   * Un movimiento, y opcionalmente una oferta de tablas que viaja con el. La oferta se
   * aplica DESPUES del movimiento, que es la secuencia de FIDE —mover, ofrecer, apretar el
   * reloj— y lo que hace que el rival la piense con su tiempo (AC-1413).
   */
  | { t: 'move'; move: Move; offerDraw?: boolean }
  | { t: 'rematch' }
  /** Ofrecer tablas y aceptarlas son el mismo mensaje: se acuerdan cuando lo mandan los dos. */
  | { t: 'draw' }
  | { t: 'draw-decline' }
  | { t: 'leave' };

export type ServerMessage =
  /** Asiento asignado. `token` sirve para reconectar tras una caida. */
  | { t: 'seated'; code: string; color: Color; token: string; view: PlayerView }
  /** Resincronizacion completa: al entrar, al reconectar y despues de cada revancha. */
  | { t: 'sync'; view: PlayerView }
  /** Un movimiento aplicado: primero se reproduce la animacion, luego manda `view`. */
  | { t: 'moved'; events: GameEvent[]; view: PlayerView }
  /** Presencia del rival. Si esta ausente, `msLeft` dice cuanto le queda antes de perder. */
  | { t: 'opponent'; connected: boolean; msLeft?: number }
  /** Estado del acuerdo de revancha: quien la ha pedido de los dos. */
  | { t: 'rematch'; mine: boolean; theirs: boolean }
  /**
   * Estado de la oferta de tablas: quien la ha ofrecido de los dos, y cuantas jugadas
   * faltan para poder volver a ofrecer (0 si ya se puede). Lo cuenta el servidor para que
   * la espera que ve el jugador y la que aplica el servidor no puedan discrepar.
   */
  | { t: 'draw'; mine: boolean; theirs: boolean; movesLeft: number }
  /**
   * Estado del reloj: lo que le queda a cada uno EN EL INSTANTE DE MANDARLO, y de quien
   * corre (`null` si esta parado). El cliente apunta cuando lo recibio y descuenta desde
   * ahi (AC-1412); no viaja una marca de tiempo del servidor porque los relojes de las dos
   * maquinas no tienen por que coincidir.
   */
  | { t: 'clock'; left: Record<Color, number>; running: Color | null }
  | { t: 'error'; message: string };

/**
 * Codigos de cierre propios. `REFUSED` le dice al cliente que el servidor ya explico el
 * motivo y que reintentar no va a cambiar nada.
 */
export const CLOSE_REPLACED = 4001;
export const CLOSE_REFUSED = 4002;

export const ROOM_CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos

export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export const normalizeRoomCode = (code: string): string =>
  code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export const isValidRoomCode = (code: string): boolean =>
  code.length === ROOM_CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));

/** Ruta del WebSocket, igual en el servidor de LAN y en el Worker. */
export const WS_PATH = '/ws';

export function intentToQuery(intent: ConnectIntent): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(intent)) params.set(key, String(value));
  // La version va con la intencion, no aparte: el servidor la necesita en el mismo sitio y
  // antes que nada, porque decide si acepta la conexion antes del apreton de manos.
  params.set(PROTOCOL_PARAM, String(PROTOCOL_VERSION));
  return params.toString();
}

/** Inversa de `intentToQuery`, con validacion: entrada de red, no se fia de nada. */
export function parseIntent(params: URLSearchParams): ConnectIntent | null {
  const a = params.get('a');

  if (a === 'create') {
    const difficulty = params.get('difficulty');
    const hostColor = params.get('hostColor');
    const boardSize = Number(params.get('boardSize'));
    if (difficulty !== 'easy' && difficulty !== 'normal' && difficulty !== 'hard') return null;
    if (hostColor !== 'w' && hostColor !== 'b' && hostColor !== 'random') return null;
    if (!Number.isInteger(boardSize) || boardSize < 4 || boardSize > 16) return null;
    // Sin control de tiempo se juega sin reloj, que es lo que hacian todas las salas.
    const timeControl = params.get('timeControl') ?? 'none';
    if (!isTimeControl(timeControl)) return null;
    return { a: 'create', difficulty, boardSize, hostColor, timeControl };
  }

  const code = normalizeRoomCode(params.get('code') ?? '');
  if (!isValidRoomCode(code)) return null;

  if (a === 'join') return { a: 'join', code };

  if (a === 'resume') {
    const token = params.get('token') ?? '';
    // Formato de UUID: descarta basura antes de tocar el almacenamiento.
    if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
    return { a: 'resume', code, token };
  }

  return null;
}
