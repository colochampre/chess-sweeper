import {
  applyMove,
  configFor,
  createGame,
  generateRoomCode,
  randomSeed,
  toView,
  type Color,
  type GameEvent,
  type GameState,
  type Move,
  type PlayerView,
  type RoomSettings,
} from '@cm/engine';
import { randomUUID } from 'node:crypto';

export interface Seat {
  color: Color;
  token: string;
  connected: boolean;
}

export interface Room {
  code: string;
  settings: RoomSettings;
  /** VERDAD OCULTA: solo vive aqui, nunca sale por el socket. */
  state: GameState;
  seats: Map<Color, Seat>;
  createdAt: number;
  lastActivity: number;
}

/** Salas vacias mas tiempo que esto se descartan (AC-104). */
export const ROOM_TTL_MS = 10 * 60 * 1000;

export class RoomStore {
  private readonly rooms = new Map<string, Room>();

  private newState(settings: RoomSettings): GameState {
    return createGame(
      configFor(settings.difficulty, {
        files: settings.boardSize,
        ranks: settings.boardSize,
        seed: randomSeed(),
      }),
    );
  }

  /** AC-101: codigo unico de 6 caracteres. */
  create(settings: RoomSettings): { room: Room; seat: Seat } {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();

    const hostColor: Color =
      settings.hostColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.hostColor;

    const room: Room = {
      code,
      settings,
      state: this.newState(settings),
      seats: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    const seat: Seat = { color: hostColor, token: randomUUID(), connected: true };
    room.seats.set(hostColor, seat);
    this.rooms.set(code, room);
    return { room, seat };
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** AC-102: el segundo jugador se sienta en el color que quede libre. */
  join(code: string): { room: Room; seat: Seat } | { error: string } {
    const room = this.rooms.get(code);
    if (room === undefined) return { error: 'No existe ninguna sala con ese codigo' }; // AC-103
    const free: Color | undefined = (['w', 'b'] as const).find((c) => !room.seats.has(c));
    if (free === undefined) return { error: 'La sala ya esta completa' }; // AC-103

    const seat: Seat = { color: free, token: randomUUID(), connected: true };
    room.seats.set(free, seat);
    room.lastActivity = Date.now();
    return { room, seat };
  }

  /** AC-302/303: recupera un asiento tras una desconexion. */
  resume(code: string, token: string): { room: Room; seat: Seat } | { error: string } {
    const room = this.rooms.get(code);
    if (room === undefined) return { error: 'No existe ninguna sala con ese codigo' };
    for (const seat of room.seats.values()) {
      if (seat.token === token) {
        seat.connected = true;
        room.lastActivity = Date.now();
        return { room, seat };
      }
    }
    return { error: 'Ese asiento no es tuyo' };
  }

  /** AC-202/203: unica puerta de entrada para modificar el estado de una sala. */
  play(room: Room, color: Color, move: Move): { events: GameEvent[] } | { error: string } {
    if (room.state.status !== 'playing') return { error: 'La partida ya ha terminado' };
    if (room.state.turn !== color) return { error: 'No es tu turno' }; // AC-203
    try {
      const result = applyMove(room.state, move);
      room.state = result.state;
      room.lastActivity = Date.now();
      return { events: result.events };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Movimiento invalido' }; // AC-202
    }
  }

  /** Nueva partida en la misma sala, con los colores intercambiados. */
  rematch(room: Room): void {
    room.state = this.newState(room.settings);
    const seats = [...room.seats.values()];
    room.seats.clear();
    for (const seat of seats) {
      seat.color = seat.color === 'w' ? 'b' : 'w';
      room.seats.set(seat.color, seat);
    }
    room.lastActivity = Date.now();
  }

  /** AC-204: cada jugador ve solo lo suyo. */
  viewFor(room: Room, color: Color): PlayerView {
    return toView(room.state, color);
  }

  disconnect(room: Room, color: Color): void {
    const seat = room.seats.get(color);
    if (seat) seat.connected = false; // AC-304
    room.lastActivity = Date.now();
  }

  /** AC-104: limpieza periodica de salas abandonadas. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      const empty = [...room.seats.values()].every((s) => !s.connected);
      if (empty && now - room.lastActivity > ROOM_TTL_MS) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.rooms.size;
  }
}
