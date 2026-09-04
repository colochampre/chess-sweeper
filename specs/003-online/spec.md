# 003 — Partidas en red

Estado: **activo** · Núcleo: `@cm/engine/room` · Transportes: `@cm/worker` (produccion) y
`@cm/server` (LAN y desarrollo) · Tests: `packages/engine/tests/room.test.ts`,
`packages/server/tests/lan.test.ts` (integracion), `packages/client/tests/connect.test.ts`,
`packages/client/tests/draw.test.ts`, `packages/client/tests/clock.test.ts`,
`packages/engine/tests/clock.test.ts` y `packages/engine/tests/protocol.test.ts`

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
- **AC-503** La version del protocolo viaja tambien en la URL, y el servidor solo acepta la
  suya. `PROTOCOL_VERSION` existia como numero que nadie miraba: documentaba el formato del
  cable sin protegerlo, asi que un cliente viejo contra un servidor nuevo no se rechazaba, se
  rompia raro. Una pestana abierta desde antes de un despliegue es el caso normal, no el
  raro. Sin version tampoco se entra: un cliente que no la manda es, justamente, uno viejo.
- **AC-504** Cambiar la forma de lo que viaja por el cable sin subir la version rompe la
  suite. AC-503 solo sirve si la version se sube cuando toca, y "acordarse" no es un
  mecanismo: es la clase de obligacion que se cumple tres veces y despues no. Se guarda una
  huella de las declaraciones de `ClientMessage`, `ServerMessage` y `ConnectIntent`, con todo
  lo que arrastran, junto a la version que le corresponde. La huella se calcula del codigo,
  no de una lista escrita a mano, para que un tipo nuevo entre solo.
  La huella recorre TODO el motor y no una lista de ficheros. La lista existio y tenia un
  agujero: `TimeControl` vive en `clock.ts` y viaja dentro de `ConnectIntent`, pero el
  recorrido solo miraba `protocol.ts` y `types.ts`, asi que lo daba por un tipo de TypeScript
  y lo saltaba. Se le anadio un valor al conjunto cerrado, cambio lo que viaja por el cable, y
  la huella no dijo nada. Una lista escrita a mano es la misma promesa un nivel mas abajo que
  la que este criterio vino a sustituir; leyendo el directorio entero no hay donde esconderse,
  y lo que no viaja sigue sin entrar porque el recorrido sale de las tres raices.
  El historial se guarda por version y no como una unica huella al dia: asi, al cambiar los
  mensajes, la unica salida honesta es anadir una entrada nueva. Pisar la de la version
  vigente tambien compila, pero deja de ser un despiste y pasa a ser una linea muy visible en
  el diff, que es justo lo que se busca.

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
- **AC-905** Una version de protocolo que no coincide abre el socket, manda `error` diciendo
  que hay que recargar y cierra con `CLOSE_REFUSED`, igual que AC-901.
  Este no se rechaza antes del apreton de manos, y es a proposito: el navegador no le deja
  leer al cliente ni el codigo ni el motivo de un upgrade fallido, asi que un 426 seria
  correcto de libro y dejaria al jugador exactamente igual que el `socket.destroy()` a secas
  que abre este FR. Aqui hace falta que el motivo llegue, porque el arreglo lo tiene que
  hacer el jugador: recargar. Antes del apreton de manos se rechaza lo que el jugador no
  puede arreglar (AC-902, AC-904); despues, lo que si.

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
- **AC-1006** El codigo de sala se valida y se normaliza al escribirlo, no al enviarlo: lo
  que se ve en la caja es lo que se manda.
- **AC-1007** Con un asiento guardado, el menu no deja empezar otra partida. Volver a la que
  esta a medias es lo unico que se puede hacer: crear una sala, emparejarse o entrar con un
  codigo mientras tanto seria dejar tirada una partida en la que hay alguien esperando, y
  perderla por abandono sin haberlo decidido (AC-1104).
- **AC-1008** El asiento guardado se descarta en cuanto se sabe que la partida termino, venga
  ese final del evento `end`, de un `sync` o de volver a una sala que ya acabo.
  Antes solo se borraba al salir al menu a proposito o cuando el servidor rechazaba la
  credencial, asi que una partida que terminaba SIN el jugador delante —por ausencia (AC-1104)
  o por tiempo (AC-1405)— le dejaba el asiento guardado para siempre: el menu seguia
  ofreciendole volver a una partida que ya habia perdido, y con AC-1007 eso ademas le bloquea
  el resto del menu.
  Borrarlo no estorba a la revancha: al acordarse, el servidor vuelve a mandar `seated`
  (AC-1201) y la credencial se guarda otra vez.

AC-1001 a AC-1003, AC-1007 y AC-1008 se comprueban a mano con dos VENTANAS, no con dos
pestanas: viven en la capa de WebSocket del navegador y no en logica que se pueda aislar.
Dos pestanas no sirven por lo que dice AC-1005 unas lineas mas arriba —`localStorage` es del
navegador y no de la pestana, asi que las dos comparten un unico asiento guardado—, con lo
cual la segunda reclama el asiento de la primera y acabas jugando contra vos mismo con el
mismo color. Este mismo texto decia "pestanas" y mandaba hacer la prueba de la manera que el
propio spec documenta como rota.

## FR-11 - Abandonar una partida

Irse y perder la conexion no son lo mismo, y hasta ahora acababan en el mismo sitio: el
asiento quedaba ocupado, la partida colgada y el que se iba no podia volver ni ceder.

La regla separa los dos casos. Irse a proposito cuesta la partida; caerse no, pero tampoco
deja al rival esperando indefinidamente.

- **AC-1101** Salir al menu con una partida en curso pide confirmacion antes de nada.
- **AC-1102** Al confirmar, la partida termina con motivo `abandoned` y gana el rival.
- **AC-1103** Perder la conexion NO termina la partida: el asiento queda ausente y se
  recupera con `resume` conservando la posicion.
- **AC-1104** Cada jugador dispone de 2 minutos de ausencia POR PARTIDA. Se gastan en tiempo
  real mientras no esta, lo que sobra queda para la proxima vez, y al agotarse gana el rival
  sin que tenga que pedir nada. Cerrar la pestana no puede salir mas barato que rendirse.
  El presupuesto es por partida y no por desconexion. Dando 2 minutos frescos cada vez, con
  reloj (FR-14) bastaria con desenchufarse en cada jugada dificil para pensarla gratis, ya
  que la ausencia para el reloj (AC-1408). Y sin reloj, permitiria estirar una partida
  indefinidamente a base de reconectar. La misma regla sirve para los dos casos.
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

## FR-12 - La revancha se acuerda

Reiniciar la partida era unilateral: el primer mensaje que llegaba la reiniciaba, sin
preguntarle al otro. Y como el boton estaba tambien en el HUD, se podia reiniciar la partida
del rival en mitad del juego.

Una revancha es un acuerdo entre dos, no una accion de uno.

- **AC-1201** La revancha necesita que la pidan los dos. Con una sola peticion la partida no
  se reinicia.
- **AC-1202** Pedirla se le comunica al rival, y quien la pidio ve que esta esperando. Un
  boton que no responde no se distingue de uno roto.
- **AC-1203** No se puede pedir con la partida en curso: la revancha es lo que se ofrece al
  final, no un boton de reinicio.
- **AC-1204** No se puede pedir si el rival ya no esta sentado: no hay con quien acordar.
- **AC-1205** Al empezar la revancha las peticiones se olvidan. La siguiente hay que volver a
  pedirla.
- **AC-1206** Ausentarse retira la peticion, para que una revancha no arranque con alguien
  que ya no esta delante.

## FR-13 - Ofrecer tablas

La revancha (FR-12) se acuerda con la partida terminada. Las tablas se acuerdan en mitad de
ella, y eso invierte las guardas: `requestRematch` rechaza si la partida sigue en curso, y
ofrecer tablas rechaza justo al reves.

Se sigue la regla FIDE (Art. 9.1.2): la oferta no se puede retirar y sigue en pie hasta que
el rival la conteste, siendo mover una de las respuestas posibles.

- **AC-1301** Las tablas necesitan que las quieran los dos. Con una sola oferta la partida
  sigue.
- **AC-1302** Ofrecer se le comunica al rival, y quien ofrece ve que esta esperando. Un boton
  que no responde no se distingue de uno roto.
- **AC-1303** Solo se puede ofrecer con la partida en curso: es lo contrario de la revancha,
  que es lo que se ofrece al final.
- **AC-1304** No se puede ofrecer si el rival no esta sentado: no hay con quien acordar.
- **AC-1305** Rechazar retira la oferta y se le comunica a quien ofrecio. Un "no" tiene que
  llegar: si no, no se distingue de un silencio.
  Aceptar lo que ofrece el rival no se limita nunca: la espera de AC-1308 es para no acosar
  con ofertas, no para impedir estar de acuerdo. Con las mismas guardas, quien acabara de
  recibir un "no" no podria decir que si al de enfrente, que es justo el momento en que los
  dos ya se pusieron de acuerdo.
- **AC-1306** La oferta sigue en pie hasta que el rival la conteste, y mover es una de las
  respuestas: si el rival mueve, ha rechazado. La posicion no caduca la oferta, la contesta.
  El acuerdo viaja en CADA movimiento, no solo al ofrecer: mover contesta a la oferta del
  rival y desbloquea la propia, asi que los dos tienen que verlo. Apagarla solo en el motor
  deja los botones de aceptar y rechazar puestos, y entonces "aceptar" despues de mover
  vuelve a ofrecer tablas sin que nadie lo haya pedido.
- **AC-1307** La oferta no se puede retirar. Quien ofrece tablas se atiene a que se las
  acepten. Ademas de ser la regla FIDE, evita que la retirada se convierta en una palanca
  de tiempo el dia que exista un reloj: ofrecer, dejar que el rival lo piense con su reloj
  corriendo, y retirarla.
- **AC-1308** No se puede ofrecer mientras la propia sigue en pie, ni volver a ofrecer tras
  un rechazo hasta 5 jugadas despues. Esperar solo a la jugada siguiente no alcanza: deja
  ofrecer una vez por jugada, que es acoso con permiso. La espera se mide en jugadas y no en
  un cupo por partida porque asi se adapta sola a lo que dure: en una partida corta salen
  pocas oportunidades y en una larga, mas. Un cupo fijo seria tacaneria en unas y spam en
  otras, y anadiria un juego de administrar propuestas que no es el ajedrez.
- **AC-1314** Mientras haya que esperar, el boton dice cuantas jugadas faltan. Un boton que
  se apaga sin explicarse no se distingue de uno roto, que es lo mismo que dice AC-1302.
- **AC-1309** Ausentarse retira la oferta propia. Si no, quien esta a punto de perder por
  ausencia (AC-1104) se llevaria unas tablas de una partida que ya estaba cediendo.
- **AC-1310** Al aceptar, la partida termina con estado `draw`, sin ganador y con motivo
  `agreed-draw`, en el mismo evento `end` que cualquier otro final (AC-1107).
- **AC-1311** Aceptadas las tablas la partida esta terminada, asi que la revancha se pide
  igual que tras cualquier otro final.
- **AC-1312** Solo en online. Contra el bot no hay con quien acordar; en hotseat los dos
  jugadores ya comparten la mesa.
- **AC-1313** El boton vive en el HUD, durante la partida. FR-12 quito de ahi el de revancha
  porque permitia reiniciarle la partida al rival sin avisarle; este actua en mitad del juego
  a proposito, y solo con el consentimiento del otro.

AC-1313 se comprueba a mano: donde se coloca un boton es una decision de maquetado, no
logica que se pueda aislar. Lo que si esta cubierto es cuando aparece y cuando no (AC-1312).

### Sobre el reloj

En FIDE se ofrecen tablas despues de mover y antes de apretar el reloj, para que el rival la
piense con su tiempo. Ese orden solo es observable si hay reloj, asi que FR-13 se construyo
entero sin el y dejo tres decisiones tomadas para cuando llegara:

- La oferta se apaga dentro de `playMove`, la unica puerta que modifica la partida, que es
  donde late el reloj tambien.
- La oferta es un booleano por asiento y el reloj son milisegundos por asiento: campos
  ortogonales, no se tocan.
- No hay mensaje para retirar la oferta (AC-1307), asi que retirarla nunca puede volverse una
  palanca de tiempo.

Lo que quedaba abierto —si la oferta viaja atomica con el movimiento para caer en el tiempo
del rival— se decidio que si, y vive en AC-1413.

## FR-14 - El reloj

Un reloj de ajedrez, opcional por sala. Lo lleva el servidor, como las minas: lo que decide
el cliente, el cliente lo puede mentir.

La regla dificil de este FR no es descontar tiempo, es que hay **dos plazos que podrian
correr a la vez** —el reloj y la ausencia de AC-1104— y aplicarlos juntos da resultados
absurdos. Lo que sigue los hace excluyentes: con los dos jugadores presentes manda el reloj;
con alguien ausente, el reloj se para y corre la ausencia.

- **AC-1401** El control de tiempo se elige al crear la sala y viaja con el resto de los
  parametros. Si no viene, la sala se crea SIN reloj: `parseIntent` y `createRoom` caen en
  `'none'`, nunca en un control cualquiera. Anadir un reloj no puede cambiarle la partida a
  quien no lo pidio, y quien no lo pide es, sobre todo, un cliente viejo que ni sabe que el
  campo existe.
  Este criterio decia tambien que "Sin reloj" era lo que el menu ofrecia marcado de entrada.
  Ya no: el menu propone 10+5 y deja "Sin reloj" al final (AC-401 de 004). Eran dos defectos
  distintos en una sola frase. El del cable protege a quien NO eligio y es el que sostiene
  este AC; el de la pantalla es una propuesta a quien SI esta eligiendo, y era el statu quo
  de cuando el reloj todavia no existia. Solo el primero es una garantia.
- **AC-1402** El reloj lo lleva el servidor. El cliente dibuja lo que le llega y nunca decide
  que se acabo el tiempo. Misma razon que las minas: lo que decide el cliente, el cliente lo
  puede mentir.
- **AC-1403** El reloj arranca con la primera jugada de las blancas, no al crear la sala ni
  al sentarse el segundo jugador. Esperar a que llegue un rival no puede costar tiempo, y
  acomodarse tampoco: entre que el segundo entra y mira el tablero pasan unos segundos que
  no son parte de la partida. La contrapartida, asumida: las blancas pueden pensar la
  primera jugada sin reloj.
- **AC-1404** Al mover se descuenta lo que tardo quien movio y se le suma el incremento, si
  lo hay. Lo mide el servidor, asi que quien mueve paga su propia latencia de subida: es lo
  que hace cualquier reloj de verdad, y la alternativa seria fiarse de un cronometro que
  corre en la maquina del rival.
- **AC-1405** Quedarse sin tiempo termina la partida con motivo `timeout`, gana el rival, y
  viaja en el mismo evento `end` que cualquier otro final.
- **AC-1406** La bandera cae sola y en el momento. El servidor se despierta en el instante en
  que el reloj llegaria a cero y el rival no tiene que reclamar nada, igual que en AC-1104.
  Un barrido periodico no sirve para esto: se perderia medio minuto tarde, o se movería con
  un tiempo que ya no se tenia.
- **AC-1407** Si al caerse la bandera el rival no tiene material para dar mate, son tablas y
  no victoria. Aqui el material desaparece por explosiones, asi que quedarse con el rey solo
  y ganar por tiempo es un caso normal, no una rareza de reglamento.
- **AC-1408** Con alguien ausente el reloj se para, el de los dos. Si estan los dos delante
  manda el reloj; si falta uno, no corre el tiempo de nadie. Que se caiga la conexion de uno
  no puede costarle la partida al otro.
- **AC-1409** Esa pausa se paga con el presupuesto de ausencia de AC-1104, que es por partida
  y no por desconexion. Es lo que hace que pausar sea seguro: regalando dos minutos en cada
  desconexion, bastaria con desenchufarse en cada jugada dificil para pensarla gratis y
  volver, porque el reloj parado convierte una caida de red en una ventaja. Acumulado, esa
  trampa se puede hacer una vez por partida, y quien gasta el presupuesto asi se queda sin
  red para una caida de verdad.
- **AC-1410** Al reconectar el reloj se recupera tal cual estaba, sin regalar ni cobrar de
  mas por el rato ausente.
- **AC-1411** La revancha reinicia los relojes y tambien los presupuestos de ausencia. Es
  una partida nueva, no la continuacion de la anterior.
- **AC-1412** El cliente no lleva su propia cuenta: recibe lo que queda y desde cuando, y
  dibuja. Es lo que ya hace con el plazo de ausencia (AC-1109), y es lo que evita que el
  reloj que se ve y el que aplica el servidor se separen.
- **AC-1413** Una oferta de tablas puede viajar con el movimiento, y entonces se aplica
  DESPUES de aplicarlo, de modo que el rival la piensa con SU tiempo. Es la secuencia de FIDE
  —mover, ofrecer, apretar el reloj— que hasta ahora no era observable porque no habia reloj
  que apretar. El mensaje suelto de FR-13 sigue existiendo, porque aceptar no es un
  movimiento y ofrecer fuera de turno tambien se permite.

AC-1406 se comprueba a mano, como los de FR-6: el control mas corto son 3 minutos, asi que
ningun test puede esperar a que caiga una bandera de verdad. El calculo del instante si esta
cubierto (`flagFallsAt`); lo que necesita una pasada manual es el despertador de cada
transporte.

### Donde vive

En el motor, como modulo propio (`@cm/engine/clock`): funciones puras sobre un `ClockState`
que guarda `RoomState`. Igual que la logica de sala y la politica de origenes, lo comparten
los dos transportes y no hay dos copias de la regla.

No va dentro de `GameState`: `applyMove` es pura y hoy recibe `(state, move)`. Meterle el
reloj la obligaria a conocer la hora, y eso cambia la funcion que usan tambien el bot, el
panel de balance y los tests de 001-core-rules, que no tienen nada que ver con esto.

El precio es que hotseat no puede tener reloj todavia. Pero como las funciones son puras y
viven en el motor, el dia que se quiera blitz en la misma maquina el cliente reusa estas
mismas: hay que darles un `ClockState`, no reescribir la regla.

### Lo que arrastra

`EndReason` y `GameStatus` suman `timeout`, como ya hizo `abandoned`. `insufficientMaterial`
esta privada en `game.ts` y hay que exportarla para AC-1407. `RoomSettings` y `parseIntent`
suman el control de tiempo. Y `PROTOCOL_VERSION` pasa a 4: cambia `ClientMessage` por
AC-1413 y `ServerMessage` por AC-1412, asi que la huella de AC-504 lo va a exigir.
