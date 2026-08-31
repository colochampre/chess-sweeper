import { centralSquares, neighbours, type PlayerView, type Square } from '@cm/engine';

export interface MineBelief {
  /** Probabilidad de mina por casilla, 0..1. */
  probability: number[];
  /** Casillas que todavia pueden esconder una mina. */
  candidates: Square[];
  /** Minas que quedan por localizar. */
  remaining: number;
}

interface Constraint {
  /** Casillas desconocidas afectadas. */
  cells: Square[];
  /** Cuantas de ellas son mina. */
  mines: number;
}

/** Limite de casillas por componente para permitirse la enumeracion exacta. */
const EXACT_COMPONENT_LIMIT = 18;

/**
 * FR-2. Las minas solo existen en las filas centrales y solo en casillas sin revelar:
 * eso ya recorta enormemente el espacio antes de mirar ningun numero.
 */
function collectCandidates(view: PlayerView): Square[] {
  return centralSquares(view.config).filter(
    (sq) => !view.revealed[sq] || view.knownMines[sq],
  );
}

/** Restricciones que imponen los numeros ya revelados. */
function collectConstraints(view: PlayerView, isCandidate: boolean[]): Constraint[] {
  const out: Constraint[] = [];
  for (let sq = 0; sq < view.board.length; sq++) {
    if (!view.revealed[sq] || view.knownMines[sq]) continue;
    const cells: Square[] = [];
    let known = 0;
    for (const nb of neighbours(sq, view.config)) {
      if (view.knownMines[nb]) known++;
      else if (isCandidate[nb]) cells.push(nb);
    }
    if (cells.length === 0) continue;
    out.push({ cells, mines: Math.max(0, view.adjacency[sq] - known) });
  }
  return out;
}

/** Estimacion local: rapida, conservadora y suficiente para el nivel normal. */
function heuristicProbabilities(
  candidates: Square[],
  constraints: Constraint[],
  prior: number,
  probability: number[],
): void {
  const best = new Map<Square, number>();
  for (const c of constraints) {
    const ratio = c.cells.length === 0 ? 0 : c.mines / c.cells.length;
    for (const cell of c.cells) {
      const previous = best.get(cell);
      // Una restriccion que garantiza casilla segura (0) o mina segura (1) manda.
      if (previous === 0 || ratio === 0) best.set(cell, 0);
      else if (previous === 1 || ratio === 1) best.set(cell, 1);
      else best.set(cell, Math.max(previous ?? 0, ratio));
    }
  }
  for (const sq of candidates) probability[sq] = best.get(sq) ?? prior;
}

/** Componentes conexas de la frontera: casillas unidas por compartir alguna restriccion. */
function frontierComponents(constraints: Constraint[]): { cells: Square[]; constraints: Constraint[] }[] {
  const owner = new Map<Square, number>();
  const groups: { cells: Square[]; constraints: Constraint[] }[] = [];

  for (const constraint of constraints) {
    const touched = new Set<number>();
    for (const cell of constraint.cells) {
      const g = owner.get(cell);
      if (g !== undefined) touched.add(g);
    }

    if (touched.size === 0) {
      const index = groups.length;
      groups.push({ cells: [...constraint.cells], constraints: [constraint] });
      for (const cell of constraint.cells) owner.set(cell, index);
      continue;
    }

    const [first, ...rest] = [...touched];
    const target = groups[first];
    target.constraints.push(constraint);
    for (const cell of constraint.cells) {
      if (!owner.has(cell)) {
        owner.set(cell, first);
        target.cells.push(cell);
      }
    }
    for (const other of rest) {
      const merged = groups[other];
      target.constraints.push(...merged.constraints);
      for (const cell of merged.cells) {
        owner.set(cell, first);
        if (!target.cells.includes(cell)) target.cells.push(cell);
      }
      merged.cells = [];
      merged.constraints = [];
    }
  }

  return groups.filter((g) => g.cells.length > 0);
}

/**
 * Enumeracion exacta de una componente pequena: recorre todas las asignaciones
 * consistentes y devuelve la frecuencia con la que cada casilla resulta ser mina.
 */
function exactComponent(
  cells: Square[],
  constraints: Constraint[],
): { marginal: Map<Square, number>; expected: number } | null {
  const index = new Map<Square, number>();
  cells.forEach((sq, i) => index.set(sq, i));

  const counts = new Array<number>(cells.length).fill(0);
  const assignment = new Array<boolean>(cells.length).fill(false);
  let solutions = 0;
  let totalMines = 0;

  const localConstraints = constraints.map((c) => ({
    idx: c.cells.map((sq) => index.get(sq) as number),
    mines: c.mines,
  }));

  const feasible = (upTo: number): boolean => {
    for (const c of localConstraints) {
      let assigned = 0;
      let pending = 0;
      for (const i of c.idx) {
        if (i < upTo) assigned += assignment[i] ? 1 : 0;
        else pending++;
      }
      if (assigned > c.mines) return false;
      if (assigned + pending < c.mines) return false;
    }
    return true;
  };

  const recurse = (i: number): void => {
    if (solutions > 200000) return; // salvaguarda
    if (i === cells.length) {
      solutions++;
      let mines = 0;
      for (let k = 0; k < cells.length; k++) {
        if (assignment[k]) {
          counts[k]++;
          mines++;
        }
      }
      totalMines += mines;
      return;
    }
    for (const value of [false, true]) {
      assignment[i] = value;
      if (feasible(i + 1)) recurse(i + 1);
    }
    assignment[i] = false;
  };

  recurse(0);
  if (solutions === 0) return null;

  const marginal = new Map<Square, number>();
  cells.forEach((sq, i) => marginal.set(sq, counts[i] / solutions));
  return { marginal, expected: totalMines / solutions };
}

/**
 * `prior`: solo minas restantes entre casillas candidatas (nivel facil).
 * `heuristic`: razones locales por cada numero revelado (nivel normal).
 * `exact`: enumera las configuraciones consistentes de la frontera (nivel dificil).
 */
export type BeliefMode = 'prior' | 'heuristic' | 'exact';

/** FR-2: probabilidad de mina por casilla a partir de lo que el jugador puede ver. */
export function estimateMines(view: PlayerView, mode: BeliefMode = 'heuristic'): MineBelief {
  const probability = new Array<number>(view.board.length).fill(0); // AC-201 / AC-202
  const candidates = collectCandidates(view);
  const isCandidate = new Array<boolean>(view.board.length).fill(false);
  for (const sq of candidates) isCandidate[sq] = true;

  let known = 0;
  for (let sq = 0; sq < view.board.length; sq++) {
    if (view.knownMines[sq]) {
      probability[sq] = 1; // AC-203
      known++;
      isCandidate[sq] = false;
    }
  }

  const unknown = candidates.filter((sq) => isCandidate[sq]);
  const remaining = Math.max(0, view.minesRemaining - known);
  if (unknown.length === 0 || remaining === 0) {
    return { probability, candidates, remaining };
  }

  const prior = Math.min(1, remaining / unknown.length); // AC-207
  if (mode === 'prior') {
    for (const sq of unknown) probability[sq] = prior;
    return { probability, candidates, remaining };
  }

  const constraints = collectConstraints(view, isCandidate);
  heuristicProbabilities(unknown, constraints, prior, probability); // AC-204 / AC-205

  if (mode !== 'exact') return { probability, candidates, remaining };

  // --- Modo exacto: enumerar las componentes pequenas de la frontera (AC-206).
  const components = frontierComponents(constraints);
  const onFrontier = new Set<Square>();
  let frontierExpected = 0;

  for (const component of components) {
    for (const cell of component.cells) onFrontier.add(cell);
    if (component.cells.length > EXACT_COMPONENT_LIMIT) {
      for (const cell of component.cells) frontierExpected += probability[cell];
      continue;
    }
    const solved = exactComponent(component.cells, component.constraints);
    if (solved === null) {
      for (const cell of component.cells) frontierExpected += probability[cell];
      continue;
    }
    for (const [sq, p] of solved.marginal) probability[sq] = p;
    frontierExpected += solved.expected;
  }

  // Las casillas sin ninguna pista se reparten las minas que sobran.
  const offFrontier = unknown.filter((sq) => !onFrontier.has(sq));
  if (offFrontier.length > 0) {
    const leftover = Math.max(0, remaining - frontierExpected);
    const p = Math.min(1, leftover / offFrontier.length);
    for (const sq of offFrontier) probability[sq] = p;
  }

  return { probability, candidates, remaining };
}
