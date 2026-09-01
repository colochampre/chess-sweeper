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
  isOriginAllowed,
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
/** Mensajes por ventana y CONEXION. El ajedrez es por turnos: esto sobra de largo. */
const RATE_LIMIT = { messages: 40, windowMs: 10_000 };

/** Longitud real en bytes: `String.length` cuenta unidades UTF-16, no bytes. */
const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength;

const encode = (message: ServerMessage): string => JSON.stringify(message);

interface Attachment {
  color: Color;
  /** Identifica esta conexion concreta; ver `markDisconnected` en el motor. */
  session: string;
}

// ---------------------------------------------------------------------------
// Worker: valida, enruta hacia la sala y sirve el cliente compilado.
// ---------------------------------------------------------------------------

/**
 * Adaptador sobre la politica compartida: aqui solo se traduce la peticion del Worker a la
 * forma que espera `@cm/engine/origin`. La regla vive alli y es la misma que aplica el
 * servidor de LAN, asi que los dos transportes no pueden divergir. Tener aqui una copia
 * propia era justo lo que rompia el circuito de desarrollo: el Worker exigia el mismo host
 * y rechazaba con 403 al cliente de Vite servido desde otro puerto.
 */
function originAllowed(request: Request, env: Env): boolean {
  return isOriginAllowed({
    origin: request.headers.get('Origin'),
    host: new URL(request.url).host,
    allowed: env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean),
  });
}

/**
 * Reenvia la peticion al Durable Object de esa sala. El codigo es a la vez la direccion del
 * objeto y el parametro que este lee, asi que no pueden diferir. Se construye una peticion
 * nueva en cada llamada, porque el bucle de colisiones puede reintentar.
 */
function roomStub(env: Env, code: string, request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.searchParams.set('code', code);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return stub.fetch(new Request(url.toString(), { method: request.method, headers: request.headers }));
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
  /** Marcas de tiempo de los ultimos mensajes, por conexion. */
  private recent = new Map<string, number[]>();

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

  private attachmentOf(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null;
  }

  /**
   * El socket vigente de ese color. Se busca por sesion, no por color: `close()` es
   * asincrono, asi que un socket recien reemplazado sigue apareciendo en `getWebSockets()`
   * con el mismo color, y mandarle a el la presencia dejaria al rival viendo "Esperando".
   */
  private socketFor(color: Color): WebSocket | undefined {
    const session = this.room?.seats[color]?.session;
    if (session === undefined) return undefined;
    return this.ctx.getWebSockets().find((ws) => this.attachmentOf(ws)?.session === session);
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
    server.serializeAttachment({ color: seat.color, session: seat.session } satisfies Attachment);

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

  /** Por conexion: si el contador fuera de la sala, pasarse uno desconectaria al otro. */
  private rateLimited(session: string): boolean {
    const now = Date.now();
    const marks = (this.recent.get(session) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
    marks.push(now);
    this.recent.set(session, marks);
    return marks.length > RATE_LIMIT.messages;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    // `raw.length` primero como descarte barato: en UTF-8 los bytes nunca son menos que
    // las unidades de codigo, asi que si ya se pasa por ahi, se pasa seguro.
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES || utf8Bytes(raw) > MAX_MESSAGE_BYTES) {
      return ws.close(1009, 'Mensaje demasiado grande');
    }

    const attachment = this.attachmentOf(ws);
    if (attachment === null || this.room === null) {
      return ws.send(encode({ t: 'error', message: 'No estas sentado en ninguna sala' }));
    }
    if (this.rateLimited(attachment.session)) return ws.close(1008, 'Demasiados mensajes');
    const color = attachment.color;

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
        // Los colores se intercambian, asi que cada socket se resienta en el suyo. El
        // asiento conserva su sesion, de modo que un socket ya reemplazado no coincide con
        // ninguno y se salta: si se le dejara escribir, reintroduciria el bug de AC-305.
        for (const socket of this.ctx.getWebSockets()) {
          const current = this.attachmentOf(socket);
          if (current === null) continue;
          const next = opponentOf(current.color);
          if (this.room.seats[next]?.session !== current.session) continue;
          socket.serializeAttachment({ color: next, session: current.session } satisfies Attachment);
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
    const attachment = this.attachmentOf(ws);
    if (attachment === null || this.room === null) return;
    // Si esta conexion ya habia sido reemplazada por otra, su cierre no significa nada.
    this.recent.delete(attachment.session);
    if (!markDisconnected(this.room, attachment.color, attachment.session)) return;
    this.broadcastPresence();
    await this.save();
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
