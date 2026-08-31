/**
 * Protocolo cliente <-> servidor para las partidas en red.
 * Vive en el motor porque los dos extremos comparten estos tipos.
 *
 * Regla de oro: el servidor es la autoridad. Guarda el `GameState` completo (con las minas)
 * y solo envia `PlayerView`, de modo que ningun cliente puede leer donde estan las minas.
 */
import type { Color, Difficulty, GameEvent, Move, PlayerView } from './types.js';

export const PROTOCOL_VERSION = 1;

export interface RoomSettings {
  difficulty: Difficulty;
  boardSize: number;
  /** Color que quiere el anfitrion; 'random' lo decide el servidor. */
  hostColor: Color | 'random';
}

export type ClientMessage =
  | { t: 'create'; settings: RoomSettings }
  | { t: 'join'; code: string }
  | { t: 'resume'; code: string; token: string }
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
  | { t: 'opponent'; connected: boolean; name?: string }
  | { t: 'error'; message: string };

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
