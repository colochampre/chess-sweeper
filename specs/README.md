# Specs

Trabajo dirigido por especificacion, en su version ligera: antes de escribir codigo se
escribe el `spec.md` de la feature con requisitos numerados (**FR-x**) y criterios de
aceptacion (**AC-xxx**). Despues, **cada test cita en su nombre el criterio que cubre**.

No hace falta ninguna herramienta: la trazabilidad se lee con un grep.

```bash
npm test -- --reporter=verbose      # los AC salen en los nombres de los tests
grep -rn "AC-5" packages/*/tests    # que cubre el criterio AC-5xx
```

## Estado

| Spec | Alcance | Paquete | Tests |
|---|---|---|---|
| [001-core-rules](001-core-rules/spec.md) | Tablero, minas, revelado, trayecto, explosiones, fin de partida, eventos, informacion oculta | `@cm/engine` | 46 |
| [002-ai](002-ai/spec.md) | Creencia sobre las minas, riesgo por movimiento, niveles de dificultad | `@cm/ai` | 21 |
| [003-online](003-online/spec.md) | Salas, autoridad, reconexion, parametros de conexion, Durable Objects, origenes, transporte, abandono, revancha, tablas, reloj | `@cm/engine` + `@cm/worker` + `@cm/server` | 124 |
| [004-interfaz](004-interfaz/spec.md) | Tablero del menu, tablero sin estado, una accion primaria, lo que el menu propone, armazon comun, HUD, tiras de jugador | `@cm/client` | 15 |

## Como anadir una feature

1. Crea `specs/00N-nombre/spec.md` con sus FR y sus AC.
2. Escribe los tests citando los AC, y velos fallar.
3. Implementa hasta que pasen.
4. Si al implementar descubres que un AC estaba mal planteado, **corrige el spec**: la
   especificacion es parte del entregable, no un documento de arranque que se abandona.

Ha pasado ya tres veces:

- El **AC-802** decia que la captura se emitia *antes* del salto de aterrizaje, y al montar la
  animacion quedo claro que tenia que ser justo *despues*. Se cambio el spec, no el test.
- El **AC-305** no existia hasta que, probando el Worker en local, dos jugadores reconectados
  se veian mutuamente ausentes: el cierre tardio de un socket ya reemplazado marcaba el
  asiento como vacio. Primero se escribio el criterio, luego el test, y luego el arreglo.
- El **AC-1401** decia que "Sin reloj" era el defecto, y metia dos defectos distintos en una
  sola frase: el del cable, que protege a quien no eligio, y el del menu, que es una
  propuesta a quien si esta eligiendo. Al cambiar la propuesta a 10+5 quedo claro que solo el
  primero era una garantia. Se separaron, y el segundo se fue a 004 con el test que nunca
  tuvo: nada afirmaba lo que el menu venia ofreciendo.

## Decisiones de diseno que fijan estos specs

- La legalidad **ignora las minas**. Son informacion oculta: no se puede prohibir una casilla
  por si acaso hay algo debajo.
- Una pieza detona **la primera** mina de su trayecto y muere alli, sin completar el
  movimiento ni capturar en el destino.
- El revelado es **compartido**; las banderas rojas son **privadas** de cada jugador.
- Lo unico que sale del motor hacia un cliente o un bot es `PlayerView`, que no contiene el
  array `mines`. La garantia de no hacer trampa es estructural, no una promesa.
