# 002 — Bot

Estado: **activo** · Paquete: `@cm/ai` · Tests: `packages/ai/tests/*.test.ts`

El bot recibe unicamente un `PlayerView`: no ve `mines` ni las banderas del rival. Toda su
ventaja viene de buscar mas profundo y de estimar mejor donde estan las minas, nunca de
mirar el campo real.

## FR-1 · Informacion oculta

- **AC-101** `chooseMove` solo accede a `PlayerView`; no existe forma de leer `mines` desde el.
- **AC-102** Con la misma vista, la misma dificultad y la misma semilla, elige el mismo movimiento.
- **AC-103** El movimiento devuelto siempre es legal en la posicion dada.
- **AC-104** Devuelve `null` si no hay movimientos legales.

## FR-2 · Creencia sobre las minas

`estimateMines(view)` asigna a cada casilla una probabilidad de contener mina.

- **AC-201** Toda casilla fuera de las filas centrales tiene probabilidad 0.
- **AC-202** Toda casilla ya revelada tiene probabilidad 0.
- **AC-203** Una casilla marcada en `knownMines` tiene probabilidad 1.
- **AC-204** Si una casilla revelada con numero `n` tiene exactamente `n` vecinas
  desconocidas, todas ellas tienen probabilidad 1.
- **AC-205** Si una casilla revelada tiene numero 0, ninguna de sus vecinas puede ser mina.
- **AC-206** Con el modo exacto, la suma de probabilidades de la frontera coincide con el
  numero esperado de minas de esa frontera.
- **AC-207** Sin ninguna pista, todas las casillas candidatas comparten la probabilidad a
  priori `minasRestantes / candidatas`.

## FR-3 · Riesgo de un movimiento

- **AC-301** El riesgo de un movimiento es la perdida material esperada al detonar la
  primera mina de su trayecto, contando las piezas propias y rivales del area de explosion.
- **AC-302** Un caballo solo arriesga en su casilla de destino.
- **AC-303** Un movimiento cuyo trayecto entero tiene probabilidad 0 tiene riesgo 0.

## FR-4 · Dificultades

- **AC-401** `easy` juega a profundidad 1, con ruido aleatorio y solo la probabilidad a priori.
- **AC-402** `normal` busca a profundidad 3 con la estimacion heuristica.
- **AC-403** `hard` busca mas profundo que `normal` y usa la estimacion exacta en la frontera.
- **AC-404** En igualdad de condiciones, `hard` gana a `easy` en una serie de partidas.
- **AC-405** Ninguna llamada supera el presupuesto de nodos configurado.
