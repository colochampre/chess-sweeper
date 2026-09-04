import { useGame } from '../store.js';
import { previewScene } from '../boardScene.js';
import { BoardView } from './BoardView.js';
import { TableView, openingSides } from './Table.js';

/**
 * Espera mientras se crea la sala o llega el rival. Comparte el armazon del menu y de la
 * partida: mismo tablero a la izquierda, mismo riel a la derecha. Lo unico que cambia es lo
 * que dice el riel, que es lo unico que de verdad cambia.
 */
export function Lobby() {
  const s = useGame();
  const scene = previewScene(s.difficulty);
  const sides = openingSides(s.timeControl, s.humanColor);

  return (
    <div className="app-body">
      <div className="stage">
        <TableView {...sides}>
          <BoardView scene={scene} />
        </TableView>
        <p className="stage-caption">
          Las minas se reparten al crear la sala. Ni vos ni tu rival sabeis donde estan.
        </p>
      </div>

      <div className="rail">
        {s.error ? (
          <>
            <div className="panel error">{s.error}</div>
            <button className="primary" onClick={s.backToMenu}>
              Volver al menu
            </button>
          </>
        ) : (
          <>
            <div className="panel room-code">
              <span className="label">Codigo de sala</span>
              <strong>{s.online.code ?? '······'}</strong>
              <small>
                {s.online.code
                  ? 'Pasaselo a tu rival para que se una desde el menu.'
                  : s.online.connected
                    ? 'Conectado. Pidiendo la sala…'
                    : 'Conectando con el servidor…'}
              </small>
            </div>
            <button className="ghost" onClick={s.backToMenu}>
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
