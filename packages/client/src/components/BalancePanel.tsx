import { useEffect, useState } from 'react';
import { centralSquareCount } from '@cm/engine';
import { useGame } from '../store.js';

/**
 * Panel de pruebas de balance. Cada cambio reinicia la partida con la configuracion
 * indicada, para poder comparar densidades de minas, radios y reglas de trayecto.
 * Atajo: tecla B.
 */
export function BalancePanel() {
  const s = useGame();
  const view = s.view;
  const [seedInput, setSeedInput] = useState(String(s.seed ?? 0));

  useEffect(() => setSeedInput(String(s.seed ?? 0)), [s.seed]);

  if (view === null || !s.showBalance) return null;
  const c = view.config;
  const maxMines = centralSquareCount(c);

  return (
    <div className="panel balance">
      <h3>Panel de balance</h3>

      <label>
        Tamano del tablero: {c.files}x{c.ranks}
        <input
          type="range"
          min={6}
          max={12}
          value={c.files}
          onChange={(e) => {
            const size = Number(e.target.value);
            s.restart({ files: size, ranks: size });
          }}
        />
      </label>

      <label>
        Minas: {c.mineCount} de {maxMines} ({Math.round((c.mineCount / maxMines) * 100)}%)
        <input
          type="range"
          min={0}
          max={maxMines}
          value={c.mineCount}
          onChange={(e) => s.restart({ mineCount: Number(e.target.value) })}
        />
      </label>

      <label>
        Filas con minas: {c.mineRows}
        <input
          type="range"
          min={0}
          max={Math.max(0, c.ranks - 4)}
          value={c.mineRows}
          onChange={(e) => s.restart({ mineRows: Number(e.target.value) })}
        />
      </label>

      <label>
        Radio de explosion: {c.explosionRadius} ({c.explosionRadius * 2 + 1}x
        {c.explosionRadius * 2 + 1})
        <input
          type="range"
          min={0}
          max={3}
          value={c.explosionRadius}
          onChange={(e) => s.restart({ explosionRadius: Number(e.target.value) })}
        />
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={c.chainExplosions}
          onChange={(e) => s.restart({ chainExplosions: e.target.checked })}
        />
        Explosiones en cadena
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={c.revealOnTransit}
          onChange={(e) => s.restart({ revealOnTransit: e.target.checked })}
        />
        Revelar casillas de paso
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={c.kingImmuneToMines}
          onChange={(e) => s.restart({ kingImmuneToMines: e.target.checked })}
        />
        Rey inmune a las minas
      </label>

      <label>
        Semilla
        <div className="seed-row">
          <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} />
          <button onClick={() => s.restart(undefined, Number(seedInput) || 0)}>Aplicar</button>
        </div>
      </label>

      <p className="hint">
        Para medir de verdad, usa el simulador headless: <code>npm run balance</code>.
      </p>
    </div>
  );
}
