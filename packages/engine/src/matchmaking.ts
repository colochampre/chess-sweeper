import type { TimeControl } from './clock.js';
import type { Color, Difficulty } from './types.js';

/** Lo que hace falta para saber con quien se puede jugar. */
export interface MatchCriteria {
  difficulty: Difficulty;
  boardSize: number;
  timeControl?: TimeControl;
  /**
   * Se acepta y se IGNORA a proposito (AC-102), para poder pasar un `RoomSettings` entero
   * sin desarmarlo. Que el tipo lo admita y la clave no lo use es la manera de que se lea
   * aqui mismo que la omision es una decision y no un olvido.
   */
  hostColor?: Color | 'random';
}

/**
 * Con quien se puede emparejar. Exacta a proposito (AC-101): emparejar a alguien que pidio
 * 5+2 con alguien que pidio 15+10 es darle a los dos una partida que ninguno eligio, y la
 * unica manera de que eso no pase es que la clave no admita aproximaciones.
 *
 * Sin control de tiempo es un ajuste mas y no la ausencia de uno, asi que se normaliza a
 * `none`: quien pide sin reloj empareja con quien pide sin reloj, y con nadie mas.
 */
export function matchKey(criteria: MatchCriteria): string {
  return `${criteria.difficulty}:${criteria.timeControl ?? 'none'}:${criteria.boardSize}`;
}

/** Una sala esperando rival. */
export interface QueueEntry {
  code: string;
  /** Instante en que se registro. */
  since: number;
}

/**
 * Cuanto vive una entrada sin que nadie la toque (AC-403).
 *
 * Es una red debajo del pegamento y no el mecanismo: quien mantiene la cola al dia es cada
 * transporte, que ya sabe cuando alguien se sienta, se va o se cae (AC-401). Esto solo cubre
 * que el proceso se caiga entre las dos cosas, asi que el plazo es corto: no cubre una
 * ausencia, cubre una ventana.
 */
export const QUEUE_TTL_MS = 60_000;

export const isEntryFresh = (entry: QueueEntry, now: number): boolean =>
  now - entry.since < QUEUE_TTL_MS;

/** A que se resuelve un `match`: no hay un tipo de sala nuevo (AC-201). */
export type MatchOutcome = { a: 'join'; code: string } | { a: 'create' };

/**
 * Que hacer con quien pide rival: entrar a la sala que ya espera, o crear una y quedarse
 * esperando. Quien decide si la sala entregada sigue admitiendo a alguien es el transporte
 * (AC-402); aqui solo se mira si hay entrada y si sigue viva.
 */
export function resolveMatch(entry: QueueEntry | null, now: number): MatchOutcome {
  if (entry !== null && isEntryFresh(entry, now)) return { a: 'join', code: entry.code };
  return { a: 'create' };
}
