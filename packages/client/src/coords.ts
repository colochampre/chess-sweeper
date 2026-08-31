import type { Color, GameConfig, Square } from '@cm/engine';

/**
 * Conversion entre indice de tablero y posicion en pantalla.
 * El jugador siempre ve sus piezas abajo: con `orientation: 'w'` la fila 1 queda
 * al pie del tablero; con `'b'` se invierte todo.
 */
export interface Cell {
  col: number;
  row: number;
}

export function toCell(sq: Square, c: GameConfig, orientation: Color): Cell {
  const file = sq % c.files;
  const rank = Math.floor(sq / c.files);
  return orientation === 'w'
    ? { col: file, row: c.ranks - 1 - rank }
    : { col: c.files - 1 - file, row: rank };
}

export function toSquare(cell: Cell, c: GameConfig, orientation: Color): Square {
  const file = orientation === 'w' ? cell.col : c.files - 1 - cell.col;
  const rank = orientation === 'w' ? c.ranks - 1 - cell.row : cell.row;
  return rank * c.files + file;
}

/** Casillas en el orden en que se pintan de arriba a abajo y de izquierda a derecha. */
export function displayOrder(c: GameConfig, orientation: Color): Square[] {
  const out: Square[] = [];
  for (let row = 0; row < c.ranks; row++) {
    for (let col = 0; col < c.files; col++) out.push(toSquare({ col, row }, c, orientation));
  }
  return out;
}

export const isLightSquare = (sq: Square, c: GameConfig): boolean =>
  ((sq % c.files) + Math.floor(sq / c.files)) % 2 === 1;

/** Transform CSS que coloca una pieza en su casilla (porcentajes de su propio tamano). */
export const cellTransform = (cell: Cell): string =>
  `translate(${cell.col * 100}%, ${cell.row * 100}%)`;
