/// <reference types="@cloudflare/workers-types" />
/**
 * Chess Minesweeper en Cloudflare Workers.
 *
 * Una sala es un Durable Object. Eso no es un truco de implementacion: es exactamente la
 * forma que tiene el problema. Un Durable Object es un objeto direccionable por nombre, de
 * un solo hilo y con almacenamiento propio, asi que el codigo de sala se convierte en su
 * direccion (`idFromName(code)`) y las dos condiciones que en el servidor de LAN quedaban
 * pendientes salen gratis:
 *
 *  - la partida sobrevive a un redespliegue, porque el estado vive en el almacenamiento
 *    del objeto y no en la memoria del proceso;
 *  - no hay que coordinar instancias, porque solo existe un objeto por sala en todo el
 *    mundo y todos los mensajes de esa sala pasan por el.
 *
 * Las minas viven aqui dentro y solo salen como `PlayerView`, igual que en el servidor de
 * LAN: los dos comparten la logica de `@cm/engine`.
 */
import {
  ROOM_TTL_MS,
  WS_PATH,
  createRoom,
  generateRoomCode,
  isRoomError,
  isStale,
  markDisconnected,
  opponentOf,
  parseIntent,
  playMove,
  rematch,
  resumeSeat,
  takeSeat,
  viewFor,
  type ClientMessage,
  type Color,
  type ConnectIntent,
  type RoomState,
  type ServerMessage,
} from '@cm/engine';

export interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** Origenes permitidos, separados por comas. Sin definir: solo el propio host. */
  ALLOWED_ORIGINS?: string;
}

/** Un movimiento son unas decenas de bytes; por encima de esto es basura o un ataque. */
const MAX_MESSAGE_BYTES = 4 * 1024;
/** Mensajes por ventana y sala. El ajedrez es por turnos: esto sobra de largo. */
const RATE_LIMIT = { messages: 40, windowMs: 10_000 };

const encode = (message: ServerMessage): string => JSON.stringify(message);

interface Attachment {
  color: Color;
}

// ---------------------------------------------------------------------------
// Worker: valida, enruta hacia la sala y sirve el cliente compilado.
// ---------------------------------------------------------------------------

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null) return true; // clientes que no son navegador (tests, wscat)
  const allowed = env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  try {
    const host = new URL(origin).host;
    if (allowed && allowed.length > 0) return allowed.includes(origin) || allowed.includes(host);
    return host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function roomStub(env: Env, code: string, request: Request, code2 = code): Promise<Response> {
  const url = new URL(request.url);
  url.searchParams.set('code', code2);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return stub.fetch(new Request(url.toString(), request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== WS_PATH) return env.ASSETS.fetch(request);

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Se esperaba una conexion WebSocket', { status: 426 });
    }
    if (!originAllowed(request, env)) {
      return new Response('Origen no permitido', { status: 403 });
    }

    const intent = parseIntent(url.searchParams);
    if (intent === null) return new Response('Parametros de conexion invalidos', { status: 400 });

    if (intent.a === 'create') {
      // Con mil millones de codigos posibles la colision es rarisima, pero es barato
      // comprobarlo: la sala responde 409 si ya existe y se prueba con otro.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateRoomCode();
        const response = await roomStub(env, code, request);
        if (response.status !== 409) return response;
      }
      return new Response('No se pudo crear la sala', { status: 503 });
    }

    return roomStub(env, intent.code, request);
  },
};

// ---------------------------------------------------------------------------
// Durable Object: una sala.
// ---------------------------------------------------------------------------

export class Room implements DurableObject {
  private room: RoomState | null = null;
  /** Marcas de tiempo de los ultimos mensajes, para limitar el ritmo. */
  private recent: number[] = [];

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    // Al despertar de la hibernacion el constructor vuelve a ejecutarse: aqui se recupera
    // la partida antes de atender nada.
    void this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get<RoomState>('room')) ?? null;
    });
  }

  private async save(): Promise<void> {
    if (this.room !== null) await this.ctx.storage.put('room', this.room);
    // La alarma limpia la sala si nadie vuelve.
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS + 60_000);
  }

  private colorOf(ws: WebSocket): Color | null {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    return attachment?.color ?? null;
  }

  private socketFor(color: Color): WebSocket | undefined {
    return this.ctx.getWebSockets().find((ws) => this.colorOf(ws) === color);
  }

  private send(color: Color, message: ServerMessage): void {
    const ws = this.socketFor(color);
    if (ws) {
      try {
        ws.send(encode(message));
      } catch {
        /* socket ya cerrado: la limpieza llega por webSocketClose */
      }
    }
  }

  private broadcastPresence(): void {
    if (this.room === null) return;
    for (const color of ['w', 'b'] as const) {
      this.send(color, {
        t: 'opponent',
        connected: this.room.seats[opponentOf(color)]?.connected === true,
      });
    }
  }

  /** Error de usuario: se acepta el socket solo para poder explicarlo y se cierra. */
  private refuse(message: string): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.send(encode({ t: 'error', message }));
    server.close(1008, message);
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const intent = parseIntent(url.searchParams);
    if (intent === null) return new Response('Parametros invalidos', { status: 400 });

    if (intent.a === 'create') {
      if (this.room !== null) return new Response('Codigo ocupado', { status: 409 });
      const code = url.searchParams.get('code');
      if (code === null) return new Response('Falta el codigo', { status: 400 });
      this.room = createRoom(code, intent);
    }

    if (this.room === null) return this.refuse('No existe ninguna sala con ese codigo');

    const seat =
      intent.a === 'resume'
        ? resumeSeat(this.room, intent.token)
        : takeSeat(this.room);
    if (isRoomError(seat)) return this.refuse(seat.error);

    // Una sesion nueva en el mismo asiento echa a la anterior.
    const previous = this.socketFor(seat.color);
    if (previous) {
      try {
        previous.close(4001, 'Sesion reemplazada');
      } catch {
        /* ya estaba cerrado */
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernacion: el objeto puede dormirse con el socket abierto sin gastar computo.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ color: seat.color } satisfies Attachment);

    server.send(
      encode({
        t: 'seated',
        code: this.room.code,
        color: seat.color,
        token: seat.token,
        view: viewFor(this.room, seat.color),
      }),
    );
    this.broadcastPresence();
    await this.save();

    return new Response(null, { status: 101, webSocket: client });
  }

  private rateLimited(): boolean {
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < RATE_LIMIT.windowMs);
    this.recent.push(now);
    return this.recent.length > RATE_LIMIT.messages;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) {
      return ws.close(1009, 'Mensaje demasiado grande');
    }
    if (this.rateLimited()) return ws.close(1008, 'Demasiados mensajes');

    const color = this.colorOf(ws);
    if (color === null || this.room === null) {
      return ws.send(encode({ t: 'error', message: 'No estas sentado en ninguna sala' }));
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return ws.send(encode({ t: 'error', message: 'Mensaje mal formado' }));
    }

    switch (message?.t) {
      case 'move': {
        const result = playMove(this.room, color, message.move);
        if (isRoomError(result)) {
          ws.send(encode({ t: 'error', message: result.error }));
          ws.send(encode({ t: 'sync', view: viewFor(this.room, color) }));
          return;
        }
        for (const seatColor of ['w', 'b'] as const) {
          this.send(seatColor, {
            t: 'moved',
            events: result.events,
            view: viewFor(this.room, seatColor),
          });
        }
        await this.save();
        return;
      }

      case 'rematch': {
        rematch(this.room);
        // Los colores se intercambian, asi que cada socket se resienta en el suyo.
        for (const socket of this.ctx.getWebSockets()) {
          const previous = this.colorOf(socket);
          if (previous === null) continue;
          const next = opponentOf(previous);
          socket.serializeAttachment({ color: next } satisfies Attachment);
          socket.send(
            encode({
              t: 'seated',
              code: this.room.code,
              color: next,
              token: this.room.seats[next]?.token ?? '',
              view: viewFor(this.room, next),
            }),
          );
        }
        await this.save();
        return;
      }

      case 'leave':
        return ws.close(1000, 'Salida voluntaria');

      default:
        return ws.send(encode({ t: 'error', message: 'Mensaje desconocido' }));
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const color = this.colorOf(ws);
    if (color !== null && this.room !== null) {
      markDisconnected(this.room, color);
      this.broadcastPresence();
      await this.save();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** Sala abandonada: se borra su almacenamiento en vez de dejarlo ahi para siempre. */
  async alarm(): Promise<void> {
    if (this.room !== null && !isStale(this.room)) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return;
    }
    this.room = null;
    await this.ctx.storage.deleteAll();
  }
}

// Referencia usada solo para el tipo del intent en `roomStub`.
export type { ConnectIntent };
