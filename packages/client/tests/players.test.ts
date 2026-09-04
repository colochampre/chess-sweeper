/**
 * Lo que se dibuja al lado de cada jugador, sin navegador.
 *
 * Donde se ponen las tiras es maquetado y se comprueba a mano; QUE dice cada una es una
 * funcion pura, y va aqui.
 */
import { describe, expect, it } from 'vitest';
import type { Piece } from '@cm/engine';
import { playerStrip } from '../src/players.js';

const piece = (color: 'w' | 'b', type: Piece['type'], id: string): Piece =>
  ({ id, color, type }) as Piece;

describe('FR-7 cada jugador con lo suyo al lado', () => {
  it('AC-701: el botin de un jugador son las piezas del rival, no las propias', () => {
    const captured = [piece('b', 'n', '1'), piece('b', 'p', '2'), piece('w', 'p', '3')];

    // Las blancas se comieron un caballo y un peon negros.
    expect(playerStrip(captured, 'w').taken).toEqual(['n', 'p']);
    // Y las negras, un peon blanco.
    expect(playerStrip(captured, 'b').taken).toEqual(['p']);
  });

  it('AC-701: el botin va de la pieza mas valiosa a la menos', () => {
    const captured = [piece('b', 'p', '1'), piece('b', 'q', '2'), piece('b', 'b', '3')];

    expect(playerStrip(captured, 'w').taken).toEqual(['q', 'b', 'p']);
  });

  it('AC-702: la ventaja se escribe en un solo lado, el que va ganando', () => {
    // Blancas +3: se comieron un caballo (3) y perdieron nada.
    const captured = [piece('b', 'n', '1')];

    expect(playerStrip(captured, 'w').advantage).toBe(3);
    // En el otro lado no se escribe "-3": leer un signo para saber quien gana es peor que no
    // escribir nada, y ademas lo dice ya el de enfrente.
    expect(playerStrip(captured, 'b').advantage).toBe(0);
  });

  it('AC-702: con el material igualado no hay ventaja en ningun lado', () => {
    const captured = [piece('b', 'r', '1'), piece('w', 'r', '2')];

    expect(playerStrip(captured, 'w').advantage).toBe(0);
    expect(playerStrip(captured, 'b').advantage).toBe(0);
  });

  it('AC-702: el rey no cuenta, aunque aqui pueda volar por los aires', () => {
    // PIECE_VALUE['k'] es 0: en este juego el rey se pierde de verdad, y contarlo daria una
    // ventaja absurda en una partida que de todos modos ya termino.
    const captured = [piece('b', 'k', '1')];

    expect(playerStrip(captured, 'w').taken).toEqual(['k']);
    expect(playerStrip(captured, 'w').advantage).toBe(0);
  });
});
