# 004 — La interfaz

Estado: **activo** · Cliente: `@cm/client` · Tests: `packages/client/tests/preview.test.ts`

`packages/client` no tiene montaje de DOM en los tests. Igual que con `planConnect`,
`drawButton`, `clockRemaining` y `formatClock`, lo que se puede sacar a una funcion pura se
saca y se prueba; lo que es maquetado se comprueba a mano y se dice cual es cual.

## FR-1 · El menu muestra el juego, no un formulario

El menu abria con un parrafo que explicaba las reglas y catorce controles. Lo que uno viene a
hacer no estaba en pantalla: estaba despues de contestar un cuestionario.

- **AC-101** El menu dibuja un tablero en la posicion inicial, con la niebla puesta. No es un
  dibujo: sale del mismo motor que una partida, asi que el dia que cambien las piezas, la
  cascada de revelado o el tamano por defecto, el menu cambia solo.
- **AC-102** El tablero del menu se arma desde `PlayerView`, nunca desde `GameState`. Nadie
  esta jugando, asi que filtrar las minas "no pasa nada" — y esa es exactamente la frase con
  la que el modo online heredo los supuestos de un solo jugador. La garantia es estructural
  en todos los consumidores o no es una garantia.
- **AC-103** El tablero del menu se dibuja con una semilla fija. Una semilla al azar cambiaria
  el menu en cada visita sin que nadie lo haya pedido, y dejaria el test sin nada que afirmar.
- **AC-104** El tablero del menu no responde al clic ni al clic derecho.
- **AC-105** El tablero del menu no registra sus piezas en el reproductor de animaciones. El
  registro es global y por `id`: dos tableros vivos a la vez se pisarian las referencias.

- **AC-106** El tablero del menu se dibuja con la dificultad elegida: subirla espesa la
  niebla y bajarla la afloja. La eleccion se ve en el tablero, que es donde va a importar, en
  vez de en un porcentaje escrito debajo de un boton.

## FR-2 · El tablero se dibuja en un componente sin estado

Hasta ahora `Board` leia del store y devolvia `null` sin partida, asi que el tablero solo
podia existir dentro de una partida en curso.

- **AC-201** `BoardView` recibe todo lo que dibuja por props y no importa el store.
- **AC-202** `Board` sigue siendo el unico que habla con el store: arma la escena y se la pasa.
  Un solo sitio que sepa de estado, un solo sitio que sepa de pintura.

## FR-3 · Una sola accion primaria

- **AC-301** El menu ofrece una unica accion primaria. Las demas maneras de empezar son
  visiblemente secundarias.
- **AC-302** Cantidad de minas, color y fuerza de la maquina abren plegadas y con su valor por
  defecto puesto. Se puede empezar una partida sin abrirlas.
- **AC-303** El tamano del tablero desaparece del menu. Ya vivia en el panel de balance
  (`BalancePanel.tsx`), con el mismo rango 6-12, y su propia ayuda decia que era para pruebas.
  Un control de desarrollo duplicado al lado de la eleccion principal.
- **AC-304** La etiqueta de la accion primaria dice lo que hace. Crear una sala y esperar a un
  rival con un codigo no es "empezar una partida": el boton no promete un rival que no hay.

AC-301, AC-302 y AC-304 son decisiones de maquetado y de texto: se comprueban a mano, igual
que AC-1313 de 003. AC-303 si se puede leer del codigo.

## FR-4 · El menu propone, no impone

El menu abria en "Sin reloj" porque era lo que hacian todas las partidas el dia que se
escribio FR-14: el reloj no existia todavia. Ya existe, y un menu que propone la opcion de no
usarlo esta proponiendo la de antes.

- **AC-401** El control de tiempo abre en 10+5, y "Sin reloj" es la ultima opcion de la lista.
  Sigue estando entera: proponer no es imponer, y quien no quiera reloj lo apaga en un clic.
- **AC-402** El valor por defecto de cada lista del menu es una constante con nombre, no "el
  primero del array". Reordenar una lista es una decision de maquetado; cambiar lo que viene
  marcado es una decision de producto. Atadas, la primera hacia la segunda en silencio, que es
  exactamente como este cambio habria pasado sin que ningun test dijese nada.
- **AC-403** Lo que el menu propone no toca lo que el servidor asume. Un `create` sin control
  de tiempo sigue creando una sala sin reloj (AC-1401 de 003): el defecto de la pantalla y el
  del cable son dos cosas, y solo el segundo es una garantia.

## FR-5 · Las tres pantallas son la misma aplicacion

Cada pantalla traia su propio armazon: el menu con el titulo "Chess Minesweeper", el lobby
con otro que decia "Sala online", y la partida sin ninguno. Ademas el riel cambiaba de ancho
al entrar a jugar. Pasar de una a otra parecia cambiar de aplicacion.

- **AC-501** La cabecera es una sola y vive en `App`, no en cada pantalla. Menu, lobby y
  partida no la declaran ni la pueden contradecir.
- **AC-502** Las tres usan la misma rejilla: tablero a la izquierda, riel de 340px a la
  derecha, mismo hueco y mismo ancho maximo. Lo unico que cambia entre pantallas es el
  contenido del riel, que es lo unico que de verdad cambia.
- **AC-503** Lo que se cuenta del tablero va debajo del tablero, en el mismo sitio en las
  tres. La ayuda del clic derecho estaba al final del HUD, que es la columna de al lado.
- **AC-504** El velo de fin de partida se cine al tablero y no a la columna. Con la columna
  mas ancha que el tablero, se salia por el lado.

## FR-6 · El HUD separa lo que decide de lo que solo se mira

Nueve controles en una lista plana, donde "Ofrecer tablas" —que puede terminar la partida—
quedaba entre "Girar tablero" y una casilla de sonido.

- **AC-601** Las acciones de partida y las preferencias van en paneles distintos y con
  titulo. Girar el tablero o apagar el sonido no cambian la partida de nadie; ofrecer tablas,
  abandonar o reiniciar, si.
- **AC-602** Las tablas van primero dentro de su panel: son lo unico de ahi que decide la
  partida, y cuando llega una oferta hay que contestarla. Siguen viviendo en el HUD y durante
  la partida (AC-1313 de 003), que es lo que este reordenamiento no puede tocar.

AC-501 a AC-602 son decisiones de maquetado: se comprueban a mano.

## FR-7 · Cada jugador con lo suyo al lado

Los relojes y los dos cementerios vivian en el riel, que se iba de alto y desbordaba la
pantalla. Y obligaban a mirar a la columna de al lado para saber cuanto le queda al rival,
que es justo lo que no se puede dejar de mirar mientras se piensa una jugada.

Ahora el tablero lleva una tira por jugador: el rival arriba, vos abajo.

- **AC-701** El botin de un jugador son las piezas del OTRO color, de la mas valiosa a la
  menos. Antes eran dos listas de "perdidas" al lado de un jugador que no las capturo, y
  habia que darles la vuelta mentalmente.
- **AC-702** La ventaja material se escribe en un solo lado, el que va ganando. Escribirla en
  los dos —"+3" arriba y "-3" abajo— es decir lo mismo dos veces y obligar a leer un signo
  para saber quien gana.
- **AC-703** Abajo va quien tiene el tablero orientado hacia si, no quien sea el humano. Asi
  en hotseat las tiras se dan la vuelta con el tablero y siguen diciendo la verdad.
- **AC-704** Los dos relojes se dibujan del MISMO instante: el latido vive en el padre de las
  dos tiras, no uno por tira. Dos intervalos leyendo dos `Date.now()` distintos pintan dos
  relojes que no cuadran entre si.
- **AC-705** En escritorio la partida entera cabe en la pantalla sin desplazar, y la ocupa. El
  ancho del tablero sale del ALTO disponible —la pantalla menos la cabecera, las dos tiras, la
  ayuda y los margenes— en vez de un tamano fijo: asi crece con la pantalla en lugar de dejar
  hueco debajo. El riel llena su columna, y lo que no decide la partida (las preferencias, la
  nota de desarrollo) se va al fondo. En pantallas pequenas la columna se apila y desplazar es
  inevitable.
- **AC-706** Las tiras aparecen donde aparece el tablero: menu, lobby y partida. No son de la
  pantalla de juego, son de la mesa. Si en el menu no estuviesen, empezar una partida moveria
  el tablero de sitio, que es la costura que este spec vino a quitar (AC-502).
- **AC-707** El control de tiempo elegido se ve en las tiras del menu, con su valor inicial
  puesto. Elegir 10+5 y leer 10:00 a los dos lados es la misma idea que ver espesarse la
  niebla al subir las minas (AC-106): la eleccion se ve donde va a importar, no en una lista.
  Ninguno de los dos corre: el reloj arranca con la primera jugada de las blancas (AC-1403).
- **AC-708** Elegir negras da la vuelta al tablero del menu, y la tira de abajo pasa a ser la
  negra. Sin esto la tira decia "Vos" en negro debajo de un tablero con las blancas abajo, que
  es la unica de las tres elecciones del menu que no se veia en ninguna parte. "Al azar" se
  dibuja con las blancas abajo: todavia no hay un lado que ensenar.

AC-701 y AC-702 son puros y estan cubiertos en `packages/client/tests/players.test.ts`.
AC-703 y de AC-705 a AC-708 se comprueban a mano; AC-704 es estructural y se lee del
codigo.

## FR-8 · Los botones dicen lo que hacen

- **AC-801** El boton de tablas nombra las tablas. Decia "Ofrecer con tu jugada": contaba
  CUANDO iba a salir la oferta y nunca QUE se ofrecia. Ahora dice "Ofrecer tablas al mover",
  que es la secuencia FIDE de AC-1413 escrita entera.
- **AC-802** Con la oferta armada, el boton dice la accion y no el estado: "Cancelar la
  oferta", no "Tablas con tu jugada". Que este armada ya se ve en que el boton pasa a
  principal; un control esta para decidir, y un hecho puesto donde va una decision no se
  distingue de un boton que solo informa.

Los dos estan cubiertos dentro de `packages/client/tests/draw.test.ts`, en los tests que
citan AC-1413: la etiqueta y la accion se afirman juntas porque son el mismo boton.

## Lo que no cambia

Estos criterios de [003-online](../003-online/spec.md) atan esta interfaz. Se enumeran aqui
porque moverlos de sitio los rompe en silencio y sin fallar ningun test:

- **AC-1004** El asiento guardado se ofrece nada mas abrir el menu, arriba de todo y sin
  elegir antes el modo online. No entra en ningun plegado.
- **AC-1006** El codigo de sala se normaliza y se valida al escribirlo, no al enviarlo.
- **AC-1313** El boton de tablas vive en el HUD, durante la partida. FR-12 quito de ahi el de
  revancha por un motivo que no aplica a este.
- **AC-1401** Un `create` que no manda control de tiempo crea una sala sin reloj. Lo que el
  menu ofrece marcado ya no lo fija este AC: lo fija AC-401 de arriba, y son cosas distintas.
- **AC-1412** El reloj se dibuja de lo que manda el servidor; el cliente no lleva su cuenta.
