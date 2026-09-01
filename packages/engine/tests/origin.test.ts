import { describe, expect, it } from 'vitest';
import { isLocalHostname, isOriginAllowed } from '@cm/engine';

const check = (origin: string | null, host: string, allowed?: string[]) =>
  isOriginAllowed({ origin, host, allowed });

describe('FR-7 origenes permitidos', () => {
  it('AC-701: sin cabecera Origin se acepta (no hay navegador que suplantar)', () => {
    expect(check(null, 'chess.example.com')).toBe(true);
    expect(check('', 'chess.example.com')).toBe(true);
  });

  it('AC-702: el mismo origen siempre vale', () => {
    expect(check('https://chess.example.com', 'chess.example.com')).toBe(true);
    expect(check('http://localhost:8787', 'localhost:8787')).toBe(true);
  });

  it('AC-703: en local vale otro puerto, que es el circuito de desarrollo', () => {
    // Vite en el 5173 contra el servidor en el 8787: es lo que documenta docs/deploy.md.
    expect(check('http://localhost:5173', 'localhost:8787')).toBe(true);
    expect(check('http://127.0.0.1:5173', '127.0.0.1:8787')).toBe(true);
    // Y jugar en la red local desde otro equipo.
    expect(check('http://192.168.0.5:5173', '192.168.0.5:8787')).toBe(true);
  });

  it('AC-704: un origen publico no entra aunque el servidor sea local', () => {
    expect(check('https://evil.example.com', 'localhost:8787')).toBe(false);
    expect(check('https://evil.example.com', '192.168.0.5:8787')).toBe(false);
    // Ni disfrazandose de subdominio.
    expect(check('https://localhost.evil.example.com', 'localhost:8787')).toBe(false);
  });

  it('AC-704: en produccion no se admite otro puerto ni otro host', () => {
    expect(check('https://chess.example.com:9000', 'chess.example.com')).toBe(false);
    expect(check('https://otra.example.com', 'chess.example.com')).toBe(false);
  });

  it('AC-705: si hay lista explicita, manda ella y nada mas', () => {
    const allowed = ['https://chess.example.com', 'https://staging.example.com'];
    expect(check('https://chess.example.com', 'otro.example.com', allowed)).toBe(true);
    expect(check('https://staging.example.com', 'otro.example.com', allowed)).toBe(true);
    // Con lista, ni siquiera el atajo de desarrollo local se cuela.
    expect(check('http://localhost:5173', 'localhost:8787', allowed)).toBe(false);
  });

  it('AC-704: un Origin que no es una URL se rechaza', () => {
    expect(check('null', 'localhost:8787')).toBe(false);
    expect(check('no-soy-una-url', 'localhost:8787')).toBe(false);
  });

  it('reconoce loopback y rangos privados', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', '10.0.0.4', '192.168.1.20', '172.16.5.5']) {
      expect(isLocalHostname(h)).toBe(true);
    }
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', 'localhost.evil.com']) {
      expect(isLocalHostname(h)).toBe(false);
    }
  });
});
