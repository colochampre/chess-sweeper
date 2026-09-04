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
            {/* Buscando rival no se ensena codigo (AC-501 de 005): nadie tiene que copiar
                nada, y ensenarlo invitaria a compartirlo, que es la otra manera de jugar. */}
            {s.online.searching ? (
              <div className="panel room-code searching">
                <span className="label">Buscando rival</span>
                <strong>···</strong>
                <small>
                  Te sentamos con el primero que pida una partida como esta.
                </small>
              </div>
            ) : (
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
            )}
            {/* Cancelar vuelve al menu y quita la entrada de la cola en el mismo momento,
                no cuando caduque nada (AC-301 y AC-502 de 005). */}
            <button className="ghost" onClick={s.backToMenu}>
              {s.online.searching ? 'Dejar de buscar' : 'Cancelar'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
