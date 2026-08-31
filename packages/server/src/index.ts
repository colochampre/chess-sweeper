/**
 * Servidor de partidas en LAN. Autoritativo: las minas solo existen aqui.
 *
 *   npm run dev:server            # escucha en 0.0.0.0:8787
 *   PORT=9000 npm run dev:server
 *
 * Si `packages/client/dist` existe, tambien lo sirve como estatico, de modo que una
 * partida en la red local se levanta con un unico comando.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  normalizeRoomCode,
  type ClientMessage,
  type Color,
  type ServerMessage,
} from '@cm/engine';
import { RoomStore, type Room } from './rooms.js';

const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** AC-402: sirve el cliente compilado si esta disponible. */
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
    file = join(CLIENT_DIST, 'index.html'); // SPA
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const rooms = new RoomStore();
const http = createServer(serveStatic);
const wss = new WebSocketServer({ server: http });

interface Session {
  room?: Room;
  color?: Color;
}

const sessions = new Map<WebSocket, Session>();
/** Sockets sentados en cada sala, para poder difundir. */
const members = new Map<string, Map<Color, WebSocket>>();

const send = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

const fail = (socket: WebSocket, message: string): void => send(socket, { t: 'error', message });

function seatSocket(socket: WebSocket, room: Room, color: Color): void {
  const roomMembers = members.get(room.code) ?? new Map<Color, WebSocket>();
  const previous = roomMembers.get(color);
  if (previous && previous !== socket) previous.close(4001, 'Sesion reemplazada');
  roomMembers.set(color, socket);
  members.set(room.code, roomMembers);
  sessions.set(socket, { room, color });
}

function opponentSocket(room: Room, color: Color): WebSocket | undefined {
  return members.get(room.code)?.get(color === 'w' ? 'b' : 'w');
}

function broadcastPresence(room: Room): void {
  for (const color of ['w', 'b'] as const) {
    const socket = members.get(room.code)?.get(color);
    if (!socket) continue;
    const other = room.seats.get(color === 'w' ? 'b' : 'w');
    send(socket, { t: 'opponent', connected: other?.connected === true });
  }
}

function handle(socket: WebSocket, message: ClientMessage): void {
  const session = sessions.get(socket) ?? {};

  switch (message.t) {
    case 'create': {
      const { room, seat } = rooms.create(message.settings);
      seatSocket(socket, room, seat.color);
      send(socket, {
        t: 'seated',
        code: room.code,
        color: seat.color,
        token: seat.token,
        view: rooms.viewFor(room, seat.color), // AC-201/204
      });
      broadcastPresence(room);
      return;
    }

    case 'join': {
      const result = rooms.join(normalizeRoomCode(message.code));
      if ('error' in result) return fail(socket, result.error); // AC-103
      seatSocket(socket, result.room, result.seat.color);
      send(socket, {
        t: 'seated',
        code: result.room.code,
        color: result.seat.color,
        token: result.seat.token, // AC-301
        view: rooms.viewFor(result.room, result.seat.color),
      });
      broadcastPresence(result.room);
      return;
    }

    case 'resume': {
      const result = rooms.resume(normalizeRoomCode(message.code), message.token);
      if ('error' in result) return fail(socket, result.error); // AC-303
      seatSocket(socket, result.room, result.seat.color);
      send(socket, {
        t: 'seated',
        code: result.room.code,
        color: result.seat.color,
        token: result.seat.token,
        view: rooms.viewFor(result.room, result.seat.color), // AC-302
      });
      broadcastPresence(result.room);
      return;
    }

    case 'move': {
      const { room, color } = session;
      if (!room || !color) return fail(socket, 'No estas sentado en ninguna sala');
      const result = rooms.play(room, color, message.move);
      if ('error' in result) {
        fail(socket, result.error);
        send(socket, { t: 'sync', view: rooms.viewFor(room, color) }); // resincroniza al que fallo
        return;
      }
      for (const seatColor of ['w', 'b'] as const) {
        const target = members.get(room.code)?.get(seatColor);
        if (target) {
          send(target, { t: 'moved', events: result.events, view: rooms.viewFor(room, seatColor) });
        }
      }
      return;
    }

    case 'rematch': {
      const { room } = session;
      if (!room) return fail(socket, 'No estas sentado en ninguna sala');
      rooms.rematch(room);
      // Los colores se intercambian: cada socket se resienta en el suyo.
      const roomMembers = members.get(room.code);
      if (roomMembers) {
        const swapped = new Map<Color, WebSocket>();
        for (const [color, member] of roomMembers) swapped.set(color === 'w' ? 'b' : 'w', member);
        members.set(room.code, swapped);
        for (const [color, member] of swapped) {
          sessions.set(member, { room, color });
          send(member, {
            t: 'seated',
            code: room.code,
            color,
            token: room.seats.get(color)?.token ?? '',
            view: rooms.viewFor(room, color),
          });
        }
      }
      return;
    }

    case 'leave': {
      const { room, color } = session;
      if (room && color) {
        rooms.disconnect(room, color);
        members.get(room.code)?.delete(color);
        broadcastPresence(room);
      }
      sessions.delete(socket);
      return;
    }

    default:
      fail(socket, 'Mensaje desconocido');
  }
}

wss.on('connection', (socket) => {
  sessions.set(socket, {});

  socket.on('message', (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return fail(socket, 'Mensaje mal formado'); // AC-403
    }
    try {
      handle(socket, message);
    } catch (err) {
      console.error('Error atendiendo mensaje:', err);
      fail(socket, 'Error interno del servidor'); // AC-403
    }
  });

  socket.on('close', () => {
    const session = sessions.get(socket);
    if (session?.room && session.color) {
      rooms.disconnect(session.room, session.color);
      const roomMembers = members.get(session.room.code);
      if (roomMembers?.get(session.color) === socket) roomMembers.delete(session.color);
      broadcastPresence(session.room);
    }
    sessions.delete(socket);
  });
});

setInterval(() => {
  const removed = rooms.sweep();
  if (removed > 0) console.log(`Salas descartadas por inactividad: ${removed}`);
}, 60_000).unref();

// AC-401: escucha en todas las interfaces para que se vea desde la LAN.
http.listen(PORT, '0.0.0.0', () => {
  console.log(`Chess Minesweeper — servidor en http://0.0.0.0:${PORT}`);
  if (!existsSync(CLIENT_DIST)) {
    console.log('Sin cliente compilado: ejecuta `npm run build` para servirlo desde aqui.');
  }
});
