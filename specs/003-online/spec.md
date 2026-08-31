# 003 — Partidas en red

Estado: **activo** · Núcleo: `@cm/engine/room` · Transportes: `@cm/worker` (produccion) y
`@cm/server` (LAN y desarrollo) · Tests: `packages/engine/tests/room.test.ts`

Servidor autoritativo. Guarda el `GameState` completo, con las minas, y a los clientes solo
les manda `PlayerView`.

La logica de sala vive en el motor y no toca Node ni el navegador: la comparten el Worker de
Cloudflare y el servidor de LAN, de modo que no existen dos copias de las reglas que puedan
desincronizarse. Cada transporte aporta solo su pegamento.

## FR-1 · Salas

- **AC-101** El codigo tiene 6 caracteres y evita los ambiguos (ni O, ni I, ni 0/1).
- **AC-102** El anfitrion ocupa el color que pidio; el segundo jugador, el que quede libre.
- **AC-103** Una sala llena rechaza a un tercero sin romper nada.
- **AC-104** Una sala sin nadie conectado durante mas de 10 minutos se puede descartar.

## FR-2 · Autoridad sobre las minas

- **AC-201** Ningun mensaje del servidor contiene el array `mines`.
- **AC-202** Cada movimiento se valida con el mismo `applyMove` del motor; uno ilegal deja el
  estado intacto.
- **AC-203** Un movimiento fuera de turno se rechaza.
- **AC-204** Cada jugador recibe su propia `PlayerView`.

## FR-3 · Reconexion

- **AC-301** Al sentarse, el jugador recibe un `token` de asiento.
- **AC-302** Con el codigo y el token correctos se recupera el asiento y se resincroniza.
- **AC-303** Un token que no corresponde se rechaza.
- **AC-304** Al cerrarse la conexion vigente, el rival ve al jugador como ausente.
- **AC-305** El cierre de una conexion **ya reemplazada** no marca ausencia. Cada vez que
  alguien se sienta se genera una sesion nueva; el cierre tardio de la anterior no cuenta.
  Sin esto, reconectarse o abrir una segunda pestana te deja invisible para tu rival.

## FR-4 · Servicio

- **AC-401** El servidor de LAN escucha en `0.0.0.0` para verse desde la red local.
- **AC-402** Si existe `packages/client/dist`, se sirve como estatico desde el mismo origen,
  tanto en el Worker como en el servidor de LAN. Un solo origen: sin CORS y sin configurar
  la direccion del servidor en el cliente.
- **AC-403** Un mensaje mal formado responde `error` sin tumbar el servicio.

## FR-5 · Parametros de conexion

A que sala se entra viaja en la URL del WebSocket, no como mensaje: el enrutado hacia el
Durable Object de la sala tiene que decidirse **antes** de aceptar el socket.

- **AC-501** `create`, `join` y `resume` sobreviven a la ida y vuelta por la query string.
- **AC-502** Se rechaza cualquier parametro que no cuadre: accion desconocida, dificultad
  inventada, tablero fuera de rango, codigo con caracteres fuera del alfabeto, token que no
  tiene forma de UUID. El codigo se normaliza antes de validarse.

## FR-6 · Produccion sobre Durable Objects

Una sala es un Durable Object, direccionado por su codigo (`idFromName(code)`).

- **AC-601** La partida sobrevive a un reinicio o redespliegue del servidor: el estado vive
  en el almacenamiento del objeto, no en la memoria del proceso.
- **AC-602** No hace falta coordinar instancias: solo existe un objeto por sala y todos sus
  mensajes pasan por el.
- **AC-603** Se rechaza un `Origin` ajeno al del propio servicio (o a `ALLOWED_ORIGINS`).
- **AC-604** Se descartan los mensajes por encima del tamano maximo y se corta a quien pasa
  del ritmo permitido.
- **AC-605** Una sala abandonada borra su almacenamiento mediante una alarma.

AC-601 a AC-605 se verifican contra `wrangler dev`, que ejecuta Durable Objects de verdad en
local; no hay test unitario porque dependen del runtime, no de la logica.
