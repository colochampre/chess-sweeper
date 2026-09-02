/**
 * El estado del boton de tablas es una decision, no un dibujo: se puede comprobar sin
 * navegador. El cliente no tiene montaje de DOM en los tests, asi que la logica vive en una
 * funcion pura y aqui se prueba entera.
 */
import { describe, expect, it } from 'vitest';
import { drawButton } from '../src/online.js';

describe('FR-13 ofrecer tablas', () => {
  const offer = (over: Partial<Parameters<typeof drawButton>[0]> = {}) =>
    drawButton({ mine: false, theirs: false, movesLeft: 0, ...over });

  it('AC-1302: sin nada pendiente, el boton ofrece', () => {
    expect(offer()).toEqual({ label: 'Ofrecer tablas', action: 'offer', disabled: false });
  });

  it('AC-1302: con la oferta propia en pie, el boton dice que se espera respuesta', () => {
    const button = offer({ mine: true });

    expect(button.label).toBe('Tablas ofrecidas');
    // Y no se puede volver a pulsar: un boton que no responde no se distingue de uno roto.
    expect(button.disabled).toBe(true);
  });

  it('AC-1302: si la oferta es del rival, el boton pasa a aceptar', () => {
    expect(offer({ theirs: true })).toEqual({
      label: 'Aceptar tablas',
      action: 'accept',
      disabled: false,
    });
  });

  it('AC-1308: durante la espera el boton se ve pero no se pulsa', () => {
    const button = offer({ movesLeft: 5 });

    expect(button.action).toBe('offer');
    expect(button.disabled).toBe(true);
  });

  it('AC-1314: el boton dice cuantas jugadas faltan, no solo que no se puede', () => {
    // Un boton que se apaga sin explicarse no se distingue de uno roto.
    expect(offer({ movesLeft: 5 }).label).toBe('Tablas en 5 jugadas');
    expect(offer({ movesLeft: 1 }).label).toBe('Tablas en 1 jugada');
  });

  it('AC-1308: estar esperando nunca impide aceptar lo que ofrece el rival', () => {
    // Deber jugadas antes de volver a ofrecer no es motivo para no poder decir que si:
    // son dos cosas distintas.
    expect(offer({ theirs: true, movesLeft: 5 })).toEqual({
      label: 'Aceptar tablas',
      action: 'accept',
      disabled: false,
    });
  });
});
