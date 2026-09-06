import { describe, expect, it } from 'vitest';
import {
  IP_RATE_LIMIT_KIND,
  ipRateLimitKey,
  ipRateLimitKindFor,
  ipRateLimitKindForParam,
} from '@cm/engine';

describe('control de abuso por IP', () => {
  it('join cae en el limitador de join: es el que adivina codigos de sala', () => {
    expect(ipRateLimitKindFor('join')).toBe(IP_RATE_LIMIT_KIND.JOIN);
  });

  it('create y match caen en el mismo limitador: los dos gastan un Durable Object nuevo', () => {
    expect(ipRateLimitKindFor('create')).toBe(IP_RATE_LIMIT_KIND.CREATE);
    expect(ipRateLimitKindFor('match')).toBe(IP_RATE_LIMIT_KIND.CREATE);
  });

  it('resume cae en el mismo limitador que join: tambien lleva codigo de sala', () => {
    expect(ipRateLimitKindFor('resume')).toBe(IP_RATE_LIMIT_KIND.JOIN);
  });

  it('ninguna accion se queda sin limitar: cualquiera valdria para enumerar salas', () => {
    const actions = ['join', 'resume', 'create', 'match'] as const;
    const kinds = Object.values(IP_RATE_LIMIT_KIND);
    for (const action of actions) expect(kinds).toContain(ipRateLimitKindFor(action));
  });

  it('el parametro en crudo reconoce las acciones validas igual que el intento ya validado', () => {
    expect(ipRateLimitKindForParam('join')).toBe(IP_RATE_LIMIT_KIND.JOIN);
    expect(ipRateLimitKindForParam('resume')).toBe(IP_RATE_LIMIT_KIND.JOIN);
    expect(ipRateLimitKindForParam('create')).toBe(IP_RATE_LIMIT_KIND.CREATE);
    expect(ipRateLimitKindForParam('match')).toBe(IP_RATE_LIMIT_KIND.CREATE);
  });

  it('lo que no se reconoce cae en el limitador mas estrecho, no en el mas holgado', () => {
    for (const raw of [null, '', 'JOIN', 'borrar', '../']) {
      expect(ipRateLimitKindForParam(raw)).toBe(IP_RATE_LIMIT_KIND.JOIN);
    }
  });

  it('sin cabecera CF-Connecting-IP no hay clave: se falla abierto, no cerrado', () => {
    expect(ipRateLimitKey(null)).toBeNull();
    expect(ipRateLimitKey(undefined)).toBeNull();
    expect(ipRateLimitKey('')).toBeNull();
    expect(ipRateLimitKey('   ')).toBeNull();
  });

  it('con cabecera, la clave es la IP recortada', () => {
    expect(ipRateLimitKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipRateLimitKey('  203.0.113.7  ')).toBe('203.0.113.7');
  });
});
