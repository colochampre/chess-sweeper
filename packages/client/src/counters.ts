/** Limite de la regla, en jugadas completas: cien medias jugadas son cincuenta (AC-707). */
export const STALL_LIMIT = 50;

/**
 * Desde donde se ensena. Por debajo no informa de nada: en una apertura el contador no
 * despega, porque los peones se mueven todo el tiempo. Que aparezca ES el dato — si esta en
 * pantalla, la partida se estanco.
 */
const SHOW_FROM = 20;

/** Cuando quedan estas o menos deja de ser un dato y pasa a ser un aviso. */
const CLOSE = 10;

export interface StallCounter {
  /** Jugadas completas sin peon, sin captura y sin detonacion. */
  moves: number;
  limit: number;
  /** Ya dice algo: por debajo de esto no se ensena. */
  visible: boolean;
  /** Queda poco. */
  close: boolean;
}

/**
 * Lo que le queda a la partida por la regla de las cincuenta jugadas (AC-707).
 *
 * No es el numero de jugada y por eso va aparte: `fullmove` no tiene techo —una partida puede
 * llegar a la 200 sin acercarse a nada— mientras que esto sube y VUELVE A CERO con cada peon,
 * cada captura y cada detonacion. Ponerle un denominador al numero de jugada seria escribir
 * un limite que no existe.
 *
 * Se muestra en jugadas completas y no en medias porque la regla se conoce por ese nombre: el
 * motor cuenta hasta cien medias, que son las cincuenta de toda la vida.
 */
export function stallCounter(halfmoveClock: number): StallCounter {
  const moves = Math.floor(halfmoveClock / 2);
  return {
    moves,
    limit: STALL_LIMIT,
    visible: moves >= SHOW_FROM,
    close: STALL_LIMIT - moves <= CLOSE,
  };
}
