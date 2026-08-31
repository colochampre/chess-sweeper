# Notas de balance

Medido con `npm run balance`. El motor es determinista con semilla, asi que todas estas
cifras se reproducen con los mismos comandos.

## Medicion de referencia (30/08/2026)

`npm run balance -- --games 60 --difficulty normal --white normal --black normal --max-plies 220`

| Metrica | Valor |
|---|---|
| Victorias blancas / negras / tablas | 21,7% / 21,7% / 56,7% |
| Duracion media | 109 medias jugadas |
| Partidas decididas por explosion del rey | 16,7% |
| Bajas por mina vs por captura | 52% / 48% |
| Minas detonadas al final de la partida | 75,8% |

**Conclusiones:**

1. **Los colores estan equilibrados**: 13 victorias cada uno. Entre las partidas decisivas,
   las blancas ganan el 50%.
2. **Las dos mitades del juego pesan lo mismo.** Con la densidad `normal` (0,25), algo mas de
   la mitad de las bajas vienen de las minas. Es justo el punto que se buscaba: el buscaminas
   importa sin comerse al ajedrez.
3. **La explosion no decide la partida por si sola**: solo el 16,7% terminan con un rey volando
   por los aires. El resto se resuelven jugando.

## Comparativa de densidades

`--white normal --black normal`, 50 partidas por densidad:

| Densidad | Bajas por mina | Decididas por explosion | Minas detonadas |
|---|---|---|---|
| facil (0,16) | 40,1% | 10,0% | 69,6% |
| normal (0,25) | 52,9% | 18,0% | 77,0% |
| dificil (0,36) | 62,2% | 16,0% | 62,3% |

La progresion es la esperada: subir la dificultad traslada bajas de las capturas a las minas.
En `dificil` bajan las minas detonadas porque los bots juegan mucho mas encerrados.

## Pendiente, y no es un problema de balance

El **53% de las partidas acaban en tablas por la regla de 50 jugadas**. No es aniquilacion
mutua (solo el 1,7% termina por material insuficiente): son dos bots de profundidad 3 sin
busqueda de quiescencia ni conocimiento de finales, incapaces de rematar un final ganado.
Para mejorarlo hace falta tocar el bot, no las minas:

- busqueda de quiescencia sobre las capturas,
- tabla de transposicion,
- una evaluacion de finales que empuje al rey rival hacia la banda.

## Como repetir las medidas

```bash
npm run balance -- --games 200 --difficulty normal --csv balance-results/normal.csv
npm run balance -- --games 60 --white hard --black easy     # fuerza relativa de los niveles
npm run balance -- --games 50 --difficulty normal --size 10 # otro tamano de tablero
npm run balance -- --games 50 --mines 4                     # densidad concreta
```
