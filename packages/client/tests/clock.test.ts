/**
 * Lo que el jugador ve del reloj, sin navegador.
 *
 * El cliente no lleva su propia cuenta (AC-1412): recibe lo que queda y cuando lo recibio, y
 * descuenta desde ahi. Eso es una funcion pura, asi que se puede comprobar entera aqui.
 */
import { describe, expect, it } from 'vitest';
import { clockRemaining, formatClock } from '../src/online.js';

describe('FR-14 el reloj en pantalla', () => {
  const view = { left: { w: 300_000, b: 240_000 }, running: 'w' as const, receivedAt: 1_000 };

  it('AC-1412: al que corre se le descuenta desde que llego el dato; al otro no', () => {
    expect(clockRemaining(view, 'w', 1_000)).toBe(300_000);
    expect(clockRemaining(view, 'w', 11_000)).toBe(290_000);
    // El rival espera: su reloj se dibuja igual que llego, por mucho que pase.
    expect(clockRemaining(view, 'b', 11_000)).toBe(240_000);
  });

  it('AC-1412: con el reloj parado no se descuenta de ninguno', () => {
    const paused = { ...view, running: null };

    expect(clockRemaining(paused, 'w', 999_000)).toBe(300_000);
    expect(clockRemaining(paused, 'b', 999_000)).toBe(240_000);
  });

  it('AC-1412: nunca baja de cero', () => {
    // Quien decide que se acabo el tiempo es el servidor (AC-1402): la pantalla se queda en
    // cero esperando el final, no lo declara ella.
    expect(clockRemaining(view, 'w', 999_000)).toBe(0);
  });

  it('AC-1412: se lee de un vistazo, y por debajo de diez segundos con decimas', () => {
    expect(formatClock(300_000)).toBe('5:00');
    expect(formatClock(62_000)).toBe('1:02');
    expect(formatClock(9_400)).toBe('0:09.4');
    // Con un decimal siempre: si 5 segundos clavados salieran "0:05" y 9,4 "0:09.4", el
    // reloj cambiaria de forma al bajar y el numero saltaria de sitio.
    expect(formatClock(5_000)).toBe('0:05.0');
    expect(formatClock(0)).toBe('0:00');
  });
});
