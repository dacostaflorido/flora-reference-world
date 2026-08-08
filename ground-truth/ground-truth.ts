import type { Observation, ObservationKind } from "../observations/observations";
import { OBSERVATIONS } from "../observations/observations";
import { WORLD_NOW } from "../timeline/world-clock";

// Ground Truth ist der formale Vertrag zwischen der simulierten Unternehmenswelt und
// der späteren Decision Engine:
//
//   Reference World → Ground Truth → Decision Engine → THE_BOOK
//
// (THE_BOOK bezeichnet die Management-/Wissensbasis des übergeordneten Flora-Produkts
// und ist nicht Bestandteil dieses Reference-World-Repositories.)
//
// Ground Truth erzeugt keine neuen Erkenntnisse. Sie referenziert ausschließlich
// bereits bestehende Observations (nie Rohdaten) und strukturiert bereits bestätigte
// Wahrheit: welche Observations zu einem Zeitpunkt gelten, welche davon am
// wichtigsten sind und welche logisch zusammengehören. Sie beantwortet niemals, was
// daraus folgen soll — das ist explizit Aufgabe der später anzuschließenden, hier
// nicht implementierten Decision Engine, die Ground Truth mit den
// Führungsprinzipien aus THE_BOOK verbindet.
//
// Keine Rule Engine, keine KI, keine neue Analyse, keine Heuristik: sowohl Priorität
// als auch Gruppen entstehen aus handgepflegten, redaktionellen Zuordnungstabellen —
// keine Mustererkennung auf Rohdaten, keine automatische Ableitung aus anderen
// Feldern.

export interface GroundTruthPriority {
  observationId: string;
  tier: "primaer" | "sekundaer" | "unterstuetzend";
}

export interface ObservationGroup {
  id: string;
  label: string;
  observationIds: string[];
}

export interface GroundTruthSnapshot {
  id: string;
  timestamp: string;
  activeObservationIds: string[];
  priorities: GroundTruthPriority[];
  observationGroups: ObservationGroup[];
}

// Priorität ist bewusst von Observation.severity entkoppelt. severity beantwortet
// "wie schwerwiegend ist diese einzelne Observation?" — Ground-Truth-Priorität
// beantwortet eine andere Frage: "wie wichtig ist diese Observation für den
// aktuellen Gesamtzustand des Unternehmens?" Das ist redaktionell zu entscheiden,
// nicht mechanisch aus severity abzuleiten (eine severity=niedrig-Observation kann
// Teil des dominanten Führungskontexts sein, eine severity=mittel-Observation nicht
// zwingend). Deshalb: eine explizite, handgepflegte Zuordnungstabelle statt einer
// Ableitungsfunktion — exakt dieselbe redaktionelle Methode wie bei
// OBSERVATION_GROUP_LABELS unten. severity und confidence bleiben davon
// vollständig unberührt.
//
// Geschlüsselt auf Observation.kind (die stabile fachliche Identität eines
// Analyse-Blocks), NICHT auf Observation.id. id wird positionell beim Generieren
// vergeben (nextId() in observations.ts) und verschiebt sich zwischen Scenario
// Profiles, sobald ein Block mit variabler Kardinalität (aktuell:
// "chance-account-repeat-business") mehr oder weniger Instanzen erzeugt als in
// baseline. Eine ID-geschlüsselte Tabelle würde dadurch in einem Teil der Szenarien
// versehentlich der falschen Observation eine Priorität zuweisen (gefunden und
// behoben im Schritt nach "Scenario Profiles": in strategischer-tag landete
// "sekundär" durch reinen ID-Zufall auf einem Chance-Account statt auf der
// Touchpoint-Reichhaltigkeits-Observation). kind ist unabhängig von Reihenfolge,
// Anzahl und Scenario Profile — ein `Record<ObservationKind, Tier>` deckt jeden
// existierenden Kind ab (vom Compiler erzwungen: ein neuer Kind ohne Tabelleneintrag
// ist ein Typfehler, kein stiller Fallback).
//
// Redaktionelle Begründung für diesen Snapshot (WORLD_NOW, baseline):
// - primär: biggest-stagnant-opportunity — der einzelne, wertmäßig größte
//   stagnierende Deal ist konkret genug, um den heutigen Führungskontext zu
//   dominieren.
// - sekundär: pipeline-stagnation-summary (Ausmaß der Stagnation),
//   stagnation-concentration-by-ae (wer sie trägt) liefern den unmittelbaren Kontext
//   zum primären Fund; touchpoint-richness-won-vs-lost (Touchpoint-Reichhaltigkeit
//   korreliert mit Gewinn) ist trotz "nur" mittlerer severity eigenständig
//   führungsrelevant.
// - unterstützend: alles Weitere — reassurierende Stabilitätsbefunde (Team-Win-Rate,
//   Follow-up-Geschwindigkeit, SDR-Last), Einzelbeobachtungen mit geringer Tragweite
//   und die Chance-Accounts (positiv, aber nicht Teil der dominanten Gesamtlage)
//   sowie die Synthese (pipeline-synthesis), deren Inhalt bereits durch die
//   primäre/sekundäre Auswahl abgedeckt ist.
// Ergänzung (Schritt "Observation-Ebene vervollständigen", Priorität 2): fünf neue
// Kinds erfordern zwingend einen Eintrag, da diese Tabelle als vollständiger
// Record<ObservationKind, ...> geführt wird (siehe Begründung oben — genau das war
// der Zweck dieser Struktur seit dem Ground-Truth-Bugfix: ein neuer Kind ohne
// Tabelleneintrag ist ein Kompilierfehler, kein stiller Fallback). Das ist eine rein
// mechanische Erweiterung derselben, unveränderten redaktionellen Methode — Ground
// Truth priorisiert weiterhin ausschließlich, interpretiert nichts Neues:
// ae-workload-distribution/sales-cycle-duration/stage-regression-rate sind
// strukturell eng verwandt mit bereits vorhandenen Kinds derselben Tier-Einstufung
// (sdr-load-distribution-healthy bzw. pipeline-stagnation-summary); loss-reason-
// concentration ist strukturell identisch zu objection-mix-top-category;
// lead-volume-trend ist die einzige fachlich neue Achse (Volumen/Wachstum statt
// Pipeline-Bewegung) und erhält deshalb "sekundär" als eigenständig
// führungsrelevanter neuer Fund, nicht weil er einem bestehenden Fund ähnelt.
const GROUND_TRUTH_PRIORITIES: Record<ObservationKind, GroundTruthPriority["tier"]> = {
  "biggest-stagnant-opportunity": "primaer",
  "pipeline-stagnation-summary": "sekundaer",
  "stagnation-concentration-by-ae": "sekundaer",
  "touchpoint-richness-won-vs-lost": "sekundaer",
  "sales-cycle-duration": "sekundaer",
  "stage-regression-rate": "sekundaer",
  "lead-volume-trend": "sekundaer",
  "low-stagnation-counterexample": "unterstuetzend",
  "team-win-rate-parity": "unterstuetzend",
  "follow-up-consistency-across-sdrs": "unterstuetzend",
  "fastest-sdr-response-time": "unterstuetzend",
  "sdr-load-distribution-healthy": "unterstuetzend",
  "ae-workload-distribution": "unterstuetzend",
  "objection-mix-top-category": "unterstuetzend",
  "loss-reason-concentration": "unterstuetzend",
  "chance-account-repeat-business": "unterstuetzend",
  "pipeline-synthesis": "unterstuetzend",
};

// Rein redaktionelle Zuordnung bereits bestehender Observation-Kinds zu thematisch
// zusammengehörigen Gruppen ("welche Observations beschreiben denselben
// Sachverhalt?") — eine handgepflegte Zuordnungstabelle, keine Stichwort- oder
// Musteranalyse (das wäre eine Heuristik und damit nicht erlaubt). Exakt dieselbe
// redaktionelle Vorgehensweise wie bei den handkuratierten Knowledge-Object-Inhalten.
// Ebenfalls auf ObservationKind geschlüsselt, aus demselben Grund wie oben.
const OBSERVATION_GROUP_LABELS: Record<ObservationKind, string> = {
  "pipeline-stagnation-summary": "Pipeline",
  "biggest-stagnant-opportunity": "Pipeline",
  "stagnation-concentration-by-ae": "Pipeline",
  "low-stagnation-counterexample": "Pipeline",
  "pipeline-synthesis": "Pipeline",
  "sales-cycle-duration": "Pipeline",
  "stage-regression-rate": "Pipeline",
  "loss-reason-concentration": "Pipeline",
  "objection-mix-top-category": "Preis",
  "team-win-rate-parity": "Team",
  "follow-up-consistency-across-sdrs": "Team",
  "fastest-sdr-response-time": "Team",
  "sdr-load-distribution-healthy": "Team",
  "ae-workload-distribution": "Team",
  "chance-account-repeat-business": "Accounts",
  "touchpoint-richness-won-vs-lost": "Accounts",
  // Neue Gruppe "Volumen": keine der bestehenden vier Gruppen (Pipeline/Preis/Team/
  // Accounts) passt fachlich zu einer Aussage über Lead-Volumen/Wachstum — eine
  // erzwungene Zuordnung in eine bestehende Gruppe wäre irreführender als eine neue,
  // ehrliche Gruppenbezeichnung. Der Gruppierungsmechanismus selbst (buildObservation
  // Groups) ist dafür bereits vollständig generisch und unverändert.
  "lead-volume-trend": "Volumen",
};

function buildObservationGroups(observations: readonly Observation[]): ObservationGroup[] {
  const observationIdsByLabel = new Map<string, string[]>();
  for (const observation of observations) {
    const label = OBSERVATION_GROUP_LABELS[observation.kind];
    const list = observationIdsByLabel.get(label) ?? [];
    list.push(observation.id);
    observationIdsByLabel.set(label, list);
  }
  let counter = 1;
  return [...observationIdsByLabel.entries()].map(([label, observationIds]) => ({
    id: `group-${String(counter++).padStart(2, "0")}`,
    label,
    observationIds,
  }));
}

// id ist eine reine Funktion des Snapshot-Inhalts (Zeitpunkt + enthaltene
// Observation-IDs) — kein modulweiter Zähler. Ein Zähler wäre call-order-abhängig
// und damit nicht deterministisch bezüglich (WORLD_SEED, Scenario Profile) allein,
// sobald generateGroundTruthSnapshot mehrfach pro Prozess aufgerufen wird (Scenario
// Profiles rufen sie einmal je Profil auf, statt wie zuvor genau einmal insgesamt).
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
function snapshotId(observations: readonly Observation[], timestamp: string): string {
  const fingerprint = `${timestamp}|${observations.map((o) => o.id).join(",")}`;
  return `gts-${String(hashString(fingerprint) % 100000).padStart(5, "0")}`;
}

// Ein Snapshot beschreibt die Ground Truth zu genau einem Zeitpunkt: alle zu diesem
// Zeitpunkt gültigen Observations, ihre Priorität und ihre thematische Gruppierung.
export function generateGroundTruthSnapshot(observations: readonly Observation[], timestamp: string): GroundTruthSnapshot {
  return {
    id: snapshotId(observations, timestamp),
    timestamp,
    activeObservationIds: observations.map((o) => o.id),
    priorities: observations.map((o) => ({
      observationId: o.id,
      tier: GROUND_TRUTH_PRIORITIES[o.kind],
    })),
    observationGroups: buildObservationGroups(observations),
  };
}

// Alle 13 bestehenden Observations tragen `generatedAt = WORLD_NOW` (eine
// Momentaufnahme-Analyse der Baseline-Welt, siehe Schritt "Observation Layer") — es
// gibt damit aktuell genau einen fachlich gedeckten Zeitpunkt für einen Ground-Truth-
// Snapshot. Weitere Zeitpunkte mit eigenen, davon abweichenden Observation-Ständen
// würden erfundene zeitliche Variation voraussetzen, die die Welt nicht hergibt —
// das widerspräche "Ground Truth erzeugt keinerlei neue Erkenntnisse".
export const GROUND_TRUTH_SNAPSHOTS: GroundTruthSnapshot[] = [generateGroundTruthSnapshot(OBSERVATIONS, WORLD_NOW)];
