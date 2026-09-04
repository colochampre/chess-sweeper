/**
 * 005: con quien se puede jugar, y que hacer con quien pide rival.
 *
 * La politica es pura y vive en el motor, como la de sala y la de origenes: lo que cada
 * transporte aporta es donde se guarda la cola, no que significa emparejar.
 */
import { describe, expect, it } from 'vitest';
import {
  QUEUE_TTL_MS,
  isEntryFresh,
  matchKey,
  resolveMatch,
  type QueueEntry,
  intentToQuery,
  parseIntent,
} from '@cm/engine';

const settings = {
  difficulty: 'normal' as const,
  boardSize: 8,
  timeControl: '10+5' as const,
};

describe('FR-1 la cola', () => {
  it('AC-101: solo empareja quien pidio exactamente lo mismo', () => {
    const key = matchKey(settings);

    expect(matchKey({ ...settings })).toBe(key);
    expect(matchKey({ ...settings, difficulty: 'hard' })).not.toBe(key);
    expect(matchKey({ ...settings, timeControl: '5+2' })).not.toBe(key);
    expect(matchKey({ ...settings, boardSize: 10 })).not.toBe(key);
  });

  it('AC-101: sin control de tiempo es un ajuste mas, no la ausencia de uno', () => {
    // Quien pide sin reloj tiene que emparejar con quien pide sin reloj, y con nadie mas.
    expect(matchKey({ ...settings, timeControl: undefined })).toBe(
      matchKey({ ...settings, timeControl: 'none' }),
    );
    expect(matchKey({ ...settings, timeControl: 'none' })).not.toBe(matchKey(settings));
  });

  it('AC-102: el color no entra en la clave', () => {
    // Si entrase, quien quiere blancas solo emparejaria con quien quiere blancas, que es
    // justo con quien no puede jugar.
    const white = matchKey({ ...settings, hostColor: 'w' });
    const black = matchKey({ ...settings, hostColor: 'b' });

    expect(white).toBe(black);
    expect(white).toBe(matchKey(settings));
  });
});

describe('FR-2 emparejar se resuelve a crear o a entrar', () => {
  const entry = (since: number): QueueEntry => ({ code: 'QK4M7X', since });

  it('AC-201: con alguien esperando se entra a su sala', () => {
    expect(resolveMatch(entry(1_000), 1_000)).toEqual({ a: 'join', code: 'QK4M7X' });
  });

  it('AC-201: sin nadie esperando se crea una y se espera', () => {
    expect(resolveMatch(null, 1_000)).toEqual({ a: 'create' });
  });

  it('AC-403: una entrada caducada no se entrega, se crea una nueva', () => {
    // La caducidad es una red debajo del pegamento (AC-401), no el mecanismo: cubre que el
    // proceso se caiga entre sentarse y darse de baja.
    const stale = entry(1_000);

    expect(isEntryFresh(stale, 1_000 + QUEUE_TTL_MS - 1)).toBe(true);
    expect(isEntryFresh(stale, 1_000 + QUEUE_TTL_MS)).toBe(false);
    expect(resolveMatch(stale, 1_000 + QUEUE_TTL_MS)).toEqual({ a: 'create' });
  });
});

describe('FR-2 el intent viaja por la URL', () => {
  it('AC-203: match sobrevive a la ida y vuelta con sus ajustes', () => {
    // Misma garantia que AC-501 de 003 para create, join y resume: lo que se manda es lo que
    // se lee. `match` lleva ajustes y no codigo, porque todavia no hay ninguno.
    const intent = {
      a: 'match',
      difficulty: 'hard',
      boardSize: 8,
      hostColor: 'random',
      timeControl: '5+2',
    } as const;

    expect(parseIntent(new URLSearchParams(intentToQuery(intent)))).toEqual(intent);
  });

  it('AC-203: un match con ajustes invalidos se rechaza, como un create', () => {
    const bad = new URLSearchParams(
      intentToQuery({
        a: 'match',
        difficulty: 'normal',
        boardSize: 8,
        hostColor: 'random',
        timeControl: '10+5',
      }),
    );
    bad.set('difficulty', 'imposible');

    expect(parseIntent(bad)).toBeNull();
  });
});
