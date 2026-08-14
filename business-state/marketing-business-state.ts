import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";
import type { MarketingDemandSignalObservation } from "../observations/marketing-observations";

// Marketing Business State ist die Marketing-eigene Entsprechung von
// business-state/business-state.ts — bewusst eine eigenständige, separate Datei
// statt einer Erweiterung des dortigen, laut PRINCIPLES.md Prinzip 19
// eingefrorenen BusinessStateType (exakt dasselbe Muster wie
// business-state/people-business-state.ts, Prinzip 16 — Domain Generality).
//
// Beantwortet ausschließlich EINE Führungsfrage: "Weicht die Lead-Entstehung
// gerade anhaltend vom historischen Referenzniveau ab?" — nicht, ob das gut
// oder schlecht ist. Deshalb tragen die drei erreichbaren Types bewusst KEINE
// Bewertungssprache (kein "gesund"/"kritisch"/"profitabel") und sind
// ausdrücklich NICHT in company/company-business-state.ts' POSITIVE_STATES/
// BELASTET_STATES eingetragen — ob mehr oder weniger Nachfrage für das
// Unternehmen positiv oder belastend ist, hängt von Daten ab, die nicht
// existieren (Kapazität, CAC, Qualified Leads, Attribution). Marketing trägt
// deshalb bewusst NICHT zur Company-weiten Divergenzprüfung bei (siehe
// company-business-state.ts: ein State ohne Eintrag in einer der beiden
// Mengen trägt nicht zur Divergenzprüfung bei, statt eine Annahme zu
// erzwingen) — Marketing wird dadurch erstmals bewertet, ohne implizit
// Rentabilität, Kanalperformance oder Attribution zu behaupten.
export type MarketingBusinessStateType = "stabile-nachfrage" | "erhoehte-nachfrage" | "unterdrueckte-nachfrage";

export interface MarketingBusinessStateSnapshot {
  id: string;
  timestamp: string;
  marketingGroundTruthSnapshotId: string;
  type: MarketingBusinessStateType;
  statement: string;
  supportingObservationIds: string[];
}

// id ist wie bei BusinessStateSnapshot/PeopleBusinessStateSnapshot eine reine
// Funktion des Inhalts, kein Zähler (aufrufreihenfolge-unabhängig) — dieselbe,
// lokal duplizierte Methode wie in den übrigen Business-State-Dateien.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
function marketingBusinessStateId(groundTruthSnapshotId: string, type: MarketingBusinessStateType, timestamp: string): string {
  const fingerprint = `${groundTruthSnapshotId}|${type}|${timestamp}`;
  return `mbstate-${String(hashString(fingerprint) % 100000).padStart(5, "0")}`;
}

// Redaktionelle 1:1-Spiegelung der bereits in
// generateMarketingDemandRegimeSignalObservation berechneten regimeSignal —
// kein neuer Schwellenwert, keine zusätzliche Interpretation. Existiert keine
// aktive Signal-Observation (zu wenig Historie/Evidenz), bleibt Marketing
// state=null/evaluationStatus="unzureichende-evidenz" — das wird bereits in
// company/company-area-summaries.ts gehandhabt (dieselbe Struktur wie bei
// Operations), nicht hier: diese Funktion wird nur aufgerufen, wenn eine
// Signal-Observation tatsächlich aktiv ist.
export function generateMarketingBusinessStateSnapshot(
  groundTruth: GroundTruthSnapshot,
  signalObservation: MarketingDemandSignalObservation,
): MarketingBusinessStateSnapshot {
  let type: MarketingBusinessStateType;
  let statement: string;

  if (signalObservation.regimeSignal === "erhoeht") {
    type = "erhoehte-nachfrage";
    statement = "Die Lead-Entstehung liegt seit mehreren Wochen anhaltend über ihrem historischen Referenzniveau.";
  } else if (signalObservation.regimeSignal === "unterdrueckt") {
    type = "unterdrueckte-nachfrage";
    statement = "Die Lead-Entstehung liegt seit mehreren Wochen anhaltend unter ihrem historischen Referenzniveau.";
  } else {
    type = "stabile-nachfrage";
    statement = "Die Lead-Entstehung zeigt aktuell keine anhaltende Abweichung von ihrem historischen Referenzniveau.";
  }

  return {
    id: marketingBusinessStateId(groundTruth.id, type, groundTruth.timestamp),
    timestamp: groundTruth.timestamp,
    marketingGroundTruthSnapshotId: groundTruth.id,
    type,
    statement,
    supportingObservationIds: [signalObservation.id],
  };
}
