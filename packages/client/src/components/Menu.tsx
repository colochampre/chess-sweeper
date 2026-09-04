import { useState } from 'react';
import {
  DEFAULT_CONFIG,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  mineRowRange,
  normalizeRoomCode,
  type Color,
  type Difficulty,
  type TimeControl,
} from '@cm/engine';
import { pieceSrc } from '../theme.js';
import { useGame } from '../store.js';
import { loadSeat } from '../online.js';
import { previewScene } from '../boardScene.js';
import { BoardView } from './BoardView.js';
import { TableView, openingSides } from './Table.js';
import {
  DEFAULT_BOT_LEVEL,
  DEFAULT_CLOCK_ON,
  DEFAULT_COLOR,
  DEFAULT_DIFFICULTY,
  DEFAULT_MODE,
  DEFAULT_TIME_CONTROL,
  DIFFICULTIES,
  MODES,
  TIME_OPTIONS,
} from '../menuOptions.js';

/** Las partidas normales se juegan en 8x8. Otros tamanos son del panel de balance (AC-303). */
const BOARD_SIZE = DEFAULT_CONFIG.files;

export function Menu() {
  const { startLocal, hostOnline, matchOnline, joinOnline, resumeOnline, error } = useGame();
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  const [botLevel, setBotLevel] = useState<Difficulty>(DEFAULT_BOT_LEVEL);
  const [color, setColor] = useState<Color | 'random'>(DEFAULT_COLOR);
  const [timeControl, setTimeControl] = useState<TimeControl>(DEFAULT_TIME_CONTROL);
  const [clockOn, setClockOn] = useState(DEFAULT_CLOCK_ON);
  const [joinCode, setJoinCode] = useState('');

  const savedSeat = loadSeat();
  // Al azar se dibuja con las blancas abajo: todavia no hay un lado que ensenar.
  const yourColor = color === 'random' ? 'w' : color;
  // El tablero del menu es el heroe y responde a lo que se elige: la dificultad espesa la
  // niebla (AC-106) y el color le da la vuelta (AC-708). La ayuda de las minas se lee de el,
  // para que no haya dos numeros que puedan discrepar.
  const scene = { ...previewScene(difficulty), flipped: yourColor === 'b' };
  // Las tiras estan tambien aqui, con el reloj elegido puesto: donde hay tablero, hay mesa.
  // Lo que se pide de verdad: el control elegido, o ninguno si el reloj esta apagado.
  const clock: TimeControl = clockOn ? timeControl : 'none';
  const sides = openingSides(clock, yourColor);
  const { start, end } = mineRowRange(scene.config);
  const mineRows = Math.max(0, end - start + 1);

  const pickColor = (): Color =>
    color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;

  const play = (mode: 'bot' | 'hotseat'): void =>
    startLocal({ mode, difficulty, botLevel, humanColor: pickColor(), boardSize: BOARD_SIZE });

  return (
    <div className="app-body">
      <div className="stage">
        <TableView {...sides}>
          <BoardView scene={scene} />
        </TableView>
        <p className="stage-caption">
          <strong>{scene.config.mineCount} minas</strong> escondidas en las {mineRows} filas
          del medio. La pieza que pise una se lleva por delante todo lo que tenga alrededor.
        </p>
      </div>

      <div className="rail">
        {error && <div className="panel error">{error}</div>}

        {/* AC-1004: se ofrece nada mas abrir el menu, arriba de todo y sin elegir nada
            antes. Estaba enterrado bajo la opcion de crear una sala nueva: para encontrar
            como volver habia que empezar por irse. */}
        {savedSeat && (
          <div className="panel resume">
            <span className="label">Tenes una partida sin terminar</span>
            <button className="primary" onClick={() => resumeOnline()}>
              Volver a mi partida
            </button>
            <small>
              Sala <code>{savedSeat.code}</code>. Volves con la posicion como la dejaste. Si
              tardas demasiado, gana tu rival por abandono.
            </small>
          </div>
        )}

        {/* Con una partida sin terminar, lo demas se apaga: volver a ella es lo unico que se
            puede hacer (AC-1007). Un `fieldset` deshabilitado apaga de una vez todo control
            que tenga dentro, asi que no hay una lista de botones que se pueda quedar corta
            el dia que se anada uno. */}
        <fieldset className="rest" disabled={savedSeat !== null}>
          {/* La casilla enciende el reloj entero y los botones eligen cual. "Sin reloj" era uno
              de los botones, y elegirlo borraba de paso el control que tenias puesto; asi,
              apagar y volver a encender lo recuerda (AC-401). */}
          <section className="field time">
            <label className="label toggle">
              <input
                type="checkbox"
                checked={clockOn}
                onChange={(e) => setClockOn(e.target.checked)}
              />
              Reloj
            </label>
            <div className="options">
              {TIME_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  className={`option${clockOn && timeControl === t.value ? ' active' : ''}`}
                  disabled={!clockOn}
                  onClick={() => setTimeControl(t.value)}
                >
                  <strong>{t.label}</strong>
                </button>
              ))}
            </div>
          </section>

          {/* Una sola primaria (AC-301 de 004), y ahora dice lo que hace de verdad: hay un
              rival del otro lado. Esto CORRIGE AC-304, que prohibia prometerlo — tenia razon
              cuando la unica accion era crear una sala y esperar a que alguien apareciese con
              un codigo (AC-503 de 005). */}
          <button
            className="start"
            onClick={() =>
              matchOnline({ difficulty, boardSize: BOARD_SIZE, hostColor: color, timeControl: clock })
            }
          >
            Empezar partida
          </button>
          <p className="hint start-hint">Te buscamos un rival.</p>

          <div className="alt">
            <button
              className="alt-action"
              onClick={() =>
                hostOnline({ difficulty, boardSize: BOARD_SIZE, hostColor: color, timeControl: clock })
              }
            >
              <strong>Jugar con un amigo</strong>
              <small>Te damos un codigo para pasarle</small>
            </button>

            {/* El propio control dice lo que pide, sin etiqueta aparte: el sitio donde se
                escribe el codigo es la explicacion (AC-305). El aria-label existe porque un
                placeholder NO es una etiqueta —se va al escribir y no se anuncia igual—, y
                ::placeholder lleva su propio estilo porque el del input esta pensado para que
                un codigo se lea como un codigo, no para una frase. */}
            <div className="join-row">
              <input
                placeholder="Entrar con un codigo"
                aria-label="Entrar con un codigo"
                value={joinCode}
                maxLength={ROOM_CODE_LENGTH}
                // AC-1006: se normaliza al escribir, no al enviar, asi lo que se ve en la
                // caja es exactamente lo que se va a mandar y el boton no miente.
                onChange={(e) => setJoinCode(normalizeRoomCode(e.target.value))}
                onKeyDown={(e) =>
                  e.key === 'Enter' && isValidRoomCode(joinCode) && joinOnline(joinCode)
                }
              />
              <button disabled={!isValidRoomCode(joinCode)} onClick={() => joinOnline(joinCode)}>
                Unirse
              </button>
            </div>

            {/* El boton ES el modo: no se elige uno y despues se pulsa otra cosa. */}
            {MODES.filter((m) => m.value !== DEFAULT_MODE).map((m) => (
              <button
                key={m.value}
                className="alt-action"
                onClick={() => play(m.value === 'bot' ? 'bot' : 'hotseat')}
              >
                <strong>{m.label}</strong>
                <small>{m.hint}</small>
              </button>
            ))}
          </div>

          {/* AC-302: abren plegadas y con su valor puesto. Se puede jugar sin abrirlas. */}
          <details className="tweaks">
            <summary>Opciones de partida</summary>

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
                  </button>
                ))}
              </div>
            </section>

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
          </details>
        </fieldset>
      </div>
    </div>
  );
}
