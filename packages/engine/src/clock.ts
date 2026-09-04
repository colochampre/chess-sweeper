/**
 * El reloj de la partida. Ver specs/003-online/spec.md, FR-14.
 *
 * Funciones puras sobre un `ClockState`, igual que el resto del motor: no saben de quien es
 * el turno, ni si hay alguien conectado, ni que existe una sala. Quien corre en cada momento
 * se lo dice el que llama, que es el unico que lo sabe.
 *
 * Vive aparte de `GameState` a proposito. `applyMove` es pura y recibe `(state, move)`;
 * meterle el reloj la obligaria a conocer la hora, y esa funcion la usan tambien el bot y el
 * panel de balance, que no tienen nada que ver con el tiempo.
 */
import type { Color } from './types.js';

/** Los controles que se pueden elegir. Es un conjunto cerrado: ver `TIME_CONTROLS`. */
export type TimeControl =
  | 'none'
  | '3+2'
  | '5+0'
  | '5+2'
  | '10+0'
  | '10+5'
  | '15+0'
  | '15+10'
  | '30+0'
  | '60+0';

/**
 * Minutos iniciales e incremento por jugada, por control.
 *
 * La lista es cerrada porque el control viaja en la URL de la conexion: sin ella se podria
 * pedir una partida de mil horas y dejar una sala ocupada hasta que caduque sola.
 */
export const TIME_CONTROLS: Record<TimeControl, { initialMs: number; incrementMs: number } | null> =
  {
    none: null,
    '3+2': { initialMs: 3 * 60_000, incrementMs: 2_000 },
    '5+0': { initialMs: 5 * 60_000, incrementMs: 0 },
    '5+2': { initialMs: 5 * 60_000, incrementMs: 2_000 },
    '10+0': { initialMs: 10 * 60_000, incrementMs: 0 },
    '10+5': { initialMs: 10 * 60_000, incrementMs: 5_000 },
    '15+0': { initialMs: 15 * 60_000, incrementMs: 0 },
    '15+10': { initialMs: 15 * 60_000, incrementMs: 10_000 },
    // Los largos del menu. Sin incremento: quien elige media hora no esta contando segundos,
    // y sumarlos alargaria una partida que ya es larga por decision.
    '30+0': { initialMs: 30 * 60_000, incrementMs: 0 },
    '60+0': { initialMs: 60 * 60_000, incrementMs: 0 },
  };

export const isTimeControl = (value: string): value is TimeControl => value in TIME_CONTROLS;

export interface ClockState {
  incrementMs: number;
  /** Lo que le queda a cada uno cuando el reloj esta parado. */
  left: Record<Color, number>;
  /**
   * Instante en que empezo a correr el turno en curso, o `null` si el reloj esta parado:
   * antes de que se sienten los dos (AC-1403) y mientras alguien esta ausente (AC-1408).
   */
  runningSince: number | null;
}

/** Reloj nuevo para ese control, o `null` si la partida se juega sin reloj. */
export function createClock(control: TimeControl): ClockState | null {
  const setting = TIME_CONTROLS[control];
  if (setting === null) return null;
  return {
    incrementMs: setting.incrementMs,
    left: { w: setting.initialMs, b: setting.initialMs },
    runningSince: null,
  };
}

/** Pone el reloj en marcha desde `now`. Si ya corria, no lo mueve. */
export function startClock(clock: ClockState, now: number): void {
  if (clock.runningSince === null) clock.runningSince = now;
}

/**
 * Para el reloj, cobrandole a `running` lo que lleve consumido. Lo que ya se gasto no se
 * devuelve: parar no es deshacer.
 */
export function pauseClock(clock: ClockState, running: Color | null, now: number): void {
  if (clock.runningSince === null) return;
  if (running !== null) clock.left[running] = clockMsLeft(clock, running, running, now);
  clock.runningSince = null;
}

/**
 * Cobra la jugada a quien la hizo y deja el reloj corriendo desde ese mismo instante, ya para
 * el rival. El incremento se suma despues de descontar lo tardado.
 */
export function chargeMove(clock: ClockState, mover: Color, now: number): void {
  if (clock.runningSince === null) return;
  clock.left[mover] = clockMsLeft(clock, mover, mover, now) + clock.incrementMs;
  clock.runningSince = now;
}

/**
 * Lo que le queda a `color`, contando el turno en curso si es el suyo. `running` es de quien
 * es el reloj ahora mismo, o `null` si esta parado. Nunca baja de cero.
 */
export function clockMsLeft(
  clock: ClockState,
  color: Color,
  running: Color | null,
  now: number,
): number {
  const consumed =
    clock.runningSince !== null && color === running ? now - clock.runningSince : 0;
  return Math.max(0, clock.left[color] - consumed);
}

/** Quien se quedo sin tiempo, o `null` si no le ha pasado a nadie. */
export function flaggedColor(
  clock: ClockState,
  running: Color | null,
  now: number,
): Color | null {
  for (const color of ['w', 'b'] as const) {
    if (clockMsLeft(clock, color, running, now) === 0) return color;
  }
  return null;
}

/** Cuando le caeria la bandera a quien corre, o `null` si no corre nadie. */
export function flagFallsAt(clock: ClockState, running: Color | null): number | null {
  if (clock.runningSince === null || running === null) return null;
  return clock.runningSince + clock.left[running];
}
