/**
 * Simulador de balance: juega N partidas bot contra bot, sin UI, con semillas fijas,
 * y resume las metricas que hacen falta para afinar la densidad de minas.
 *
 *   npm run balance -- --games 200 --difficulty normal
 *   npm run balance -- --games 60 --white hard --black easy
 *   npm run balance -- --games 200 --difficulty hard --csv balance-results/hard.csv
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  applyMove,
  configFor,
  createGame,
  toView,
  type Color,
  type Difficulty,
  type EndReason,
  type GameState,
} from '@cm/engine';
import { chooseMove } from '@cm/ai';

interface Options {
  games: number;
  difficulty: Difficulty;
  white: Difficulty;
  black: Difficulty;
  size: number;
  seed: number;
  maxPlies: number;
  mines?: number;
  csv?: string;
}

interface GameRecord {
  seed: number;
  winner: Color | 'draw';
  status: GameState['status'];
  reason: EndReason | null;
  plies: number;
  minesTotal: number;
  minesDetonated: number;
  lostToMine: Record<Color, number>;
  lostToCapture: Record<Color, number>;
  decidedByExplosion: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    games: 100,
    difficulty: 'normal',
    white: 'normal',
    black: 'normal',
    size: 8,
    seed: 1,
    maxPlies: 300,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key === undefined || value === undefined) continue;
    switch (key) {
      case 'games': options.games = Number(value); break;
      case 'difficulty': options.difficulty = value as Difficulty; break;
      case 'white': options.white = value as Difficulty; break;
      case 'black': options.black = value as Difficulty; break;
      case 'size': options.size = Number(value); break;
      case 'seed': options.seed = Number(value); break;
      case 'max-plies': options.maxPlies = Number(value); break;
      case 'mines': options.mines = Number(value); break;
      case 'csv': options.csv = value; break;
      default: console.warn(`Opcion desconocida: --${key}`);
    }
  }
  return options;
}

function playGame(seed: number, options: Options): GameRecord {
  const overrides: Record<string, number> = { files: options.size, ranks: options.size, seed };
  if (options.mines !== undefined) overrides.mineCount = options.mines;
  let state = createGame(configFor(options.difficulty, overrides));

  const minesTotal = state.mines.filter(Boolean).length;
  const lostToMine: Record<Color, number> = { w: 0, b: 0 };
  const lostToCapture: Record<Color, number> = { w: 0, b: 0 };
  let plies = 0;

  while (state.status === 'playing' && plies < options.maxPlies) {
    const level = state.turn === 'w' ? options.white : options.black;
    const move = chooseMove(toView(state, state.turn), { level, seed: seed * 131 + plies });
    if (move === null) break;

    const { state: next, events } = applyMove(state, move);
    for (const ev of events) {
      if (ev.type === 'capture') lostToCapture[ev.color]++;
      if (ev.type === 'explosion') for (const v of ev.victims) lostToMine[v.color]++;
    }
    state = next;
    plies++;
  }

  return {
    seed,
    winner: state.winner ?? 'draw',
    status: state.status,
    reason: state.endReason,
    plies,
    minesTotal,
    minesDetonated: minesTotal - state.mines.filter(Boolean).length,
    lostToMine,
    lostToCapture,
    decidedByExplosion: state.status === 'king-destroyed',
  };
}

const pct = (n: number, total: number): string =>
  total === 0 ? '0.0%' : `${((100 * n) / total).toFixed(1)}%`;

function report(records: GameRecord[], options: Options): void {
  const n = records.length;
  const wins = { w: 0, b: 0, draw: 0 };
  let plies = 0;
  let mineDeaths = 0;
  let captureDeaths = 0;
  let detonated = 0;
  let total = 0;
  let byExplosion = 0;
  const byReason = new Map<string, number>();

  for (const r of records) {
    wins[r.winner]++;
    plies += r.plies;
    mineDeaths += r.lostToMine.w + r.lostToMine.b;
    captureDeaths += r.lostToCapture.w + r.lostToCapture.b;
    detonated += r.minesDetonated;
    total += r.minesTotal;
    if (r.decidedByExplosion) byExplosion++;
    const key = r.reason ?? 'sin-terminar';
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }

  const deaths = mineDeaths + captureDeaths;
  console.log(`\n=== ${n} partidas · minas "${options.difficulty}" · ${options.size}x${options.size} · blancas ${options.white} vs negras ${options.black} ===\n`);
  console.log(`Victorias blancas    ${wins.w.toString().padStart(4)}  ${pct(wins.w, n)}`);
  console.log(`Victorias negras     ${wins.b.toString().padStart(4)}  ${pct(wins.b, n)}`);
  console.log(`Tablas               ${wins.draw.toString().padStart(4)}  ${pct(wins.draw, n)}`);
  console.log(`\nDuracion media       ${(plies / n).toFixed(1)} medias jugadas`);
  console.log(`Decididas por explosion  ${byExplosion} (${pct(byExplosion, n)})`);
  console.log(`Piezas perdidas por mina ${mineDeaths} (${pct(mineDeaths, deaths)} del total de bajas)`);
  console.log(`Piezas perdidas por captura ${captureDeaths} (${pct(captureDeaths, deaths)})`);
  console.log(`Minas detonadas      ${detonated}/${total} (${pct(detonated, total)})`);
  console.log('\nMotivo del final:');
  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(22)} ${count.toString().padStart(4)}  ${pct(count, n)}`);
  }
}

function writeCsv(records: GameRecord[], path: string): void {
  const header =
    'seed,winner,status,reason,plies,minesTotal,minesDetonated,whiteLostToMine,blackLostToMine,whiteLostToCapture,blackLostToCapture,decidedByExplosion';
  const rows = records.map((r) =>
    [
      r.seed, r.winner, r.status, r.reason ?? '', r.plies, r.minesTotal, r.minesDetonated,
      r.lostToMine.w, r.lostToMine.b, r.lostToCapture.w, r.lostToCapture.b,
      r.decidedByExplosion ? 1 : 0,
    ].join(','),
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [header, ...rows].join('\n') + '\n', 'utf8');
  console.log(`\nCSV escrito en ${path}`);
}

const options = parseArgs(process.argv.slice(2));
const started = Date.now();
const records: GameRecord[] = [];

for (let i = 0; i < options.games; i++) {
  records.push(playGame(options.seed + i, options));
  if ((i + 1) % 10 === 0) process.stdout.write(`\r${i + 1}/${options.games} partidas...`);
}
process.stdout.write('\r');

report(records, options);
if (options.csv) writeCsv(records, options.csv);
console.log(`\nTiempo total: ${((Date.now() - started) / 1000).toFixed(1)}s`);
