import { useGame } from '../store.js';
import { BoardView } from './BoardView.js';

/**
 * El tablero de la partida. Es el unico que habla con el store: arma la escena y se la pasa
 * a `BoardView`, que no sabe que existe un store (AC-202).
 */
export function Board() {
  const s = useGame();
  const view = s.view;
  if (view === null) return null;

  return (
    <BoardView
      scene={{
        config: view.config,
        pieces: s.pieces,
        revealed: s.revealed,
        adjacency: s.adjacency,
        detonated: s.detonated,
        craters: s.craters,
        flags: s.flags,
        blasts: s.blasts,
        dying: s.dying,
        targets: s.targets,
        selected: s.selected,
        lastMove: s.lastMove,
        flipped: s.orientation === 'b',
      }}
      onClickSquare={s.clickSquare}
      onRightClickSquare={s.rightClickSquare}
      animated
    />
  );
}
