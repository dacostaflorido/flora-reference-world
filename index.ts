// Public Consumer Contract (sales-platform Integration Decision, Step A, Phase 2/4).
//
// Dies ist der EINZIGE unterstützte Einstiegspunkt für externe Consumer. Alle
// tieferen Modulpfade (engine/, world/, events/, observations/, ground-truth/,
// business-state/, executive-context/, snapshot/, company/, validation/) bleiben
// interne Implementierungsdetails — sie sind nicht Teil dieses Contracts und
// können sich ohne SemVer-Major-Ankündigung ändern, solange dieser Export bestehen
// bleibt. Ein Consumer, der stattdessen einen internen Pfad importiert, verlässt
// den unterstützten Contract.
//
// Absichtlich NICHT exportiert (interne Implementierungsdetails, siehe Phase 2 der
// Integrationsentscheidung): RNG-Interna (engine/seed.ts, engine/random.ts als
// eigenständige API), SEED_STEP, dateilokale Zuteilungs-/Gewichtungs-Helfer
// (z. B. pickByInverseLoad), ID-/Hash-Helfer, einzelne Low-Level-Generatoren
// (generateObservations, generateDeliveryUnits, generateAccountOwnerships u. Ä.),
// validation/* (reine Selbsttest-Infrastruktur dieses Repositories), sowie jegliche
// UI-/React-/Next-Typen (es gibt keine — Product Separation, PRINCIPLES.md
// Prinzip 1).
export { generateFullCompanyContext, type FullCompanyContext } from "./company/full-company-context";

export type {
  CompanyAreaKey,
  CompanyAreaKind,
  CompanyAreaObservationSummary,
  CompanyAreaSummary,
} from "./company/company-area";

export type { CompanyBusinessStateType, CompanyBusinessStateSnapshot } from "./company/company-business-state";

export type { CompanyExecutiveContextSnapshot, CompanyCrossAreaLink } from "./company/company-executive-context";

// Executive KPI Contract v1.1 Foundation: rein deskriptive Rohfakten
// (People-Headcount/Eintritte/Austritte, Sales Won Deals), additiv an
// FullCompanyContext.executiveKpis angehängt. Der erzeugende Generator
// (generateCompanyExecutiveKpiData) bleibt bewusst intern — Consumer erhalten
// diese Daten ausschließlich über generateFullCompanyContext().executiveKpis,
// wie jede andere Teilstruktur von FullCompanyContext auch.
export type {
  CompanyExecutiveKpiData,
  PeopleHireFact,
  PeopleTerminationFact,
  SalesWonDealFact,
} from "./company/company-executive-kpis";

// Marketing Executive KPI Contract v1 Foundation: additive Rohfakten (Leads,
// Sales-Handoffs), an CompanyExecutiveKpiData.marketing angehängt. Der
// erzeugende Generator (generateMarketingExecutiveKpiData) bleibt bewusst
// intern — Consumer erhalten diese Daten ausschließlich über
// generateFullCompanyContext().executiveKpis.marketing.
export type { MarketingExecutiveKpiData, MarketingLeadFact, MarketingSalesHandoffFact } from "./company/marketing-executive-kpis";

export type { WorldSnapshot } from "./snapshot/snapshot";

export type { ScenarioProfile } from "./engine/scenario-profiles";
export { BASELINE_PROFILE, SCENARIO_PROFILES } from "./engine/scenario-profiles";

export { WORLD_NOW } from "./timeline/world-clock";

// Marketing/Sales Workspace Data Contract (Auftrag "Workspace Contract
// Checkpoint + Erste sichtbare Marketing/Sales-Unternehmeransicht", Phase I):
// additiver, UI-fertiger Datenvertrag für Marketing-Kohortenkosten und
// Sales-Aktivität, jeweils für Gestern/Woche-bis-heute/Monat-bis-heute.
// Ausschließlich UI-fertige Projektionstypen und der eine schmale
// Einstiegspunkt werden exportiert — jede zugrunde liegende
// Berechnungsfunktion (generateMarketingCohortCostMetrics,
// generateSalesPeriodMetrics, generateCustomerAcquisitionPeriodMetrics,
// generateMarketingPeriodMetrics, generateAreaWorkspaceData selbst) bleibt
// bewusst intern — ein Consumer erhält diese Daten ausschließlich über
// `generateReferenceAreaWorkspaceData()`, wie jeder andere externe
// Einstiegspunkt dieses Contracts auch. Keine Kennzahl wird hier neu
// berechnet; siehe company/area-workspace-data.ts für die vollständige
// Herleitung und Statuspräzedenz.
export {
  generateReferenceAreaWorkspaceData,
  type AreaWorkspaceData,
  type MarketingWorkspaceData,
  type SalesWorkspaceData,
  type MarketingWorkspacePeriod,
  type SalesWorkspacePeriod,
  type WorkspacePeriodKey,
  type WorkspacePeriodBounds,
  type WorkspaceMetricStatus,
  type WorkspaceCountMetric,
  type WorkspaceMoneyMetric,
  type WorkspaceCostMetric,
} from "./company/area-workspace-data";
