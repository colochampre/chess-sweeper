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
  ABSENCE_FORFEIT_MS,
  ROOM_TTL_MS,
  WS_PATH,
  absenceMsLeft,
  createRoom,
  forfeitAbsent,
  generateRoomCode,
  matchKey,
  resolveMatch,
  PROTOCOL_STALE_MESSAGE,
  isOriginAllowed,
  isProtocolCurrent,
  isRoomError,
  isStale,
  leaveRoom,
  markDisconnected,
  opponentOf,
  parseIntent,
  playMove,
  clockMsLeft,
  clockRunningFor,
  declineDraw,
  drawMovesLeft,
  flagFallsAt,
  forfeitTimeout,
  offerDraw,
  requestRematch,
  resumeSeat,
  takeSeat,
  viewFor,
  type ClientMessage,
  type Color,
  type GameEvent,
  type MatchOutcome,
  type QueueEntry,
  type RoomState,
  type ServerMessage,
} from '@cm/engine';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** La cola de emparejamiento. Un solo objeto para todo el servicio. */
  QUEUE: DurableObjectNamespace;
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

/**
 * Rechazo con motivo: se acepta el socket solo para poder explicarse y se cierra. Un rechazo
 * HTTP dejaria al cliente sin poder leer el porque, que es justo lo que evita FR-9.
 */
function refuseSocket(message: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.send(encode({ t: 'error', message }));
  server.close(1008, message);
  return new Response(null, { status: 101, webSocket: client });
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
function roomStub(
  env: Env,
  code: string,
  request: Request,
  overrides: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(request.url);
  url.searchParams.set('code', code);
  for (const [name, value] of Object.entries(overrides)) url.searchParams.set(name, value);
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return stub.fetch(new Request(url.toString(), { method: request.method, headers: request.headers }));
}

/** La cola vive en un unico objeto para todo el servicio. */
const QUEUE_NAME = 'matchmaking';

function queueStub(env: Env, params: Record<string, string>): Promise<Response> {
  const url = new URL('https://queue/');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return env.QUEUE.get(env.QUEUE.idFromName(QUEUE_NAME)).fetch(url.toString());
}

/** Crea una sala nueva probando codigos hasta que uno este libre. */
async function createRoomStub(
  env: Env,
  request: Request,
  overrides: Record<string, string> = {},
): Promise<{ response: Response; code: string } | null> {
  // Con mil millones de codigos posibles la colision es rarisima, pero es barato
  // comprobarlo: la sala responde 409 si ya existe y se prueba con otro.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const response = await roomStub(env, code, request, overrides);
    if (response.status !== 409) return { response, code };
  }
  return null;
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

    // La version manda sobre el resto: a un cliente viejo, "parametros invalidos" no le sirve
    // de nada, y ademas sus parametros pueden ser invalidos justo por ser viejo. El rechazo
    // va por el socket y no como HTTP porque el navegador no le deja leer al cliente el
    // motivo de un upgrade fallido, y este es el unico que el jugador arregla solo. AC-905.
    if (!isProtocolCurrent(url.searchParams)) return refuseSocket(PROTOCOL_STALE_MESSAGE);

    const intent = parseIntent(url.searchParams);
    if (intent === null) return new Response('Parametros de conexion invalidos', { status: 400 });

    // `match` se resuelve aqui a una de las dos acciones de siempre, y por eso tiene que
    // ser antes del apreton de manos: con `match` no hay codigo que mirar todavia, y hay
    // que saber a que objeto mandar la conexion (AC-202 de 005).
    if (intent.a === 'match') {
      const key = matchKey(intent);
      const claimed = (await queueStub(env, { op: 'claim', key }).then((r) =>
        r.json(),
      )) as MatchOutcome;

      if (claimed.a === 'join') {
        // `match=1` pide una respuesta enrutable en vez de un rechazo por el socket: si la
        // sala ya no admite a nadie no es un error del jugador, es que hay que crear otra.
        const response = await roomStub(env, claimed.code, request, { a: 'join', match: '1' });
        if (response.status !== 409) return response;
      }

      const created = await createRoomStub(env, request, { a: 'create' });
      if (created === null) return new Response('No se pudo crear la sala', { status: 503 });
      // Quien no encontro rival se queda esperando por sus ajustes.
      await queueStub(env, { op: 'offer', key, code: created.code });
      return created.response;
    }

    if (intent.a === 'create') {
      const created = await createRoomStub(env, request);
      if (created === null) return new Response('No se pudo crear la sala', { status: 503 });
      return created.response;
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
    await this.ctx.storage.setAlarm(this.nextAlarmAt());
  }

  /**
   * Un Durable Object solo puede tener una alarma, asi que la manda la mas urgente: si hay
   * alguien ausente en una partida viva hay que despertar a cobrarle el abandono, y si no,
   * basta con volver a tiempo de limpiar la sala.
   */
  private nextAlarmAt(now = Date.now()): number {
    if (this.room !== null && this.room.game.status === 'playing') {
      const deadlines: number[] = [];
      // El plazo de ausencia sale de `absenceMsLeft` y no de una cuenta propia. Calcularlo
      // aparte fue justamente el fallo: sumando ABSENCE_FORFEIT_MS a `disconnectedAt` se
      // ignora lo ya gastado en ausencias anteriores (AC-1104), asi que cada reconexion
      // empujaba la alarma dos minutos mas alla y la cuenta del HUD llegaba a cero sin que
      // pasara nada. Es lo que el comentario de esa funcion venia advirtiendo.
      for (const color of ['w', 'b'] as const) {
        const left = absenceMsLeft(this.room, color, now);
        if (left !== null) deadlines.push(now + left);
      }
      // La bandera cae sola y en el momento (AC-1406): si toca antes que una ausencia, la
      // alarma es esa. Un Durable Object solo puede tener una, asi que manda la mas urgente.
      const flag = this.room.clock === null
        ? null
        : flagFallsAt(this.room.clock, clockRunningFor(this.room));
      if (flag !== null) deadlines.push(flag);
      // Un segundo de margen: al despertar el plazo tiene que estar cumplido, no justo.
      if (deadlines.length > 0) return Math.min(...deadlines) + 1_000;
    }
    return now + ROOM_TTL_MS + 60_000;
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

  /** Los eventos llegan a los dos asientos con la vista de cada uno, sea un movimiento o
   * un final por abandono: el cliente no necesita distinguirlos. */
  private broadcastEvents(events: GameEvent[]): void {
    if (this.room === null || events.length === 0) return;
    for (const seatColor of ['w', 'b'] as const) {
      this.send(seatColor, { t: 'moved', events, view: viewFor(this.room, seatColor) });
    }
  }

  /** Quien ha pedido la revancha, para que el boton diga si esta esperando o le esperan. */
  private broadcastRematchState(): void {
    if (this.room === null) return;
    for (const color of ['w', 'b'] as const) {
      this.send(color, {
        t: 'rematch',
        mine: this.room.seats[color]?.wantsRematch === true,
        theirs: this.room.seats[opponentOf(color)]?.wantsRematch === true,
      });
    }
  }

  /** Quien ha ofrecido tablas, por el mismo motivo: una oferta muda no se ve. */
  private broadcastDrawState(): void {
    if (this.room === null) return;
    for (const color of ['w', 'b'] as const) {
      this.send(color, {
        t: 'draw',
        mine: this.room.seats[color]?.offersDraw === true,
        theirs: this.room.seats[opponentOf(color)]?.offersDraw === true,
        movesLeft: drawMovesLeft(this.room, color),
      });
    }
  }

  /**
   * El reloj de la sala. Se manda lo que le queda a cada uno en ESTE instante; el cliente
   * apunta cuando lo recibio y descuenta desde ahi (AC-1412).
   */
  private broadcastClock(): void {
    if (this.room === null || this.room.clock === null) return;
    const running = clockRunningFor(this.room);
    const at = Date.now();
    const left = {
      w: clockMsLeft(this.room.clock, 'w', running, at),
      b: clockMsLeft(this.room.clock, 'b', running, at),
    };
    for (const color of ['w', 'b'] as const) this.send(color, { t: 'clock', left, running });
  }

  private broadcastPresence(): void {
    if (this.room === null) return;
    for (const color of ['w', 'b'] as const) {
      const rival = opponentOf(color);
      // Si el rival esta ausente, se manda tambien cuanto le queda: esperar sin saber
      // cuanto obliga a elegir entre quedarse a ciegas o irse.
      const msLeft = absenceMsLeft(this.room, rival);
      this.send(color, {
        t: 'opponent',
        connected: this.room.seats[rival]?.connected === true,
        ...(msLeft === null ? {} : { msLeft }),
      });
    }
  }

  /** Error de usuario: se acepta el socket solo para poder explicarlo y se cierra. */
  private refuse(message: string): Response {
    return refuseSocket(message);
  }

  /**
   * Da de baja esta sala de la cola de emparejamiento (AC-401 de 005).
   *
   * Lo hace el objeto y no `room.ts`: aqui es donde vive el pegamento —los sockets, la
   * hibernacion, las alarmas— y la logica de sala sigue sin saber que existe una cola, igual
   * que no sabe que existen los WebSockets.
   */
  private async dropFromQueue(): Promise<void> {
    if (this.room === null) return;
    await queueStub(this.env, { op: 'drop', code: this.room.code });
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

    // Un emparejamiento que llega a una sala que ya no existe, o que ya se lleno, no es un
    // error del jugador: se contesta con un estado que el enrutado pueda leer para crear
    // otra, en vez de un rechazo por el socket que el jugador no puede arreglar (AC-402).
    const routable = url.searchParams.get('match') === '1';
    const unavailable = (): Response => new Response('Sala no disponible', { status: 409 });

    if (this.room === null) {
      return routable ? unavailable() : this.refuse('No existe ninguna sala con ese codigo');
    }

    const seat =
      intent.a === 'resume'
        ? resumeSeat(this.room, intent.token)
        : takeSeat(this.room);
    if (isRoomError(seat)) return routable ? unavailable() : this.refuse(seat.error);

    // La sala acaba de llenarse: deja de estar disponible para el siguiente que pida rival.
    if (routable) await this.dropFromQueue();

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
    this.broadcastClock();
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
        this.broadcastEvents(result.events);
        // La oferta que viaja con la jugada se aplica DESPUES de ella (AC-1413). Si no se
        // puede —cooldown, o la jugada acabo la partida— se dice y el movimiento queda:
        // deshacerlo por una oferta seria mucho peor que no ofrecer.
        if (message.offerDraw === true) {
          const offered = offerDraw(this.room, color);
          if (isRoomError(offered)) ws.send(encode({ t: 'error', message: offered.error }));
          else if (offered.agreed) this.broadcastEvents(offered.events);
        }
        // Mover contesta a la oferta del rival y desbloquea la propia (AC-1306/1308), asi
        // que el acuerdo cambia en CADA movimiento. Sin avisarlo, los botones se quedan
        // puestos y pulsar "aceptar" despues de mover vuelve a ofrecer tablas.
        this.broadcastDrawState();
        this.broadcastClock();
        await this.save();
        return;
      }

      case 'draw': {
        const offered = offerDraw(this.room, color);
        if (isRoomError(offered)) {
          return ws.send(encode({ t: 'error', message: offered.error }));
        }
        // Con una sola oferta no termina nada: se avisa a los dos y se espera respuesta.
        // Acordadas, solo va el final: mandar ademas el acuerdo en blanco se leeria como un
        // rechazo justo antes de las tablas, y el boton ya desaparece con la partida.
        if (offered.agreed) this.broadcastEvents(offered.events);
        else this.broadcastDrawState();
        await this.save();
        return;
      }

      case 'draw-decline': {
        const refused = declineDraw(this.room, color);
        if (isRoomError(refused)) {
          return ws.send(encode({ t: 'error', message: refused.error }));
        }
        this.broadcastDrawState();
        await this.save();
        return;
      }

      case 'rematch': {
        const asked = requestRematch(this.room, color);
        if (isRoomError(asked)) {
          return ws.send(encode({ t: 'error', message: asked.error }));
        }
        // Con una sola peticion no se reinicia nada: se avisa a los dos y se espera.
        if (!asked.agreed) {
          this.broadcastRematchState();
          await this.save();
          return;
        }
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
        // Partida nueva: relojes a cero y en marcha (AC-1411).
        this.broadcastClock();
        await this.save();
        return;
      }

      case 'leave': {
        // Irse a proposito cuesta la partida; el cierre del socket por si solo no.
        const result = leaveRoom(this.room, color);
        if (!isRoomError(result)) {
          this.broadcastEvents(result.events);
          await this.save();
        }
        return ws.close(1000, 'Salida voluntaria');
      }

      default:
        return ws.send(encode({ t: 'error', message: 'Mensaje desconocido' }));
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = this.attachmentOf(ws);
    if (attachment === null || this.room === null) return;
    // Quien esperaba rival deja de estar disponible ahora, no cuando caduque la entrada
    // (AC-301 y AC-302 de 005). Si la sala ya estaba llena, esto no encuentra nada.
    await this.dropFromQueue();
    // Si esta conexion ya habia sido reemplazada por otra, su cierre no significa nada.
    this.recent.delete(attachment.session);
    if (!markDisconnected(this.room, attachment.color, attachment.session)) return;
    this.broadcastPresence();
    // La ausencia para el reloj (AC-1408). `save` reprograma la alarma, que con el reloj
    // parado ya no tiene bandera que cobrar.
    this.broadcastClock();
    await this.save();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /**
   * Despertar sirve para dos cosas: cobrar un abandono por ausencia y, cuando ya no queda
   * nadie, borrar el almacenamiento en vez de dejarlo ahi para siempre.
   */
  async alarm(): Promise<void> {
    if (this.room !== null) {
      const out = forfeitTimeout(this.room);
      if (out !== null) {
        this.broadcastEvents(out.events);
        this.broadcastClock();
      }
      const abandoned = forfeitAbsent(this.room);
      if (abandoned) {
        this.broadcastEvents(abandoned.events);
        await this.save();
        return;
      }
    }
    if (this.room !== null && !isStale(this.room)) {
      await this.ctx.storage.setAlarm(this.nextAlarmAt());
      return;
    }
    this.room = null;
    await this.ctx.storage.deleteAll();
  }
}

// ---------------------------------------------------------------------------
// Durable Object: la cola de emparejamiento.
// ---------------------------------------------------------------------------

/**
 * Un unico objeto para todo el servicio, con una entrada por combinacion de ajustes: la sala
 * que esta esperando rival (AC-103 de 005).
 *
 * Es diminuto a proposito. No guarda partidas ni jugadores, solo a que sala mandar al
 * siguiente que pida esos ajustes, y las salas siguen sin saber que existe.
 */
export class Queue implements DurableObject {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get('key') ?? '';
    const code = url.searchParams.get('code') ?? '';

    switch (url.searchParams.get('op')) {
      case 'claim': {
        const entry = (await this.ctx.storage.get<QueueEntry>(key)) ?? null;
        // Se borra se entregue o no: una entrada se reclama UNA vez. Dos jugadores que
        // piden a la vez no pueden llevarse la misma sala, y el almacenamiento del objeto
        // es de un solo hilo, asi que esto no necesita mas cerrojo que el que ya tiene.
        if (entry !== null) await this.ctx.storage.delete(key);
        return Response.json(resolveMatch(entry, Date.now()) satisfies MatchOutcome);
      }

      case 'offer': {
        await this.ctx.storage.put(key, { code, since: Date.now() } satisfies QueueEntry);
        return new Response(null, { status: 204 });
      }

      case 'drop': {
        // Por codigo y no por clave: la sala no guarda con que ajustes se creo, y el mapa
        // tiene como mucho una entrada por combinacion.
        const all = await this.ctx.storage.list<QueueEntry>();
        for (const [entryKey, entry] of all) {
          if (entry.code === code) await this.ctx.storage.delete(entryKey);
        }
        return new Response(null, { status: 204 });
      }

      default:
        return new Response('Operacion desconocida', { status: 400 });
    }
  }
}
