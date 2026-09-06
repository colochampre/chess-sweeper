/**
 * Que intento de conexion cae en que limitador de abuso por IP, y con que clave.
 *
 * El transporte real -leer la cabecera `CF-Connecting-IP`, llamar al binding de Cloudflare-
 * vive en el Worker, porque es quien conoce Cloudflare. Aqui solo esta la decision, para
 * poder probarla sin un binding de verdad: dado que se pidio (`join`, `create`, `match`...)
 * y que trajo la cabecera, que limitador corresponde y con que clave, o si no hay nada que
 * limitar.
 *
 * Dos limitadores porque el ataque no es el mismo:
 *  - `join` es adivinar un codigo de sala existente (fuerza bruta).
 *  - `create` y `match` son gastar Durable Objects nuevos, que es lo que raciona el plan
 *    gratuito.
 * `resume` entra con `join`, aunque traiga un token opaco de 36 caracteres que no se adivina
 * goteando conexiones. Lo que se adivina es el CODIGO, que `resume` tambien lleva, y la sala
 * contesta distinto segun exista o no: «No existe ninguna sala con ese codigo» frente a «Ese
 * asiento no es tuyo». Esa diferencia dice si el codigo era bueno sin necesidad de acertar el
 * token, asi que dejar `resume` fuera seria dejar la misma puerta con otro nombre.
 */
import type { ConnectIntent } from './protocol.js';

export const IP_RATE_LIMIT_KIND = {
  JOIN: 'join',
  CREATE: 'create',
} as const;

export type IpRateLimitKind = (typeof IP_RATE_LIMIT_KIND)[keyof typeof IP_RATE_LIMIT_KIND];

/**
 * A que limitador corresponde la accion pedida. Devuelve siempre uno: no hay accion sin
 * limitar. El tipo es a proposito, porque anadir una accion nueva a `ConnectIntent` sin
 * decidir su limitador deja de compilar aqui en vez de colarse sin freno.
 */
export function ipRateLimitKindFor(action: ConnectIntent['a']): IpRateLimitKind {
  switch (action) {
    // Las dos llevan codigo de sala, asi que las dos sirven para enumerarlos.
    case 'join':
    case 'resume':
      return IP_RATE_LIMIT_KIND.JOIN;
    case 'create':
    case 'match':
      return IP_RATE_LIMIT_KIND.CREATE;
  }
}

/**
 * Clave de limitado a partir de lo que traiga `CF-Connecting-IP`, o `null` si no hay nada
 * usable. Sin cabecera -desarrollo local, tests, un llamador que no pasa por Cloudflare- no
 * hay IP que limitar, y fallar cerrado bloquearia a todo el mundo por igual, que es peor que
 * no limitar nada: el limitador es una capa mas, no la unica defensa.
 */
export function ipRateLimitKey(cfConnectingIp: string | null | undefined): string | null {
  const trimmed = cfConnectingIp?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}
