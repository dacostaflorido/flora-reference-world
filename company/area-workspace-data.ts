import type { MetaAdSpendRecord } from "../events/marketing-meta-ad-spend";
import type { MetaLeadGenerated, MarketingCrmLeadIngested, MarketingLeadIdentityMatched } from "../events/marketing-meta-crm-source";
import type { SalesAppointmentBooked, SalesAppointmentHeld } from "../events/sales-appointment-lifecycle";
import type { SalesAppointment } from "../world/sales-appointments";
import type { Opportunity } from "../events/opportunities";
import type { MarketingSourceCoverage } from "../events/marketing-source-coverage";
import { WORLD_SEED } from "../engine/seed";
import { generateScenarioWorld } from "../engine/generator";
import { BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { WORLD_NOW } from "../timeline/world-clock";
import { generateMarketingPeriodMetrics, type MarketingPeriodMetrics, type PeriodMetricValue } from "./marketing-period-metrics";
import {
  generateMarketingCohortCostMetrics,
  type MarketingCohort,
  type CohortCostMetric,
  type CohortMaturityStatus,
} from "./marketing-cohort-cost-metrics";
import { generateSalesPeriodMetrics, type SalesPeriodMetrics } from "./sales-period-metrics";
import { generateCustomerAcquisitionPeriodMetrics, type CustomerAcquisitionPeriodMetric } from "./customer-period-metrics";

// Marketing/Sales Workspace Data Contract V1 (Auftrag "Customer Metrics
// Checkpoint + Marketing/Sales Workspace Data Contract V1", Phase B) — ein
// rein orchestrierender, UI-fertiger interner Datenvertrag. Berechnet
// NICHTS neu: jede Zahl stammt unverändert aus genau einer der vier bereits
// kanonischen Domain-Funktionen (siehe B1-Forensik unten). Diese Datei
// filtert keine Events, leitet keine Periodengrenzen ab, dividiert nichts
// und bestimmt weder Coverage noch Maturity selbst — sie liest ausschließlich
// bereits vorhandene Felder aus den vier Rückgabewerten und projiziert sie
// in ein gemeinsames, UI-lesbares Statusmodell (B6). NICHT über index.ts
// exportiert — dieselbe Sichtbarkeitsstufe wie die vier zugrunde liegenden
// Dateien.
//
// --- B1: Architekturforensik — Ergebnis ---------------------------------------
//
// 1) Activity-Zahlen liefern: `generateMarketingPeriodMetrics`
//    (Spend/Leads-generiert/Matched/CRM-Eingänge, gefiltert nach EIGENEM
//    Ereigniszeitstempel innerhalb der Periode, gewrappt in
//    `PeriodMetricValue` mit `status: PeriodDataStatus`),
//    `generateSalesPeriodMetrics` (First-/Strategy-Call Booked/Held nach
//    bookedAt/heldAt, Won nach closedAt — PLAIN `number`, kein
//    Status-Wrapper, weil Sales-Daten in dieser Referenzwelt strukturell
//    immer synchron/vollständig generiert werden, siehe
//    events/marketing-source-coverage.ts, "crm-sales-appointment-lifecycle"
//    /"crm-opportunity-lifecycle" sind immer "complete") und
//    `generateCustomerAcquisitionPeriodMetrics` (Customer Acquisitions nach
//    `CustomerAcquired.acquiredAt`, ebenfalls PLAIN `number`, aus demselben
//    Grund).
// 2) Cohort-Zahlen liefert ausschließlich `generateMarketingCohortCostMetrics`
//    (CPL, Kosten pro First Call Booked/Held, Kosten pro Customer Acquired
//    u. a. — Kohortenmitgliedschaft nach `MetaLeadGenerated.generatedAt`,
//    gewrappt in `CohortCostMetric` mit fünfwertigem `availability` UND
//    separatem `maturity`).
// 3) Coverage-Status-Werte: `PeriodDataStatus` ("complete"/"partial"/
//    "unavailable", events/marketing-source-coverage.ts) — direkt sichtbar
//    in `PeriodMetricValue.status`; indirekt eingerechnet in
//    `CohortCostAvailability` (dort mit Nenner-Existenz UND Maturity
//    kombiniert, siehe marketing-cohort-cost-metrics.ts, `computeCostMetric`).
// 4) Maturity-Status-Werte: `CohortMaturityStatus`
//    ("mature"/"developing"/"indeterminate") — AUSSCHLIESSLICH auf
//    `CohortCostMetric` vorhanden. Marketing-Activity-, Sales- und Customer-
//    Period-Metrics kennen kein Maturity-Konzept (reine Aktivitätszählung
//    nach bereits eingetretenen Ereignissen, keine von zukünftigem Outcome
//    abhängige Division).
// 5) Nur interne Domain-APIs: alle vier oben genannten Generatoren sowie
//    `generateCustomerAcquisitionLifecycle`/`generateMarketingToSalesAttribution`
//    (von den Cohort-Cost-Metrics intern konsumiert) — keiner ist über
//    `index.ts` exportiert.
// 6) Gemeinsamer interner Workspace-Vertrag: diese Datei
//    (`company/area-workspace-data.ts`), exakt dieselbe Sichtbarkeitsstufe
//    wie `company/marketing-period-metrics.ts`, `company/sales-period-metrics.ts`,
//    `company/marketing-cohort-cost-metrics.ts` und
//    `company/customer-period-metrics.ts` — kein Snapshot-, kein
//    FullCompanyContext-, kein Observation-Pfad.
// 7) Verhinderung doppelter Berechnung: `generateAreaWorkspaceData` ruft
//    jede der vier Funktionen GENAU EINMAL mit denselben Rohdaten und
//    demselben `asOf` auf und liest danach ausschließlich bereits
//    vorhandene Felder ihrer Rückgabewerte (`activity.bounds`,
//    `evidence.*`, `costPer*.amountMinor` usw.) — keine eigene Filterung,
//    keine eigene Kalenderberechnung, keine eigene Division.
// 8) Public Contract bleibt unverändert: kein neuer Export in `index.ts`,
//    `WorldSnapshot`/`FullCompanyContext`/Observations/Business State
//    bleiben unberührt (siehe Public-Contract-Test in der dedizierten
//    Testdatei).
//
// --- B6: Statusprojektion — ausschließlich aus bestehenden Feldern -----------
//
// Zwei bereits vorhandene Quellstatus-Modelle werden auf dasselbe
// fünfwertige `WorkspaceMetricStatus` abgebildet — beide Abbildungen sind
// reine, verlustfreie Übersetzungen, keine neue fachliche Bewertung:
// - `PeriodDataStatus` ("complete"/"partial"/"unavailable") — hat KEIN
//   "Nenner 0"-Konzept (reine Summen/Zählungen, niemals Divisionen), daher
//   nie "no-result-yet".
// - `CohortCostAvailability` (fünfwertig, bereits Nenner-Existenz UND
//   Coverage UND Maturity in genau dieser Präzedenz kombiniert, siehe
//   marketing-cohort-cost-metrics.ts) — bildet 1:1 auf die fünf
//   `WorkspaceMetricStatus`-Werte ab.

export type WorkspacePeriodKey = "yesterday" | "week-to-date" | "month-to-date";

export interface WorkspacePeriodBounds {
  from: string;
  through: string;
}

export type WorkspaceMetricStatus = "final" | "provisional" | "partial-data" | "unavailable" | "no-result-yet";

export interface WorkspaceCountMetric {
  status: WorkspaceMetricStatus;
  // Nur gesetzt, wenn status === "final" (identisch zu PeriodMetricValue.value).
  value?: number;
  observedValue: number;
  evidenceIds: string[];
}

export interface WorkspaceMoneyMetric {
  status: WorkspaceMetricStatus;
  amountMinor?: number;
  observedAmountMinor: number;
  currency: "EUR";
  evidenceIds: string[];
}

export interface WorkspaceCostMetric {
  status: WorkspaceMetricStatus;
  // Nur EINES von amountMinor/provisionalAmountMinor ist jemals gesetzt
  // (identisch zur zugrunde liegenden CohortCostMetric-Invariante).
  amountMinor?: number;
  provisionalAmountMinor?: number;
  currency: "EUR";
  numeratorAmountMinor?: number;
  denominatorCount: number;
  numeratorEvidenceIds: string[];
  denominatorEvidenceIds: string[];
  maturity?: CohortMaturityStatus;
}

function statusFromPeriodDataStatus(status: PeriodMetricValue["status"]): WorkspaceMetricStatus {
  if (status === "complete") return "final";
  if (status === "partial") return "partial-data";
  return "unavailable";
}

function statusFromCohortCostAvailability(availability: CohortCostMetric["availability"]): WorkspaceMetricStatus {
  switch (availability) {
    case "available":
      return "final";
    case "provisional":
      return "provisional";
    case "partial-data":
      return "partial-data";
    case "unavailable-data":
      return "unavailable";
    case "no-denominator-events":
      return "no-result-yet";
  }
}

function toWorkspaceCountMetric(source: PeriodMetricValue, evidenceIds: string[]): WorkspaceCountMetric {
  return {
    status: statusFromPeriodDataStatus(source.status),
    value: source.value,
    observedValue: source.observedValue,
    evidenceIds,
  };
}

function toWorkspaceMoneyMetric(source: PeriodMetricValue, evidenceIds: string[]): WorkspaceMoneyMetric {
  return {
    status: statusFromPeriodDataStatus(source.status),
    amountMinor: source.value,
    observedAmountMinor: source.observedValue,
    currency: "EUR",
    evidenceIds,
  };
}

function toWorkspaceCostMetric(source: CohortCostMetric): WorkspaceCostMetric {
  return {
    status: statusFromCohortCostAvailability(source.availability),
    amountMinor: source.amountMinor,
    provisionalAmountMinor: source.provisionalAmountMinor,
    currency: source.currency,
    numeratorAmountMinor: source.numeratorAmountMinor,
    denominatorCount: source.denominatorCount,
    numeratorEvidenceIds: source.numeratorEvidenceIds,
    denominatorEvidenceIds: source.denominatorEvidenceIds,
    maturity: source.maturity,
  };
}

// --- B4: Marketing Workspace ---------------------------------------------------

export interface MarketingWorkspaceActivity {
  // B8: dieselbe Zeitlogik wie Sales-Aktivitätskennzahlen — jede Zahl ist
  // nach ihrem EIGENEN Ereigniszeitstempel innerhalb der Periode gefiltert
  // (spendDate/generatedAt/ingestedAt), KEINE Kohortenmitgliedschaft.
  timeSemantics: "event-activity";
  metaSpend: WorkspaceMoneyMetric;
  metaLeadsGenerated: WorkspaceCountMetric;
  matchedMetaLeadsIngested: WorkspaceCountMetric;
  crmLeadsIngested: WorkspaceCountMetric;
}

export interface MarketingWorkspaceCohortCosts {
  // B8: die Kohortenmitgliedschaft dieser Kostenwerte richtet sich nach
  // `MetaLeadGenerated.generatedAt` — NICHT nach der Aktivitätsperiode
  // (`bounds`) selbst. Ein Kunde kann z. B. im August akquiriert worden
  // sein, aber zur Juni-Meta-Kohorte gehören (siehe B11 des Cohort-CAC-
  // Auftrags) — dieses Feld macht diese Zeitlogik für die UI explizit
  // sichtbar, damit "gestriger Spend" niemals fälschlich mit "gestern
  // akquirierten Kunden" gleichgesetzt wird.
  timeSemantics: "lead-generation-cohort";
  // = MarketingCohort.bounds — identisch zu `bounds` der übergeordneten
  // MarketingWorkspacePeriod für Yesterday/WTD/MTD (beide Generatoren
  // verwenden dieselben Kalenderhelfer), aber konzeptionell getrennt
  // benannt, weil diese Grenze die KOHORTENMITGLIEDSCHAFT markiert, nicht
  // die Aktivitätsperiode.
  cohortBounds: WorkspacePeriodBounds;
  // B8: Knowledge Cutoff explizit neben den Kostenwerten verfügbar.
  asOf: string;
  costPerMetaLead: WorkspaceCostMetric;
  costPerLeadWithFirstCallBooked: WorkspaceCostMetric;
  costPerLeadWithFirstCallHeld: WorkspaceCostMetric;
  costPerCustomerAcquired: WorkspaceCostMetric;
}

// B4: "Nicht aufnehmen, sofern nicht als sekundäre Diagnose ausdrücklich
// sinnvoll" — bleibt intern verfügbar, überlädt aber nicht die
// Hauptansicht (`cohortCosts` oben).
export interface MarketingWorkspaceCohortCostsDiagnostics {
  costPerCrmMatchedLead: WorkspaceCostMetric;
  costPerOpportunityWithStrategyCallBooked: WorkspaceCostMetric;
  costPerOpportunityWithStrategyCallHeld: WorkspaceCostMetric;
  costPerWonOpportunity: WorkspaceCostMetric;
  campaignCount: number;
}

export interface MarketingWorkspacePeriod {
  period: WorkspacePeriodKey;
  bounds: WorkspacePeriodBounds;
  activity: MarketingWorkspaceActivity;
  cohortCosts: MarketingWorkspaceCohortCosts;
  cohortCostsDiagnostics: MarketingWorkspaceCohortCostsDiagnostics;
  pendingMetaLeadsAtPeriodEnd: WorkspaceCountMetric;
}

export interface MarketingWorkspaceData {
  asOf: string;
  yesterday: MarketingWorkspacePeriod;
  weekToDate: MarketingWorkspacePeriod;
  monthToDate: MarketingWorkspacePeriod;
}

// --- B5: Sales Workspace ---------------------------------------------------

// B9: verbindliche semantische Keys, unverändert aus den zugrunde liegenden
// Domain-APIs übernommen — "customers" wird NIE für Won-Opportunities
// verwendet, "wonOpportunities" bleibt ein eigenes, separates Feld.
export interface SalesWorkspacePeriod {
  period: WorkspacePeriodKey;
  bounds: WorkspacePeriodBounds;
  firstCallsBooked: number;
  firstCallsHeld: number;
  strategyCallsBooked: number;
  strategyCallsHeld: number;
  // Neue Kunden dieser Periode (nach `CustomerAcquired.acquiredAt`) — NIEMALS
  // gleichzusetzen mit `wonOpportunities` (siehe B7 im vorherigen Auftrag:
  // 79 Won ≠ 58 Kunden, Repeat-Wins sind hier strukturell ausgeschlossen).
  customersAcquired: number;
  // Diagnosezahl: ALLE gewonnenen Opportunities dieser Periode (Acquisition
  // + Repeat Business), nach `closedAt`.
  wonOpportunities: number;
  evidence: {
    firstCallsBookedAppointmentIds: string[];
    firstCallsHeldAppointmentIds: string[];
    strategyCallsBookedAppointmentIds: string[];
    strategyCallsHeldAppointmentIds: string[];
    customerAcquiredEventIds: string[];
    customerAcquiredAccountIds: string[];
    acquiringOpportunityIds: string[];
    wonOpportunityIds: string[];
  };
  // B8: `customersAcquired` folgt einer ANDEREN Zeitlogik als die übrigen
  // Felder dieses flachen Objekts — explizit je Feld ausgewiesen, damit die
  // UI niemals annimmt, alle sechs Zahlen seien nach demselben Prinzip
  // gezählt.
  timeSemantics: {
    firstCallsBooked: "event-activity";
    firstCallsHeld: "event-activity";
    strategyCallsBooked: "event-activity";
    strategyCallsHeld: "event-activity";
    wonOpportunities: "event-activity";
    customersAcquired: "customer-acquisition-activity";
  };
}

export interface SalesWorkspaceData {
  asOf: string;
  yesterday: SalesWorkspacePeriod;
  weekToDate: SalesWorkspacePeriod;
  monthToDate: SalesWorkspacePeriod;
}

export interface AreaWorkspaceData {
  asOf: string;
  marketing: MarketingWorkspaceData;
  sales: SalesWorkspaceData;
}

export interface AreaWorkspaceDataSource {
  metaAdSpendRecords: readonly MetaAdSpendRecord[];
  metaLeadGeneratedEvents: readonly MetaLeadGenerated[];
  marketingCrmLeadIngestedEvents: readonly MarketingCrmLeadIngested[];
  marketingLeadIdentityMatchedEvents: readonly MarketingLeadIdentityMatched[];
  marketingSourceCoverage: readonly MarketingSourceCoverage[];
  salesAppointments: readonly SalesAppointment[];
  salesAppointmentBookedEvents: readonly SalesAppointmentBooked[];
  salesAppointmentHeldEvents: readonly SalesAppointmentHeld[];
  opportunities: readonly Opportunity[];
}

function buildMarketingWorkspacePeriod(period: WorkspacePeriodKey, asOf: string, activity: MarketingPeriodMetrics, cohort: MarketingCohort): MarketingWorkspacePeriod {
  return {
    period,
    bounds: activity.activity.bounds,
    activity: {
      timeSemantics: "event-activity",
      metaSpend: toWorkspaceMoneyMetric(activity.activity.metaSpendAmountMinor, activity.activity.evidence.metaSpendRecordIds),
      metaLeadsGenerated: toWorkspaceCountMetric(activity.activity.metaLeadsGenerated, activity.activity.evidence.metaLeadGeneratedEventIds),
      matchedMetaLeadsIngested: toWorkspaceCountMetric(activity.activity.matchedMetaLeadsIngested, activity.activity.evidence.matchedMetaLeadIngestedEventIds),
      crmLeadsIngested: toWorkspaceCountMetric(activity.activity.crmLeadsIngested, activity.activity.evidence.crmLeadIngestedEventIds),
    },
    cohortCosts: {
      timeSemantics: "lead-generation-cohort",
      cohortBounds: cohort.bounds,
      asOf,
      costPerMetaLead: toWorkspaceCostMetric(cohort.costPerMetaLead),
      costPerLeadWithFirstCallBooked: toWorkspaceCostMetric(cohort.costPerLeadWithFirstCallBooked),
      costPerLeadWithFirstCallHeld: toWorkspaceCostMetric(cohort.costPerLeadWithFirstCallHeld),
      costPerCustomerAcquired: toWorkspaceCostMetric(cohort.costPerCustomerAcquired),
    },
    cohortCostsDiagnostics: {
      costPerCrmMatchedLead: toWorkspaceCostMetric(cohort.costPerCrmMatchedLead),
      costPerOpportunityWithStrategyCallBooked: toWorkspaceCostMetric(cohort.costPerOpportunityWithStrategyCallBooked),
      costPerOpportunityWithStrategyCallHeld: toWorkspaceCostMetric(cohort.costPerOpportunityWithStrategyCallHeld),
      costPerWonOpportunity: toWorkspaceCostMetric(cohort.costPerWonOpportunity),
      campaignCount: cohort.campaigns.length,
    },
    pendingMetaLeadsAtPeriodEnd: toWorkspaceCountMetric(activity.pendingMetaLeadsAtPeriodEnd, activity.pendingMetaLeadGeneratedEventIds),
  };
}

function buildSalesWorkspacePeriod(period: WorkspacePeriodKey, sales: SalesPeriodMetrics, customer: CustomerAcquisitionPeriodMetric): SalesWorkspacePeriod {
  return {
    period,
    bounds: sales.bounds,
    firstCallsBooked: sales.firstCallsBooked,
    firstCallsHeld: sales.firstCallsHeld,
    strategyCallsBooked: sales.strategyCallsBooked,
    strategyCallsHeld: sales.strategyCallsHeld,
    customersAcquired: customer.customersAcquired,
    wonOpportunities: sales.wonOpportunities,
    evidence: {
      firstCallsBookedAppointmentIds: sales.firstCallsBookedAppointmentIds,
      firstCallsHeldAppointmentIds: sales.firstCallsHeldAppointmentIds,
      strategyCallsBookedAppointmentIds: sales.strategyCallsBookedAppointmentIds,
      strategyCallsHeldAppointmentIds: sales.strategyCallsHeldAppointmentIds,
      customerAcquiredEventIds: customer.customerAcquiredEventIds,
      customerAcquiredAccountIds: customer.accountIds,
      acquiringOpportunityIds: customer.acquiringOpportunityIds,
      wonOpportunityIds: sales.wonOpportunityIds,
    },
    timeSemantics: {
      firstCallsBooked: "event-activity",
      firstCallsHeld: "event-activity",
      strategyCallsBooked: "event-activity",
      strategyCallsHeld: "event-activity",
      wonOpportunities: "event-activity",
      customersAcquired: "customer-acquisition-activity",
    },
  };
}

// B2/B3: einzige Orchestrierungsstelle — ruft jede der vier kanonischen
// Domain-Funktionen genau einmal auf und projiziert ausschließlich deren
// bereits vorhandene Felder.
export function generateAreaWorkspaceData(params: { world: AreaWorkspaceDataSource; asOf: string }): AreaWorkspaceData {
  const { world, asOf } = params;

  const marketingPeriod = generateMarketingPeriodMetrics(
    asOf,
    world.metaAdSpendRecords,
    world.metaLeadGeneratedEvents,
    world.marketingCrmLeadIngestedEvents,
    world.marketingLeadIdentityMatchedEvents,
    world.marketingSourceCoverage,
  );
  const marketingCohort = generateMarketingCohortCostMetrics({
    asOf,
    metaAdSpendRecords: world.metaAdSpendRecords,
    metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
    marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
    marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
    salesAppointments: world.salesAppointments,
    opportunities: world.opportunities,
    marketingSourceCoverage: world.marketingSourceCoverage,
  });
  const salesPeriod = generateSalesPeriodMetrics(asOf, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);
  const customerPeriod = generateCustomerAcquisitionPeriodMetrics(world.opportunities, asOf);

  return {
    asOf,
    marketing: {
      asOf,
      yesterday: buildMarketingWorkspacePeriod("yesterday", asOf, marketingPeriod.yesterday, marketingCohort.yesterday),
      weekToDate: buildMarketingWorkspacePeriod("week-to-date", asOf, marketingPeriod.weekToDate, marketingCohort.weekToDate),
      monthToDate: buildMarketingWorkspacePeriod("month-to-date", asOf, marketingPeriod.monthToDate, marketingCohort.monthToDate),
    },
    sales: {
      asOf,
      yesterday: buildSalesWorkspacePeriod("yesterday", salesPeriod.yesterday, customerPeriod.yesterday),
      weekToDate: buildSalesWorkspacePeriod("week-to-date", salesPeriod.weekToDate, customerPeriod.weekToDate),
      monthToDate: buildSalesWorkspacePeriod("month-to-date", salesPeriod.monthToDate, customerPeriod.monthToDate),
    },
  };
}

// --- Public Consumer Contract: schmaler externer Einstiegspunkt --------------
//
// Additive Erweiterung (Auftrag "Workspace Contract Checkpoint + Erste
// sichtbare Marketing/Sales-Unternehmeransicht", Phase I) — exakt derselbe
// World-Resolution-Pfad wie der bereits bestehende externe Einstiegspunkt
// `generateFullCompanyContext` (company/full-company-context.ts):
// World-Seed/Scenario-Profile/asOf → `generateScenarioWorld` → unverändertes
// Durchreichen an `generateAreaWorkspaceData`. Reiner Verkabelungs-Wrapper,
// keine eigene Berechnung, keine neue Fachlogik — ein externer Consumer
// (sales-platform) muss dadurch weder den internen ScenarioWorldTruth-Aufbau
// noch die neun Einzelfelder von `AreaWorkspaceDataSource` selbst kennen.
export function generateReferenceAreaWorkspaceData(
  worldSeed: number = WORLD_SEED,
  profile: ScenarioProfile = BASELINE_PROFILE,
  asOf: string = WORLD_NOW,
): AreaWorkspaceData {
  const scenarioWorld = generateScenarioWorld(worldSeed, profile);
  const source: AreaWorkspaceDataSource = {
    metaAdSpendRecords: scenarioWorld.metaAdSpendRecords,
    metaLeadGeneratedEvents: scenarioWorld.metaLeadGeneratedEvents,
    marketingCrmLeadIngestedEvents: scenarioWorld.marketingCrmLeadIngestedEvents,
    marketingLeadIdentityMatchedEvents: scenarioWorld.marketingLeadIdentityMatchedEvents,
    marketingSourceCoverage: scenarioWorld.marketingSourceCoverage,
    salesAppointments: scenarioWorld.salesAppointments,
    salesAppointmentBookedEvents: scenarioWorld.salesAppointmentBookedEvents,
    salesAppointmentHeldEvents: scenarioWorld.salesAppointmentHeldEvents,
    opportunities: scenarioWorld.opportunities,
  };
  return generateAreaWorkspaceData({ world: source, asOf });
}
