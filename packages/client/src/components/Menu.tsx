import { useState } from 'react';
import { MINE_DENSITY, configFor, mineRowRange, type Color, type Difficulty } from '@cm/engine';
import { MINE_SRC, pieceSrc } from '../theme.js';
import { useGame, type Mode } from '../store.js';
import { loadSeat } from '../online.js';

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'hotseat', label: 'Dos jugadores', hint: 'Mismo dispositivo, el tablero gira en cada turno' },
  { value: 'bot', label: 'Contra la maquina', hint: 'Elige la fuerza del rival' },
  { value: 'online', label: 'Online (LAN)', hint: 'Crea una sala o entra con un codigo' },
];

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Facil' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Dificil' },
];

export function Menu() {
  const { startLocal, hostOnline, joinOnline, resumeOnline, error } = useGame();
  const [mode, setMode] = useState<Mode>('hotseat');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [botLevel, setBotLevel] = useState<Difficulty>('normal');
  const [color, setColor] = useState<Color | 'random'>('w');
  const [boardSize, setBoardSize] = useState(8);
  const [joinCode, setJoinCode] = useState('');

  const config = configFor(difficulty, { files: boardSize, ranks: boardSize, seed: 0 });
  const { start, end } = mineRowRange(config);
  const mineRows = Math.max(0, end - start + 1);
  const savedSeat = loadSeat();

  const pickColor = (): Color =>
    color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;

  return (
    <div className="menu">
      <header>
        <img src={MINE_SRC} alt="" className="logo" />
        <div>
          <h1>Chess Minesweeper</h1>
          <p>
            Ajedrez con minas ocultas en las cuatro filas centrales. Tus piezas van destapando el
            tablero; la que pise una mina se lleva por delante todo lo que tenga alrededor.
          </p>
        </div>
      </header>

      {error && <div className="panel error">{error}</div>}

      <section>
        <h2>Modo de juego</h2>
        <div className="options">
          {MODES.map((m) => (
            <button
              key={m.value}
              className={`option${mode === m.value ? ' active' : ''}`}
              onClick={() => setMode(m.value)}
            >
              <strong>{m.label}</strong>
              <small>{m.hint}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Cantidad de minas</h2>
        <div className="options row">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.value}
              className={`option${difficulty === d.value ? ' active' : ''}`}
              onClick={() => setDifficulty(d.value)}
            >
              <strong>{d.label}</strong>
              <small>{Math.round(MINE_DENSITY[d.value] * 100)}% de las casillas centrales</small>
            </button>
          ))}
        </div>
        <p className="hint">
          {config.mineCount} minas repartidas al azar en las {mineRows} filas centrales.
        </p>
      </section>

      {mode === 'bot' && (
        <section>
          <h2>Fuerza de la maquina</h2>
          <div className="options row">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                className={`option${botLevel === d.value ? ' active' : ''}`}
                onClick={() => setBotLevel(d.value)}
              >
                <strong>{d.label}</strong>
              </button>
            ))}
          </div>
        </section>
      )}

      {mode !== 'hotseat' && (
        <section>
          <h2>Tu color</h2>
          <div className="options row">
            {(['w', 'b', 'random'] as const).map((value) => (
              <button
                key={value}
                className={`option${color === value ? ' active' : ''}`}
                onClick={() => setColor(value)}
              >
                {value === 'random' ? (
                  <strong>Al azar</strong>
                ) : (
                  <img className="swatch" src={pieceSrc('k', value)} alt="" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Tamano del tablero</h2>
        <div className="slider-row">
          <input
            type="range"
            min={6}
            max={12}
            value={boardSize}
            onChange={(e) => setBoardSize(Number(e.target.value))}
          />
          <span>
            {boardSize}x{boardSize}
          </span>
        </div>
        <p className="hint">Para pruebas de balance. Las partidas normales se juegan en 8x8.</p>
      </section>

      {mode === 'online' ? (
        <section className="online-actions">
          <button
            className="primary"
            onClick={() => hostOnline({ difficulty, boardSize, hostColor: color })}
          >
            Crear sala
          </button>
          <div className="join-row">
            <input
              placeholder="Codigo de sala"
              value={joinCode}
              maxLength={6}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinCode && joinOnline(joinCode)}
            />
            <button disabled={joinCode.length < 6} onClick={() => joinOnline(joinCode)}>
              Unirse
            </button>
          </div>
          {savedSeat && (
            <button className="ghost" onClick={() => resumeOnline()}>
              Volver a mi partida ({savedSeat.code})
            </button>
          )}
          <p className="hint">
            El servidor se levanta con <code>npm run dev:server</code>. Los demas jugadores entran
            por la IP de tu equipo en la red local.
          </p>
        </section>
      ) : (
        <button
          className="primary"
          onClick={() =>
            startLocal({
              mode: mode === 'bot' ? 'bot' : 'hotseat',
              difficulty,
              botLevel,
              humanColor: pickColor(),
              boardSize,
            })
          }
        >
          Jugar
        </button>
      )}
    </div>
  );
}
