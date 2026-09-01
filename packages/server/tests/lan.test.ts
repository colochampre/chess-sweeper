/**
 * Tests de integracion del servidor de LAN: levantan el servidor de verdad y hablan con el
 * por WebSocket.
 *
 * Existen porque los 83 tests de logica no cubrian ni una linea del pegamento de transporte,
 * y por ahi se colo que `wss.handleUpgrade` con `noServer: true` no emite 'connection': el
 * servidor sentaba al jugador y despues descartaba todos sus mensajes en silencio. Compilaba
 * y los tests pasaban.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { type ClientOptions } from 'ws';
import type { ServerMessage } from '@cm/engine';
import { startServer, type RunningServer } from '../src/server.js';

let server: RunningServer;

beforeEach(async () => {
  // Puerto 0: el sistema elige uno libre, asi los tests no chocan con nada.
  server = await startServer({ port: 0, host: '127.0.0.1', clientDist: '/no-existe' });
});
afterEach(async () => {
  await server.close();
});

interface Client {
  socket: WebSocket;
  messages: ServerMessage[];
  /** Espera un mensaje de ese tipo; con `match` se puede exigir ademas una condicion. */
  waitFor: (
    type: ServerMessage['t'],
    match?: (m: ServerMessage) => boolean,
    ms?: number,
  ) => Promise<ServerMessage>;
  opened: Promise<boolean>;
  closeCode: () => number | null;
  send: (message: unknown) => void;
  bye: () => void;
}

function connect(query: string, options: ClientOptions = {}): Client {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?${query}`, options);
  const messages: ServerMessage[] = [];
  const waiters: {
    type: string;
    match: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
  }[] = [];
  let closeCode: number | null = null;

  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw)) as ServerMessage;
    messages.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === message.t && waiters[i].match(message)) {
        waiters.splice(i, 1)[0].resolve(message);
      }
    }
  });
  socket.on('close', (code) => {
    closeCode = code;
  });
  socket.on('error', () => undefined);

  const opened = new Promise<boolean>((resolve) => {
    socket.on('open', () => resolve(true));
    socket.on('error', () => resolve(false));
    socket.on('unexpected-response', () => resolve(false));
  });

  return {
    socket,
    messages,
    opened,
    closeCode: () => closeCode,
    send: (message) => socket.send(JSON.stringify(message)),
    bye: () => socket.terminate(),
    waitFor: (type, match = () => true, ms = 3000) =>
      new Promise<ServerMessage>((resolve, reject) => {
        const found = messages.find((m) => m.t === type && match(m));
        if (found) return resolve(found);
        waiters.push({ type, match, resolve });
        setTimeout(() => reject(new Error(`no llego ningun mensaje "${type}" en ${ms}ms`)), ms);
      }),
  };
}

const CREATE = 'a=create&difficulty=normal&boardSize=8&hostColor=w';

/** Comprueba que NO llega un mensaje de ese tipo en la ventana dada. */
const notReceived = async (client: Client, type: ServerMessage['t'], ms = 600): Promise<boolean> => {
  await new Promise((r) => setTimeout(r, ms));
  return !client.messages.some((m) => m.t === type);
};

describe('FR-8 el servidor de LAN atiende de verdad', () => {
  it('AC-801: un movimiento legal produce `moved` (regresion: el emit de connection)', async () => {
    const host = connect(CREATE);
    expect(await host.opened).toBe(true);
    await host.waitFor('seated');

    // Peon e2-e4: casillas 12 -> 28.
    host.send({ t: 'move', move: { from: 12, to: 28 } });
    const moved = await host.waitFor('moved');

    expect(moved.t).toBe('moved');
    if (moved.t !== 'moved') return;
    expect(moved.events.some((e) => e.type === 'hop')).toBe(true);
    expect(moved.view.turn).toBe('b');
    host.bye();
  });

  it('AC-801: un movimiento ilegal responde error y resincroniza', async () => {
    const host = connect(CREATE);
    await host.waitFor('seated');
    host.send({ t: 'move', move: { from: 0, to: 40 } });

    expect((await host.waitFor('error')).t).toBe('error');
    expect((await host.waitFor('sync')).t).toBe('sync');
    host.bye();
  });

  it('AC-801: un mensaje ilegible no tumba la conexion', async () => {
    const host = connect(CREATE);
    await host.waitFor('seated');
    host.socket.send('{ esto no es json');

    await host.waitFor('error');
    expect(host.socket.readyState).toBe(WebSocket.OPEN);
    host.bye();
  });

  it('AC-802: dos jugadores se ven y el movimiento le llega al rival', async () => {
    const host = connect(CREATE);
    const seated = await host.waitFor('seated');
    if (seated.t !== 'seated') return;

    const guest = connect(`a=join&code=${seated.code}`);
    const guestSeated = await guest.waitFor('seated');
    if (guestSeated.t !== 'seated') return;
    expect(guestSeated.color).toBe('b');

    // Cada uno recibe que el rival esta presente.
    const presence = await guest.waitFor('opponent', (m) => m.t === 'opponent' && m.connected);
    expect(presence.t === 'opponent' && presence.connected).toBe(true);

    host.send({ t: 'move', move: { from: 12, to: 28 } });
    const relayed = await guest.waitFor('moved');
    expect(relayed.t === 'moved' && relayed.view.turn).toBe('b');

    host.bye();
    guest.bye();
  });

  it('AC-803: al irse un jugador, el rival se entera', async () => {
    const host = connect(CREATE);
    const seated = await host.waitFor('seated');
    if (seated.t !== 'seated') return;

    const guest = connect(`a=join&code=${seated.code}`);
    await guest.waitFor('seated');
    // Hay que esperar al aviso de presencia concreto, no a uno cualquiera: el primero que
    // recibe el anfitrion dice que esta solo, y llegaria antes de que entre el invitado.
    await host.waitFor('opponent', (m) => m.t === 'opponent' && m.connected);

    guest.bye();
    const presence = await host.waitFor('opponent', (m) => m.t === 'opponent' && !m.connected);
    expect(presence.t === 'opponent' && presence.connected).toBe(false);
    host.bye();
  });
});

describe('FR-9 los rechazos se explican', () => {
  it('AC-901: un codigo inexistente abre el socket y dice por que se rechaza', async () => {
    const client = connect('a=join&code=ZZZZZZ');
    expect(await client.opened).toBe(true);

    const error = await client.waitFor('error');
    expect(error.t === 'error' && error.message).toMatch(/No existe/i);
    // Y cierra: el cliente no debe quedarse reintentando contra una sala que no esta.
    await new Promise((r) => setTimeout(r, 300));
    expect(client.closeCode()).toBe(4002);
  });

  it('AC-902: un origen ajeno se rechaza con 403, no cortando la conexion a secas', async () => {
    const client = connect(CREATE, { origin: 'https://evil.example.com' });
    expect(await client.opened).toBe(false);
    expect(await notReceived(client, 'seated')).toBe(true);
  });

  it('AC-903: el circuito de desarrollo (Vite en otro puerto) SI se acepta', async () => {
    const client = connect(CREATE, { origin: `http://127.0.0.1:5173` });
    expect(await client.opened).toBe(true);
    expect((await client.waitFor('seated')).t).toBe('seated');
    client.bye();
  });

  it('AC-904: parametros invalidos se rechazan antes del apreton de manos', async () => {
    const client = connect('a=borrar-todo&code=ABC234');
    expect(await client.opened).toBe(false);
  });
});

describe('FR-11 abandonar una partida', () => {
  it('AC-1102/AC-1107: al abandonar, el rival recibe el final por el mismo evento `end`', async () => {
    const host = connect(CREATE);
    const seated = await host.waitFor('seated');
    if (seated.t !== 'seated') return;

    const guest = connect(`a=join&code=${seated.code}`);
    const guestSeated = await guest.waitFor('seated');
    if (guestSeated.t !== 'seated') return;
    await host.waitFor('opponent', (m) => m.t === 'opponent' && m.connected);

    host.send({ t: 'leave' });

    const ended = await guest.waitFor('moved');
    if (ended.t !== 'moved') return;
    expect(ended.events).toEqual([
      { type: 'end', status: 'abandoned', winner: guestSeated.color, reason: 'abandoned' },
    ]);
    // Y la vista que acompana al evento ya viene con la partida terminada.
    expect(ended.view.status).toBe('abandoned');
    expect(ended.view.winner).toBe(guestSeated.color);

    host.bye();
    guest.bye();
  });

  it('AC-1103: caerse no termina la partida, solo marca ausencia', async () => {
    const host = connect(CREATE);
    const seated = await host.waitFor('seated');
    if (seated.t !== 'seated') return;

    const guest = connect(`a=join&code=${seated.code}`);
    await guest.waitFor('seated');
    await host.waitFor('opponent', (m) => m.t === 'opponent' && m.connected);

    // Se corta sin avisar: el rival se entera de la ausencia, pero nadie gana todavia.
    guest.bye();
    await host.waitFor('opponent', (m) => m.t === 'opponent' && !m.connected);
    expect(await notReceived(host, 'moved')).toBe(true);

    host.bye();
  });

  it('AC-1108: quien abandona libera su asiento y puede volver a entrar por el codigo', async () => {
    const host = connect(CREATE);
    const seated = await host.waitFor('seated');
    if (seated.t !== 'seated') return;

    const guest = connect(`a=join&code=${seated.code}`);
    await guest.waitFor('seated');
    await host.waitFor('opponent', (m) => m.t === 'opponent' && m.connected);

    host.send({ t: 'leave' });
    await guest.waitFor('moved');
    host.bye();

    // El asiento quedo libre: entrar con el codigo ya no responde "la sala esta completa".
    const again = connect(`a=join&code=${seated.code}`);
    const backSeated = await again.waitFor('seated');
    expect(backSeated.t).toBe('seated');

    guest.bye();
    again.bye();
  });

  it('AC-1105: irse antes de que llegue el rival deja el asiento libre', async () => {
    const host = connect(CREATE);
    const seated = await host.waitFor('seated');
    if (seated.t !== 'seated') return;

    host.send({ t: 'leave' });
    await new Promise((r) => setTimeout(r, 200));

    // La sala sigue admitiendo a alguien: no quedo un asiento fantasma ocupandola.
    const other = connect(`a=join&code=${seated.code}`);
    const otherSeated = await other.waitFor('seated');
    expect(otherSeated.t).toBe('seated');

    host.bye();
    other.bye();
  });
});
