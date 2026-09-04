# 005 — Emparejamiento automatico

Estado: **activo** · Nucleo: `@cm/engine/matchmaking` · Transportes: `@cm/worker` y `@cm/server`

Hasta ahora, para jugar online habia que conseguir un rival por fuera del juego: crear una
sala, copiar el codigo y pasarselo a alguien por otro sitio. Eso no es jugar online, es
organizar una partida.

## FR-1 · La cola

Una sola cola, y lo unico que guarda es que sala esta esperando para cada combinacion de
ajustes.

- **AC-101** Se empareja con quien pidio EXACTAMENTE lo mismo: misma dificultad, mismo
  control de tiempo y mismo tamano. No hay rangos ni aproximaciones. Emparejar a alguien que
  pidio 5+2 con alguien que pidio 15+10 es darle a los dos una partida que ninguno eligio, y
  la unica manera de que eso no pase es que la clave sea exacta.
- **AC-102** El color NO entra en la clave. Si entrase, quien quiere blancas solo podria
  emparejar con quien quiere blancas, que es justo con quien no puede jugar. El color lo
  reparte la sala como siempre (AC-102 de 003).
- **AC-103** Como mucho hay UNA sala esperando por clave. La segunda persona que llega con
  esos ajustes se sienta en la que ya espera, no abre otra. Guardar varias solo serviria para
  tener a dos personas esperando por separado pudiendo jugar entre ellas.

## FR-2 · Emparejar se resuelve a crear o a entrar

No existe un tipo de sala nuevo. `a=match` se resuelve, ANTES del apreton de manos, a una de
las dos acciones que ya existian: si hay alguien esperando se entra a su sala, y si no se
crea una y se queda esperando.

- **AC-201** La logica de sala no cambia. Una partida emparejada es indistinguible de una
  jugada por codigo: mismos asientos, mismo reloj, mismas tablas, mismo abandono.
- **AC-202** La resolucion ocurre en el enrutado, no como mensaje. Es la misma razon que
  AC-501 de 003: el Worker tiene que saber a que Durable Object mandar la conexion antes de
  aceptar el socket, y con `a=match` todavia no hay codigo que mirar.
- **AC-203** `ConnectIntent` suma `match`, asi que `PROTOCOL_VERSION` sube. La huella de
  AC-504 de 003 lo va a exigir sola, que para eso se escribio.

## FR-3 · Salir de la cola

- **AC-301** Cancelar la busqueda quita la entrada. Quien cancela deja de estar disponible en
  el mismo momento, no cuando caduque nada.
- **AC-302** Perder la conexion mientras se espera tambien la quita. Esperar en una cola no es
  lo mismo que jugar una partida: aqui no hay posicion que conservar ni rival al que avisar,
  asi que no aplica el presupuesto de ausencia de AC-1104 de 003.

## FR-4 · Entradas que ya no valen

Este es el fallo que hay que evitar, y no es teorico:

> A entra a la cola y crea una sala. A cierra la pestana. B entra a la cola, le entregan la
> sala de A y se sienta. Ahora B espera a alguien que no va a volver, y a los dos minutos
> **gana por abandono una partida que nunca empezo** (AC-1104 de 003).

- **AC-401** La entrada la mantiene el PEGAMENTO de cada transporte, no la sala. El pegamento
  ya sabe cuando alguien se sienta, cuando se va y cuando se cae; darle de baja la entrada es
  una linea mas en sitios que ya existen. La sala sigue sin saber que hay una cola, igual que
  no sabe que hay WebSockets.
- **AC-402** Una sala que ya no admite a nadie no se entrega. Si la entrada apunta a una sala
  llena o que ya no existe, se descarta y se sigue como si no hubiera nadie esperando.
- **AC-403** Ademas caduca por tiempo. Es una red debajo de AC-401, no el mecanismo: si el
  proceso se cae entre sentarse y darse de baja, la entrada no puede quedarse ahi para
  siempre. El plazo es corto porque solo cubre esa ventana, no una ausencia.

## FR-5 · Lo que ve quien espera

- **AC-501** Mientras se busca, se dice que se busca. No hay codigo que ensenar: nadie tiene
  que copiar nada, y ensenar un codigo invitaria a compartirlo, que es la otra manera de
  jugar y no esta.
- **AC-502** Se puede cancelar en cualquier momento, y cancelar vuelve al menu.
- **AC-503** Emparejar es la accion primaria del menu y dice **"Empezar partida"**. Crear una
  sala con codigo baja a secundaria, como "Jugar con un amigo".
  Esto **corrige AC-304 de 004**, que decia que la primaria no podia prometer un rival que no
  habia. Tenia razon cuando se escribio: la unica accion era crear una sala y esperar a que
  alguien apareciese con un codigo. Ahora si hay rival del otro lado, asi que la etiqueta que
  entonces habria sido mentira pasa a ser la unica exacta.

## Lo que no cambia

- **AC-102 de 003** El anfitrion ocupa el color que pidio y el segundo el que quede. Emparejar
  no inventa un reparto propio: quien llega primero crea la sala y es el anfitrion.
- **AC-103 de 003** Una sala llena rechaza a un tercero. Sigue siendo la ultima defensa si dos
  jugadores reclaman la misma entrada a la vez.
- **AC-1104 de 003** El presupuesto de ausencia es de las partidas, no de la cola (AC-302).
