/**
 * El contador de la regla de las cincuenta jugadas, sin navegador.
 *
 * Es la unica cifra de la partida que tiene techo, y no es el numero de jugada: `fullmove` no
 * tiene ninguno, porque esta vuelve a cero con cada peon, cada captura y cada detonacion.
 */
import { describe, expect, it } from 'vitest';
import { STALL_LIMIT, stallCounter } from '../src/counters.js';

describe('FR-9 el limite que si existe', () => {
  it('AC-903: se cuenta en jugadas completas, que son las que le dan nombre a la regla', () => {
    // El motor cuenta medias jugadas y corta en cien; la regla se conoce como la de 50.
    expect(stallCounter(0).moves).toBe(0);
    expect(stallCounter(1).moves).toBe(0);
    expect(stallCounter(2).moves).toBe(1);
    expect(stallCounter(99).moves).toBe(49);
    expect(STALL_LIMIT).toBe(50);
  });

  it('AC-902: no se ensena mientras no diga nada', () => {
    // En una apertura no despega: los peones se mueven todo el tiempo y lo vuelven a cero.
    expect(stallCounter(0).visible).toBe(false);
    expect(stallCounter(2 * 19).visible).toBe(false);
    // Que aparezca es el dato: si esta en pantalla, la partida se estanco.
    expect(stallCounter(2 * 20).visible).toBe(true);
  });

  it('AC-904: avisa cuando quedan diez o menos, y no antes', () => {
    expect(stallCounter(2 * 39).close).toBe(false);
    expect(stallCounter(2 * 40).close).toBe(true);
    expect(stallCounter(99).close).toBe(true);
  });
});
