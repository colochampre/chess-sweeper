/** PRNG con semilla (mulberry32): partidas y campos de minas reproducibles. */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (max) => Math.floor(next() * max) };
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
