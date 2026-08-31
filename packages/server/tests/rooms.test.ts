import { describe, expect, it } from 'vitest';
import { ROOM_CODE_LENGTH, legalMoves, type RoomSettings } from '@cm/engine';
import { ROOM_TTL_MS, RoomStore } from '../src/rooms.js';

const SETTINGS: RoomSettings = { difficulty: 'normal', boardSize: 8, hostColor: 'w' };

describe('FR-1 salas', () => {
  it('AC-101: el codigo tiene 6 caracteres y evita los ambiguos', () => {
    const rooms = new RoomStore();
    for (let i = 0; i < 60; i++) {
      const { room } = rooms.create(SETTINGS);
      expect(room.code).toHaveLength(ROOM_CODE_LENGTH);
      expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    }
    expect(rooms.size).toBe(60);
  });

  it('AC-102: el segundo jugador ocupa el color libre', () => {
    const rooms = new RoomStore();
    const { room } = rooms.create(SETTINGS);
    const joined = rooms.join(room.code);
    expect('error' in joined).toBe(false);
    if ('error' in joined) return;
    expect(joined.seat.color).toBe('b');
    expect(room.seats.size).toBe(2);
  });

  it('AC-103: codigo inexistente o sala llena responden error', () => {
    const rooms = new RoomStore();
    expect(rooms.join('ZZZZZZ')).toHaveProperty('error');
    const { room } = rooms.create(SETTINGS);
    rooms.join(room.code);
    expect(rooms.join(room.code)).toHaveProperty('error');
  });

  it('AC-104: las salas vacias caducan', () => {
    const rooms = new RoomStore();
    const { room, seat } = rooms.create(SETTINGS);
    expect(rooms.sweep()).toBe(0); // sigue conectado
    seat.connected = false;
    expect(rooms.sweep()).toBe(0); // todavia reciente
    expect(rooms.sweep(Date.now() + ROOM_TTL_MS + 1000)).toBe(1);
    expect(rooms.get(room.code)).toBeUndefined();
  });
});

describe('FR-2 autoridad sobre las minas', () => {
  it('AC-201/204: cada jugador recibe su vista y ninguna lleva las minas', () => {
    const rooms = new RoomStore();
    const { room } = rooms.create(SETTINGS);
    const white = rooms.viewFor(room, 'w');
    const black = rooms.viewFor(room, 'b');
    expect(Object.keys(white)).not.toContain('mines');
    expect(JSON.parse(JSON.stringify(black))).not.toHaveProperty('mines');
    expect(white.as).toBe('w');
    expect(black.as).toBe('b');
  });

  it('AC-202: un movimiento ilegal no toca el estado', () => {
    const rooms = new RoomStore();
    const { room } = rooms.create(SETTINGS);
    const before = room.state;
    expect(rooms.play(room, 'w', { from: 0, to: 40 })).toHaveProperty('error');
    expect(room.state).toBe(before);
  });

  it('AC-203: no se puede mover fuera de turno', () => {
    const rooms = new RoomStore();
    const { room } = rooms.create(SETTINGS);
    const blackMove = legalMoves(room.state, 'b')[0];
    expect(rooms.play(room, 'b', blackMove)).toHaveProperty('error');
  });

  it('un movimiento legal avanza la partida y devuelve eventos', () => {
    const rooms = new RoomStore();
    const { room } = rooms.create(SETTINGS);
    const move = legalMoves(room.state, 'w')[0];
    const result = rooms.play(room, 'w', move);
    expect(result).not.toHaveProperty('error');
    if ('error' in result) return;
    expect(result.events.some((e) => e.type === 'hop')).toBe(true);
    expect(room.state.turn).toBe('b');
  });
});

describe('FR-3 reconexion', () => {
  it('AC-301/302: el token recupera el asiento', () => {
    const rooms = new RoomStore();
    const { room, seat } = rooms.create(SETTINGS);
    seat.connected = false;
    const resumed = rooms.resume(room.code, seat.token);
    expect(resumed).not.toHaveProperty('error');
    if ('error' in resumed) return;
    expect(resumed.seat.color).toBe(seat.color);
    expect(resumed.seat.connected).toBe(true);
  });

  it('AC-303: un token ajeno no recupera nada', () => {
    const rooms = new RoomStore();
    const { room } = rooms.create(SETTINGS);
    expect(rooms.resume(room.code, 'token-inventado')).toHaveProperty('error');
  });

  it('AC-304: al desconectar, el asiento queda marcado', () => {
    const rooms = new RoomStore();
    const { room, seat } = rooms.create(SETTINGS);
    rooms.disconnect(room, seat.color);
    expect(room.seats.get(seat.color)?.connected).toBe(false);
  });

  it('la revancha reparte los colores al reves y reparte minas nuevas', () => {
    const rooms = new RoomStore();
    const { room, seat } = rooms.create(SETTINGS);
    rooms.join(room.code);
    const beforeMines = room.state.mines.join('');
    rooms.rematch(room);
    expect(seat.color).toBe('b');
    expect(room.seats.get('b')).toBe(seat);
    expect(room.state.history).toHaveLength(0);
    expect(room.state.mines.join('')).not.toBe(beforeMines);
  });
});
