import type { BusinessStateSnapshot } from "../business-state/business-state";
import type { ExecutiveContextSnapshot } from "../executive-context/executive-context";
import type { PeopleBusinessStateSnapshot } from "../business-state/people-business-state";
import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";
import type { Observation } from "../observations/observations";
import type { OperationsObservation } from "../observations/operations-observations";
import type { CompanyAreaObservationSummary, CompanyAreaSummary } from "./company-area";

// Phase 5 (Company Aggregation Foundation): reine Adapter-Funktionen. Sie lesen
// ausschließlich bereits bestehende, an anderer Stelle erzeugte Snapshots/
// Observations und bilden sie verlustfrei auf CompanyAreaSummary ab — keine neue
// Businesslogik, keine neue Priorisierung, keine neue Bewertung. Jede Funktion ist
// bewusst pro Domäne getrennt (keine generische "irgendeine Domäne"-Funktion), weil
// die drei Domänen strukturell unterschiedliche Eingaben haben (Sales hat Executive
// Context, People/Operations nicht; Operations hat keinen Business State).

function toObservationSummaries(
  ids: readonly string[],
  observations: readonly Observation[],
  groundTruth: GroundTruthSnapshot,
): CompanyAreaObservationSummary[] {
  const observationById = new Map(observations.map((o) => [o.id, o]));
  const activeIds = new Set(groundTruth.activeObservationIds);
  // Bestehende Reihenfolge von `ids` (businessState.supportingObservationIds)
  // respektiert, keine Neusortierung. Der activeIds-Filter ist ein reiner
  // Konsistenz-Check gegen die zugehörige Ground Truth (Backward Explainability) —
  // keine neue Auswahl-/Priorisierungsentscheidung.
  return ids
    .filter((id) => activeIds.has(id))
    .map((id) => observationById.get(id))
    .filter((o): o is Observation => o !== undefined)
    .map((o) => ({ id: o.id, statement: o.statement, severity: o.severity, confidence: o.confidence }));
}

// SALES ----------------------------------------------------------------------
// Quellen: Sales Business State, Sales Executive Context, aktive Sales
// Observations, Sales Ground Truth. statement = executiveContext.relevanceStatement
// (die bereits vorhandene, für Führung aufbereitete Aussage) — nicht neu formuliert.
export function generateSalesAreaSummary(
  businessState: BusinessStateSnapshot,
  executiveContext: ExecutiveContextSnapshot,
  groundTruth: GroundTruthSnapshot,
  observations: readonly Observation[],
): CompanyAreaSummary {
  return {
    key: "sales",
    kind: "department",
    departmentId: "dept-vertrieb",
    state: businessState.type,
    evaluationStatus: "bewertet",
    statement: executiveContext.relevanceStatement,
    topObservations: toObservationSummaries(businessState.supportingObservationIds, observations, groundTruth),
    relevantMetrics: {},
    evidenceIds: [...businessState.supportingObservationIds],
  };
}

// PEOPLE -----------------------------------------------------------------------
// Quellen: People Business State, People Ground Truth, People Observations. Keine
// departmentId (Domain Decision 9 — People ist Querschnittsdimension, kein
// Department). statement = businessState.statement (People hat keinen eigenen
// Executive Context). Baseline (keine aktive People Observation) bleibt ehrlich
// "ausgeglichen" mit leeren topObservations/evidenceIds — kein künstlicher Inhalt.
export function generatePeopleAreaSummary(
  businessState: PeopleBusinessStateSnapshot,
  groundTruth: GroundTruthSnapshot,
  observations: readonly Observation[],
): CompanyAreaSummary {
  return {
    key: "people",
    kind: "cross-cutting-dimension",
    state: businessState.type,
    evaluationStatus: "bewertet",
    statement: businessState.statement,
    topObservations: toObservationSummaries(businessState.supportingObservationIds, observations, groundTruth),
    relevantMetrics: {},
    evidenceIds: [...businessState.supportingObservationIds],
  };
}

// OPERATIONS ---------------------------------------------------------------
// Quellen: Operations Observation, Operations Ground Truth, aktive DeliveryUnits.
// state bleibt zwingend null, evaluationStatus zwingend "unzureichende-evidenz" —
// Operations besitzt keinen Business State (Domain Decision 3). statement gibt
// ausschließlich den bereits vorhandenen Observation-Fakt wieder, unverändert.
// observation ist optional: undefined nur, wenn zu diesem Zeitpunkt keine aktiven
// Operations-Mitarbeiter existieren (siehe
// generateOperationsDeliveryFairShareObservation) — dann leere, ehrliche Summary,
// kein erfundener Ersatzinhalt.
export function generateOperationsAreaSummary(
  observation: OperationsObservation | undefined,
  groundTruth: GroundTruthSnapshot,
): CompanyAreaSummary {
  const isActive = observation !== undefined && groundTruth.activeObservationIds.includes(observation.id);

  const topObservations: CompanyAreaObservationSummary[] = isActive
    ? [{ id: observation!.id, statement: observation!.statement, confidence: observation!.confidence }]
    : [];

  const relevantMetrics: Record<string, number | string> = isActive
    ? {
        activeDeliveryUnits: observation!.activeDeliveryUnitsTotal,
        maxAssignedCount: observation!.maxAssignedCount,
        fairShare: observation!.fairShare,
        maxShare: observation!.maxShare,
        fairShareRatio: observation!.fairShareRatio,
      }
    : {};

  return {
    key: "operations",
    kind: "department",
    departmentId: "dept-operations",
    state: null,
    evaluationStatus: "unzureichende-evidenz",
    statement: isActive ? observation!.statement : null,
    topObservations,
    relevantMetrics,
    evidenceIds: isActive ? [...observation!.derivedFrom] : [],
  };
}
