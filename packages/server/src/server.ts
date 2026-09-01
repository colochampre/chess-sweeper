/**
 * Servidor de partidas sobre Node, para desarrollo y para jugar en LAN.
 *
 * En produccion el que manda es el Worker de Cloudflare (`packages/worker`). Los dos
 * comparten la logica de sala de `@cm/engine`; aqui solo esta el pegamento de Node.
 *
 * Se exporta como funcion arrancable, no como efecto secundario de importar el modulo,
 * para que los tests puedan levantarlo, hablar con el de verdad y apagarlo.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CLOSE_REFUSED,
  CLOSE_REPLACED,
  WS_PATH,
  absenceMsLeft,
  createRoom,
  forfeitAbsent,
  generateRoomCode,
  isOriginAllowed,
  isRoomError,
  isStale,
  leaveRoom,
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
  type GameEvent,
  type RoomState,
  type Seat,
  type ServerMessage,
} from '@cm/engine';

const DEFAULT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

/** Un movimiento son unas decenas de bytes; por encima de esto es basura o un ataque. */
const MAX_MESSAGE_BYTES = 4 * 1024;
/** Cada cuanto se revisan abandonos por ausencia y salas caducadas. */
const SWEEP_MS = 30_000;
/** Cada cuanto se comprueba que las conexiones siguen vivas. */
const HEARTBEAT_MS = 30_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface ServerOptions {
  port?: number;
  host?: string;
  clientDist?: string;
  allowedOrigins?: string[];
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const clientDist = options.clientDist ?? DEFAULT_DIST;
  const rooms = new Map<string, RoomState>();
  /** Sockets sentados en cada sala, para poder difundir. */
  const members = new Map<string, Map<Color, WebSocket>>();

  interface Session {
    room: RoomState;
    color: Color;
    /** Identifica esta conexion; ver `markDisconnected` en el motor. */
    session: string;
    alive: boolean;
  }
  const sessions = new Map<WebSocket, Session>();

  const send = (socket: WebSocket, message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  /** Rechazo con motivo: el cliente recibe el porque y deja de reintentar. */
  const refuse = (socket: WebSocket, message: string): void => {
    send(socket, { t: 'error', message });
    socket.close(CLOSE_REFUSED, 'refused');
  };

  function serveStatic(req: IncomingMessage, res: ServerResponse): void {
    if (!existsSync(clientDist)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Servidor de Chess Minesweeper en marcha. Compila el cliente con `npm run build`.');
      return;
    }
    const url = (req.url ?? '/').split('?')[0];
    const relative = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '');
    let file = join(clientDist, relative);
    if (!file.startsWith(clientDist) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(clientDist, 'index.html');
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }

  function broadcastPresence(room: RoomState): void {
    for (const color of ['w', 'b'] as const) {
      const socket = members.get(room.code)?.get(color);
      if (!socket) continue;
      const rival = opponentOf(color);
      // Si el rival esta ausente, se manda tambien cuanto le queda: esperar sin saber
      // cuanto obliga a elegir entre quedarse a ciegas o irse.
      const msLeft = absenceMsLeft(room, rival);
      send(socket, {
        t: 'opponent',
        connected: room.seats[rival]?.connected === true,
        ...(msLeft === null ? {} : { msLeft }),
      });
    }
  }

  /** Los eventos llegan a los dos asientos con la vista de cada uno, sea un movimiento
   * o un final por abandono: el cliente no necesita distinguirlos. */
  function broadcastEvents(room: RoomState, events: GameEvent[]): void {
    if (events.length === 0) return;
    for (const seatColor of ['w', 'b'] as const) {
      // Un asiento liberado (quien acaba de abandonar) ya no recibe: el Worker resuelve sus
      // sockets por asiento, asi que sin esto los dos transportes no se comportarian igual.
      if (!room.seats[seatColor]) continue;
      const target = members.get(room.code)?.get(seatColor);
      if (target) send(target, { t: 'moved', events, view: viewFor(room, seatColor) });
    }
  }

  function seat(socket: WebSocket, room: RoomState, taken: Seat): void {
    const { color, token, session } = taken;
    const roomMembers = members.get(room.code) ?? new Map<Color, WebSocket>();
    const previous = roomMembers.get(color);
    if (previous && previous !== socket) previous.close(CLOSE_REPLACED, 'Sesion reemplazada');
    roomMembers.set(color, socket);
    members.set(room.code, roomMembers);
    sessions.set(socket, { room, color, session, alive: true });
    send(socket, { t: 'seated', code: room.code, color, token, view: viewFor(room, color) });
    broadcastPresence(room);
  }

  const server = createServer(serveStatic);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  /** Rechazo antes del apreton de manos: se responde HTTP en vez de cortar a lo bruto. */
  const rejectUpgrade = (socket: Duplex, status: number, reason: string): void => {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.pathname !== WS_PATH) return rejectUpgrade(socket, 404, 'Not Found');

    if (!isOriginAllowed({ origin: req.headers.origin ?? null, host, allowed: options.allowedOrigins })) {
      return rejectUpgrade(socket, 403, 'Forbidden');
    }

    const intent = parseIntent(url.searchParams);
    if (intent === null) return rejectUpgrade(socket, 400, 'Bad Request');

    wss.handleUpgrade(req, socket, head, (ws, request) => {
      // Con `noServer: true` nadie emite 'connection' por nosotros: hay que hacerlo aqui.
      // Sin esta linea el socket se conecta pero no escucha nada, y todos los movimientos
      // se descartan en silencio.
      wss.emit('connection', ws, request);

      if (intent.a === 'create') {
        let code = generateRoomCode();
        while (rooms.has(code)) code = generateRoomCode();
        const room = createRoom(code, intent);
        rooms.set(code, room);
        const taken = takeSeat(room);
        if (isRoomError(taken)) return refuse(ws, taken.error);
        return seat(ws, room, taken);
      }

      const room = rooms.get(intent.code);
      if (room === undefined) return refuse(ws, 'No existe ninguna sala con ese codigo');

      const taken = intent.a === 'join' ? takeSeat(room) : resumeSeat(room, intent.token);
      if (isRoomError(taken)) return refuse(ws, taken.error);
      seat(ws, room, taken);
    });
  });

  wss.on('connection', (socket) => {
    socket.on('pong', () => {
      const current = sessions.get(socket);
      if (current) current.alive = true;
    });

    socket.on('message', (raw) => {
      const current = sessions.get(socket);
      if (!current) return refuse(socket, 'No estas sentado en ninguna sala');

      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return send(socket, { t: 'error', message: 'Mensaje mal formado' });
      }

      const { room, color } = current;
      switch (message?.t) {
        case 'move': {
          const result = playMove(room, color, message.move);
          if (isRoomError(result)) {
            send(socket, { t: 'error', message: result.error });
            return send(socket, { t: 'sync', view: viewFor(room, color) });
          }
          broadcastEvents(room, result.events);
          return;
        }
        case 'rematch': {
          rematch(room);
          // Los colores se intercambian: cada socket se resienta en el suyo.
          const roomMembers = members.get(room.code);
          if (!roomMembers) return;
          const swapped = new Map<Color, WebSocket>();
          for (const [c, member] of roomMembers) swapped.set(opponentOf(c), member);
          members.set(room.code, swapped);
          for (const [c, member] of swapped) {
            const seatOfColor = room.seats[c];
            sessions.set(member, {
              room,
              color: c,
              session: seatOfColor?.session ?? '',
              alive: true,
            });
            send(member, {
              t: 'seated',
              code: room.code,
              color: c,
              token: seatOfColor?.token ?? '',
              view: viewFor(room, c),
            });
          }
          return;
        }
        case 'leave': {
          // Irse a proposito cuesta la partida; el cierre del socket por si solo no.
          const result = leaveRoom(room, color);
          if (!isRoomError(result)) broadcastEvents(room, result.events);
          return socket.close(1000, 'Salida voluntaria');
        }
        default:
          return send(socket, { t: 'error', message: 'Mensaje desconocido' });
      }
    });

    socket.on('close', () => {
      const current = sessions.get(socket);
      if (current) {
        const roomMembers = members.get(current.room.code);
        if (roomMembers?.get(current.color) === socket) roomMembers.delete(current.color);
        // Solo cuenta si esta conexion no habia sido ya reemplazada por otra.
        if (markDisconnected(current.room, current.color, current.session)) {
          broadcastPresence(current.room);
        }
      }
      sessions.delete(socket);
    });
  });

  // Conexiones muertas: sin esto, un cliente que desaparece sin cerrar deja al rival esperando.
  const heartbeat = setInterval(() => {
    for (const [socket, current] of sessions) {
      if (!current.alive) {
        socket.terminate();
        continue;
      }
      current.alive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const sweep = setInterval(() => {
    for (const [code, room] of rooms) {
      // Ausentarse demasiado equivale a irse: el rival no tiene que reclamar nada.
      const abandoned = forfeitAbsent(room);
      if (abandoned) broadcastEvents(room, abandoned.events);
      if (isStale(room)) {
        rooms.delete(code);
        members.delete(code);
      }
    }
  }, SWEEP_MS);
  sweep.unref();

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 8787, options.host ?? '0.0.0.0', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 8787);

  return {
    port,
    close: async () => {
      clearInterval(heartbeat);
      clearInterval(sweep);
      for (const socket of sessions.keys()) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => (server as Server).close(() => resolve()));
    },
  };
}
