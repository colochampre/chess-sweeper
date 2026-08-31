import type { GameConfig, Square } from '@cm/engine';

/**
 * Conversion entre indice de tablero y posicion en pantalla.
 *
 * El tablero se dibuja SIEMPRE con la fila 1 abajo. Que el jugador de negras vea sus
 * piezas en la parte inferior se resuelve rotando el contenedor 180 grados por CSS y
 * contrarrotando piezas, numeros e iconos. Asi el orden de las casillas en el DOM nunca
 * cambia, que es lo que permite animar el giro en vez de que el tablero salte de golpe.
 */
export interface Cell {
  col: number;
  row: number;
}

export function toCell(sq: Square, c: GameConfig): Cell {
  return { col: sq % c.files, row: c.ranks - 1 - Math.floor(sq / c.files) };
}

export function toSquare(cell: Cell, c: GameConfig): Square {
  return (c.ranks - 1 - cell.row) * c.files + cell.col;
}

/** Casillas en el orden en que se pintan, de arriba a abajo y de izquierda a derecha. */
export function displayOrder(c: GameConfig): Square[] {
  const out: Square[] = [];
  for (let row = 0; row < c.ranks; row++) {
    for (let col = 0; col < c.files; col++) out.push(toSquare({ col, row }, c));
  }
  return out;
}

export const isLightSquare = (sq: Square, c: GameConfig): boolean =>
  ((sq % c.files) + Math.floor(sq / c.files)) % 2 === 1;

/** Transform CSS que coloca una pieza en su casilla (porcentajes de su propio tamano). */
export const cellTransform = (cell: Cell): string =>
  `translate(${cell.col * 100}%, ${cell.row * 100}%)`;
