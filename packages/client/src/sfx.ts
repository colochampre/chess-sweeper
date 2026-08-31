/**
 * Efectos de sonido sintetizados con la Web Audio API.
 *
 * No hay archivos de audio: todo se genera en el momento. Asi el bundle no engorda,
 * no hay licencias que arrastrar y cada sonido se afina cambiando un numero.
 *
 * El contexto se crea perezosamente y se reanuda solo, porque los navegadores no dejan
 * sonar nada hasta que el usuario ha interactuado con la pagina.
 */

const STORAGE_KEY = 'cm-sound';

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

let enabled = ((): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
})();

export const soundEnabled = (): boolean => enabled;

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    /* modo privado: el ajuste no sobrevive a la recarga, no es grave */
  }
  if (value) audio(); // reanuda el contexto aprovechando el clic del propio interruptor
}

function audio(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  if (ctx === null) {
    const Ctor: Ctor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (Ctor === undefined) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Ruido blanco de un segundo, reutilizado por todos los golpes y la explosion. */
function noise(ac: AudioContext): AudioBuffer {
  if (noiseBuffer === null) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

interface ToneOptions {
  from: number;
  to?: number;
  type?: OscillatorType;
  at?: number;
  duration: number;
  gain: number;
}

function tone(ac: AudioContext, o: ToneOptions): void {
  const start = ac.currentTime + (o.at ?? 0);
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.from, start);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(o.to, start + o.duration);

  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(o.gain, start + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, start + o.duration);

  osc.connect(env).connect(master as GainNode);
  osc.start(start);
  osc.stop(start + o.duration + 0.02);
}

interface BurstOptions {
  at?: number;
  duration: number;
  gain: number;
  filterFrom: number;
  filterTo?: number;
}

function burst(ac: AudioContext, o: BurstOptions): void {
  const start = ac.currentTime + (o.at ?? 0);
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(o.filterFrom, start);
  if (o.filterTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(o.filterTo, start + o.duration);
  }
  const env = ac.createGain();
  env.gain.setValueAtTime(o.gain, start);
  env.gain.exponentialRampToValueAtTime(0.0001, start + o.duration);

  src.connect(filter).connect(env).connect(master as GainNode);
  src.start(start);
  src.stop(start + o.duration + 0.02);
}

/** Saltito intermedio: un tic corto y seco, pensado para repetirse sin cansar. */
function hopAt(ac: AudioContext, at: number): void {
  tone(ac, { from: 720, to: 560, type: 'sine', at, duration: 0.045, gain: 0.05 });
}

/** Aterrizaje de la pieza: el golpe de madera del ajedrez. */
function landAt(ac: AudioContext, at: number): void {
  tone(ac, { from: 340, to: 150, type: 'triangle', at, duration: 0.1, gain: 0.14 });
  burst(ac, { at, duration: 0.045, gain: 0.1, filterFrom: 2400, filterTo: 700 });
}

/**
 * Programa el sonido de un recorrido completo: un tic por casilla intermedia y el
 * golpe de aterrizaje al final. Se programa de una vez, con la precision del reloj
 * de audio, en lugar de encadenar temporizadores.
 */
export function playPath(cells: number, msPerCell: number): void {
  const ac = audio();
  if (ac === null || cells <= 0) return;
  const step = msPerCell / 1000;
  for (let i = 0; i < cells - 1; i++) hopAt(ac, i * step + step * 0.5);
  landAt(ac, (cells - 1) * step + step * 0.5);
}

/** La pieza muere de un solo salto (sin recorrido previo que sonar). */
export function playHop(): void {
  const ac = audio();
  if (ac !== null) hopAt(ac, 0);
}

export function playCapture(): void {
  const ac = audio();
  if (ac === null) return;
  tone(ac, { from: 260, to: 80, type: 'triangle', duration: 0.18, gain: 0.18 });
  burst(ac, { duration: 0.12, gain: 0.22, filterFrom: 3200, filterTo: 400 });
}

export function playExplosion(): void {
  const ac = audio();
  if (ac === null) return;
  burst(ac, { duration: 0.55, gain: 0.5, filterFrom: 2600, filterTo: 90 });
  tone(ac, { from: 110, to: 28, type: 'sine', duration: 0.5, gain: 0.32 });
  tone(ac, { from: 60, to: 20, type: 'square', duration: 0.3, gain: 0.1 });
}

/** Arpegio ascendente: has ganado. */
export function playWin(): void {
  const ac = audio();
  if (ac === null) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    tone(ac, { from: f, type: 'triangle', at: i * 0.11, duration: 0.24, gain: 0.16 });
  });
}

/** Caida cromatica: has perdido. */
export function playLoss(): void {
  const ac = audio();
  if (ac === null) return;
  [392, 349.23, 293.66, 233.08].forEach((f, i) => {
    tone(ac, { from: f, to: f * 0.98, type: 'triangle', at: i * 0.14, duration: 0.32, gain: 0.15 });
  });
}

/** Dos notas que no resuelven: tablas. */
export function playDraw(): void {
  const ac = audio();
  if (ac === null) return;
  [440, 392].forEach((f, i) => {
    tone(ac, { from: f, type: 'triangle', at: i * 0.16, duration: 0.34, gain: 0.13 });
  });
}

export type Outcome = 'win' | 'loss' | 'draw';

export function playOutcome(outcome: Outcome): void {
  if (outcome === 'win') playWin();
  else if (outcome === 'loss') playLoss();
  else playDraw();
}
