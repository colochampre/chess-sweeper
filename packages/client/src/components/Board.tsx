import type { Square } from '@cm/engine';
import { cellTransform, displayOrder, isLightSquare, toCell } from '../coords.js';
import { registerPiece } from '../anim/pieceRefs.js';
import { FLAG_SRC, MINE_SRC, NUMBER_COLORS, pieceSrc } from '../theme.js';
import { useGame } from '../store.js';

export function Board() {
  const s = useGame();
  const view = s.view;
  if (view === null) return null;

  const c = view.config;
  const order = displayOrder(c, s.orientation);
  const blasts = new Set(s.blasts);
  const targets = new Set(s.targets);
  // Ocupacion segun lo que se ve ahora, no segun el estado final del motor.
  const occupied = new Set(s.pieces.map((p) => p.sq));

  const label = (sq: Square): { file?: string; rank?: string } => {
    const cell = toCell(sq, c, s.orientation);
    return {
      file: cell.row === c.ranks - 1 ? String.fromCharCode(97 + (sq % c.files)) : undefined,
      rank: cell.col === 0 ? String(Math.floor(sq / c.files) + 1) : undefined,
    };
  };

  return (
    <div
      className="board"
      style={{ ['--files' as string]: c.files, ['--ranks' as string]: c.ranks }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="cells">
        {order.map((sq) => {
          const revealed = s.revealed[sq];
          const n = s.adjacency[sq];
          const { file, rank } = label(sq);
          return (
            <div
              key={sq}
              className={[
                'cell',
                isLightSquare(sq, c) ? 'light' : 'dark',
                s.detonated[sq] ? 'burnt' : '',
                s.lastMove && (s.lastMove.from === sq || s.lastMove.to === sq) ? 'last' : '',
                s.selected === sq ? 'selected' : '',
                blasts.has(sq) ? 'blast' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => s.clickSquare(sq)}
              onContextMenu={(e) => {
                e.preventDefault();
                s.rightClickSquare(sq);
              }}
            >
              {/* Con pieza encima el numero se encoge a una esquina en vez de esconderse:
                  saber cuantas minas tocan la casilla de tu propia pieza es informacion util. */}
              {revealed && n > 0 && (
                <span
                  className={occupied.has(sq) ? 'number badge' : 'number'}
                  style={{ color: NUMBER_COLORS[n] }}
                >
                  {n}
                </span>
              )}
              {s.craters[sq] && <img className="mine" src={MINE_SRC} alt="mina" />}
              {!revealed && <div className="fog" />}
              {!revealed && s.flags[sq] && <img className="flag" src={FLAG_SRC} alt="bandera" />}
              {targets.has(sq) && (
                <div className={occupied.has(sq) ? 'target-ring' : 'target-dot'} />
              )}
              {file && <span className="coord file">{file}</span>}
              {rank && <span className="coord rank">{rank}</span>}
            </div>
          );
        })}
      </div>

      <div className="pieces">
        {s.pieces.map((p) => (
          <div
            key={p.id}
            ref={(el) => registerPiece(p.id, el)}
            className={`piece${s.dying.includes(p.id) ? ' dying' : ''}`}
            style={{ transform: cellTransform(toCell(p.sq, c, s.orientation)) }}
          >
            <img src={pieceSrc(p.type, p.color)} alt={`${p.color}${p.type}`} draggable={false} />
          </div>
        ))}
      </div>

      <div className="blast-layer">
        {s.blasts.map((sq) => (
          <div
            key={sq}
            className="blast-cell"
            style={{ transform: cellTransform(toCell(sq, c, s.orientation)) }}
          />
        ))}
      </div>
    </div>
  );
}
