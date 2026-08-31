# Set de piezas "cburnett"

Autor: Colin M.L. Burnett.
Licencia: **GPL-2.0-or-later** (tambien disponible bajo BSD y CC-BY-SA-3.0 en Wikimedia Commons).
Origen: https://github.com/lichess-org/lila/tree/master/public/piece/cburnett

Es el mismo set que usa Lichess. **No** son las piezas de chess.com: esas son propietarias y
no se pueden redistribuir. Los colores del tablero de esta app si imitan la paleta de chess.com,
que no es material protegible.

## Cambiar de set

Crea `public/assets/pieces/<nombre>/` con los 12 archivos `wK wQ wR wB wN wP bK bQ bR bB bN bP`
en `.svg` y selecciona el set en `src/theme.ts` (`PIECE_SET`). Si tienes sprites propios,
sueltalos ahi y no hace falta tocar nada mas.
