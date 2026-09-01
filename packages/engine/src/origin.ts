/**
 * Que origenes pueden abrir un WebSocket contra el servidor.
 *
 * Sin este chequeo, cualquier web podria abrir conexiones contra la partida usando el
 * navegador de quien la visite. Con el chequeo mal puesto, se rompe el circuito de
 * desarrollo: el cliente de Vite vive en el 5173 y el servidor en el 8787, asi que el
 * navegador manda un `Origin` que no coincide con el host.
 *
 * La regla resuelve las dos cosas a la vez: se acepta el mismo origen siempre, y se acepta
 * un puerto distinto **solo cuando los dos extremos son locales**. Una web publica no puede
 * colarse por ahi, porque para eso su propio nombre tendria que ser local.
 */

const LOOPBACK = /^(localhost|0\.0\.0\.0|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1)$/i;

/** Rangos privados de la RFC 1918, para jugar en la red local. */
const PRIVATE_IPV4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

const hostnameOf = (hostWithPort: string): string | null => {
  try {
    return new URL(`http://${hostWithPort}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
};

export function isLocalHostname(hostname: string): boolean {
  return LOOPBACK.test(hostname) || PRIVATE_IPV4.test(hostname);
}

export interface OriginCheck {
  /** Cabecera `Origin` de la peticion; `null` si no viene (cliente que no es navegador). */
  origin: string | null;
  /** Host al que se ha pedido la conexion, con puerto. */
  host: string;
  /** Lista explicita; si se define, manda ella y nada mas. */
  allowed?: string[];
}

export function isOriginAllowed({ origin, host, allowed }: OriginCheck): boolean {
  // Sin `Origin` no hay navegador detras: tests, wscat, un bot. No hay nada que suplantar.
  if (origin === null || origin === '') return true;

  let originHost: string;
  let originHostname: string;
  try {
    const url = new URL(origin);
    originHost = url.host;
    originHostname = url.hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }

  if (allowed && allowed.length > 0) {
    return allowed.includes(origin) || allowed.includes(originHost);
  }

  if (originHost === host) return true;

  // Desarrollo y red local: otro puerto vale, pero los dos lados tienen que ser locales.
  const target = hostnameOf(host);
  return target !== null && isLocalHostname(originHostname) && isLocalHostname(target);
}
