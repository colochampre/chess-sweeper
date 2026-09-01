import { useGame } from '../store.js';

/**
 * Salir de una partida online en curso la cede: el rival gana por abandono. Es una accion
 * irreversible a un clic de distancia del tablero, asi que se pregunta antes.
 */
export function ConfirmLeave() {
  const s = useGame();
  if (!s.confirmingLeave) return null;

  return (
    <div className="game-over">
      <div className="card">
        <h2>Abandonar la partida</h2>
        <p>Si sales ahora, la partida termina y gana tu rival. No se puede deshacer.</p>
        <div className="row">
          <button className="primary" onClick={s.cancelLeave}>
            Seguir jugando
          </button>
          <button className="ghost" onClick={s.backToMenu}>
            Abandonar
          </button>
        </div>
      </div>
    </div>
  );
}
