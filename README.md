# Chess Minesweeper

Ajedrez fusionado con Buscaminas. Ocho minas ocultas esperan en las cuatro filas centrales
del tablero: tus piezas van destapando casillas conforme avanzan, y la que pise una mina
vuela por los aires con todo lo que tenga alrededor, sea tuyo o del rival.

![estado](https://img.shields.io/badge/tests-79%20verdes-brightgreen)

## Como se juega

- **El tablero empieza medio destapado.** Cada pieza revela su casilla al empezar y la cascada
  del Buscaminas hace el resto, asi que ves las dos filas traseras de cada bando y asoman
  numeros en las filas 3 y 6. El centro es territorio desconocido.
- **Ajedrez normal.** Enroque, captura al paso, promocion, jaque y jaque mate. Las minas no
  cambian que movimientos son legales: son informacion oculta, no se puede prohibir una
  casilla por si acaso.
- **Una pieza detona la primera mina de su trayecto.** Una torre que cruza el centro puede
  morir a mitad de camino y no llegar nunca a su destino. El caballo salta por encima: solo
  arriesga donde aterriza.
- **La explosion arrasa un 3x3** y no distingue bandos. Si dentro hay otra mina, la cadena
  sigue. Se han visto cadenas de nueve.
- **Si tu rey vuela, pierdes en el acto.** Si vuelan los dos a la vez, tablas.
- **Clic derecho** para marcar una casilla con una bandera roja. Tus banderas son tuyas: el
  rival no las ve.
- **El numero de una casilla se ve aunque tenga una pieza encima**: se encoge a una esquina
  en lugar de esconderse. Saber cuantas minas rozan a tu propia torre importa.

## Arrancar

```bash
npm install
npm run dev          # cliente en http://localhost:5173
```

| Comando | Que hace |
|---|---|
| `npm run dev` | Cliente en modo desarrollo |
| `npm run build` | Compila el cliente en `packages/client/dist` |
| `npm run dev:server` | Servidor de partidas en LAN, en el puerto 8787 |
| `npm test` | Toda la bateria de tests |
| `npm run typecheck` | Comprobacion de tipos de todos los paquetes |
| `npm run balance` | Simulador de balance headless |

### Jugar en red local

```bash
npm run build        # el servidor sirve este build
npm run dev:server
```

El servidor escucha en `0.0.0.0:8787` y sirve el cliente compilado, asi que los demas entran
por `http://<tu-ip-local>:8787`. Uno crea la sala, comparte el codigo de 6 caracteres, y el
otro lo escribe en el menu. Si se cae la conexion, se recupera el asiento con el token que
guarda el navegador.

## Modos

- **Dos jugadores** en el mismo dispositivo. El tablero gira en cada turno.
- **Contra la maquina**, en tres niveles.
- **Online (LAN)** por WebSocket, con servidor autoritativo.

En todos, **el jugador siempre ve sus piezas en la parte de abajo**.

## Como esta hecho

Monorepo con workspaces de npm. La frontera que importa: `engine` es TypeScript puro, sin
DOM ni React, y es la unica fuente de verdad para el cliente, el servidor y el simulador.

```
packages/
  engine/   Reglas, minas, revelado, explosiones, protocolo de red. Cero dependencias.
  ai/       Bot: probabilidad de minas, evaluacion y busqueda negamax.
  client/   React + Vite. Tablero, animaciones y menus.
  server/   Node + ws. Salas de LAN; las minas solo existen aqui.
tools/
  balance/  Simulador bot contra bot que escupe metricas en CSV.
specs/      Requisitos y criterios de aceptacion (ver "Sobre los specs").
docs/       Notas de balance con datos reales.
```

### La interfaz no sabe las reglas

`applyMove` devuelve el estado nuevo **y una lista de eventos** en orden cronologico:

```ts
{ type: 'hop', pieceId, from, to }        // un salto por casilla recorrida
{ type: 'capture', pieceId, at }
{ type: 'explosion', center, cells, victims }
{ type: 'reveal', cells }
{ type: 'end', status, winner, reason }
```

El cliente se limita a reproducir esa lista: los saltitos con la Web Animations API (un arco
por casilla, sin librerias), la explosion como un fogonazo sobre el area y las bajas como un
fundido. El servidor retransmite exactamente los mismos eventos, asi que las partidas en red
se ven igual sin duplicar ni una regla.

El sonido cuelga de los mismos eventos y **esta sintetizado con la Web Audio API**: no hay
un solo archivo de audio en el repositorio. Un tic por saltito, el golpe de madera al
aterrizar, un impacto grave al capturar, un estallido con barrido de filtro al detonar y un
arpegio al terminar, ascendente o descendente segun como acabe. El recorrido entero se
programa de una vez con el reloj de audio, no encadenando temporizadores. Se apaga desde el
panel lateral y la preferencia se recuerda.

Girar el tablero es rotar el contenedor 180 grados y contrarrotar piezas, numeros e iconos.
Como el orden de las casillas en el DOM no cambia nunca, el navegador puede interpolar el
giro: el tablero da la vuelta alrededor de las piezas, que se quedan derechas.

### Nadie puede hacer trampa

El estado completo tiene un array `mines` que **nunca sale del motor**. Lo unico que sale es
`PlayerView`, que no lo incluye:

```ts
type PlayerView = Omit<GameState, 'mines' | 'flags'> & { as: Color; flags: boolean[] };
```

El cliente, el bot y el servidor trabajan sobre esa proyeccion. El bot no juega mejor porque
vea mas, sino porque busca mas hondo y deduce mejor. Esto vale tambien para las partidas
locales: el bot recibe el mismo `PlayerView` que tendria por la red.

Un detalle bonito que se cae de aqui: como la legalidad no depende de las minas, el cliente
puede calcular los movimientos legales el solo a partir de la vista, sin preguntar al servidor.

### El bot

- **Probabilidad de minas** a partir de los numeros revelados. En `facil` solo usa la
  probabilidad a priori; en `normal`, razones locales por cada numero; en `dificil` enumera
  todas las configuraciones consistentes de la frontera y saca la probabilidad exacta.
- **Riesgo por movimiento**: recorre el trayecto acumulando la probabilidad de que la primera
  mina este en cada casilla y valora el 3x3 que se llevaria por delante. Sale en centipeones,
  asi que entra directo en la busqueda. Puede salir **negativo**: si la explosion se lleva la
  dama rival y solo tu torre, el sacrificio compensa y el bot lo ve.
- **Busqueda** negamax con poda alfa-beta, ordenacion MVV-LVA y tope de nodos.

| Nivel | Profundidad | Modelo de minas | Ritmo |
|---|---|---|---|
| Facil | 1 | a priori, con ruido | ~1 ms |
| Normal | 3 | heuristico | ~14 ms |
| Dificil | 4 | exacto en la frontera | ~90 ms |

## Balance

Todo lo ajustable esta en `GameConfig`: tamano del tablero, numero de minas, filas minadas,
radio de explosion, cadena si o no, y si el trayecto revela. En la partida se abre el panel
de balance con la tecla **B**.

Para medir de verdad hay un simulador headless:

```bash
npm run balance -- --games 200 --difficulty normal --csv balance-results/normal.csv
```

Los resultados y las conclusiones estan en [`docs/balance.md`](docs/balance.md). En resumen,
con la densidad `normal` los colores quedan 50-50, algo mas de la mitad de las bajas vienen
de las minas y solo el 17% de las partidas se deciden con el rey por los aires.

## Sobre los specs

Se ha trabajado con specs primero. Cada feature tiene un `spec.md` con requisitos numerados
(FR-x) y criterios de aceptacion (AC-xxx), y **cada test cita en su nombre el criterio que
cubre**, asi que se lee de un vistazo que esta cubierto y que no:

- [`specs/001-core-rules/spec.md`](specs/001-core-rules/spec.md) — motor
- [`specs/002-ai/spec.md`](specs/002-ai/spec.md) — bot
- [`specs/003-online/spec.md`](specs/003-online/spec.md) — red

```bash
npm test -- --reporter=verbose   # los AC salen en los nombres
```

## Graficos

Las piezas son el set **cburnett** de Colin M.L. Burnett (GPL-2.0), el mismo que usa Lichess.
**No** son las de chess.com: ese set es propietario y no se puede redistribuir. Los colores
del tablero si imitan su paleta, que no es material protegible. La mina y la bandera roja
estan redibujadas al estilo del Buscaminas clasico, igual que la paleta de los numeros.

El set es intercambiable: mete los doce SVG en `packages/client/public/assets/pieces/<nombre>/`
y cambia `PIECE_SET` en `packages/client/src/theme.ts`. Detalles en
[`packages/client/public/assets/pieces/cburnett/LICENSE.md`](packages/client/public/assets/pieces/cburnett/LICENSE.md).

## Lo que falta

- El bot no tiene busqueda de quiescencia ni tabla de transposicion, y se le nota en los
  finales: mas de la mitad de las partidas bot contra bot acaban en tablas por la regla de
  50 jugadas.
- El online es para LAN: sin emparejamiento, sin reloj y sin persistencia entre reinicios
  del servidor.
