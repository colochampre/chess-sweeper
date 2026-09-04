/**
 * El estado del boton de tablas es una decision, no un dibujo: se puede comprobar sin
 * navegador. El cliente no tiene montaje de DOM en los tests, asi que la logica vive en una
 * funcion pura y aqui se prueba entera.
 */
import { describe, expect, it } from 'vitest';
import { drawButton } from '../src/online.js';

describe('FR-13 ofrecer tablas', () => {
  const state = (over: Partial<Parameters<typeof drawButton>[0]> = {}) => ({
    mode: 'online' as const,
    status: 'playing' as const,
    mine: false,
    theirs: false,
    movesLeft: 0,
    yourTurn: false,
    armed: false,
    ...over,
  });
  /** Los casos en los que el boton se muestra: el resto devuelve `null`. */
  const offer = (over: Partial<Parameters<typeof drawButton>[0]> = {}) => {
    const button = drawButton(state(over));
    if (button === null) throw new Error('se esperaba un boton, no null');
    return button;
  };

  it('AC-1312: fuera de online no hay boton, porque no hay con quien acordar', () => {
    // Contra la maquina no hay con quien acordar, y en hotseat los dos jugadores ya
    // comparten la mesa: pueden dejarlo sin pedirle permiso a nadie.
    expect(drawButton(state({ mode: 'bot' }))).toBeNull();
    expect(drawButton(state({ mode: 'hotseat' }))).toBeNull();
  });

  it('AC-1303: con la partida terminada tampoco hay boton', () => {
    // Lo que se ofrece al final es la revancha, no las tablas.
    expect(drawButton(state({ status: 'draw' }))).toBeNull();
    expect(drawButton(state({ status: 'checkmate' }))).toBeNull();
  });

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
  it('AC-1413: en tu turno la oferta se arma para viajar con la jugada', () => {
    // Secuencia FIDE: mover, ofrecer, apretar el reloj. Mandarla suelta antes de mover la
    // haria caer en el tiempo propio, que es justo lo contrario de lo que se busca.
    // Y la etiqueta nombra las tablas: "Ofrecer con tu jugada" decia cuando pero nunca que.
    expect(offer({ yourTurn: true })).toEqual({
      label: 'Ofrecer tablas al mover',
      action: 'arm',
      disabled: false,
    });
  });

  it('AC-1413: armada, se ve que esta armada y se puede desarmar', () => {
    const button = offer({ yourTurn: true, armed: true });

    // Dice lo que hace al pulsarlo. Que este armada se ve en que el boton pasa a principal.
    expect(button.label).toBe('Cancelar la oferta');
    expect(button.action).toBe('disarm');
    expect(button.disabled).toBe(false);
  });

  it('AC-1413: fuera de turno se ofrece suelta, que FIDE tambien permite', () => {
    expect(offer({ yourTurn: false }).action).toBe('offer');
  });

  it('AC-1413: aceptar lo que ofrece el rival no espera a ninguna jugada', () => {
    // Es una respuesta, no una oferta: no tiene sentido hacerla esperar a mover.
    expect(offer({ theirs: true, yourTurn: true }).action).toBe('accept');
  });
});
