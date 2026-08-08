import type { BusinessStateSnapshot, BusinessStateType } from "../business-state/business-state";
import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";

// Executive Context erklärt, warum ein bereits belegter Business State für die
// Unternehmensführung relevant ist — nicht, was daraus folgen soll. Rein textuelle,
// evidenzgebundene Interpretation, keine neue Klassifikation, keine neue
// Risiko-/Chancen-Aggregation (siehe PRINCIPLES.md, Prinzip 20).
//
// Rollenbezogen, nicht personenbezogen: "für die Unternehmensführung", nie für eine
// bestimmte Person. Eine personenbezogene Perspektive würde eine eigene, bewusste
// Daten-/Kontextgrundlage benötigen (wer fragt, wofür ist diese Person zuständig),
// die heute nicht existiert und hier nicht simuliert wird — auch nicht durch
// Ableitung aus Employee.managerId, obwohl das Organigramm technisch dafür
// missbraucht werden könnte (jede heutige Observation ist ausschließlich über Sales
// traceable, das berichtet vollständig an nur einen der beiden Geschäftsführer).
//
// Scenario-Blindheit wie bei Business State typsystemisch erzwungen: die Signatur
// nimmt ausschließlich BusinessStateSnapshot und GroundTruthSnapshot entgegen.
// ScenarioProfile taucht nirgends auf.
//
// Kein Observation[]-Parameter: die minimal erforderliche Eingabe für dieses
// Feldmodell ist ausschließlich Business States eigene Zitate
// (supportingObservationIds) und Ground Truths Gruppenzuordnung
// (observationGroups) — beides bereits vollständig in BusinessStateSnapshot bzw.
// GroundTruthSnapshot enthalten. Ein zusätzlicher Observation[]-Parameter wäre
// ungenutzt geblieben; das hätte nur suggeriert, dieser Layer läse Observation-Inhalte
// selbst, was er nicht tut.
export interface ExecutiveContextSnapshot {
  id: string;
  timestamp: string;
  businessStateId: string;
  affectedDimensions: string[];
  relevanceStatement: string;
  tensionStatement?: string;
  supportingObservationIds: string[];
}

// id ist — wie bei GroundTruthSnapshot/BusinessStateSnapshot — eine reine Funktion
// des Inhalts, kein modulweiter Zähler (siehe ground-truth.ts für die ausführliche
// Begründung).
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
function executiveContextId(businessStateId: string, timestamp: string): string {
  const fingerprint = `${businessStateId}|${timestamp}`;
  return `exec-${String(hashString(fingerprint) % 100000).padStart(5, "0")}`;
}

// Eine einzige, redaktionell verfasste Aussage je Business-State-Type — dieselbe
// Granularität wie Business States eigenes `statement`-Feld, keine feinere
// Untergliederung. Kein implicationStatement, keine Risiko-/Chancen-Aggregation:
// diese Information liegt bereits in den zitierten Observations/Ground Truth vor und
// wird hier nicht neu bewertet.
//
// "wachstum-ueber-kapazitaet" ist nach aktuellem Stand der Ground Truth unerreichbar
// (siehe business-state.ts) — der Eintrag existiert ausschließlich, damit dieser
// Record vollständig bleibt (dieselbe Disziplin wie bei GROUND_TRUTH_PRIORITIES: ein
// neuer BusinessStateType ohne Eintrag wäre ein Kompilierfehler, kein stiller
// Fallback), nicht weil er heute erzeugt werden kann.
const RELEVANCE_STATEMENTS: Record<BusinessStateType, string> = {
  ausgeglichen: "Die aktuelle Lage weist keine dominante operative Belastung auf.",
  "verlangsamte-pipeline":
    "Die Pipeline bewegt sich langsamer als im Normalzustand. Dieser Zustand betrifft mehrere aktuell offene " +
    "Opportunities und ist deshalb für die Führungsübersicht relevant.",
  "operative-anspannung":
    "Mehrere unabhängige Signale weichen gleichzeitig vom Normalzustand ab und betreffen mehr als einen " +
    "Unternehmensbereich. Diese gemeinsame Abweichung ist für die Führungsübersicht relevant.",
  "konzentrierte-last":
    "Die aktuelle Belastung konzentriert sich auf einen begrenzten Teil des Teams und ist deshalb für die " +
    "Führungsübersicht relevant.",
  "strategischer-freiraum":
    "Die aktuelle Lage zeigt eine überdurchschnittliche Anzahl bestätigter positiver Signale und ist deshalb für " +
    "die Führungsübersicht relevant.",
  "wachstum-ueber-kapazitaet":
    "Das Unternehmen wächst, während die verfügbare Kapazität in einzelnen Bereichen nicht im gleichen Maß " +
    "mitwächst.",
};

export function generateExecutiveContextSnapshot(
  businessState: BusinessStateSnapshot,
  groundTruth: GroundTruthSnapshot,
): ExecutiveContextSnapshot {
  // Echte Teilmenge im mathematischen Sinn (⊆, Gleichheit eingeschlossen): Business
  // States eigene Zitate werden vollständig übernommen, nie erweitert. Eine
  // Auswahl-Heuristik ("welche davon sind die 'wichtigsten'") wäre selbst bereits
  // eine neue, hier nicht erlaubte Klassifikationsentscheidung.
  const supportingObservationIds = [...businessState.supportingObservationIds];

  // affectedDimensions ausschließlich aus bereits bestehenden Ground-Truth-Gruppen —
  // keine neue Taxonomie. Alphabetisch sortiert, damit das Ergebnis unabhängig von
  // der Reihenfolge in supportingObservationIds ist.
  const dimensionSet = new Set<string>();
  for (const id of supportingObservationIds) {
    const group = groundTruth.observationGroups.find((g) => g.observationIds.includes(id));
    if (group) dimensionSet.add(group.label);
  }
  const affectedDimensions = [...dimensionSet].sort();

  const relevanceStatement = RELEVANCE_STATEMENTS[businessState.type];

  // tensionStatement ausschließlich, wenn die Evidenz selbst mehr als eine
  // unabhängige Dimension gleichzeitig belegt — kein künstlicher Text, nur damit das
  // Feld gefüllt ist. Generisch über die tatsächlich betroffenen Dimensionen
  // formuliert statt einer Vorlage je exakter Dimensions-Kombination (das würde mit
  // wachsender Observation-Ebene unkontrolliert wachsen).
  const tensionStatement =
    affectedDimensions.length >= 2
      ? `Mehrere unabhängige Bereiche — ${affectedDimensions.join(", ")} — weichen gleichzeitig vom Normalzustand ab.`
      : undefined;

  return {
    id: executiveContextId(businessState.id, businessState.timestamp),
    timestamp: businessState.timestamp,
    businessStateId: businessState.id,
    affectedDimensions,
    relevanceStatement,
    tensionStatement,
    supportingObservationIds,
  };
}
