import type { Difficulty, TimeControl } from '@cm/engine';

export type Mode = 'hotseat' | 'bot' | 'online';

/**
 * Las listas del menu y lo que viene marcado en cada una.
 *
 * El defecto es una constante con nombre y NO "el primero del array" (AC-402). Atados,
 * reordenar una lista —que es maquetado— cambiaba lo que se ofrece —que es producto— sin que
 * nada lo dijese. Es como el defecto del reloj se movio de "Sin reloj" a 10+5 sin que ningun
 * test se enterase.
 */
export interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

export const MODES: Option<Mode>[] = [
  { value: 'online', label: 'Online', hint: 'Crea una sala o entra con un codigo' },
  { value: 'bot', label: 'Contra la maquina', hint: 'Elige la fuerza del rival' },
  { value: 'hotseat', label: 'Dos jugadores', hint: 'Mismo dispositivo, el tablero gira en cada turno' },
];

/**
 * De la mas corta a la mas larga, y "Sin reloj" al final (AC-401). Estaba primera porque el
 * dia que se escribio FR-14 era lo que hacian todas las partidas: el reloj no existia. Ya
 * existe, asi que abrir en "Sin reloj" es proponer la version de antes del reloj.
 *
 * Son controles SIN incremento a proposito. La etiqueta dice "10 min" y tiene que ser cierta:
 * con 10+5 sumarias cinco segundos por jugada y una partida de "10 min" duraria bastante mas
 * (AC-404). El que quiera incremento pide una sala por codigo; el conjunto del motor los
 * sigue teniendo todos.
 *
 * Que el menu proponga 10+0 no cambia lo que asume el servidor: un `create` sin control de
 * tiempo sigue creando una sala sin reloj (AC-403, y AC-1401 de 003).
 */
export const TIME_OPTIONS: Option<TimeControl>[] = [
  { value: '5+0', label: '5 min' },
  { value: '10+0', label: '10 min' },
  { value: '60+0', label: '1 h' },
  { value: 'none', label: 'Sin reloj' },
];

/**
 * Sin ayuda escrita: la densidad se ve en el tablero del menu, que se espesa al subirla
 * (AC-106). Un porcentaje al lado de eso dice dos veces lo mismo, y peor.
 */
export const DIFFICULTIES: Option<Difficulty>[] = [
  { value: 'easy', label: 'Facil' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Dificil' },
];

export const DEFAULT_MODE: Mode = 'online';
export const DEFAULT_TIME_CONTROL: TimeControl = '10+0';
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';
export const DEFAULT_BOT_LEVEL: Difficulty = 'normal';
/**
 * Al azar por defecto: en online el color se negocia con el rival, y elegir blancas de
 * entrada da la primera jugada a quien monta la sala sin que nadie lo haya acordado.
 */
export const DEFAULT_COLOR = 'random' as const;
