import type { Color, GameConfig, Piece, PieceType, Square } from './types.js';

export const fileOf = (sq: Square, files: number): number => sq % files;
export const rankOf = (sq: Square, files: number): number => Math.floor(sq / files);
export const sqOf = (file: number, rank: number, files: number): Square => rank * files + file;
export const squareCount = (c: GameConfig): number => c.files * c.ranks;

export function inBounds(file: number, rank: number, c: GameConfig): boolean {
  return file >= 0 && file < c.files && rank >= 0 && rank < c.ranks;
}

const NEIGHBOUR_DELTAS: readonly [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** Las hasta 8 casillas contiguas (el vecindario del Buscaminas). */
export function neighbours(sq: Square, c: GameConfig): Square[] {
  const f = fileOf(sq, c.files);
  const r = rankOf(sq, c.files);
  const out: Square[] = [];
  for (const [df, dr] of NEIGHBOUR_DELTAS) {
    const nf = f + df;
    const nr = r + dr;
    if (inBounds(nf, nr, c)) out.push(sqOf(nf, nr, c.files));
  }
  return out;
}

/** Casillas dentro de un cuadrado de radio `radius` (incluido el centro). */
export function areaAround(sq: Square, radius: number, c: GameConfig): Square[] {
  const f = fileOf(sq, c.files);
  const r = rankOf(sq, c.files);
  const out: Square[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let df = -radius; df <= radius; df++) {
      const nf = f + df;
      const nr = r + dr;
      if (inBounds(nf, nr, c)) out.push(sqOf(nf, nr, c.files));
    }
  }
  return out;
}

/**
 * Disposicion de la fila trasera para un tablero de `files` columnas.
 * En 8 columnas devuelve el orden estandar; en otros tamanos coloca rey y dama en el
 * centro y rellena de fuera hacia dentro con torre, caballo y alfil.
 */
export function backRankOrder(files: number): PieceType[] {
  const row: (PieceType | null)[] = new Array(files).fill(null);
  const kingFile = Math.min(files - 1, Math.floor((files - 1) / 2) + 1);
  const queenFile = Math.max(0, kingFile - 1);
  row[kingFile] = 'k';
  if (queenFile !== kingFile) row[queenFile] = 'q';

  const pattern: PieceType[] = ['r', 'n', 'b'];
  let left = 0;
  let right = files - 1;
  let p = 0;
  while (left <= right) {
    while (left <= right && row[left] !== null) left++;
    while (left <= right && row[right] !== null) right--;
    if (left > right) break;
    const t = pattern[p % pattern.length];
    row[left] = t;
    if (left !== right) row[right] = t;
    left++;
    right--;
    p++;
  }
  return row.map((t) => t ?? 'p');
}

/** Tablero en posicion inicial. Los ids son estables para que la UI pueda animar. */
export function initialBoard(c: GameConfig): (Piece | null)[] {
  const board: (Piece | null)[] = new Array(squareCount(c)).fill(null);
  const order = backRankOrder(c.files);
  let counter = 0;
  const put = (file: number, rank: number, type: PieceType, color: Color): void => {
    board[sqOf(file, rank, c.files)] = {
      id: `${color}${type}${counter++}`,
      type,
      color,
      hasMoved: false,
    };
  };
  for (let f = 0; f < c.files; f++) {
    put(f, 0, order[f], 'w');
    put(f, 1, 'p', 'w');
    put(f, c.ranks - 2, 'p', 'b');
    put(f, c.ranks - 1, order[f], 'b');
  }
  return board;
}


export const pawnDirection = (color: Color): number => (color === 'w' ? 1 : -1);
export const pawnStartRank = (color: Color, c: GameConfig): number =>
  color === 'w' ? 1 : c.ranks - 2;
export const promotionRank = (color: Color, c: GameConfig): number =>
  color === 'w' ? c.ranks - 1 : 0;

/** Notacion algebraica de una casilla (a1, e4...), util en logs y tests. */
export function squareName(sq: Square, c: GameConfig): string {
  return `${String.fromCharCode(97 + fileOf(sq, c.files))}${rankOf(sq, c.files) + 1}`;
}

/** Inversa de `squareName`. */
export function parseSquare(name: string, c: GameConfig): Square {
  const file = name.charCodeAt(0) - 97;
  const rank = Number.parseInt(name.slice(1), 10) - 1;
  return sqOf(file, rank, c.files);
}
