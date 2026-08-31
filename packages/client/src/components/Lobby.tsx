import { useGame } from '../store.js';

/** Pantalla de espera mientras se crea la sala o llega el rival. */
export function Lobby() {
  const s = useGame();

  return (
    <div className="menu lobby">
      <h1>Sala online</h1>
      {s.error ? (
        <>
          <div className="panel error">{s.error}</div>
          <button className="primary" onClick={s.backToMenu}>
            Volver al menu
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            {s.online.connected ? 'Conectado al servidor.' : 'Conectando con el servidor…'}
          </p>
          {s.online.code && (
            <div className="panel room-code">
              <span className="label">Codigo de sala</span>
              <strong>{s.online.code}</strong>
              <small>Pasaselo a tu rival para que se una desde el menu.</small>
            </div>
          )}
          <button className="ghost" onClick={s.backToMenu}>
            Cancelar
          </button>
        </>
      )}
    </div>
  );
}
