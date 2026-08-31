/**
 * Servidor de partidas para desarrollo y para jugar en LAN.
 *
 *   npm run dev:server            # escucha en 0.0.0.0:8787
 *   PORT=9000 npm run dev:server
 *
 * En produccion el que manda es el Worker de Cloudflare (`packages/worker`). Los dos
 * comparten la logica de sala de `@cm/engine`; aqui solo esta el pegamento de Node.
 * Si `packages/client/dist` existe, tambien lo sirve, asi que una partida en la red local
 * se levanta con un unico comando.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
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
  type RoomState,
  type Seat,
  type ServerMessage,
} from '@cm/engine';

const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

/** Tope de tamano por mensaje: un movimiento son unas decenas de bytes. */
const MAX_MESSAGE_BYTES = 4 * 1024;
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

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(CLIENT_DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Servidor de Chess Minesweeper en marcha. Compila el cliente con `npm run build`.');
    return;
  }

  const url = (req.url ?? '/').split('?')[0];
  const relative = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '');
  let file = join(CLIENT_DIST, relative);
  if (!file.startsWith(CLIENT_DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(CLIENT_DIST, 'index.html');
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const rooms = new Map<string, RoomState>();
/** Sockets sentados en cada sala, para poder difundir. */
const members = new Map<string, Map<Color, WebSocket>>();

interface Session {
  room: RoomState;
  color: Color;
  alive: boolean;
}
const sessions = new Map<WebSocket, Session>();

const send = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};
const fail = (socket: WebSocket, message: string): void => send(socket, { t: 'error', message });

function broadcastPresence(room: RoomState): void {
  for (const color of ['w', 'b'] as const) {
    const socket = members.get(room.code)?.get(color);
    if (!socket) continue;
    send(socket, { t: 'opponent', connected: room.seats[opponentOf(color)]?.connected === true });
  }
}

function seat(socket: WebSocket, room: RoomState, taken: Seat): void {
  const { color, token } = taken;
  const roomMembers = members.get(room.code) ?? new Map<Color, WebSocket>();
  const previous = roomMembers.get(color);
  if (previous && previous !== socket) previous.close(4001, 'Sesion reemplazada');
  roomMembers.set(color, socket);
  members.set(room.code, roomMembers);
  sessions.set(socket, { room, color, alive: true });
  send(socket, { t: 'seated', code: room.code, color, token, view: viewFor(room, color) });
  broadcastPresence(room);
}

const server = createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== WS_PATH) return socket.destroy();

  // En LAN no se exige `Origin`, pero si viene tiene que ser del mismo host.
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== req.headers.host) return socket.destroy();
    } catch {
      return socket.destroy();
    }
  }

  const intent = parseIntent(url.searchParams);
  if (intent === null) return socket.destroy();

  wss.handleUpgrade(req, socket, head, (ws) => {
    if (intent.a === 'create') {
      let code = generateRoomCode();
      while (rooms.has(code)) code = generateRoomCode();
      const room = createRoom(code, intent);
      rooms.set(code, room);
      const taken = takeSeat(room);
      if (isRoomError(taken)) return fail(ws, taken.error);
      return seat(ws, room, taken);
    }

    const room = rooms.get(intent.code);
    if (room === undefined) return fail(ws, 'No existe ninguna sala con ese codigo');

    const taken = intent.a === 'join' ? takeSeat(room) : resumeSeat(room, intent.token);
    if (isRoomError(taken)) return fail(ws, taken.error);
    seat(ws, room, taken);
  });
});

wss.on('connection', (socket) => {
  socket.on('pong', () => {
    const session = sessions.get(socket);
    if (session) session.alive = true;
  });

  socket.on('message', (raw) => {
    const session = sessions.get(socket);
    if (!session) return fail(socket, 'No estas sentado en ninguna sala');

    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return fail(socket, 'Mensaje mal formado');
    }

    const { room, color } = session;
    switch (message?.t) {
      case 'move': {
        const result = playMove(room, color, message.move);
        if (isRoomError(result)) {
          fail(socket, result.error);
          return send(socket, { t: 'sync', view: viewFor(room, color) });
        }
        for (const seatColor of ['w', 'b'] as const) {
          const target = members.get(room.code)?.get(seatColor);
          if (target) {
            send(target, { t: 'moved', events: result.events, view: viewFor(room, seatColor) });
          }
        }
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
          sessions.set(member, { room, color: c, alive: true });
          send(member, {
            t: 'seated',
            code: room.code,
            color: c,
            token: room.seats[c]?.token ?? '',
            view: viewFor(room, c),
          });
        }
        return;
      }
      case 'leave':
        socket.close(1000, 'Salida voluntaria');
        return;
      default:
        fail(socket, 'Mensaje desconocido');
    }
  });

  socket.on('close', () => {
    const current = sessions.get(socket);
    if (current) {
      markDisconnected(current.room, current.color);
      const roomMembers = members.get(current.room.code);
      if (roomMembers?.get(current.color) === socket) roomMembers.delete(current.color);
      broadcastPresence(current.room);
    }
    sessions.delete(socket);
  });
});

// Conexiones muertas: sin esto, un cliente que desaparece sin cerrar deja al rival esperando.
setInterval(() => {
  for (const [socket, session] of sessions) {
    if (!session.alive) {
      socket.terminate();
      continue;
    }
    session.alive = false;
    socket.ping();
  }
}, HEARTBEAT_MS).unref();

setInterval(() => {
  for (const [code, room] of rooms) {
    if (isStale(room)) {
      rooms.delete(code);
      members.delete(code);
    }
  }
}, ROOM_TTL_MS).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chess Minesweeper — servidor en http://0.0.0.0:${PORT}`);
  if (!existsSync(CLIENT_DIST)) {
    console.log('Sin cliente compilado: ejecuta `npm run build` para servirlo desde aqui.');
  }
});
