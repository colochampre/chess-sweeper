import type { ClientMessage, ServerMessage } from '@cm/engine';

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
 * En desarrollo el cliente vive en el 5173 de Vite y el servidor en el 8787.
 * En produccion el propio servidor sirve el cliente, asi que basta con su mismo origen.
 */
export function defaultServerUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = location.port === '5173' ? '8787' : location.port;
  return `${proto}//${location.hostname}${port ? `:${port}` : ''}`;
}

export interface OnlineHandlers {
  onMessage(message: ServerMessage): void;
  /** `reconnected` es true cuando se recupera una conexion caida, no en la primera. */
  onOpen(reconnected: boolean): void;
  onClose(): void;
}

/** Conexion al servidor con reintentos: en LAN una caida suele ser momentanea. */
export class OnlineClient {
  private socket: WebSocket | null = null;
  private attempts = 0;
  private closedByUs = false;
  private timer: number | null = null;
  /** Mensajes pedidos antes de que el socket estuviera abierto. */
  private queue: ClientMessage[] = [];

  constructor(
    private readonly url: string,
    private readonly handlers: OnlineHandlers,
  ) {}

  connect(): void {
    this.closedByUs = false;
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      const reconnected = this.attempts > 0;
      this.attempts = 0;
      // Primero el handler (que puede enviar `resume`), y despues lo que quedo en cola.
      this.handlers.onOpen(reconnected);
      const pending = this.queue;
      this.queue = [];
      for (const message of pending) socket.send(JSON.stringify(message));
    };
    socket.onmessage = (event) => {
      try {
        this.handlers.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        /* mensaje ilegible: lo ignoramos en vez de tumbar la partida */
      }
    };
    socket.onclose = () => {
      this.handlers.onClose();
      if (this.closedByUs || this.attempts >= 6) return;
      const delay = Math.min(8000, 400 * 2 ** this.attempts);
      this.attempts++;
      this.timer = window.setTimeout(() => this.connect(), delay);
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
