# 003 — Partidas en red

Estado: **activo** · Núcleo: `@cm/engine/room` · Transportes: `@cm/worker` (produccion) y
`@cm/server` (LAN y desarrollo) · Tests: `packages/engine/tests/room.test.ts`,
`packages/server/tests/lan.test.ts` (integracion) y `packages/client/tests/connect.test.ts`

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

- **AC-606** El socket vigente de un asiento se localiza por su **sesion**, no por su color.
  `close()` es asincrono: un socket recien reemplazado sigue apareciendo en la lista con el
  mismo color, y mandarle a el la presencia dejaria al rival viendo "Esperando al rival".
- **AC-607** El limite de ritmo se cuenta **por conexion**. Contandolo por sala, pasarse uno
  desconectaria al rival, que es justo al que no hay que castigar.

## FR-7 · Origenes permitidos

Una sola decision, aplicada igual en los dos transportes (`@cm/engine/origin`).

- **AC-701** Sin cabecera `Origin` se acepta: no hay navegador al que suplantar.
- **AC-702** El mismo origen siempre vale.
- **AC-703** Con los dos extremos en local (loopback o rango privado) vale otro puerto. Es
  lo que hace posible el circuito de desarrollo: Vite en el 5173 contra el servidor en el 8787.
- **AC-704** Un origen publico no entra aunque el servidor sea local, ni disfrazandose de
  subdominio (`localhost.evil.com`). Un `Origin` que no es una URL se rechaza.
- **AC-705** Si se define `ALLOWED_ORIGINS`, manda esa lista y nada mas: ni el atajo local.

## FR-8 · El transporte tambien se prueba

Tests de integracion que levantan el servidor y hablan con el por WebSocket de verdad.

Existen porque el pegamento de transporte no tenia ni una linea cubierta, y por ahi se colo
que `handleUpgrade` con `noServer: true` no emite `'connection'`: el servidor sentaba al
jugador y despues descartaba todos sus mensajes en silencio. Compilaba y los tests pasaban.

- **AC-801** Un movimiento legal produce `moved`; uno ilegal, `error` y `sync`; un mensaje
  ilegible no tumba la conexion.
- **AC-802** Con dos jugadores, cada uno ve al otro presente y el movimiento le llega al rival.
- **AC-803** Al irse un jugador, el rival recibe el aviso.

## FR-9 · Los rechazos se explican

Un `socket.destroy()` a secas no deja al cliente ni un motivo: se queda en "Conectando...".

- **AC-901** Un codigo de sala inexistente abre el socket, manda `error` con el motivo y
  cierra con un codigo propio para que el cliente no reintente.
- **AC-902** Un origen ajeno se rechaza con 403 antes del apreton de manos.
- **AC-903** El circuito de desarrollo (Vite en otro puerto) si se acepta.
- **AC-904** Los parametros invalidos se rechazan con 400, tambien antes del apreton de manos.

## FR-10 · Politica de reconexion del cliente

- **AC-1001** Solo se reintenta una conexion que **llego a sentarse**. Si nunca se sento, el
  problema no es la red: reintentar un `create` fabricaria una sala huerfana por intento, y
  un `join` fallido acabaria entrando por `resume` a una partida anterior que no tiene nada
  que ver con la que se pidio.
- **AC-1002** Cuando ya no se va a reintentar y el servidor no explico nada, el cliente lo
  dice en vez de dejar un "Conectando..." eterno.
- **AC-1003** Un cierre pedido por la propia aplicacion no se anuncia como fallo: salir al
  menu es una decision del jugador, no un problema de red.
- **AC-1004** Si hay un asiento guardado, volver a esa partida se ofrece nada mas abrir el
  menu, sin tener que elegir antes el modo online. Estaba, pero enterrado bajo la opcion de
  crear una sala nueva: para encontrar como volver habia que empezar por irse.
- **AC-1005** Escribir el codigo de una sala en la que ya se tiene asiento reconecta a ese
  asiento en vez de responder que la sala esta completa. Es la via que la gente usa por su
  cuenta y tiene que funcionar.
  El orden no es negociable: se pide sitio como jugador nuevo **primero**, y solo si la sala
  rechaza se recurre a la credencial guardada. `localStorage` es del navegador y no de la
  pestana, asi que dos pestanas comparten un unico asiento guardado: yendo por `resume` de
  entrada, la segunda reclamaria el asiento de la primera y las dos jugarian con el mismo
  color. Tener token para una sala no significa que el sitio libre sea el nuestro.
  Si la credencial tampoco vale, se descarta y se muestra el rechazo.
- **AC-1003** El codigo de sala se valida y se normaliza al escribirlo, no al enviarlo: lo
  que se ve en la caja es lo que se manda.

AC-1001 a AC-1003 se comprueban a mano con las dos pestanas; viven en la capa de WebSocket
del navegador, no en logica que se pueda aislar.

## FR-11 - Abandonar una partida

Irse y perder la conexion no son lo mismo, y hasta ahora acababan en el mismo sitio: el
asiento quedaba ocupado, la partida colgada y el que se iba no podia volver ni ceder.

La regla separa los dos casos. Irse a proposito cuesta la partida; caerse no, pero tampoco
deja al rival esperando indefinidamente.

- **AC-1101** Salir al menu con una partida en curso pide confirmacion antes de nada.
- **AC-1102** Al confirmar, la partida termina con motivo `abandoned` y gana el rival.
- **AC-1103** Perder la conexion NO termina la partida: el asiento queda ausente y se
  recupera con `resume` conservando la posicion.
- **AC-1104** Una ausencia de mas de 2 minutos da la victoria al rival sin que este tenga
  que pedir nada. Cerrar la pestana no puede salir mas barato que rendirse.
- **AC-1105** Abandonar antes de que el rival se siente no da la victoria a nadie: el
  asiento queda libre y la sala vuelve a admitir a alguien.
- **AC-1106** Una partida ya terminada no se puede abandonar otra vez.
- **AC-1107** El final por abandono viaja en el mismo evento `end` que cualquier otro final,
  de modo que los dos transportes y el cliente no necesitan un camino aparte.
- **AC-1108** Al abandonar, el asiento queda libre. Quien se fue no sigue ocupando sitio en
  una partida que ya cedio, ni le impide volver a entrar por el codigo.
- **AC-1109** Mientras el rival esta ausente, el cliente muestra cuanto le queda antes de
  perder por abandono. Un plazo que corre en silencio obliga a elegir entre esperar sin
  saber cuanto o irse.
