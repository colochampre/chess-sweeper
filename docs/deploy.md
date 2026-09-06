# Despliegue

El juego se publica entero en **Cloudflare Workers**: el mismo Worker sirve el cliente
compilado y atiende los WebSockets. Un solo origen, un solo comando.

```bash
npx wrangler login          # una vez
npm run deploy              # compila el cliente y publica el Worker
```

`npm run deploy` hace `npm run build` y luego `wrangler deploy` desde `packages/worker`.

## Por que Cloudflare y no Vercel

Vercel no ejecuta procesos persistentes: sus funciones son peticion-respuesta y no aceptan
un *upgrade* de WebSocket entrante. El cliente se desplegaria sin problema (de hecho, dos de
los tres modos son cien por cien navegador y funcionarian), pero el online no.

Cloudflare resuelve algo mas que "poder tener un socket abierto". Una sala **es** un Durable
Object: un objeto direccionable por nombre, de un solo hilo y con almacenamiento propio. El
codigo de sala se convierte en su direccion, y con eso caen solas las dos carencias que
tenia el servidor de LAN:

- **La partida sobrevive a un redespliegue.** El estado vive en el almacenamiento del objeto,
  no en la memoria del proceso. Comprobado matando el servidor a mitad de partida y
  reclamando el asiento: la posicion volvio intacta.
- **No hay que coordinar instancias.** Solo existe un objeto por sala en todo el mundo y
  todos sus mensajes pasan por el, asi que no hay estado que repartir entre replicas ni
  sesiones que fijar a un servidor.

Ademas, con la *hibernation* de WebSockets el objeto puede dormirse con los sockets abiertos
sin consumir computo, que es lo que hace viable una partida larga en el plan gratuito.

## Configuracion

Todo esta en `packages/worker/wrangler.jsonc`:

| Clave | Para que |
|---|---|
| `assets` | Sirve `packages/client/dist` desde el propio Worker |
| `durable_objects` | Enlaza dos clases: `Room` (una sala) y `Queue` (la cola de emparejamiento automatico, spec 005) |
| `migrations` | `new_sqlite_classes`, el respaldo disponible en el plan gratuito. Una migracion por clase: `v1` dio de alta `Room`, `v2` dio de alta `Queue` |

Variable opcional: **`ALLOWED_ORIGINS`**, una lista separada por comas. Sin definir, solo se
acepta el origen del propio servicio. Solo hace falta si sirves el cliente desde otro dominio.

```bash
npx wrangler secret put ALLOWED_ORIGINS   # o vars en wrangler.jsonc
```

## Desarrollo local

```bash
npm run build        # el Worker sirve este build
npm run dev:worker   # wrangler dev en http://127.0.0.1:8787
```

`wrangler dev` ejecuta Durable Objects de verdad en local (Miniflare) y persiste su
almacenamiento en `.wrangler/state`, asi que se puede probar de verdad la reconexion y la
supervivencia a un reinicio.

Para tocar la interfaz es mas comodo `npm run dev` (Vite en el 5173, con recarga en caliente)
y, en paralelo, `npm run dev:worker` para el online: el cliente detecta el puerto 5173 y
apunta al 8787 automaticamente.

## El servidor de Node sigue ahi

`packages/server` es el servidor de LAN y no se ha tirado: sirve para jugar en la red local
sin herramientas de Cloudflare, y como banco de pruebas del mismo nucleo de salas. Comparte
con el Worker toda la logica; solo cambia el pegamento del transporte.

```bash
npm run build && npm run dev:server   # http://<tu-ip>:8787
```

La diferencia importante: **guarda las salas en memoria**. Si lo reinicias, las partidas en
curso se pierden. En produccion eso lo resuelve el Durable Object.

## Endurecido para internet abierto

Lo que se anadio al salir de la red local, donde no hacia falta:

- Validacion de `Origin` en el WebSocket, para que otra web no pueda abrir conexiones
  usando el navegador de un visitante. La regla vive en `@cm/engine/origin` y es la misma
  en los dos transportes: mismo origen siempre; otro puerto solo si **los dos extremos** son
  locales, que es lo que permite desarrollar con Vite en el 5173 sin abrir la puerta a nadie;
  y si defines `ALLOWED_ORIGINS`, manda esa lista.
- Tamano maximo por mensaje (4 KB) y limite de ritmo por conexion.
- Limite de ritmo **por IP** antes de aceptar nada, con el limitador nativo de Workers. El de
  conexion de arriba no servia contra quien abre conexiones sueltas. Son dos, porque el ataque
  no es el mismo: `join` y `resume` adivinan un codigo de sala (15 cada 10 segundos), `create`
  y `match` gastan Durable Objects nuevos (10 por minuto). La decision de que accion cae en
  cual vive en `@cm/engine/abuse`; el Worker solo lee `CF-Connecting-IP` y llama al binding.
  Va antes que la comprobacion de version, porque esa ya rechaza por el socket y eso cuesta.
- `resume` contesta lo mismo exista la sala o no. Lleva el codigo ademas del token, asi que
  dos mensajes distintos habrian dicho si un codigo adivinado era bueno sin acertar ninguno.
  `join` si distingue: ahi lo tecleo una persona y le sirve saber cual de las dos cosas pasa.
- Validacion estricta de los parametros de conexion, con el codigo de sala normalizado y el
  token comprobado contra el formato de UUID antes de tocar el almacenamiento.
- *Heartbeat* en el servidor de LAN, para detectar conexiones que mueren en silencio.

## Lo que sigue pendiente

- El limite por IP lo cuenta cada centro de datos por su cuenta, no hay un total. Quien
  reparta el ataque entre varios colos multiplica su presupuesto por otros tantos. Frena a un
  escaner suelto, que es el caso realista; no a uno repartido.
- La ventana solo puede ser de 10 o 60 segundos: la eligio Cloudflare, no nosotros.
- Los dos caminos por los que `resume` rechaza no tardan exactamente lo mismo, aunque digan lo
  mismo. Son nanosegundos frente al ruido de la red, pero no es cero, y por eso `resume` sigue
  contando en el limitador de `join`.
