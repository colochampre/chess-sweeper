import {
  CLOSE_REFUSED,
  WS_PATH,
  intentToQuery,
  type ClientMessage,
  type ConnectIntent,
  type ServerMessage,
} from '@cm/engine';

const SEAT_KEY = 'cm-online-seat';

export interface SavedSeat {
  code: string;
  token: string;
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
  /** `willRetry` en false significa que ya no se va a intentar mas. */
  onClose(willRetry: boolean): void;
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
      if (this.closedByUs) return this.handlers.onClose(false);

      const seat = loadSeat();
      // Solo se reintenta una conexion que LLEGO A SENTARSE. Si nunca se sento, el problema
      // no es la red y volver a intentarlo no arregla nada: reintentar un `create` fabricaria
      // una sala huerfana por intento, y reintentar un `join` fallido acabaria entrando por
      // `resume` a una partida anterior que no tiene nada que ver con la que se pidio.
      const retry =
        this.seated && seat !== null && event.code !== CLOSE_REFUSED && this.attempts < 6;
      this.handlers.onClose(retry);
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
