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

// Sales Period KPI Foundation V1: additive Unternehmenskalender-Helfer —
// Montag als Wochenbeginn (verbindlich festgelegt, Auftrag B2), keine
// Zeitzonen-Umrechnung (siehe dortige Begründung: die Reference World ist
// vollständig Date-only, es existiert an keiner Stelle im Repository eine
// Uhrzeit- oder Zeitzonen-Auflösung — eine künftige echte CRM-/Kalender-
// integration muss eingehende Zeitstempel VOR der Periodenzuordnung explizit
// in eine dann zu konfigurierende Unternehmenszeitzone umrechnen; das wird
// hier bewusst nicht durch eine erfundene Uhrzeit simuliert).
//
// getUTCDay(): 0=Sonntag..6=Samstag. daysSinceMonday normalisiert das auf
// einen Montag-Wochenbeginn (Montag=0 Tage zurück, Sonntag=6 Tage zurück).
export function startOfWeek(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDays(isoDate, -daysSinceMonday);
}

// Reine String-Operation (kein Date-Objekt nötig) — der erste Kalendertag des
// Monats von isoDate, funktioniert unverändert über Monats-/Jahreswechsel
// hinweg, da isoDate bereits im festen YYYY-MM-DD-Format vorliegt.
export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}
