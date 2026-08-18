import type { BusinessStateSnapshot } from "../business-state/business-state";
import type { ExecutiveContextSnapshot } from "../executive-context/executive-context";
import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";
import { generateGroundTruthSnapshot } from "../ground-truth/ground-truth";
import type { Observation } from "../observations/observations";
import { generatePeopleObservations } from "../observations/people-observations";
import { generatePeopleBusinessStateSnapshot } from "../business-state/people-business-state";
import { generateMarketingBusinessStateSnapshot } from "../business-state/marketing-business-state";
import type { WorldSnapshot } from "../snapshot/snapshot";
import {
  generateSalesAreaSummary,
  generateMarketingAreaSummary,
  generatePeopleAreaSummary,
  generateOperationsAreaSummary,
} from "./company-area-summaries";
import { generateCompanyBusinessStateSnapshot, type CompanyBusinessStateSnapshot } from "./company-business-state";
import { generateCompanyExecutiveContextSnapshot, type CompanyExecutiveContextSnapshot } from "./company-executive-context";

// Phase 21 (Company Aggregation Foundation) — Snapshot-Architektur-Entscheidung:
// OPTION B (Company Context als reine deterministische Ableitung), mit einer
// ehrlich benannten Grenze statt einer stillschweigenden Annahme.
//
// People UND Operations sind vollständig und ausschließlich aus WorldSnapshot
// ableitbar:
// - People: snapshot.employeeTerminatedEvents ist bereits existenzgefiltert auf
//   snapshot.asOf (People Foundation, Prinzip 18) — generatePeopleObservations()
//   darauf angewendet liefert exakt die zu asOf bekannten People-Observations,
//   keine Zukunftskenntnis.
// - Operations: snapshot.operationsObservation ist bereits im Snapshot selbst
//   vollständig vorberechnet (Operations Foundation, Phase 14) — keine erneute
//   Ableitung nötig.
//
// Sales ist NICHT rein aus dem Snapshot ableitbar — das ist eine bereits
// bestehende, hier nicht angetastete Architekturgrenze: generateObservations()/
// generateBusinessStateSnapshot()/generateExecutiveContextSnapshot() sind nicht
// asOf-parametrisiert, sondern liefern ausschließlich die WORLD_NOW-Analyse eines
// Scenario Worlds (siehe engine/generator.ts). Diese Funktionen zu asOf-fähig zu
// machen wäre eine Änderung an bestehender Sales-Logik — ausdrücklich nicht
// Teil dieses Auftrags ("bestehende Sales-/People-/Operations-Logik bleibt
// unverändert"). Deshalb nimmt generateCompanyContextFromSnapshot die bereits
// extern berechneten Sales-Eingaben als Parameter entgegen, statt sie
// stillschweigend (und unkorrekt) aus dem Snapshot selbst zu erfinden. Das ist
// eine ehrlich benannte Teil-Grenze von Option B, keine verdeckte Annahme.
//
// Kein neues Feld in WorldSnapshot selbst — Company Context bleibt eine reine
// Ableitung, keine neue Persistenz, keine neue Datenquelle.
export function generateCompanyContextFromSnapshot(
  snapshot: WorldSnapshot,
  salesBusinessState: BusinessStateSnapshot,
  salesExecutiveContext: ExecutiveContextSnapshot,
  salesGroundTruth: GroundTruthSnapshot,
  salesObservations: readonly Observation[],
): { businessState: CompanyBusinessStateSnapshot; executiveContext: CompanyExecutiveContextSnapshot } {
  const peopleObservations = generatePeopleObservations(snapshot.employeeTerminatedEvents, snapshot.employees);
  const peopleGroundTruth = generateGroundTruthSnapshot(peopleObservations, snapshot.asOf);
  const peopleBusinessState = generatePeopleBusinessStateSnapshot(peopleGroundTruth, peopleObservations);

  // Delivery Commitment Truth + Completed Delivery Duration Observation V1 +
  // Queue Duration Observation V1 + Current Delivery Queue Snapshot V1: exakt
  // dieselbe Herleitung wie Marketings zwei Observation-Kinds oben — alle vier
  // Operations-Observations werden derselben generischen Ground Truth übergeben,
  // kein neuer Mechanismus. currentDeliveryQueueSnapshotObservation ist im
  // Snapshot nicht optional (siehe snapshot.ts), daher hier ohne bedingten
  // Spread direkt in das Array aufgenommen.
  const operationsGroundTruth = generateGroundTruthSnapshot(
    [
      ...(snapshot.operationsObservation ? [snapshot.operationsObservation] : []),
      ...(snapshot.completedDeliveryDurationObservation ? [snapshot.completedDeliveryDurationObservation] : []),
      ...(snapshot.queueDurationObservation ? [snapshot.queueDurationObservation] : []),
      snapshot.currentDeliveryQueueSnapshotObservation,
    ],
    snapshot.asOf,
  );

  // Marketing as First-Class Company Area: exakt dieselbe Herleitung wie Operations
  // oben — snapshot.marketingObservation/snapshot.marketingDemandSignal sind bereits
  // im Snapshot selbst vollständig vorberechnet (snapshot.ts), keine erneute
  // Ableitung nötig. Ground Truth führt beide Observation-Kinds derselben Domäne
  // zusammen (dieselbe generische generateGroundTruthSnapshot-Funktion wie überall
  // sonst — kein neuer Mechanismus).
  const marketingGroundTruth = generateGroundTruthSnapshot(
    [
      ...(snapshot.marketingObservation ? [snapshot.marketingObservation] : []),
      ...(snapshot.marketingDemandSignal ? [snapshot.marketingDemandSignal] : []),
    ],
    snapshot.asOf,
  );
  // Marketing Leadership State: nur berechnet, wenn tatsächlich ein Regime-Signal
  // aktiv ist (genug historische Evidenz) — sonst bleibt Marketing über
  // generateMarketingAreaSummary bei state=null/evaluationStatus="unzureichende-
  // evidenz", exakt wie zuvor.
  const marketingBusinessState = snapshot.marketingDemandSignal
    ? generateMarketingBusinessStateSnapshot(marketingGroundTruth, snapshot.marketingDemandSignal)
    : undefined;

  const areaSummaries = [
    generateSalesAreaSummary(salesBusinessState, salesExecutiveContext, salesGroundTruth, salesObservations),
    generateMarketingAreaSummary(snapshot.marketingObservation, snapshot.marketingDemandSignal, marketingBusinessState, marketingGroundTruth),
    generatePeopleAreaSummary(peopleBusinessState, peopleGroundTruth, peopleObservations),
    generateOperationsAreaSummary(
      snapshot.operationsObservation,
      snapshot.completedDeliveryDurationObservation,
      snapshot.queueDurationObservation,
      snapshot.currentDeliveryQueueSnapshotObservation,
      operationsGroundTruth,
    ),
  ];

  const businessState = generateCompanyBusinessStateSnapshot(areaSummaries, snapshot.asOf);
  const executiveContext = generateCompanyExecutiveContextSnapshot(businessState.id, areaSummaries, snapshot.asOf);

  return { businessState, executiveContext };
}
