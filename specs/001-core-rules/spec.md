# 001 — Reglas base del motor

Estado: **activo** · Paquete: `@cm/engine` · Tests: `packages/engine/tests/*.test.ts`

El motor es TS puro y headless: no importa DOM, React ni nada del navegador. Es la única
fuente de verdad para el cliente, el servidor online y el simulador de balance. No anima
nada: `applyMove` devuelve el nuevo estado más una lista ordenada de `GameEvent` que la
capa visual reproduce.

Cada criterio de aceptación (AC-xxx) tiene al menos un test que lo cita por id en su nombre.

---

## FR-1 · Tablero y configuración

El tablero es de `files` x `ranks`, por defecto 8x8, y el tamaño es configurable para
pruebas de balance. Las casillas se indexan `sq = rank * files + file`, con `rank = 0` en
la primera fila de las blancas.

- **AC-101** Un tablero 8x8 recién creado tiene 32 piezas en la disposición inicial estándar.
- **AC-102** `createGame` acepta tamaños distintos de 8x8 sin lanzar, y coloca las piezas
  menores desde los extremos hacia el centro cuando `files != 8`.
- **AC-103** Dos partidas creadas con la misma `seed` y la misma config son idénticas
  (mismo campo de minas, mismo revelado inicial).

## FR-2 · Campo de minas

Las minas se colocan aleatoriamente y **solo** en las `mineRows` filas centrales del
tablero (4 por defecto: filas 3-6 en un 8x8). `mineCount` sale de una densidad por
dificultad aplicada al número de casillas centrales.

- **AC-201** Ninguna mina cae fuera de las `mineRows` filas centrales.
- **AC-202** El número de minas colocadas es exactamente `mineCount`, sin repeticiones.
- **AC-203** Si `mineCount` excede las casillas centrales disponibles, se recorta a ese máximo.
- **AC-204** Presets: fácil 0.16, normal 0.25, difícil 0.36 de densidad → 5 / 8 / 12 minas en 8x8.

## FR-3 · Revelado estilo Buscaminas

`adjacency[sq]` es el número de minas en las 8 vecinas. Revelar una casilla con
`adjacency === 0` revela en cascada a sus vecinas, y así recursivamente. El estado
`revealed` es **compartido** por ambos jugadores.

- **AC-301** La cascada nunca revela una casilla que contiene una mina.
- **AC-302** Al crear la partida se revela desde cada casilla ocupada, dejando las dos filas
  traseras de cada bando completamente visibles.
- **AC-303** Una casilla con `adjacency > 0` se revela pero no propaga la cascada.
- **AC-304** Aterrizar en una casilla ya revelada no cambia el conjunto de reveladas.

## FR-4 · Movimiento y trayecto

La legalidad es la del ajedrez estándar (enroque, captura al paso, promoción, prohibido
dejar el rey propio en jaque) y **se calcula ignorando las minas**: son información oculta,
así que ninguna casilla es ilegal por poder explotar.

El trayecto son las casillas desde el origen (excluido) hasta el destino (incluido).

- **AC-401** El trayecto de una pieza deslizante incluye todas las casillas intermedias en orden.
- **AC-402** El trayecto de un caballo es solo la casilla de destino (salta por encima).
- **AC-403** El avance doble de peón incluye la casilla intermedia en el trayecto.
- **AC-404** El enroque recorre primero el camino del rey y después el de la torre.
- **AC-405** La generación de movimientos legales cubre enroque, captura al paso y promoción.

## FR-5 · Detonación

Una pieza detona la **primera** mina que encuentra en su trayecto: muere en esa casilla, no
completa el movimiento y no captura nada en el destino. El turno pasa igual al rival.

- **AC-501** Una torre que cruza una mina muere en la casilla de la mina, no llega al destino
  y la pieza que hubiera capturado sigue en el tablero.
- **AC-502** Un caballo cuya casilla intermedia "sobrevolada" tiene mina no la detona; solo
  detona si la mina está en su destino.
- **AC-503** La pieza que detona siempre muere (está en el centro del área de explosión).
- **AC-504** Con `revealOnTransit: true` las casillas del trayecto se revelan; con `false`,
  solo la de aterrizaje.
- **AC-505** Revelar el trayecto es el **defecto**. Una pieza que cruza cuatro casillas
  destapa las cuatro: ya paga el riesgo de pisarlas —detona la primera mina que encuentre
  (AC-501)—, asi que no hay razon para que no vea lo que piso. El caballo queda fuera porque
  su trayecto es solo el destino (AC-402): no pisa lo que sobrevuela, ni para detonar ni para
  destapar.
  Esto cambia el juego y no la presentacion. Las piezas deslizantes barren el tablero al
  moverse, la informacion se abre mucho mas rapido y una torre pasa a valer mas de lo que
  valia; `tools/balance` mide otra cosa a partir de aqui. Lo que se cambia es el defecto, no
  la regla: la regla ya estaba escrita y probada, apagada.

## FR-6 · Explosión y reacción en cadena

Una detonación afecta al área `(2r+1)^2` centrada en la mina (`explosionRadius: 1` → 3x3).
Destruye **todas** las piezas del área, propias y rivales. Toda mina dentro del área detona
también, en cadena (BFS), si `chainExplosions` está activo.

- **AC-601** La explosión destruye piezas de ambos colores dentro del área.
- **AC-602** Dos minas adyacentes producen una única cadena que cubre la unión de sus áreas.
- **AC-603** Con `chainExplosions: false` solo detona la mina pisada.
- **AC-604** Las casillas del área quedan marcadas como `detonated` y `revealed`.
- **AC-605** Tras la cadena se recalcula `adjacency` y se relanzan las cascadas desde las
  casillas reveladas que hayan quedado en 0.
- **AC-606** Una cadena termina siempre (ninguna mina detona dos veces).

## FR-7 · Fin de partida

Jaque mate clásico, más muerte instantánea por explosión del rey.

- **AC-701** Si el rey de un bando es destruido por una explosión, gana el rival de inmediato
  (`status: 'king-destroyed'`).
- **AC-702** Si ambos reyes mueren en la misma cadena, la partida son tablas.
- **AC-703** El jaque mate estándar termina la partida con `status: 'checkmate'`.
- **AC-704** El rey ahogado da `status: 'stalemate'` y `winner: null`.
- **AC-705** Con `kingImmuneToMines: true` el rey sobrevive a las explosiones.
- **AC-706** Ningún movimiento es aceptado una vez la partida ha terminado.

## FR-8 · Eventos

`applyMove` devuelve `{ state, events }`. Los eventos van en orden cronológico y bastan para
reconstruir la animación sin consultar el estado interno.

- **AC-801** Un movimiento simple emite un `hop` por cada casilla del trayecto.
- **AC-802** Una captura emite `capture` inmediatamente despues del `hop` de aterrizaje.
- **AC-803** Una cadena emite un `explosion` por cada mina detonada, en orden de detonación.
- **AC-804** El último evento de una partida terminada es `end`.

## FR-9 · Información oculta

`toView(state, color)` produce la única proyección que salen del motor hacia cliente y bot.

- **AC-901** `PlayerView` no contiene el array `mines` bajo ninguna clave.
- **AC-902** `PlayerView` solo incluye las banderas del color solicitado.
- **AC-903** Una casilla con mina ya detonada sí aparece en la vista (como `detonated`).

---

## Fuera de alcance de este spec

Bot (→ `specs/002-ai`), red (→ `specs/003-online`), render y animación (cliente).
