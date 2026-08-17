import type { BusinessStateSnapshot } from "../business-state/business-state";
import type { ExecutiveContextSnapshot } from "../executive-context/executive-context";
import type { PeopleBusinessStateSnapshot } from "../business-state/people-business-state";
import type { MarketingBusinessStateSnapshot } from "../business-state/marketing-business-state";
import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";
import type { Observation } from "../observations/observations";
import type { OperationsObservation, CompletedDeliveryDurationObservation } from "../observations/operations-observations";
import type { MarketingObservation, MarketingDemandSignalObservation } from "../observations/marketing-observations";
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
// Quellen: Operations Fair-Share-Observation, Completed Delivery Duration
// Observation (Delivery-Commitment-Truth-Auftrag), Operations Ground Truth.
// state bleibt zwingend null, evaluationStatus zwingend "unzureichende-evidenz" —
// Operations besitzt keinen Business State (Domain Decision 3) und keine der
// beiden Observations verändert das (beide sind rein deskriptiv, ohne
// Bewertungsgrundlage). statement bleibt bewusst ausschließlich die Fair-Share-
// Aussage (unverändertes Verhalten, bestehender Consumer Contract) — die neue
// Completed-Delivery-Duration-Aussage wird additiv über topObservations
// exponiert, exakt demselben Muster wie Marketings zweite Observation
// (generateMarketingAreaSummary oben: mehrere aktive Observations, aber ein
// einzelnes, weiterhin eindeutiges statement-Feld). completedDeliveryDuration ist
// optional: undefined, wenn zu diesem Zeitpunkt keine DeliveryUnit bereits
// abgeschlossen ist (siehe generateOperationsCompletedDeliveryDurationObservation)
// — dann keine Teilnahme an topObservations/relevantMetrics/evidenceIds, kein
// erfundener Ersatzinhalt.
export function generateOperationsAreaSummary(
  observation: OperationsObservation | undefined,
  completedDeliveryDuration: CompletedDeliveryDurationObservation | undefined,
  groundTruth: GroundTruthSnapshot,
): CompanyAreaSummary {
  const isActive = observation !== undefined && groundTruth.activeObservationIds.includes(observation.id);
  const isDurationActive =
    completedDeliveryDuration !== undefined && groundTruth.activeObservationIds.includes(completedDeliveryDuration.id);

  const topObservations: CompanyAreaObservationSummary[] = [
    ...(isActive ? [{ id: observation!.id, statement: observation!.statement, confidence: observation!.confidence }] : []),
    ...(isDurationActive
      ? [{ id: completedDeliveryDuration!.id, statement: completedDeliveryDuration!.statement, confidence: completedDeliveryDuration!.confidence }]
      : []),
  ];

  const relevantMetrics: Record<string, number | string> = {
    ...(isActive
      ? {
          activeDeliveryUnits: observation!.activeDeliveryUnitsTotal,
          maxAssignedCount: observation!.maxAssignedCount,
          fairShare: observation!.fairShare,
          maxShare: observation!.maxShare,
          fairShareRatio: observation!.fairShareRatio,
        }
      : {}),
    ...(isDurationActive
      ? {
          completedDeliveryUnitsTotal: completedDeliveryDuration!.completedDeliveryUnitsTotal,
          durationDaysMedian: completedDeliveryDuration!.durationDaysMedian,
          durationDaysMin: completedDeliveryDuration!.durationDaysMin,
          durationDaysMax: completedDeliveryDuration!.durationDaysMax,
        }
      : {}),
  };

  // evidenceIds: Vereinigung beider aktiven Observation-Evidenzketten (dedupliziert,
  // beide sind gleichrangige, unterstützende Evidenz — anders als bei Marketing gibt
  // es hier keine Bewertungshierarchie/isEvaluated-Unterscheidung, die eine Quelle
  // gegenüber der anderen bevorzugen müsste). isAreaAffected (company-executive-
  // context.ts) prüft für state=null-Areas ausschließlich evidenceIds.length > 0 —
  // generisch unverändert, keine Sonderbehandlung nötig.
  const evidenceIds = [
    ...new Set([
      ...(isActive ? observation!.derivedFrom : []),
      ...(isDurationActive ? completedDeliveryDuration!.derivedFrom : []),
    ]),
  ];

  return {
    key: "operations",
    kind: "department",
    departmentId: "dept-operations",
    state: null,
    evaluationStatus: "unzureichende-evidenz",
    statement: isActive ? observation!.statement : null,
    topObservations,
    relevantMetrics,
    evidenceIds,
  };
}

// MARKETING --------------------------------------------------------------
// Quellen: Marketing Demand-Generation-Observation (reine Momentaufnahme, weiterhin
// ohne State-Beitrag — siehe observations/marketing-observations.ts), Marketing
// Demand-Regime-Signal-Observation (Marketing Leadership State, siehe
// business-state/marketing-business-state.ts) und Marketing Ground Truth.
//
// state/evaluationStatus sind jetzt state-fähig, exakt demselben Muster wie People
// folgend: state=null/evaluationStatus="unzureichende-evidenz" NUR, solange keine
// Regime-Signal-Observation aktiv ist (zu wenig historische Evidenz für eine
// belastbare Referenzdichte, siehe generateMarketingDemandRegimeSignalObservation)
// — sobald genug Evidenz vorliegt, wird Marketing bewertet: state=businessState.type,
// evaluationStatus="bewertet". Die drei erreichbaren Types (stabile-nachfrage/
// erhoehte-nachfrage/unterdrueckte-nachfrage) tragen bewusst keine Bewertungssprache
// und sind bewusst NICHT in POSITIVE_STATES/BELASTET_STATES (company-business-state.ts)
// eingetragen — Marketing trägt dadurch nicht zur Company-weiten Divergenzprüfung
// bei, ohne implizit zu behaupten, mehr/weniger Nachfrage sei per se gut oder
// belastend (siehe marketing-business-state.ts für die vollständige Begründung).
//
// relevantMetrics bleibt für die reine Momentaufnahme-Observation weiterhin leer
// (Lead-/Handoff-Zahlen bleiben vollständig öffentlich über
// FullCompanyContext.executiveKpis.marketing) — sobald ein Regime-Signal aktiv ist,
// werden dessen abgeleitete Vergleichszahlen (nicht Rohzahlen) hier zusätzlich
// exponiert, exakt demselben Muster wie Operations' fairShare-Kennzahlen folgend.
export function generateMarketingAreaSummary(
  observation: MarketingObservation | undefined,
  demandSignal: MarketingDemandSignalObservation | undefined,
  businessState: MarketingBusinessStateSnapshot | undefined,
  groundTruth: GroundTruthSnapshot,
): CompanyAreaSummary {
  const isVolumeActive = observation !== undefined && groundTruth.activeObservationIds.includes(observation.id);
  const isSignalActive = demandSignal !== undefined && groundTruth.activeObservationIds.includes(demandSignal.id);
  const isEvaluated = businessState !== undefined && isSignalActive;

  const topObservations: CompanyAreaObservationSummary[] = [
    ...(isVolumeActive ? [{ id: observation!.id, statement: observation!.statement, confidence: observation!.confidence }] : []),
    ...(isSignalActive ? [{ id: demandSignal!.id, statement: demandSignal!.statement, confidence: demandSignal!.confidence }] : []),
  ];

  const relevantMetrics: Record<string, number | string> = isEvaluated
    ? {
        recentWindowDensity1: demandSignal!.recentWindowDensities[0],
        recentWindowDensity2: demandSignal!.recentWindowDensities[1],
        referenceDensity: demandSignal!.referenceDensity,
        regimeSignal: demandSignal!.regimeSignal,
      }
    : {};

  return {
    key: "marketing",
    kind: "department",
    departmentId: "dept-marketing",
    state: isEvaluated ? businessState!.type : null,
    evaluationStatus: isEvaluated ? "bewertet" : "unzureichende-evidenz",
    statement: isEvaluated ? businessState!.statement : isVolumeActive ? observation!.statement : null,
    topObservations,
    relevantMetrics,
    evidenceIds: isEvaluated ? [...businessState!.supportingObservationIds] : isVolumeActive ? [...observation!.derivedFrom] : [],
  };
}
