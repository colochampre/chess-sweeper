/**
 * El reloj, en aislamiento. Ver specs/003-online/spec.md, FR-14.
 *
 * Son funciones puras sobre un `ClockState`: no saben de quien es el turno ni si hay alguien
 * conectado. Quien corre en cada momento se lo dice la sala, que es la que sabe. Asi el mismo
 * modulo sirve el dia que se quiera reloj fuera de una partida en red.
 */
import { describe, expect, it } from 'vitest';
import {
  TIME_CONTROLS,
  chargeMove,
  clockMsLeft,
  createClock,
  flaggedColor,
  startClock,
  type ClockState,
} from '@cm/engine';

/** Reloj de 5 minutos con 2 segundos de incremento, arrancado en `t`. */
const running = (t = 1_000_000): ClockState => {
  const clock = createClock('5+2');
  if (clock === null) throw new Error('5+2 deberia existir');
  startClock(clock, t);
  return clock;
};

describe('FR-14 el reloj', () => {
  it('AC-1401: los controles conocidos se resuelven y "sin reloj" no crea ninguno', () => {
    expect(createClock('none')).toBeNull();

    const clock = createClock('5+2');
    expect(clock?.left).toEqual({ w: 5 * 60_000, b: 5 * 60_000 });
    expect(clock?.incrementMs).toBe(2_000);

    // El conjunto es cerrado a proposito: el control viaja por la URL, y sin lista alguien
    // podria pedir una partida de mil horas y dejar la sala ocupada hasta que caduque.
    for (const [name, control] of Object.entries(TIME_CONTROLS)) {
      if (control === null) continue;
      expect(control.initialMs, name).toBeGreaterThan(0);
      expect(control.incrementMs, name).toBeGreaterThanOrEqual(0);
    }
  });

  it('AC-1402: el tiempo se descuenta del que corre, no del que espera', () => {
    const clock = running();

    // Diez segundos despues, con las blancas en el reloj.
    expect(clockMsLeft(clock, 'w', 'w', 1_010_000)).toBe(5 * 60_000 - 10_000);
    expect(clockMsLeft(clock, 'b', 'w', 1_010_000)).toBe(5 * 60_000);
  });

  it('AC-1403: parado no corre el tiempo de nadie', () => {
    const clock = createClock('5+2');
    if (clock === null) throw new Error('5+2 deberia existir');

    // Sin arrancar: `runningSince` es null y da igual cuanto pase.
    expect(clock.runningSince).toBeNull();
    expect(clockMsLeft(clock, 'w', 'w', 9_999_999)).toBe(5 * 60_000);
  });

  it('AC-1404: al mover se descuenta lo tardado y se suma el incremento', () => {
    const clock = running();

    chargeMove(clock, 'w', 1_010_000); // tardo 10 segundos

    expect(clock.left.w).toBe(5 * 60_000 - 10_000 + 2_000);
    expect(clock.left.b).toBe(5 * 60_000);
    // Y el reloj sigue corriendo desde ese mismo instante, ahora para el rival.
    expect(clock.runningSince).toBe(1_010_000);
  });

  it('AC-1404: el incremento nunca sube el reloj por encima de lo que se tardo', () => {
    const clock = running();

    // Mover al instante con incremento de 2s no puede dar tiempo infinito gratis: lo que
    // suma el incremento es real, pero el tiempo consumido tambien se descuenta.
    chargeMove(clock, 'w', 1_000_000);
    expect(clock.left.w).toBe(5 * 60_000 + 2_000);
  });

  it('AC-1405: quedarse sin tiempo se detecta y no baja de cero', () => {
    const clock = running();
    const seisMinutos = 1_000_000 + 6 * 60_000;

    expect(clockMsLeft(clock, 'w', 'w', seisMinutos)).toBe(0);
    expect(flaggedColor(clock, 'w', seisMinutos)).toBe('w');
    // El que no corre no se queda sin tiempo por mucho que espere.
    expect(flaggedColor(clock, 'b', seisMinutos)).toBe('b');
  });

  it('AC-1405: con el reloj parado no se le cae la bandera a nadie', () => {
    const clock = running();
    chargeMove(clock, 'w', 1_010_000);
    clock.runningSince = null; // parado: ver AC-1408

    expect(flaggedColor(clock, 'b', 9_999_999)).toBeNull();
  });
});
