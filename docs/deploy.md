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
| `durable_objects` | Enlaza la clase `Room` |
| `migrations` | `new_sqlite_classes`, el respaldo disponible en el plan gratuito |

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
  usando el navegador de un visitante.
- Tamano maximo por mensaje (4 KB) y limite de ritmo por sala.
- Validacion estricta de los parametros de conexion, con el codigo de sala normalizado y el
  token comprobado contra el formato de UUID antes de tocar el almacenamiento.
- *Heartbeat* en el servidor de LAN, para detectar conexiones que mueren en silencio.

## Lo que sigue pendiente

- No hay emparejamiento ni reloj de partida.
- El codigo de sala son ~1.070 millones de combinaciones, pero `join` no tiene limite de
  intentos por IP: alguien muy insistente podria acabar entrando en una sala ajena. Con el
  limite de ritmo actual es lento, no imposible.
