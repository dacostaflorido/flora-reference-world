// Survival-Analyse-Grundlage (Auftrag "Operations Delivery Flow Signal Design"):
// generische, zero-dependency Kaplan-Meier-/Restricted-Mean-Survival-Time-
// Implementierung für rechtszensierte Dauerdaten. Domänenneutral — kennt weder
// DeliveryUnit noch Queue/Delivery, nimmt ausschließlich abstrakte
// SurvivalCase[]-Populationen entgegen (dieselbe Trennung wie
// engine/random.ts: reine mathematische Infrastruktur, keine Fachlogik).
//
// Warum Kaplan-Meier statt Complete-Case oder Maturity-Buffer (siehe
// Abschlussbericht, Phase 3/4 für den vollständigen Methodenaudit): ein
// Complete-Case-Median (nur bereits eingetretene Ereignisse) unterschätzt
// systematisch, sobald sich Dauern verlängern — genau die noch laufenden,
// potenziell längsten Fälle fehlen dann in der Stichprobe (Right-Censoring-
// Bias). Ein Maturity-Buffer (nur "alt genug" gewordene Kohorten) würde eine
// angenommene Generator-Maximaldauer voraussetzen — eine versteckte, in
// echten CRM-/PM-Daten nicht existierende Produktannahme. Kaplan-Meier bezieht
// zensierte Fälle korrekt (mit ihrem bisherigen Alter, nicht als fehlendes
// Ereignis) in die Risk-Set-Berechnung ein, ohne eine Maximaldauer zu
// unterstellen.
export interface SurvivalCase {
  // Bei einem eingetretenen Ereignis: die tatsächliche Dauer bis zum Ereignis
  // (z. B. startedAt - queuedAt). Bei einer Zensierung: das bisherige Alter zum
  // Auswertungszeitpunkt (asOf - queuedAt) — NICHT die (unbekannte) tatsächliche
  // Enddauer. Muss >= 0 sein.
  durationDays: number;
  // true = die Unit hat das Ereignis bis asOf noch nicht erreicht (rechtszensiert,
  // z. B. noch wartend/noch laufend). false = das Ereignis ist eingetreten.
  censored: boolean;
}

export interface KaplanMeierStep {
  time: number;
  atRisk: number;
  events: number;
  survival: number;
}

function validateCases(cases: readonly SurvivalCase[]): void {
  for (const c of cases) {
    if (c.durationDays < 0) {
      throw new Error(`SurvivalCase: durationDays darf nicht negativ sein (${c.durationDays})`);
    }
  }
}

// Standard-Kaplan-Meier-Schätzer. Risk Set bei Zeit t = alle Fälle mit
// durationDays >= t (unabhängig davon, ob sie selbst bei t, später, oder als
// Zensierung enden) — die übliche Definition. Zensierte Fälle verlassen das
// Risk Set an ihrer eigenen Zensierungszeit, ohne die Survival-Funktion selbst
// zu senken (nur Ereignisse senken sie). Rein deterministisch, keine externe
// Dependency, O(n log n + n·k) für k eindeutige Ereigniszeiten.
export function kaplanMeierCurve(cases: readonly SurvivalCase[]): KaplanMeierStep[] {
  validateCases(cases);
  const steps: KaplanMeierStep[] = [{ time: 0, atRisk: cases.length, events: 0, survival: 1 }];
  if (cases.length === 0) {
    return steps;
  }

  const eventTimes = [...new Set(cases.filter((c) => !c.censored).map((c) => c.durationDays))].sort((a, b) => a - b);

  let survival = 1;
  for (const t of eventTimes) {
    const atRisk = cases.filter((c) => c.durationDays >= t).length;
    const events = cases.filter((c) => !c.censored && c.durationDays === t).length;
    if (atRisk > 0) {
      survival = survival * (1 - events / atRisk);
    }
    steps.push({ time: t, atRisk, events, survival });
  }
  return steps;
}

// Kleinste Zeit t, an der die Survival-Kurve auf <=0.5 fällt — undefined, wenn
// dieser Punkt innerhalb der beobachteten Daten nie erreicht wird ("Median not
// reached", ein bei zensierten Daten regulärer, ehrlich zu meldender Fall,
// keine Rechenfehler).
export function kaplanMeierMedian(cases: readonly SurvivalCase[]): number | undefined {
  const curve = kaplanMeierCurve(cases);
  const reached = curve.find((s) => s.survival <= 0.5 && s.time > 0);
  return reached?.time;
}

// Restricted Mean Survival Time: die Fläche unter der Kaplan-Meier-Treppenfunktion
// zwischen 0 und horizonDays — "erwartete Zeit bis zum Ereignis, gedeckelt auf den
// Horizont, gegeben die heute verfügbare Evidenz". horizonDays ist AUSDRÜCKLICH
// keine SLA, keine Zusage und kein Erwartungswert für eine reale Obergrenze — er
// ist ausschließlich die statistische Integrationsgrenze, innerhalb derer RMST
// vergleichbar bleibt (siehe Abschlussbericht, Phase 5). Wird die Kurve nach der
// letzten beobachteten Zeit nicht fortgesetzt (kein Rückgang unterstellt,
// Standard-Konvention bei zensiertem letzten Fall): die Survival-Funktion bleibt
// ab der letzten Stufe konstant bis horizonDays — das ist konservativ (unterstellt
// kein Ereignis, das nicht belegt ist), nicht optimistisch.
export function restrictedMeanSurvivalTime(cases: readonly SurvivalCase[], horizonDays: number): number {
  if (horizonDays <= 0) {
    throw new Error(`restrictedMeanSurvivalTime: horizonDays muss positiv sein (${horizonDays})`);
  }
  const curve = kaplanMeierCurve(cases);
  let area = 0;
  for (let i = 0; i < curve.length; i++) {
    const stepStart = curve[i]!.time;
    if (stepStart >= horizonDays) break;
    const stepEnd = i + 1 < curve.length ? Math.min(curve[i + 1]!.time, horizonDays) : horizonDays;
    const width = Math.max(0, stepEnd - stepStart);
    area += curve[i]!.survival * width;
  }
  // Numerisch garantiert innerhalb [0, horizonDays] (Survival in [0,1], Breite
  // summiert exakt auf horizonDays) — Assertion statt stiller Clamp, damit ein
  // Implementierungsfehler sichtbar würde statt maskiert zu werden.
  if (area < 0 || area > horizonDays + 1e-9) {
    throw new Error(`restrictedMeanSurvivalTime: Ergebnis außerhalb [0, horizonDays]: ${area}`);
  }
  return Math.min(Math.max(area, 0), horizonDays);
}

export function censoredCount(cases: readonly SurvivalCase[]): number {
  return cases.filter((c) => c.censored).length;
}

export function eventCount(cases: readonly SurvivalCase[]): number {
  return cases.filter((c) => !c.censored).length;
}
