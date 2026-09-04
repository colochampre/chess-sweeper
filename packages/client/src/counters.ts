/** Limite de la regla, en jugadas completas: cien medias jugadas son cincuenta (AC-707). */
export const STALL_LIMIT = 50;

/** Cuando quedan estas o menos, el contador deja de ser un dato y pasa a ser un aviso. */
const CLOSE = 10;

export interface StallCounter {
  /** Jugadas completas sin peon, sin captura y sin detonacion. */
  moves: number;
  limit: number;
  /** Queda poco: a partir de aqui conviene que se vea. */
  close: boolean;
}

/**
 * Lo que le queda a la partida por la regla de las cien medias jugadas (AC-707).
 *
 * No es el numero de jugada, y por eso va en su propio contador: `fullmove` no tiene techo
 * —una partida puede llegar a la 200 sin acercarse a nada— mientras que esto sube y VUELVE A
 * CERO con cada peon, cada captura y cada detonacion. Ponerle un denominador al numero de
 * jugada seria escribir un limite que no existe.
 *
 * Se muestra en jugadas completas y no en medias porque la regla se conoce por ese nombre:
 * el motor cuenta hasta cien medias, que son las cincuenta de toda la vida.
 */
export function stallCounter(halfmoveClock: number): StallCounter {
  const moves = Math.floor(halfmoveClock / 2);
  return { moves, limit: STALL_LIMIT, close: STALL_LIMIT - moves <= CLOSE };
}
