import type { Color, PieceType } from '@cm/engine';

/** Carpeta de `public/assets/pieces/`. Cambiala para usar otro set. */
export const PIECE_SET = 'cburnett';

export const pieceSrc = (type: PieceType, color: Color): string =>
  `/assets/pieces/${PIECE_SET}/${color}${type.toUpperCase()}.svg`;

export const MINE_SRC = '/assets/icons/mine.svg';
export const FLAG_SRC = '/assets/icons/flag.svg';

/** Colores clasicos del Buscaminas para los numeros de casillas vecinas. */
export const NUMBER_COLORS: readonly string[] = [
  'transparent',
  '#0000ff',
  '#008200',
  '#ff0000',
  '#000084',
  '#840000',
  '#008284',
  '#000000',
  '#808080',
];

/** Duraciones de animacion, en ms. */
export const ANIM = {
  hop: 150,
  capture: 180,
  explosion: 460,
  reveal: 120,
  botThink: 260,
} as const;

export const PIECE_VALUE: Record<PieceType, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};
