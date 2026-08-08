import type { Rng } from "./seed";

// Kleine, generische Ziehungs-/Datumshelfer auf Basis eines Rng — Teil der
// Generierungs-Infrastruktur (engine/), keine neue Abstraktionsebene. Alle Funktionen
// sind rein: gleiche Eingaben (inkl. Rng-Zustand) erzeugen immer dieselbe Ausgabe.

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const index = Math.min(Math.floor(rng() * items.length), items.length - 1);
  const item = items[index];
  if (item === undefined) {
    throw new Error("pick() aufgerufen mit leerem Array");
  }
  return item;
}

// Ganzzahl inklusive beider Grenzen.
export function randomInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

// Reine Kalenderarithmetik auf ISO-Datumsstrings (YYYY-MM-DD) — kein Date.now()-Bezug,
// daher deterministisch.
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const iso = date.toISOString().slice(0, 10);
  return iso;
}

export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = new Date(`${fromIsoDate}T00:00:00Z`).getTime();
  const to = new Date(`${toIsoDate}T00:00:00Z`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}
