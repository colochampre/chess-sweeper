import {
  CLOSE_REFUSED,
  WS_PATH,
  intentToQuery,
  type ClientMessage,
  type ConnectIntent,
  type GameStatus,
  type ServerMessage,
} from '@cm/engine';
// Solo el tipo: se borra al compilar, asi que no crea un ciclo con `store.ts`.
import type { Mode } from './store.js';

const SEAT_KEY = 'cm-online-seat';

export interface SavedSeat {
  code: string;
  token: string;
}

/**
 * Que intentar al entrar por codigo, y con que reserva si el servidor rechaza.
 *
 * Se entra como jugador nuevo PRIMERO y solo se recurre a la credencial guardada si la sala
 * responde que no hay sitio. El orden inverso parece equivalente y no lo es: `localStorage`
 * es del navegador, no de la pestana, asi que dos pestanas del mismo navegador comparten un
 * unico asiento guardado. Yendo por `resume` de entrada, la segunda pestana reclamaria el
 * asiento de la primera y las dos acabarian jugando con el mismo color.
 *
 * Tener token para una sala no significa que el sitio libre sea el nuestro.
 */
export function planConnect(
  code: string,
  saved: SavedSeat | null,
): { first: ConnectIntent; fallback: ConnectIntent | null } {
  return {
    first: { a: 'join', code },
    fallback:
      saved !== null && saved.code === code
        ? { a: 'resume', code, token: saved.token }
        : null,
  };
}

export const loadSeat = (): SavedSeat | null => {
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    return raw ? (JSON.parse(raw) as SavedSeat) : null;
  } catch {
    return null;
  }
};

export const saveSeat = (seat: SavedSeat): void => {
  try {
    localStorage.setItem(SEAT_KEY, JSON.stringify(seat));
  } catch {
    /* modo privado: seguimos sin poder reconectar, no es critico */
  }
};

export const clearSeat = (): void => {
  try {
    localStorage.removeItem(SEAT_KEY);
  } catch {
    /* ignorado */
  }
};

/**
 * En produccion el propio servidor (el Worker de Cloudflare) sirve el cliente, asi que
 * basta con su mismo origen. En desarrollo el cliente vive en el 5173 de Vite y el
 * servidor de LAN en el 8787.
 */
export function serverBase(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = location.port === '5173' ? '8787' : location.port;
  return `${proto}//${location.hostname}${port ? `:${port}` : ''}`;
}

/** A que sala se entra va en la URL, no en un mensaje: es lo que enruta hacia su sala. */
const socketUrl = (intent: ConnectIntent): string =>
  `${serverBase()}${WS_PATH}?${intentToQuery(intent)}`;

export interface OnlineHandlers {
  onMessage(message: ServerMessage): void;
  onOpen(): void;
  /**
   * @param willRetry en false significa que ya no se va a intentar mas.
   * @param deliberate el cierre lo pidio la propia aplicacion (salir al menu). Cerrar a
   * proposito no es un fallo, y anunciarlo como tal contradice lo que el jugador acaba de
   * hacer: confirma que abandona y acto seguido se le dice que fallo la conexion.
   */
  onClose(willRetry: boolean, deliberate: boolean): void;
}

/** Conexion al servidor con reintentos: una caida suele ser momentanea. */
export class OnlineClient {
  private socket: WebSocket | null = null;
  private intent: ConnectIntent | null = null;
  private attempts = 0;
  private closedByUs = false;
  private timer: number | null = null;
  /** Si esta conexion llego a sentarse en la sala. Decide si tiene sentido reintentar. */
  private seated = false;
  /** Mensajes pedidos antes de que el socket estuviera abierto. */
  private queue: ClientMessage[] = [];

  constructor(private readonly handlers: OnlineHandlers) {}

  connect(intent: ConnectIntent): void {
    this.intent = intent;
    this.closedByUs = false;
    this.attempts = 0;
    this.seated = false;
    this.open();
  }

  private open(): void {
    if (this.intent === null) return;
    const socket = new WebSocket(socketUrl(this.intent));
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.handlers.onOpen();
      const pending = this.queue;
      this.queue = [];
      for (const message of pending) socket.send(JSON.stringify(message));
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.t === 'seated') this.seated = true;
        this.handlers.onMessage(message);
      } catch {
        /* mensaje ilegible: lo ignoramos en vez de tumbar la partida */
      }
    };
    socket.onclose = (event) => {
      if (this.closedByUs) return this.handlers.onClose(false, true);

      const seat = loadSeat();
      // Solo se reintenta una conexion que LLEGO A SENTARSE. Si nunca se sento, el problema
      // no es la red y volver a intentarlo no arregla nada: reintentar un `create` fabricaria
      // una sala huerfana por intento, y reintentar un `join` fallido acabaria entrando por
      // `resume` a una partida anterior que no tiene nada que ver con la que se pidio.
      const retry =
        this.seated && seat !== null && event.code !== CLOSE_REFUSED && this.attempts < 6;
      this.handlers.onClose(retry, false);
      if (!retry) return;

      this.intent = { a: 'resume', code: seat.code, token: seat.token };
      this.timer = window.setTimeout(() => this.open(), Math.min(8000, 400 * 2 ** this.attempts));
      this.attempts++;
    };
    socket.onerror = () => socket.close();
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    else this.queue.push(message);
  }

  close(): void {
    this.closedByUs = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.queue = [];
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

/** Lo que el boton de tablas ofrece hacer ahora mismo. */
export interface DrawButton {
  label: string;
  action: 'offer' | 'accept';
  disabled: boolean;
}

/**
 * Estado del boton de tablas, o `null` si no va ninguno.
 *
 * Si se muestra o no se decide aqui y no en el JSX, para que sea comprobable: el cliente no
 * tiene montaje de DOM en los tests, asi que toda la decision vive en esta funcion pura. Y
 * `movesLeft` lo cuenta el servidor (`drawMovesLeft` en el motor), de modo que el boton no
 * ofrezca lo que el servidor va a rechazar.
 */
export function drawButton(offer: {
  mode: Mode;
  status: GameStatus;
  mine: boolean;
  theirs: boolean;
  movesLeft: number;
}): DrawButton | null {
  // Contra la maquina no hay con quien acordar, y en hotseat los dos jugadores ya comparten
  // la mesa. Y con la partida terminada lo que se ofrece es la revancha, no las tablas.
  if (offer.mode !== 'online' || offer.status !== 'playing') return null;
  // Deber jugadas antes de volver a ofrecer no impide decir que si: son cosas distintas.
  if (offer.theirs) return { label: 'Aceptar tablas', action: 'accept', disabled: false };
  if (offer.mine) return { label: 'Tablas ofrecidas', action: 'offer', disabled: true };
  // Un boton que se apaga sin explicarse no se distingue de uno roto: dice lo que falta.
  if (offer.movesLeft > 0) {
    const unit = offer.movesLeft === 1 ? 'jugada' : 'jugadas';
    return { label: `Tablas en ${offer.movesLeft} ${unit}`, action: 'offer', disabled: true };
  }
  return { label: 'Ofrecer tablas', action: 'offer', disabled: false };
}
