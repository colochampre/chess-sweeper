import {
  configFor,
  createGame,
  toView,
  type Color,
  type Difficulty,
  type GameConfig,
  type PieceType,
  type PlayerView,
  type Square,
} from '@cm/engine';
import { DEFAULT_DIFFICULTY } from './menuOptions.js';

export interface RenderPiece {
  id: string;
  type: PieceType;
  color: Color;
  sq: Square;
}

/**
 * Todo lo que hace falta para dibujar un tablero: ni store, ni partida en curso, ni la hora.
 * Un objeto plano que `BoardView` convierte en pixeles y nada mas.
 *
 * Se deriva siempre de `PlayerView`, nunca de `GameState` (AC-102). Aqui no juega nadie, asi
 * que arrastrar las minas no rompe nada hoy: por eso mismo se dice, porque manana la escena
 * la va a usar otro.
 */
export interface BoardScene {
  config: GameConfig;
  pieces: RenderPiece[];
  revealed: boolean[];
  adjacency: number[];
  detonated: boolean[];
  craters: boolean[];
  /** Banderas rojas del jugador. Son privadas, y en el menu no hay ninguna. */
  flags: boolean[];
  blasts: Square[];
  dying: string[];
  targets: Square[];
  selected: Square | null;
  lastMove: { from: Square; to: Square } | null;
  flipped: boolean;
}

export const piecesOf = (view: PlayerView): RenderPiece[] => {
  const out: RenderPiece[] = [];
  view.board.forEach((piece, sq) => {
    if (piece !== null) out.push({ id: piece.id, type: piece.type, color: piece.color, sq });
  });
  return out;
};

/** Vuelca la vista en la capa de render. Se llama al terminar cada animacion. */
export const renderLayer = (view: PlayerView) => ({
  pieces: piecesOf(view),
  revealed: view.revealed.slice(),
  detonated: view.detonated.slice(),
  craters: view.craters.slice(),
  adjacency: view.adjacency.slice(),
  blasts: [] as Square[],
  dying: [] as string[],
});

/**
 * Semilla del tablero del menu (AC-103). Fija a proposito: una al azar cambiaria el menu en
 * cada visita sin que nadie lo haya pedido, y dejaria el test sin nada que afirmar.
 *
 * Esta elegida comparando cinco: deja el bloque de niebla centrado y casi rectangular, con
 * el anillo de numeros alrededor. Otras lo desparraman hasta los bordes del tablero.
 */
const PREVIEW_SEED = 20260903;

/**
 * El tablero que abre el menu: la posicion inicial tal y como la deja el motor, con la
 * cascada de revelado ya corrida y la niebla puesta sobre las filas centrales.
 *
 * No es un dibujo. Sale de `createGame`, asi que el dia que cambien las piezas, el reparto de
 * minas o el tamano por defecto, el menu cambia con ellos y no hay una segunda copia que
 * mantener (AC-101).
 *
 * Y responde a la dificultad elegida (AC-106): subirla espesa la niebla, y eso se ve. Es el
 * tablero explicando lo que cambia, en vez de un porcentaje en una ayuda debajo de un boton.
 */
export function previewScene(difficulty: Difficulty = DEFAULT_DIFFICULTY): BoardScene {
  const state = createGame(configFor(difficulty, { seed: PREVIEW_SEED }));
  const view = toView(state, 'w');

  return {
    config: view.config,
    ...renderLayer(view),
    flags: new Array<boolean>(view.board.length).fill(false),
    targets: [],
    selected: null,
    lastMove: null,
    flipped: false,
  };
}
