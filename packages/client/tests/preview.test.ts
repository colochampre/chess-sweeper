/**
 * El tablero del menu, sin navegador.
 *
 * La escena que dibuja el tablero es un objeto plano derivado de `PlayerView`, asi que se
 * puede comprobar entera aqui aunque `packages/client` no tenga montaje de DOM. Lo que si
 * queda para la pasada a mano es donde se coloca (AC-301, AC-302, AC-304).
 */
import { describe, expect, it } from 'vitest';
import { mineRowRange } from '@cm/engine';
import { DEFAULT_DIFFICULTY } from '../src/menuOptions.js';
import { previewScene } from '../src/boardScene.js';

const rankOf = (sq: number, files: number): number => Math.floor(sq / files);

describe('FR-1 el menu muestra el juego', () => {
  it('AC-101: es la posicion inicial de verdad, con los dos ejercitos completos', () => {
    const scene = previewScene();

    expect(scene.config.files).toBe(8);
    expect(scene.config.ranks).toBe(8);
    expect(scene.pieces).toHaveLength(32);
    expect(scene.pieces.filter((p) => p.color === 'w')).toHaveLength(16);
    expect(scene.pieces.filter((p) => p.color === 'b')).toHaveLength(16);
  });

  it('AC-101: las filas de salida se ven y el centro esta tapado', () => {
    const scene = previewScene();
    const { files } = scene.config;
    const { start, end } = mineRowRange(scene.config);

    // Las cuatro filas de salida estan reveladas: por ahi no hay minas y la cascada arranca
    // desde cada pieza. Si no fuese asi, el menu abriria con una losa gris.
    const home = scene.revealed.filter((_, sq) => rankOf(sq, files) < start || rankOf(sq, files) > end);
    expect(home.every(Boolean)).toBe(true);

    // Y en el centro queda niebla: es la unica parte del juego que no es ajedrez, y es lo que
    // el menu tiene que estar mostrando.
    const central = scene.revealed.filter((_, sq) => {
      const r = rankOf(sq, files);
      return r >= start && r <= end;
    });
    expect(central).toHaveLength((end - start + 1) * files);
    expect(central.some((seen) => !seen)).toBe(true);
  });

  it('AC-102: la escena no lleva las minas, ni ningun otro campo de mas', () => {
    const scene = previewScene();

    // Lista cerrada a proposito. Nadie esta jugando en el menu, asi que colar el `GameState`
    // entero "no rompe nada" hoy — y esa es la frase con la que el modo online heredo los
    // supuestos de un solo jugador. La lista falla el dia que alguien lo intente.
    expect(Object.keys(scene).sort()).toEqual(
      [
        'adjacency',
        'blasts',
        'config',
        'craters',
        'detonated',
        'dying',
        'flags',
        'flipped',
        'lastMove',
        'pieces',
        'revealed',
        'selected',
        'targets',
      ].sort(),
    );
  });

  it('AC-103: la semilla es fija, asi que el menu se dibuja siempre igual', () => {
    expect(previewScene()).toEqual(previewScene());
  });

  it('AC-104/AC-105: no trae nada de una partida viva', () => {
    const scene = previewScene();

    expect(scene.selected).toBeNull();
    expect(scene.lastMove).toBeNull();
    expect(scene.targets).toEqual([]);
    expect(scene.blasts).toEqual([]);
    expect(scene.dying).toEqual([]);
    expect(scene.flags.some(Boolean)).toBe(false);
    expect(scene.craters.some(Boolean)).toBe(false);
    expect(scene.detonated.some(Boolean)).toBe(false);
  });
});

describe('FR-1 el tablero del menu responde a lo que se elige', () => {
  it('AC-106: subir la dificultad espesa la niebla, y bajarla la afloja', () => {
    const tapadas = (d: 'easy' | 'normal' | 'hard'): number =>
      previewScene(d).revealed.filter((seen) => !seen).length;

    expect(tapadas('easy')).toBeLessThan(tapadas('normal'));
    expect(tapadas('normal')).toBeLessThan(tapadas('hard'));
  });

  it('AC-106: sin decir nada se dibuja la dificultad que el menu viene proponiendo', () => {
    expect(previewScene()).toEqual(previewScene(DEFAULT_DIFFICULTY));
  });
});
