import { describe, expect, it } from 'vitest';
import { applyMove, type GameEvent } from '@cm/engine';
import { emptyGame, mine, put, sq } from './helpers.js';

const centersOf = (events: GameEvent[]): number[] =>
  events
    .filter((e): e is Extract<GameEvent, { type: 'explosion' }> => e.type === 'explosion')
    .map((e) => e.center);

describe('FR-8 eventos', () => {
  it('AC-801: un salto por cada casilla del trayecto', () => {
    const s = emptyGame();
    put(s, 'a1', 'r', 'w');
    put(s, 'h1', 'k', 'w');
    put(s, 'h8', 'k', 'b');
    const { events } = applyMove(s, { from: sq(s, 'a1'), to: sq(s, 'a4') });
    expect(events.filter((e) => e.type === 'hop')).toHaveLength(3);
  });

  it('AC-802: la captura llega justo despues del salto de aterrizaje', () => {
    const s = emptyGame();
    put(s, 'a1', 'r', 'w');
    put(s, 'a4', 'p', 'b');
    put(s, 'h1', 'k', 'w');
    put(s, 'h8', 'k', 'b');
    const { events } = applyMove(s, { from: sq(s, 'a1'), to: sq(s, 'a4') });

    const captureIndex = events.findIndex((e) => e.type === 'capture');
    const lastHopIndex = events.map((e) => e.type).lastIndexOf('hop');
    expect(captureIndex).toBe(lastHopIndex + 1);
    expect(events[lastHopIndex]).toMatchObject({ to: sq(s, 'a4') });
  });

  it('AC-803: una explosion por mina detonada, en orden de detonacion', () => {
    const s = emptyGame();
    put(s, 'd1', 'r', 'w');
    put(s, 'h1', 'k', 'w');
    put(s, 'h8', 'k', 'b');
    mine(s, 'd4', 'e5');
    const { events } = applyMove(s, { from: sq(s, 'd1'), to: sq(s, 'd4') });
    expect(centersOf(events)).toEqual([sq(s, 'd4'), sq(s, 'e5')]);
  });

  it('AC-804: el ultimo evento de una partida terminada es end', () => {
    const s = emptyGame();
    put(s, 'a8', 'k', 'b');
    put(s, 'b6', 'k', 'w');
    put(s, 'h1', 'r', 'w');
    const { events } = applyMove(s, { from: sq(s, 'h1'), to: sq(s, 'h8') });
    expect(events.at(-1)?.type).toBe('end');
  });
});
