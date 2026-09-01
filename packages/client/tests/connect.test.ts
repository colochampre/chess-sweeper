/**
 * Primeros tests del cliente. Existen por un fallo concreto: entrar por codigo probaba la
 * credencial guardada ANTES que entrar como jugador nuevo, y como `localStorage` es del
 * navegador y no de la pestana, la segunda pestana reclamaba el asiento de la primera. Las
 * dos acababan jugando con blancas, las negras no se ocupaban nunca y nada mas funcionaba
 * a partir de ahi.
 *
 * `planConnect` es puro a proposito: la decision se puede comprobar sin navegador.
 */
import { describe, expect, it } from 'vitest';
import { planConnect } from '../src/online.js';

describe('FR-10 politica de reconexion del cliente', () => {
  it('AC-1005: se entra como jugador nuevo primero, aunque haya credencial de esa sala', () => {
    const plan = planConnect('ABC234', { code: 'ABC234', token: 'un-token' });

    // Lo primero es pedir sitio: tener token no significa que el libre sea el nuestro.
    expect(plan.first).toEqual({ a: 'join', code: 'ABC234' });
    // La credencial queda de reserva, para cuando la sala responda que esta completa.
    expect(plan.fallback).toEqual({ a: 'resume', code: 'ABC234', token: 'un-token' });
  });

  it('AC-1005: sin credencial guardada no hay reserva que probar', () => {
    expect(planConnect('ABC234', null)).toEqual({
      first: { a: 'join', code: 'ABC234' },
      fallback: null,
    });
  });

  it('AC-1005: una credencial de otra sala no sirve de reserva', () => {
    const plan = planConnect('ABC234', { code: 'XYZ789', token: 'un-token' });

    expect(plan.first).toEqual({ a: 'join', code: 'ABC234' });
    expect(plan.fallback).toBeNull();
  });
});
