/**
 * Protocolo cliente <-> servidor para las partidas en red.
 * Vive en el motor porque los dos extremos comparten estos tipos.
 *
 * Regla de oro: el servidor es la autoridad. Guarda el `GameState` completo (con las minas)
 * y solo envia `PlayerView`, de modo que ningun cliente puede leer donde estan las minas.
 */
import type { Color, Difficulty, GameEvent, Move, PlayerView } from './types.js';

export const PROTOCOL_VERSION = 2;

export interface RoomSettings {
  difficulty: Difficulty;
  boardSize: number;
  /** Color que quiere el anfitrion; 'random' lo decide el servidor. */
  hostColor: Color | 'random';
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
  | { t: 'move'; move: Move }
  | { t: 'rematch' }
  | { t: 'leave' };

export type ServerMessage =
  /** Asiento asignado. `token` sirve para reconectar tras una caida. */
  | { t: 'seated'; code: string; color: Color; token: string; view: PlayerView }
  /** Resincronizacion completa: al entrar, al reconectar y despues de cada revancha. */
  | { t: 'sync'; view: PlayerView }
  /** Un movimiento aplicado: primero se reproduce la animacion, luego manda `view`. */
  | { t: 'moved'; events: GameEvent[]; view: PlayerView }
  | { t: 'opponent'; connected: boolean }
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
    return { a: 'create', difficulty, boardSize, hostColor };
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
