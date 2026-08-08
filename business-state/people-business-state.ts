import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";
import type { Observation } from "../observations/observations";

// People Business State ist die People-eigene Entsprechung von
// business-state/business-state.ts — bewusst eine eigenständige, separate Datei statt
// einer Erweiterung des dortigen, laut PRINCIPLES.md Prinzip 19 eingefrorenen
// BusinessStateType. Dieselbe redaktionelle Methode (deskriptiv, niemals normativ,
// scenario-blind, Backward Explainability über supportingObservationIds), aber eine
// eigene, kleine Taxonomie für eine eigene Domäne — exakt im Sinne von Prinzip 16
// (Domain Generality). Kein neuer Schwellenwert: die drei Types sind eine 1:1-
// Spiegelung der bereits freigegebenen, event-getriebenen People-Observation-Regel
// (observations/people-observations.ts) — keine Observation / "letzte Person
// verbleibt" (mittel) / "unbesetzt" (hoch).
export type PeopleBusinessStateType = "ausgeglichen" | "letzte-person-verbleibt" | "rolle-unbesetzt";

export interface PeopleBusinessStateSnapshot {
  id: string;
  timestamp: string;
  peopleGroundTruthSnapshotId: string;
  type: PeopleBusinessStateType;
  statement: string;
  supportingObservationIds: string[];
}

// id ist wie bei BusinessStateSnapshot/GroundTruthSnapshot eine reine Funktion des
// Inhalts, kein Zähler (aufrufreihenfolge-unabhängig) — dieselbe, lokal duplizierte
// Methode wie in ground-truth.ts/business-state.ts, keine geteilte Utility-Datei
// eingeführt (folgt derselben, bereits etablierten Konvention kleiner, lokaler
// Duplikate statt einer neuen Architekturebene).
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
function peopleBusinessStateId(groundTruthSnapshotId: string, type: PeopleBusinessStateType, timestamp: string): string {
  const fingerprint = `${groundTruthSnapshotId}|${type}|${timestamp}`;
  return `pbstate-${String(hashString(fingerprint) % 100000).padStart(5, "0")}`;
}

// Redaktionelle Klassifikation, kein neuer Schwellenwert: unstaffed (severity hoch,
// eine bereits eingetretene, unbesetzte Rolle) dominiert last-person (severity mittel,
// ein Risiko-Vorbote), falls beide gleichzeitig aktiv sind — dieselbe
// "schwerwiegenderes Signal gewinnt"-Logik wie in business-state.ts (dort:
// Stagnation vor Chance-Häufung).
export function generatePeopleBusinessStateSnapshot(
  groundTruth: GroundTruthSnapshot,
  allObservations: readonly Observation[],
): PeopleBusinessStateSnapshot {
  const activeIds = new Set(groundTruth.activeObservationIds);
  const observations = allObservations.filter((o) => activeIds.has(o.id));

  const unstaffed = observations.find((o) => o.kind === "people-critical-role-unstaffed");
  const lastPerson = observations.find((o) => o.kind === "people-critical-role-last-person");

  let type: PeopleBusinessStateType;
  let statement: string;
  let supportingObservationIds: string[];

  if (unstaffed) {
    type = "rolle-unbesetzt";
    statement = "Mindestens eine Rolle ist nach einem Ausscheiden unbesetzt.";
    supportingObservationIds = [unstaffed.id];
  } else if (lastPerson) {
    type = "letzte-person-verbleibt";
    statement = "Mindestens eine Rolle wird nach einem Ausscheiden nur noch von einer einzigen Person getragen.";
    supportingObservationIds = [lastPerson.id];
  } else {
    type = "ausgeglichen";
    statement = "Es besteht aktuell kein aus einem Ausscheiden abgeleitetes Engpassrisiko in der Team-Kontinuität.";
    supportingObservationIds = [];
  }

  return {
    id: peopleBusinessStateId(groundTruth.id, type, groundTruth.timestamp),
    timestamp: groundTruth.timestamp,
    peopleGroundTruthSnapshotId: groundTruth.id,
    type,
    statement,
    supportingObservationIds,
  };
}
