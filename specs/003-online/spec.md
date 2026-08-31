# 003 — Partidas en red (LAN)

Estado: **activo** · Paquetes: `@cm/server`, `@cm/client` · Protocolo: `@cm/engine/protocol`

Servidor autoritativo por WebSocket. Guarda el `GameState` completo, con las minas, y a los
clientes solo les manda `PlayerView`. Pensado para jugar en la red local: un solo comando
levanta el servidor, que ademas sirve el cliente ya compilado.

## FR-1 · Salas

- **AC-101** `create` devuelve un codigo de 6 caracteres sin letras ambiguas (ni O, ni I, ni 0/1).
- **AC-102** `join` con un codigo valido sienta al segundo jugador con el color libre.
- **AC-103** `join` con un codigo inexistente o una sala llena responde `error`, no cierra la conexion.
- **AC-104** Una sala vacia durante mas de 10 minutos se descarta.

## FR-2 · Autoridad sobre las minas

- **AC-201** Ningun mensaje del servidor contiene el array `mines`.
- **AC-202** El servidor valida cada `move` con el mismo `applyMove` del motor; un movimiento
  ilegal responde `error` y no cambia el estado.
- **AC-203** Un `move` fuera de turno se rechaza.
- **AC-204** Cada jugador recibe su propia `PlayerView`.

## FR-3 · Reconexion

- **AC-301** Al sentarse, el jugador recibe un `token` de asiento.
- **AC-302** `resume` con el codigo y el token correctos recupera el asiento y hace `sync`.
- **AC-303** `resume` con un token que no corresponde responde `error`.
- **AC-304** Mientras un asiento esta desconectado, el rival recibe `opponent: false`.

## FR-4 · Servicio

- **AC-401** El servidor escucha en `0.0.0.0` para que se vea desde la red local.
- **AC-402** Si existe `packages/client/dist`, lo sirve como estatico en la misma direccion.
- **AC-403** Un mensaje mal formado responde `error` sin tumbar el servidor.
