export type Rng = () => number;

// Einzige Quelle des Weltzustands (PRINCIPLES.md, Prinzip 3 & 14). Einzelne Generatoren
// leiten über einen festen numerischen Offset ihren eigenen, unabhängigen Teilstrom ab
// (z. B. createRng(WORLD_SEED + 1)), damit sie unabhängig voneinander reproduzierbar
// bleiben und nicht von der Aufrufreihenfolge anderer Generatoren abhängen.
export const WORLD_SEED = 424242;

// mulberry32 — deterministisches Seed-PRNG, zero-dependency. Gleicher Seed erzeugt
// immer dieselbe Zahlenfolge (siehe PRINCIPLES.md, Prinzip 3: Deterministic Generation).
// Kein Bezug zu Date.now()/Math.random() — bewusst rein funktional.
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
