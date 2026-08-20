import { WORLD_SEED } from "../engine/seed";
import { generateScenarioWorld } from "../engine/generator";
import { BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { generateBusinessStateSnapshot } from "../business-state/business-state";
import { generateExecutiveContextSnapshot } from "../executive-context/executive-context";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { WORLD_NOW } from "../timeline/world-clock";
import { generateCompanyContextFromSnapshot } from "./company-context";
import type { CompanyBusinessStateSnapshot } from "./company-business-state";
import type { CompanyExecutiveContextSnapshot } from "./company-executive-context";
import { generateCompanyExecutiveKpiData } from "./company-executive-kpis";
import type { CompanyExecutiveKpiData } from "./company-executive-kpis";

// Public Consumer Contract (sales-platform Integration Decision, Step A, Phase 3):
// dünne Orchestrierungsfunktion — sie enthält KEINE eigene Klassifikationslogik,
// KEINEN neuen Schwellenwert, bewertet Operations nicht und dupliziert keine
// bestehende Businessregel. Sie ruft ausschließlich bereits bestehende, an anderer
// Stelle geprüfte Funktionen in der bereits bestehenden Reihenfolge auf:
// World/Scenario → Snapshot → Sales Ground Truth/Business State/Executive Context
// → generateCompanyContextFromSnapshot. Das ist exakt dieselbe Verkabelung, die ein
// Consumer heute manuell nachbauen müsste (siehe company-context.ts, "ehrlich
// benannte Teilgrenze") — hier lediglich an einer Stelle gekapselt, damit kein
// externer Consumer sie kennen oder duplizieren muss.
//
// Kapselt weiterhin ehrlich dieselbe, bereits in company-context.ts benannte
// Architekturgrenze: Sales ist nicht asOf-parametrisiert
// (generateObservations/generateBusinessStateSnapshot/generateExecutiveContextSnapshot
// analysieren immer den vollständigen, bei WORLD_NOW erzeugten Scenario World-Zustand,
// unabhängig vom übergebenen asOf). People und Operations reagieren über den
// Snapshot korrekt auf asOf; Sales bleibt bewusst unverändert — diese Funktion
// verändert diese bestehende Sales-Logik nicht, sie verbirgt nur die
// Verkabelungskomplexität vor dem Consumer.
export interface FullCompanyContext {
  businessState: CompanyBusinessStateSnapshot;
  executiveContext: CompanyExecutiveContextSnapshot;
  // Additive, backward-compatible Erweiterung (Executive KPI Contract v1.1
  // Foundation): rein deskriptive Rohfakten aus demselben, bereits oben
  // berechneten WorldSnapshot — keine neue Bewertung, kein neuer Business
  // State, keine Kopplung an businessState/executiveContext über den
  // gemeinsamen asOf-Zeitpunkt hinaus.
  executiveKpis: CompanyExecutiveKpiData;
}

export function generateFullCompanyContext(
  worldSeed: number = WORLD_SEED,
  profile: ScenarioProfile = BASELINE_PROFILE,
  asOf: string = WORLD_NOW,
): FullCompanyContext {
  const scenarioWorld = generateScenarioWorld(worldSeed, profile);

  const snapshotSource: WorldSnapshotSource = {
    employees: EMPLOYEES,
    employeeHiredEvents: EMPLOYEE_HIRED_EVENTS,
    employeeTerminatedEvents: EMPLOYEE_TERMINATED_EVENTS,
    deliveryUnits: scenarioWorld.deliveryUnits,
    customerAccounts: CUSTOMER_ACCOUNTS,
    contacts: CONTACTS,
    accountOwnerships: scenarioWorld.accountOwnerships,
    leads: scenarioWorld.leads,
    opportunities: scenarioWorld.opportunities,
    stageHistory: scenarioWorld.stageHistory,
    knowledgeObjects: scenarioWorld.knowledgeObjects,
    calls: scenarioWorld.calls,
    emails: scenarioWorld.emails,
    meetings: scenarioWorld.meetings,
    meetingTranscripts: scenarioWorld.meetingTranscripts,
    crmActivities: scenarioWorld.crmActivities,
    salesAppointmentBookedEvents: scenarioWorld.salesAppointmentBookedEvents,
    salesAppointmentHeldEvents: scenarioWorld.salesAppointmentHeldEvents,
    metaAdSpendRecords: scenarioWorld.metaAdSpendRecords,
    metaLeadGeneratedEvents: scenarioWorld.metaLeadGeneratedEvents,
    marketingCrmLeadIngestedEvents: scenarioWorld.marketingCrmLeadIngestedEvents,
    marketingLeadIdentityMatchedEvents: scenarioWorld.marketingLeadIdentityMatchedEvents,
  };
  const snapshot = generateWorldSnapshot(snapshotSource, asOf);

  const salesBusinessState = generateBusinessStateSnapshot(scenarioWorld.groundTruth, scenarioWorld.observations);
  const salesExecutiveContext = generateExecutiveContextSnapshot(salesBusinessState, scenarioWorld.groundTruth);

  const companyContext = generateCompanyContextFromSnapshot(
    snapshot,
    salesBusinessState,
    salesExecutiveContext,
    scenarioWorld.groundTruth,
    scenarioWorld.observations,
  );

  // Reine Weiterverwendung des bereits oben berechneten Snapshots — keine
  // zweite Weltgenerierung, kein zusätzlicher RNG-Aufruf (Executive KPI
  // Contract v1.1 Foundation, Option A).
  const executiveKpis = generateCompanyExecutiveKpiData(snapshot);

  return { ...companyContext, executiveKpis };
}
