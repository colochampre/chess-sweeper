import type { Square } from '@cm/engine';
import { cellTransform, displayOrder, isLightSquare, toCell } from '../coords.js';
import { registerPiece } from '../anim/pieceRefs.js';
import { FLAG_SRC, MINE_SRC, NUMBER_COLORS, pieceSrc } from '../theme.js';
import type { BoardScene } from '../boardScene.js';

export interface BoardViewProps {
  scene: BoardScene;
  onClickSquare?: (sq: Square) => void;
  onRightClickSquare?: (sq: Square) => void;
  /**
   * Registra las piezas en el reproductor de animaciones. Solo lo hace la partida viva: el
   * registro es global y por `id`, asi que dos tableros a la vez se pisarian las
   * referencias y las animaciones acabarian moviendo las piezas del otro (AC-105).
   */
  animated?: boolean;
}

/**
 * Dibuja un tablero. No sabe que es una partida: recibe la escena y la convierte en pixeles.
 *
 * Vive aparte de `Board` porque el menu tambien tiene que poder dibujar uno, y `Board` leia
 * del store y devolvia `null` sin partida en curso (AC-201).
 */
export function BoardView({
  scene,
  onClickSquare,
  onRightClickSquare,
  animated = false,
}: BoardViewProps) {
  const c = scene.config;
  // Siempre se dibuja con la fila 1 abajo; girar el tablero es cosa del CSS.
  const order = displayOrder(c);
  const blasts = new Set(scene.blasts);
  const targets = new Set(scene.targets);
  // Ocupacion segun lo que se ve ahora, no segun el estado final del motor.
  const occupied = new Set(scene.pieces.map((p) => p.sq));
  const interactive = onClickSquare !== undefined || onRightClickSquare !== undefined;

  const label = (sq: Square): { file?: string; rank?: string } => {
    const cell = toCell(sq, c);
    return {
      file: cell.row === c.ranks - 1 ? String.fromCharCode(97 + (sq % c.files)) : undefined,
      rank: cell.col === 0 ? String(Math.floor(sq / c.files) + 1) : undefined,
    };
  };

  return (
    <div
      className={`board${scene.flipped ? ' flipped' : ''}${interactive ? '' : ' static'}`}
      style={{ ['--files' as string]: c.files, ['--ranks' as string]: c.ranks }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="cells">
        {order.map((sq) => {
          const revealed = scene.revealed[sq];
          const n = scene.adjacency[sq];
          const hasPiece = occupied.has(sq);
          const { file, rank } = label(sq);
          return (
            <div
              key={sq}
              className={[
                'cell',
                isLightSquare(sq, c) ? 'light' : 'dark',
                scene.detonated[sq] ? 'burnt' : '',
                scene.lastMove && (scene.lastMove.from === sq || scene.lastMove.to === sq)
                  ? 'last'
                  : '',
                scene.selected === sq ? 'selected' : '',
                blasts.has(sq) ? 'blast' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onClickSquare?.(sq)}
              onContextMenu={(e) => {
                e.preventDefault();
                onRightClickSquare?.(sq);
              }}
            >
              {/* Con pieza encima el numero se encoge a una esquina en vez de esconderse:
                  saber cuantas minas tocan la casilla de tu propia pieza es informacion util. */}
              {revealed && n > 0 && (
                <span
                  className={hasPiece ? 'number badge' : 'number'}
                  style={{ color: NUMBER_COLORS[n] }}
                >
                  {n}
                </span>
              )}
              {scene.craters[sq] && <img className="mine" src={MINE_SRC} alt="mina" />}
              {!revealed && <div className="fog" />}
              {!revealed && scene.flags[sq] && <img className="flag" src={FLAG_SRC} alt="bandera" />}
              {targets.has(sq) && <div className={hasPiece ? 'target-ring' : 'target-dot'} />}
              {file && <span className="coord file">{file}</span>}
              {rank && <span className="coord rank">{rank}</span>}
            </div>
          );
        })}
      </div>

      <div className="pieces">
        {scene.pieces.map((p) => (
          <div
            key={p.id}
            ref={animated ? (el) => registerPiece(p.id, el) : undefined}
            className={`piece${scene.dying.includes(p.id) ? ' dying' : ''}`}
            style={{ transform: cellTransform(toCell(p.sq, c)) }}
          >
            <img src={pieceSrc(p.type, p.color)} alt={`${p.color}${p.type}`} draggable={false} />
          </div>
        ))}
      </div>

      <div className="blast-layer">
        {scene.blasts.map((sq) => (
          <div
            key={sq}
            className="blast-cell"
            style={{ transform: cellTransform(toCell(sq, c)) }}
          />
        ))}
      </div>
    </div>
  );
}
