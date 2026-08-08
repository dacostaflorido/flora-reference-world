import { addDays } from "../engine/random";

// Reine Kalenderlogik auf ISO-Datumsstrings (YYYY-MM-DD) — baut auf engine/random.ts
// auf, keine neue Abstraktionsebene. Arbeitstags-/Wochenendbehandlung für spätere
// Event-Generatoren (Calls/Meetings finden überwiegend an Arbeitstagen statt).
export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function isBusinessDay(isoDate: string): boolean {
  return !isWeekend(isoDate);
}

export function nextBusinessDay(isoDate: string): string {
  let date = addDays(isoDate, 1);
  while (isWeekend(date)) {
    date = addDays(date, 1);
  }
  return date;
}

export function addBusinessDays(isoDate: string, businessDays: number): string {
  let date = isoDate;
  let remaining = businessDays;
  while (remaining > 0) {
    date = addDays(date, 1);
    if (isBusinessDay(date)) {
      remaining--;
    }
  }
  return date;
}
