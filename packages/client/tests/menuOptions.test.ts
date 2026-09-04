/**
 * Lo que el menu viene proponiendo, sin navegador.
 *
 * Las listas y sus defectos son datos planos a proposito: asi se pueden afirmar aqui, que es
 * justo lo que le faltaba al defecto del reloj el dia que se movio.
 */
import { describe, expect, it } from 'vitest';
import { TIME_CONTROLS, isTimeControl } from '@cm/engine';
import {
  DEFAULT_BOT_LEVEL,
  DEFAULT_COLOR,
  DEFAULT_DIFFICULTY,
  DEFAULT_MODE,
  DEFAULT_TIME_CONTROL,
  DIFFICULTIES,
  MODES,
  TIME_OPTIONS,
} from '../src/menuOptions.js';

describe('FR-4 el menu propone, no impone', () => {
  it('AC-401: abre en 10+0 y "Sin reloj" queda al final de la lista', () => {
    expect(DEFAULT_TIME_CONTROL).toBe('10+0');
    expect(TIME_OPTIONS[TIME_OPTIONS.length - 1].value).toBe('none');

    // Y sigue estando: proponer no es imponer. Quien no quiera reloj lo apaga en un clic.
    expect(TIME_OPTIONS.filter((t) => t.value === 'none')).toHaveLength(1);
  });

  it('AC-402: los defectos no son "el primero del array"', () => {
    // Si alguien reordena una lista, esto no se entera — que es exactamente lo que se busca.
    // Lo que tiene que costar un cambio deliberado es mover la constante.
    expect(DEFAULT_TIME_CONTROL).not.toBe(TIME_OPTIONS[0].value);

    // Y cada defecto tiene que existir en su lista: una constante con nombre puede quedar
    // apuntando a una opcion que ya no esta, y eso es un menu que abre sin nada marcado.
    expect(TIME_OPTIONS.map((t) => t.value)).toContain(DEFAULT_TIME_CONTROL);
    expect(MODES.map((m) => m.value)).toContain(DEFAULT_MODE);
    expect(DIFFICULTIES.map((d) => d.value)).toContain(DEFAULT_DIFFICULTY);
    expect(DIFFICULTIES.map((d) => d.value)).toContain(DEFAULT_BOT_LEVEL);
    expect(DEFAULT_COLOR).toBe('random');
  });

  it('AC-404: lo que ofrece el menu no lleva incremento, para que la etiqueta sea cierta', () => {
    // Un boton que dice "10 min" con un control de 10+5 miente: sumaria cinco segundos por
    // jugada y la partida duraria bastante mas de diez minutos.
    for (const option of TIME_OPTIONS) {
      const control = TIME_CONTROLS[option.value];
      if (control === null) continue;
      expect(control.incrementMs, option.label).toBe(0);
    }
  });

  it('AC-403: todo lo que ofrece el menu es un control que el servidor acepta', () => {
    // El conjunto es cerrado en el motor (AC-1401): un valor inventado en el menu no daria
    // un error visible, daria una sala que se rechaza al crearse.
    for (const option of TIME_OPTIONS) {
      expect(isTimeControl(option.value), option.label).toBe(true);
    }
  });
});
