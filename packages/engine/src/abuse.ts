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
 * goteando conexiones. Lo que se adivina es el CODIGO, que `resume` tambien lleva. La sala ya
 * no contesta distinto segun exista o no -las dos razones de rechazo comparten
 * `RESUME_REFUSED_MESSAGE`, ver `protocol.ts`-, pero el limitador se queda igual: es defensa
 * en profundidad contra lo que el mensaje ya no revela pero el tiempo de respuesta todavia
 * podria, y adivinar el codigo sigue siendo el mismo ataque aunque la respuesta ya no lo diga.
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

/** Las acciones validas, para reconocerlas antes de haberlas validado del todo. */
const CONNECT_ACTIONS: readonly ConnectIntent['a'][] = ['join', 'resume', 'create', 'match'];

/**
 * Igual que `ipRateLimitKindFor`, pero a partir del parametro `a` en crudo, antes de validar
 * la peticion entera. Hace falta porque el limitador tiene que actuar ANTES que el resto de
 * comprobaciones: la de version rechaza por el socket (AC-905) y eso ya cuesta un
 * `WebSocketPair`, justo lo que este limitador existe para no pagar en cada intento.
 *
 * Lo que no se reconoce -un `a` desconocido, o directamente ausente- cae en el limitador mas
 * estrecho. Quien manda basura no merece el presupuesto mas holgado de los dos.
 */
export function ipRateLimitKindForParam(rawAction: string | null): IpRateLimitKind {
  const action = CONNECT_ACTIONS.find((known) => known === rawAction);
  return action === undefined ? IP_RATE_LIMIT_KIND.JOIN : ipRateLimitKindFor(action);
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
