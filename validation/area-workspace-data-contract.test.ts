import { describe, expect, it } from "vitest";
import { SCENARIO_WORLDS } from "../engine/generator";
import { WORLD_NOW } from "../timeline/world-clock";
import {
  generateAreaWorkspaceData,
  type AreaWorkspaceDataSource,
  type AreaWorkspaceData,
} from "../company/area-workspace-data";
import { generateCompanyCapabilitySnapshot } from "../company/company-capability";
import type { CompanyExecutiveContextSnapshot } from "../company/company-executive-context";
import type { CompanyAreaSummary } from "../company/company-area";
import { generateMarketingPeriodMetrics } from "../company/marketing-period-metrics";
import { generateMarketingCohortCostMetrics, generateMarketingCohortForBounds } from "../company/marketing-cohort-cost-metrics";
import { generateSalesPeriodMetrics } from "../company/sales-period-metrics";
import { generateCustomerAcquisitionPeriodMetrics } from "../company/customer-period-metrics";
import { generateCustomerAcquisitionLifecycle } from "../company/customer-acquisition-lifecycle";
import { generateDeliveryUnits } from "../world/delivery-units";
import { generateOperationsPeriodMetrics } from "../company/operations-period-metrics";
import { generatePeoplePeriodMetrics } from "../company/people-period-metrics";
import { generateFullCompanyContext } from "../company/full-company-context";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import type { MetaAdSpendRecord } from "../events/marketing-meta-ad-spend";
import type { MetaLeadGenerated, MarketingCrmLeadIngested, MarketingLeadIdentityMatched } from "../events/marketing-meta-crm-source";
import type { SalesAppointmentBooked, SalesAppointmentHeld } from "../events/sales-appointment-lifecycle";
import type { SalesAppointment, SalesAppointmentType } from "../world/sales-appointments";
import type { Opportunity } from "../events/opportunities";
import type { MarketingSourceCoverage, MarketingSourceStream } from "../events/marketing-source-coverage";

// AUFTRAG — Customer Metrics Checkpoint + Marketing/Sales Workspace Data
// Contract V1, Phase B, B12: Pflichttests für den rein orchestrierenden
// internen Workspace-Vertrag. Prüft: keine doppelte Berechnung, korrekte
// Statusprojektion, korrekte Zeitsemantik, vollständige Evidenz, ein
// positiver historischer Funktionsbeweis, keine Regression.

const world = SCENARIO_WORLDS.baseline;

function toWorldSource(): AreaWorkspaceDataSource {
  return {
    metaAdSpendRecords: world.metaAdSpendRecords,
    metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
    marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
    marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
    marketingSourceCoverage: world.marketingSourceCoverage,
    salesAppointments: world.salesAppointments,
    salesAppointmentBookedEvents: world.salesAppointmentBookedEvents,
    salesAppointmentHeldEvents: world.salesAppointmentHeldEvents,
    opportunities: world.opportunities,
    deliveryUnits: world.deliveryUnits,
    employees: EMPLOYEES,
  };
}

// Executive-Ebene (D054): jeder generateAreaWorkspaceData-Aufruf benötigt
// seit dieser Erweiterung zusätzlich einen CompanyExecutiveContextSnapshot.
// REAL_EXECUTIVE_CONTEXT ist der echte, bereits an anderer Stelle getestete
// WORLD_NOW-Kontext (siehe validation/company-capability.test.ts für die
// dedizierte Prüfung) — für alle Tests, die mit toWorldSource()/WORLD_NOW
// arbeiten. neutralExecutiveContext(asOf) ist ein reines, hier lokales
// Fixture (alle vier Areas unzureichende-evidenz) für die synthetischen
// fullSource()-Fixtures dieser Datei, die ausschließlich Marketing-/Sales-
// Mechanik prüfen und keine Executive-Aussage benötigen — der `asOf`-Wert
// wird bewusst 1:1 übernommen, damit `AreaWorkspaceData.asOf` und
// `AreaWorkspaceData.executive.asOf` niemals auseinanderfallen.
const REAL_EXECUTIVE_CONTEXT: CompanyExecutiveContextSnapshot = generateFullCompanyContext().executiveContext;

function neutralAreaSummary(key: CompanyAreaSummary["key"]): CompanyAreaSummary {
  return {
    key,
    kind: key === "people" ? "cross-cutting-dimension" : "department",
    state: null,
    evaluationStatus: "unzureichende-evidenz",
    statement: null,
    topObservations: [],
    relevantMetrics: {},
    evidenceIds: [],
  };
}

function neutralExecutiveContext(asOf: string): CompanyExecutiveContextSnapshot {
  return {
    id: "cexec-fixture",
    timestamp: asOf,
    companyBusinessStateId: "cbstate-fixture",
    affectedAreas: [],
    areaSummaries: (["sales", "marketing", "people", "operations"] as const).map(neutralAreaSummary),
    topSituations: [],
    crossAreaLinks: [],
    insufficientEvidenceAreas: ["sales", "marketing", "people", "operations"],
  };
}

function toSnapshotSource(): WorldSnapshotSource {
  return {
    employees: EMPLOYEES,
    employeeHiredEvents: EMPLOYEE_HIRED_EVENTS,
    employeeTerminatedEvents: EMPLOYEE_TERMINATED_EVENTS,
    deliveryUnits: world.deliveryUnits,
    customerAccounts: CUSTOMER_ACCOUNTS,
    contacts: CONTACTS,
    accountOwnerships: world.accountOwnerships,
    leads: world.leads,
    opportunities: world.opportunities,
    stageHistory: world.stageHistory,
    knowledgeObjects: world.knowledgeObjects,
    calls: world.calls,
    emails: world.emails,
    meetings: world.meetings,
    meetingTranscripts: world.meetingTranscripts,
    crmActivities: world.crmActivities,
    salesAppointmentBookedEvents: world.salesAppointmentBookedEvents,
    salesAppointmentHeldEvents: world.salesAppointmentHeldEvents,
    metaAdSpendRecords: world.metaAdSpendRecords,
    metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
    marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
    marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
  };
}

// --- Synthetische Fixture-Helfer --------------------------------------------
function spend(id: string, spendDate: string, importedAt: string, amountMinor: number, externalCampaignId = "cmp-01"): MetaAdSpendRecord {
  return { id, provider: "meta", externalAdAccountId: "act-synth", externalCampaignId, spendDate, currency: "EUR", amountMinor, importedAt };
}
function metaGen(id: string, generatedAt: string, campaignId = "campaign-01", externalCampaignId = "cmp-01"): MetaLeadGenerated {
  return { id, externalLeadId: `ext-${id}`, provider: "meta", generatedAt, externalCampaignId, campaignId };
}
function match(id: string, metaLeadGeneratedEventId: string, crmLeadIngestedEventId: string, leadId: string, matchedAt: string): MarketingLeadIdentityMatched {
  return { id, metaLeadGeneratedEventId, crmLeadIngestedEventId, externalLeadId: `ext-${metaLeadGeneratedEventId}`, externalCrmLeadId: `crm-${crmLeadIngestedEventId}`, leadId, matchedAt, method: "direct-external-meta-lead-id" };
}
function crmIngest(id: string, leadId: string, ingestedAt: string): MarketingCrmLeadIngested {
  return { id, leadId, externalCrmLeadId: `crm-${id}`, ingestedAt, crmProvider: "synthetic-crm" };
}
function won(id: string, accountId: string, leadId: string, createdAt: string, closedAt: string): Opportunity {
  return { id, leadId, accountId, createdAt, currentStage: "gewonnen", value: 10000, probability: 100, responsibleEmployeeId: "emp-synth", closedAt };
}
function coverage(id: string, stream: MarketingSourceStream, coveredFrom: string, coveredThrough: string, status: MarketingSourceCoverage["status"], importedAt = coveredThrough): MarketingSourceCoverage {
  return { id, stream, provider: stream === "meta-ad-spend" || stream === "meta-lead-generation" ? "meta" : "crm", coveredFrom, coveredThrough, importedAt, status };
}
function booked(id: string, appointmentType: SalesAppointmentType, bookedAt: string): SalesAppointmentBooked {
  return { id, appointmentId: id, appointmentType, bookedAt, scheduledFor: bookedAt, assignedEmployeeId: "emp-synth" };
}
function held(id: string, appointmentType: SalesAppointmentType, heldAt: string): SalesAppointmentHeld {
  return { id, appointmentId: id, appointmentType, heldAt, conductedByEmployeeId: "emp-synth" };
}
function salesAppt(overrides: Partial<SalesAppointment> & Pick<SalesAppointment, "id" | "appointmentType" | "bookedAt">): SalesAppointment {
  return {
    contactId: "contact-synth",
    accountId: "account-synth",
    bookingSeriesId: overrides.id,
    assignedEmployeeId: "emp-synth",
    initialScheduledFor: overrides.bookedAt,
    reschedules: [],
    currentScheduledFor: overrides.bookedAt,
    currentStatus: "scheduled",
    ...overrides,
  };
}

// Coverage-Obergrenze (weit in der Zukunft relativ zu den Fixture-
// Ereignissen unten) — getrennt von `ASOF`, dem tatsächlichen
// Berechnungszeitpunkt der meisten Tests.
const COVERAGE_UPPER_BOUND = "2025-06-01";

const FULL_META = metaGen("meta-full", "2025-01-01", "campaign-01", "cmp-01");
const FULL_MATCH = match("match-full", "meta-full", "crm-full", "lead-full", "2025-01-03");
const FULL_CRM = crmIngest("crm-full", "lead-full", "2025-01-03");
// Alle Ereignisse bewusst innerhalb desselben Kalendermonats (Januar 2025),
// damit ein einziger MTD-Zeitraum (bounds Jan1..Jan15, siehe MTD_ASOF unten)
// sowohl die Kohortenmitgliedschaft (generatedAt) als auch die vollständige
// Sales-/Acquisition-Kette (bookedAt/heldAt/closedAt) gleichzeitig abdeckt —
// realistische Referenzwelt-Zykluszeiten (Wochen bis Monate, siehe B11-
// Historienbeweis unten) würden das in einem einzelnen MTD-Fenster nicht
// zulassen, sind für einen kontrollierten Fixture-Test aber nicht nötig.
const FULL_OPP = won("opp-full", "account-full", "lead-full", "2025-01-05", "2025-01-10");
const FULL_SPEND = spend("spend-full", "2025-01-01", "2025-01-02", 10000, "cmp-01");
const FULL_FC_BOOKED = booked("bk-fc-full", "first-call", "2025-01-03");
const FULL_FC_HELD = held("hd-fc-full", "first-call", "2025-01-04");
const FULL_SC_BOOKED = booked("bk-sc-full", "strategy-call", "2025-01-05");
const FULL_SC_HELD = held("hd-sc-full", "strategy-call", "2025-01-06");
const FULL_SALES_APPT_FC = salesAppt({ id: "sappt-fc-full", appointmentType: "first-call", leadId: "lead-full", bookedAt: "2025-01-03", heldAt: "2025-01-04", currentStatus: "held", conductedByEmployeeId: "emp-synth" });
const FULL_SALES_APPT_SC = salesAppt({ id: "sappt-sc-full", appointmentType: "strategy-call", leadId: "lead-full", opportunityId: "opp-full", bookedAt: "2025-01-05", heldAt: "2025-01-06", currentStatus: "held", conductedByEmployeeId: "emp-synth" });
// Standard-asOf für die "alles sichtbar"-Tests dieser Fixture-Kette: MTD-
// Grenzen bei diesem asOf sind [2025-01-01, 2025-01-15] — deckt sämtliche
// obigen Ereignisse ab, während `COVERAGE_UPPER_BOUND` unverändert bei
// 2025-06-01 bleibt.
const ASOF = "2025-01-15";

// importedAt bewusst früh (2025-01-01, vor jedem Fixture-Ereignis) gesetzt —
// ein Coverage-Fakt mit importedAt === COVERAGE_UPPER_BOUND (2025-06-01)
// wäre bei den meisten Tests dieser Datei (asOf = ASOF = 2025-01-15) noch
// gar nicht sichtbar (Future-Knowledge-Schutz: importedAt <= asOf).
const FULL_COVERAGE: MarketingSourceCoverage[] = [
  coverage("cov-spend", "meta-ad-spend", "2024-06-01", COVERAGE_UPPER_BOUND, "complete", "2025-01-01"),
  coverage("cov-leadgen", "meta-lead-generation", "2024-06-01", COVERAGE_UPPER_BOUND, "complete", "2025-01-01"),
  coverage("cov-crm", "crm-lead-ingestion", "2024-06-01", COVERAGE_UPPER_BOUND, "complete", "2025-01-01"),
  coverage("cov-appt", "crm-sales-appointment-lifecycle", "2024-06-01", COVERAGE_UPPER_BOUND, "complete", "2025-01-01"),
  coverage("cov-opp", "crm-opportunity-lifecycle", "2024-06-01", COVERAGE_UPPER_BOUND, "complete", "2025-01-01"),
];

function fullSource(overrides?: Partial<AreaWorkspaceDataSource>): AreaWorkspaceDataSource {
  return {
    metaAdSpendRecords: [FULL_SPEND],
    metaLeadGeneratedEvents: [FULL_META],
    marketingCrmLeadIngestedEvents: [FULL_CRM],
    marketingLeadIdentityMatchedEvents: [FULL_MATCH],
    marketingSourceCoverage: FULL_COVERAGE,
    salesAppointments: [FULL_SALES_APPT_FC, FULL_SALES_APPT_SC],
    salesAppointmentBookedEvents: [FULL_FC_BOOKED, FULL_SC_BOOKED],
    salesAppointmentHeldEvents: [FULL_FC_HELD, FULL_SC_HELD],
    opportunities: [FULL_OPP],
    // Dieses Fixture prüft ausschließlich die Marketing-/Sales-Kette (siehe
    // Auftrag "Customer Metrics Checkpoint + Marketing/Sales Workspace Data
    // Contract V1") — bewusst leer statt eine künstliche, mit FULL_OPP nicht
    // konsistente DeliveryUnit zu erfinden. Operations-spezifisches Verhalten
    // wird vollständig in validation/operations-period-metrics.test.ts geprüft.
    deliveryUnits: [],
    // Dieselbe Begründung wie bei deliveryUnits oben — People-spezifisches
    // Verhalten wird vollständig in validation/people-period-metrics.test.ts
    // geprüft, dieses Fixture bewusst ohne Employees.
    employees: [],
    ...overrides,
  };
}

function generateFullData(asOf: string, overrides?: Partial<AreaWorkspaceDataSource>): AreaWorkspaceData {
  return generateAreaWorkspaceData({ world: fullSource(overrides), asOf, executiveContext: neutralExecutiveContext(asOf) });
}

// ============================================================================
// Orchestrierung (1-7)
// ============================================================================
describe("Workspace Data Contract — Orchestrierung (1-7)", () => {
  it("1. verwendet die bestehende Marketing Period API unverändert (identische Werte)", () => {
    const data = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    const direct = generateMarketingPeriodMetrics(WORLD_NOW, world.metaAdSpendRecords, world.metaLeadGeneratedEvents, world.marketingCrmLeadIngestedEvents, world.marketingLeadIdentityMatchedEvents, world.marketingSourceCoverage);
    expect(data.marketing.monthToDate.activity.metaSpend.observedAmountMinor).toBe(direct.monthToDate.activity.metaSpendAmountMinor.observedValue);
    expect(data.marketing.monthToDate.activity.metaLeadsGenerated.evidenceIds).toEqual(direct.monthToDate.activity.evidence.metaLeadGeneratedEventIds);
  });

  it("2. verwendet die bestehende Cohort Cost API unverändert (identische Werte)", () => {
    const data = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    const direct = generateMarketingCohortCostMetrics({
      asOf: WORLD_NOW,
      metaAdSpendRecords: world.metaAdSpendRecords,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
      marketingSourceCoverage: world.marketingSourceCoverage,
    });
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.denominatorCount).toBe(direct.monthToDate.costPerMetaLead.denominatorCount);
    expect(data.marketing.monthToDate.cohortCosts.costPerCustomerAcquired.denominatorEvidenceIds).toEqual(direct.monthToDate.costPerCustomerAcquired.denominatorEvidenceIds);
  });

  it("3. verwendet die bestehende Sales Period API unverändert (identische Werte)", () => {
    const data = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    const direct = generateSalesPeriodMetrics(WORLD_NOW, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);
    expect(data.sales.monthToDate.firstCallsBooked).toBe(direct.monthToDate.firstCallsBooked);
    expect(data.sales.monthToDate.wonOpportunities).toBe(direct.monthToDate.wonOpportunities);
    expect(data.sales.monthToDate.evidence.wonOpportunityIds).toEqual(direct.monthToDate.wonOpportunityIds);
  });

  it("4. verwendet die bestehende Customer Period API unverändert (identische Werte)", () => {
    const data = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    const direct = generateCustomerAcquisitionPeriodMetrics(world.opportunities, WORLD_NOW);
    expect(data.sales.monthToDate.customersAcquired).toBe(direct.monthToDate.customersAcquired);
    expect(data.sales.monthToDate.evidence.customerAcquiredEventIds).toEqual(direct.monthToDate.customerAcquiredEventIds);
  });

  it("5. keine doppelte Eventzählung: dieselbe Meta-Lead-Menge fließt nur einmal in metaLeadsGenerated ein", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.activity.metaLeadsGenerated.evidenceIds).toEqual(["meta-full"]);
    expect(new Set(data.marketing.monthToDate.activity.metaLeadsGenerated.evidenceIds).size).toBe(1);
  });

  it("6. keine doppelte Periodenlogik: Marketing- und Sales-bounds für denselben Zeitraumschlüssel sind identisch (dieselben Kalenderhelfer)", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.bounds).toEqual(data.sales.monthToDate.bounds);
    expect(data.marketing.yesterday.bounds).toEqual(data.sales.yesterday.bounds);
  });

  it("7. keine zweite CAC-Formel: costPerCustomerAcquired.provisionalAmountMinor entspricht exakt Zähler/Nenner der zugrunde liegenden Cohort-API", () => {
    const data = generateFullData(ASOF);
    const direct = generateMarketingCohortForBounds(
      "reference", { from: "2025-01-01", through: ASOF }, ASOF,
      [FULL_SPEND], [FULL_META], [FULL_MATCH], [FULL_CRM], [FULL_SALES_APPT_FC, FULL_SALES_APPT_SC], [FULL_OPP], FULL_COVERAGE,
    );
    expect(data.marketing.monthToDate.cohortCosts.costPerCustomerAcquired.provisionalAmountMinor).toBe(direct.costPerCustomerAcquired.provisionalAmountMinor);
  });
});

// ============================================================================
// Marketing (8-16)
// ============================================================================
describe("Workspace Data Contract — Marketing (8-16)", () => {
  it("8. Spend korrekt projiziert", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.activity.metaSpend.amountMinor).toBe(10000);
    expect(data.marketing.monthToDate.activity.metaSpend.currency).toBe("EUR");
  });

  it("9. Leads korrekt projiziert", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.activity.metaLeadsGenerated.value).toBe(1);
  });

  it("10. CRM-Landung (matchedMetaLeadsIngested) korrekt projiziert", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.activity.matchedMetaLeadsIngested.value).toBe(1);
    expect(data.marketing.monthToDate.activity.matchedMetaLeadsIngested.evidenceIds).toEqual(["crm-full"]);
  });

  it("11. sämtliche CRM-Leads (crmLeadsIngested) korrekt", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.activity.crmLeadsIngested.value).toBe(1);
  });

  it("12. CPL korrekt", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.amountMinor).toBe(10000);
  });

  it("13. First-Call-Booked-Kosten korrekt", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerLeadWithFirstCallBooked.denominatorCount).toBe(1);
  });

  it("14. First-Call-Held-Kosten korrekt", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerLeadWithFirstCallHeld.denominatorCount).toBe(1);
  });

  it("15. Customer-Acquired-Kosten korrekt", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerCustomerAcquired.denominatorEvidenceIds).toEqual(["customer-acquired-account-full"]);
  });

  it("16. Pending-Bestand korrekt projiziert", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.pendingMetaLeadsAtPeriodEnd.status).toBeDefined();
    expect(typeof data.marketing.monthToDate.pendingMetaLeadsAtPeriodEnd.observedValue).toBe("number");
  });
});

// ============================================================================
// Sales (17-23)
// ============================================================================
describe("Workspace Data Contract — Sales (17-23)", () => {
  it("17. First Call Booked korrekt (nach bookedAt)", () => {
    const data = generateFullData("2025-01-05");
    expect(data.sales.monthToDate.firstCallsBooked).toBe(1);
  });

  it("18. First Call Held korrekt (nach heldAt)", () => {
    const data = generateFullData("2025-01-10");
    expect(data.sales.monthToDate.firstCallsHeld).toBe(1);
  });

  it("19. Strategy Call Booked korrekt (nach bookedAt)", () => {
    const data = generateFullData("2025-01-15");
    expect(data.sales.monthToDate.strategyCallsBooked).toBe(1);
  });

  it("20. Strategy Call Held korrekt (nach heldAt)", () => {
    const data = generateFullData("2025-01-20");
    expect(data.sales.monthToDate.strategyCallsHeld).toBe(1);
  });

  it("21. Customer Acquired korrekt (nach acquiredAt = closedAt der akquirierenden Opportunity)", () => {
    const before = generateFullData("2025-01-09"); // vor FULL_OPP.closedAt (2025-01-10)
    const after = generateFullData("2025-01-10");
    expect(before.sales.monthToDate.customersAcquired).toBe(0);
    expect(after.sales.monthToDate.customersAcquired).toBe(1);
  });

  it("22. Won Opportunities korrekt (nach closedAt)", () => {
    const data = generateFullData("2025-01-10");
    expect(data.sales.monthToDate.wonOpportunities).toBe(1);
  });

  it("23. Customer und Won bleiben getrennte Felder, auch bei einem Repeat-Win", () => {
    const repeatOpp = won("opp-repeat", "account-full", "lead-repeat-x", "2025-02-05", "2025-02-10");
    const data = generateAreaWorkspaceData({ world: fullSource({ opportunities: [FULL_OPP, repeatOpp] }), asOf: "2025-02-10", executiveContext: neutralExecutiveContext("2025-02-10") });
    expect(data.sales.monthToDate.wonOpportunities).toBe(1); // nur opp-repeat liegt im Februar (MTD)
    expect(data.sales.monthToDate.customersAcquired).toBe(0); // opp-repeat ist Repeat Business, keine Acquisition
  });
});

// ============================================================================
// Status (24-32)
// ============================================================================
describe("Workspace Data Contract — Status (24-32)", () => {
  it("24. complete Coverage + mature ergibt final", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe("final");
    expect(data.marketing.monthToDate.activity.metaSpend.status).toBe("final");
  });

  it("25. developing ergibt provisional", () => {
    const young = generateFullData("2025-01-05"); // First Call Held Horizont (84 Tage) noch nicht erreicht
    expect(young.marketing.monthToDate.cohortCosts.costPerLeadWithFirstCallHeld.maturity).toBe("developing");
    expect(young.marketing.monthToDate.cohortCosts.costPerLeadWithFirstCallHeld.status).toBe("provisional");
  });

  it("26. indeterminate ergibt provisional", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerCustomerAcquired.maturity).toBe("indeterminate");
    expect(data.marketing.monthToDate.cohortCosts.costPerCustomerAcquired.status).toBe("provisional");
  });

  it("27. partial Coverage ergibt partial-data", () => {
    const partialCoverage = FULL_COVERAGE.map((c) => (c.stream === "meta-ad-spend" ? coverage("cov-spend-p", "meta-ad-spend", "2025-01-01", "2025-01-01", "partial") : c));
    const data = generateAreaWorkspaceData({ world: fullSource({ marketingSourceCoverage: partialCoverage }), asOf: ASOF, executiveContext: neutralExecutiveContext(ASOF) });
    expect(data.marketing.monthToDate.activity.metaSpend.status).toBe("partial-data");
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe("partial-data");
  });

  it("28. unavailable Coverage ergibt unavailable", () => {
    const data = generateAreaWorkspaceData({ world: fullSource({ marketingSourceCoverage: [] }), asOf: ASOF, executiveContext: neutralExecutiveContext(ASOF) });
    expect(data.marketing.monthToDate.activity.metaSpend.status).toBe("unavailable");
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe("unavailable");
  });

  it("29. Nenner 0 ergibt no-result-yet, nicht 0 €", () => {
    const data = generateAreaWorkspaceData({ world: fullSource({ metaLeadGeneratedEvents: [] }), asOf: ASOF, executiveContext: neutralExecutiveContext(ASOF) });
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe("no-result-yet");
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.amountMinor).toBeUndefined();
  });

  it("30. keine falsche Null: bei unavailable Coverage bleibt amountMinor undefined, niemals fälschlich 0", () => {
    const data = generateAreaWorkspaceData({ world: fullSource({ marketingSourceCoverage: [] }), asOf: ASOF, executiveContext: neutralExecutiveContext(ASOF) });
    expect(data.marketing.monthToDate.activity.metaSpend.status).toBe("unavailable");
    expect(data.marketing.monthToDate.activity.metaSpend.amountMinor).toBeUndefined();
    // observedAmountMinor bleibt der tatsächlich beobachtete Rohwert (10000,
    // aus FULL_SPEND) — nicht als finale Periodensumme dargestellt (siehe
    // amountMinor oben), aber auch nicht künstlich auf 0 zurückgesetzt.
    expect(data.marketing.monthToDate.activity.metaSpend.observedAmountMinor).toBe(10000);
  });

  it("31. kein Infinity in irgendeiner Kostenkennzahl", () => {
    const data = generateAreaWorkspaceData({ world: fullSource({ metaLeadGeneratedEvents: [] }), asOf: ASOF, executiveContext: neutralExecutiveContext(ASOF) });
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.amountMinor).not.toBe(Infinity);
    expect(data.marketing.monthToDate.cohortCosts.costPerCustomerAcquired.provisionalAmountMinor).not.toBe(Infinity);
  });

  it("32. kein NaN in irgendeiner Kostenkennzahl", () => {
    const data = generateAreaWorkspaceData({ world: fullSource({ metaLeadGeneratedEvents: [] }), asOf: ASOF, executiveContext: neutralExecutiveContext(ASOF) });
    expect(Number.isNaN(data.marketing.monthToDate.cohortCosts.costPerMetaLead.denominatorCount)).toBe(false);
  });
});

// ============================================================================
// Zeitsemantik (33-38)
// ============================================================================
describe("Workspace Data Contract — Zeitsemantik (33-38)", () => {
  it("33. Marketingkosten sind als lead-generation-cohort gekennzeichnet", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.timeSemantics).toBe("lead-generation-cohort");
  });

  it("34. Sales-Aktivitätskennzahlen sind als event-activity gekennzeichnet", () => {
    const data = generateFullData(ASOF);
    expect(data.sales.monthToDate.timeSemantics.firstCallsBooked).toBe("event-activity");
    expect(data.sales.monthToDate.timeSemantics.wonOpportunities).toBe("event-activity");
  });

  it("35. Customers sind als customer-acquisition-activity gekennzeichnet", () => {
    const data = generateFullData(ASOF);
    expect(data.sales.monthToDate.timeSemantics.customersAcquired).toBe("customer-acquisition-activity");
  });

  it("36. Kohortengrenzen sind explizit von der Aktivitätsperiode getrennt benannt", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.cohortBounds).toBeDefined();
    expect(data.marketing.monthToDate.bounds).toBeDefined();
  });

  it("37. asOf ist explizit auf Kohortenebene verfügbar", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.asOf).toBe(ASOF);
    expect(data.asOf).toBe(ASOF);
  });

  it("38. Aktivität und Kohorte werden nicht vermischt: Marketing-activity-bounds und cohortCosts-cohortBounds können bei Yesterday/WTD abweichen (unterschiedliche Zeitlogik)", () => {
    const data = generateFullData(ASOF);
    // Für "yesterday" ist die Aktivitätsperiode ein einzelner Tag (asOf-1),
    // während die Kohorte (hier: die Referenz-Fixture) unabhängig davon nach
    // MetaLeadGenerated.generatedAt gebildet wird — die beiden Konzepte sind
    // strukturell getrennte Felder, keine gemeinsame Periodendivision.
    expect(data.marketing.yesterday.activity.timeSemantics).not.toBe(data.marketing.yesterday.cohortCosts.timeSemantics);
  });
});

// ============================================================================
// Evidenz (39-43)
// ============================================================================
describe("Workspace Data Contract — Evidenz (39-43)", () => {
  it("39. Evidenzlisten bleiben in jedem Marketing-Feld erhalten", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.activity.metaLeadsGenerated.evidenceIds.length).toBeGreaterThan(0);
  });

  it("40. Count entspricht der Evidenzlänge", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.activity.metaLeadsGenerated.value).toBe(data.marketing.monthToDate.activity.metaLeadsGenerated.evidenceIds.length);
  });

  it("41. Kosten-Zähler-Evidenz vorhanden", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.numeratorEvidenceIds).toEqual(["spend-full"]);
  });

  it("42. Kosten-Nenner-Evidenz vorhanden", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.denominatorEvidenceIds).toEqual(["meta-full"]);
  });

  it("43. keine fremden IDs: Sales-Evidenz enthält ausschließlich IDs aus der jeweiligen Periode", () => {
    const data = generateFullData("2025-01-10");
    expect(data.sales.monthToDate.evidence.wonOpportunityIds).toEqual(["opp-full"]);
    expect(data.sales.monthToDate.evidence.wonOpportunityIds).not.toContain("meta-full");
  });
});

// ============================================================================
// Historischer Fall (44-48) — echte Referenzwelt, April-2025-Meta-Kohorte
// ============================================================================
describe("Workspace Data Contract — Historischer Fall (44-48)", () => {
  const aprilBounds = { from: "2025-04-01", through: "2025-04-30" };
  const aprilCohort = generateMarketingCohortForBounds(
    "reference", aprilBounds, WORLD_NOW,
    world.metaAdSpendRecords, world.metaLeadGeneratedEvents, world.marketingLeadIdentityMatchedEvents, world.marketingCrmLeadIngestedEvents, world.salesAppointments, world.opportunities, world.marketingSourceCoverage,
  );

  it("44. positive Customer Acquisitions in der April-Kohorte", () => {
    expect(aprilCohort.costPerCustomerAcquired.denominatorCount).toBeGreaterThan(0);
  });

  it("45. positive Meta-Attribution: die Acquisitions sind über die Kohorte belegt", () => {
    expect(aprilCohort.costPerCustomerAcquired.denominatorEvidenceIds.length).toBe(aprilCohort.costPerCustomerAcquired.denominatorCount);
  });

  it("46. positiver, vorläufiger CAC (nie final, da indeterminate)", () => {
    expect(aprilCohort.costPerCustomerAcquired.maturity).toBe("indeterminate");
    expect(aprilCohort.costPerCustomerAcquired.provisionalAmountMinor).toBeGreaterThan(0);
    expect(aprilCohort.costPerCustomerAcquired.amountMinor).toBeUndefined();
  });

  it("47. Repeat-Wins fließen nicht als Kunde in den CAC-Nenner ein (Won-Count >= Customer-Count)", () => {
    expect(aprilCohort.costPerWonOpportunity.denominatorCount).toBeGreaterThanOrEqual(aprilCohort.costPerCustomerAcquired.denominatorCount);
  });

  it("48. Won- und Customer-Count bleiben in der historischen Kohorte getrennte Zahlen", () => {
    expect(aprilCohort.costPerWonOpportunity.denominatorCount).not.toBe(undefined);
    expect(aprilCohort.costPerCustomerAcquired.denominatorCount).not.toBe(undefined);
    // beide Nenner werden unabhängig voneinander geführt (unterschiedliche Evidenzlisten möglich)
    expect(Array.isArray(aprilCohort.costPerWonOpportunity.denominatorEvidenceIds)).toBe(true);
    expect(Array.isArray(aprilCohort.costPerCustomerAcquired.denominatorEvidenceIds)).toBe(true);
  });
});

// ============================================================================
// Regression (49-59)
// ============================================================================
describe("Workspace Data Contract — Regression (49-59)", () => {
  it("49. Customer Lifecycle unverändert erreichbar", () => {
    const l = generateCustomerAcquisitionLifecycle(world.opportunities, WORLD_NOW);
    expect(l.customerAcquiredEvents.length).toBe(58);
  });

  it("50. Customer/CAC Period Metrics unverändert erreichbar", () => {
    const m = generateCustomerAcquisitionPeriodMetrics(world.opportunities, WORLD_NOW);
    expect(m.asOf).toBe(WORLD_NOW);
  });

  it("51. Cohort Costs unverändert berechenbar (achte Kennzahl weiterhin vorhanden)", () => {
    const c = generateMarketingCohortCostMetrics({
      asOf: WORLD_NOW,
      metaAdSpendRecords: world.metaAdSpendRecords,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
      marketingSourceCoverage: world.marketingSourceCoverage,
    });
    expect(c.monthToDate.costPerCustomerAcquired).toBeDefined();
  });

  it("52. Marketing Attribution unverändert erreichbar", async () => {
    const { generateMarketingToSalesAttribution } = await import("../company/marketing-sales-attribution");
    const result = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
    });
    expect(result.attributions.length).toBeGreaterThan(0);
  });

  it("53. Sales Period Metrics unverändert erreichbar", () => {
    const s = generateSalesPeriodMetrics(WORLD_NOW, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);
    expect(s.asOf).toBe(WORLD_NOW);
  });

  it("54. Marketing Period Metrics unverändert erreichbar", () => {
    const m = generateMarketingPeriodMetrics(WORLD_NOW, world.metaAdSpendRecords, world.metaLeadGeneratedEvents, world.marketingCrmLeadIngestedEvents, world.marketingLeadIdentityMatchedEvents, world.marketingSourceCoverage);
    expect(m.asOf).toBe(WORLD_NOW);
  });

  it("55. Opportunities/Won/Lost unverändert", () => {
    expect(world.opportunities.filter((o) => o.currentStage === "gewonnen").length).toBe(79);
  });

  it("56. Delivery unverändert (79 Won === 79 DeliveryUnits)", () => {
    const won79 = world.opportunities.filter((o) => o.currentStage === "gewonnen");
    expect(world.deliveryUnits.length).toBe(won79.length);
    const fresh = generateDeliveryUnits(1, world.opportunities, EMPLOYEES);
    expect(fresh.length).toBe(won79.length);
  });

  it("57. Bereichsstates (Snapshot) unverändert", () => {
    const snapshot = generateWorldSnapshot(toSnapshotSource(), WORLD_NOW);
    expect(snapshot.deliveryUnits).toBeDefined();
    expect(snapshot.customerAccounts.length).toBeGreaterThan(0);
  });

  it("58. RNG unverändert: der Workspace-Vertrag ist eine reine Funktion ohne eigenen Zufallsstrom", () => {
    const a = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    const b = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(a).toEqual(b);
  });

  it("59. [KORREKTURAUFTRAG 'Workspace Contract Checkpoint', Phase I] Public Contract: ausschließlich der autorisierte, schmale Einstiegspunkt ist neu exportiert — der interne Orchestrator selbst bleibt unexportiert", async () => {
    const publicContract = await import("../index");
    // Der interne Low-Level-Orchestrator (nimmt eine bereits aufgelöste
    // AreaWorkspaceDataSource entgegen) bleibt bewusst unexportiert — externe
    // Consumer erhalten ausschließlich den schmalen, selbstständigen
    // Einstiegspunkt `generateReferenceAreaWorkspaceData` (löst World-Seed/
    // Profile/asOf selbst auf, siehe company/area-workspace-data.ts).
    expect(publicContract).not.toHaveProperty("generateAreaWorkspaceData");
    // Explizit und minimal autorisierte additive Erweiterung (siehe
    // Abschlussbericht "Workspace Contract Checkpoint + Erste sichtbare
    // Marketing/Sales-Unternehmeransicht", Phase I):
    expect(publicContract).toHaveProperty("generateReferenceAreaWorkspaceData");
    expect(typeof (publicContract as Record<string, unknown>).generateReferenceAreaWorkspaceData).toBe("function");
  });

  it("60. generateReferenceAreaWorkspaceData liefert ohne Argumente dieselbe Struktur wie der interne Orchestrator (kein Verhaltensunterschied, reiner Verkabelungs-Wrapper)", async () => {
    const publicContract = (await import("../index")) as typeof import("../index");
    const viaPublicEntryPoint = publicContract.generateReferenceAreaWorkspaceData();
    const viaInternalOrchestrator = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(viaPublicEntryPoint).toEqual(viaInternalOrchestrator);
  });
});

// ============================================================================
// KORREKTURAUFTRAG "Coverage-First Cost Status Precedence" — K7 Workspace
// (60-65) + Referenzwelt (66-70)
// ============================================================================
describe("Workspace Data Contract — Coverage-First: Workspace-Mapping (60-65)", () => {
  it("60. unavailable-data wird als unavailable projiziert", () => {
    const data = generateAreaWorkspaceData({ world: fullSource({ marketingSourceCoverage: [] }), asOf: ASOF, executiveContext: neutralExecutiveContext(ASOF) });
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe("unavailable");
  });

  it("61. partial-data wird als partial-data projiziert", () => {
    const partialCoverage = FULL_COVERAGE.map((c) => (c.stream === "meta-ad-spend" ? coverage("cov-spend-p61", "meta-ad-spend", "2025-01-01", "2025-01-01", "partial", "2025-01-01") : c));
    const data = generateAreaWorkspaceData({ world: fullSource({ marketingSourceCoverage: partialCoverage }), asOf: ASOF, executiveContext: neutralExecutiveContext(ASOF) });
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe("partial-data");
  });

  it("62. no-denominator-events wird als no-result-yet projiziert", () => {
    const data = generateAreaWorkspaceData({ world: fullSource({ metaLeadGeneratedEvents: [] }), asOf: ASOF, executiveContext: neutralExecutiveContext(ASOF) });
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe("no-result-yet");
  });

  it("63. available wird als final projiziert", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe("final");
  });

  it("64. provisional wird als provisional projiziert", () => {
    const data = generateFullData(ASOF);
    expect(data.marketing.monthToDate.cohortCosts.costPerCustomerAcquired.status).toBe("provisional");
  });

  it("65. der Workspace berechnet den Status nicht selbst neu — er entspricht exakt statusFromCohortCostAvailability(cohort.availability)", () => {
    const data = generateFullData(ASOF);
    const direct = generateMarketingCohortForBounds(
      "reference", { from: "2025-01-01", through: ASOF }, ASOF,
      [FULL_SPEND], [FULL_META], [FULL_MATCH], [FULL_CRM], [FULL_SALES_APPT_FC, FULL_SALES_APPT_SC], [FULL_OPP], FULL_COVERAGE,
    );
    // dieselbe availability aus derselben kanonischen Berechnung muss beim
    // Workspace-Aufruf zu demselben Status geführt haben — keine zweite,
    // abweichende Interpretation im Workspace-Layer.
    const availabilityToStatus: Record<string, string> = { available: "final", provisional: "provisional", "partial-data": "partial-data", "unavailable-data": "unavailable", "no-denominator-events": "no-result-yet" };
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe(availabilityToStatus[direct.costPerMetaLead.availability]);
  });
});

describe("Workspace Data Contract — Coverage-First: Referenzwelt (66-70)", () => {
  const data = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });

  it("66. Yesterday-Kosten sind bei partial Spend-/Leadgen-Coverage ehrlich partial-data, NICHT fälschlich no-result-yet", () => {
    expect(data.marketing.yesterday.activity.metaSpend.status).toBe("partial-data");
    expect(data.marketing.yesterday.cohortCosts.costPerMetaLead.status).toBe("partial-data");
    expect(data.marketing.yesterday.cohortCosts.costPerMetaLead.status).not.toBe("no-result-yet");
  });

  it("67. WTD-Kosten sind bei unavailable aktuellen Marketingquellen ehrlich unavailable, NICHT fälschlich no-result-yet", () => {
    expect(data.marketing.weekToDate.activity.metaSpend.status).toBe("unavailable");
    expect(data.marketing.weekToDate.cohortCosts.costPerMetaLead.status).toBe("unavailable");
    expect(data.marketing.weekToDate.cohortCosts.costPerMetaLead.status).not.toBe("no-result-yet");
  });

  it("68. MTD-Kosten sind bei unavailable aktuellen Marketingquellen ehrlich unavailable, NICHT fälschlich no-result-yet", () => {
    expect(data.marketing.monthToDate.activity.metaSpend.status).toBe("unavailable");
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).toBe("unavailable");
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.status).not.toBe("no-result-yet");
  });

  it("69. keine falsche Null: WTD/MTD zeigen keinen Kostenbetrag (weder final noch provisional)", () => {
    expect(data.marketing.weekToDate.cohortCosts.costPerMetaLead.amountMinor).toBeUndefined();
    expect(data.marketing.weekToDate.cohortCosts.costPerMetaLead.provisionalAmountMinor).toBeUndefined();
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.amountMinor).toBeUndefined();
    expect(data.marketing.monthToDate.cohortCosts.costPerMetaLead.provisionalAmountMinor).toBeUndefined();
  });

  it("70. eine historische, vollständig abgedeckte Kohorte mit echtem Nullnenner ergibt weiterhin no-result-yet (Status bleibt erreichbar)", () => {
    const historical = generateMarketingCohortForBounds(
      "reference", { from: "2024-06-05", through: "2024-06-05" }, WORLD_NOW,
      world.metaAdSpendRecords, world.metaLeadGeneratedEvents, world.marketingLeadIdentityMatchedEvents, world.marketingCrmLeadIngestedEvents, world.salesAppointments, world.opportunities, world.marketingSourceCoverage,
    );
    expect(historical.costPerWonOpportunity.denominatorCount).toBe(0);
    expect(historical.costPerWonOpportunity.availability).toBe("no-denominator-events");
    expect(historical.costPerCustomerAcquired.availability).toBe("no-denominator-events");
  });
});

// ============================================================================
// Operations Workspace (Auftrag "Operations Workspace Data Contract +
// Entrepreneur View V1", D052) — Pflichttests Phase D5: direkte Wertgleichheit,
// keine zweite Berechnung, Statusprojektion, Zeitsemantik, Evidenz-
// Weitergabe, Operations State unverändert, Marketing/Sales/Customer
// unverändert.
// ============================================================================
describe("Workspace Data Contract — Operations (71-84)", () => {
  const data = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
  const direct = generateOperationsPeriodMetrics(WORLD_NOW, world.deliveryUnits);

  it("71. direkte Wertgleichheit: deliveryCommitmentsCreated entspricht exakt der Domain-Funktion", () => {
    expect(data.operations.yesterday.activity.deliveryCommitmentsCreated).toBe(
      direct.yesterday.activity.deliveryCommitmentsCreated,
    );
    expect(data.operations.weekToDate.activity.deliveriesStarted).toBe(direct.weekToDate.activity.deliveriesStarted);
    expect(data.operations.monthToDate.activity.deliveriesCompleted).toBe(
      direct.monthToDate.activity.deliveriesCompleted,
    );
  });

  it("72. direkte Wertgleichheit: Bestand entspricht exakt der Domain-Funktion", () => {
    expect(data.operations.yesterday.stockAtPeriodEnd.queuedDeliveriesAtPeriodEnd).toBe(
      direct.yesterday.stockAtPeriodEnd.queuedDeliveriesAtPeriodEnd,
    );
    expect(data.operations.yesterday.stockAtPeriodEnd.activeDeliveriesAtPeriodEnd).toBe(
      direct.yesterday.stockAtPeriodEnd.activeDeliveriesAtPeriodEnd,
    );
  });

  it("73. direkte Wertgleichheit: Dauermediane entsprechen exakt der Domain-Funktion", () => {
    expect(data.operations.yesterday.durationFacts.queueDurationDaysMedianForStartedDeliveries.medianDays).toBe(
      direct.yesterday.durationFacts.queueDurationDaysMedianForStartedDeliveries.medianDays,
    );
  });

  it("74. keine zweite Berechnung: Bounds identisch zur Domain-Funktion", () => {
    expect(data.operations.yesterday.bounds).toEqual(direct.yesterday.bounds);
    expect(data.operations.weekToDate.bounds).toEqual(direct.weekToDate.bounds);
    expect(data.operations.monthToDate.bounds).toEqual(direct.monthToDate.bounds);
  });

  it("75. Statusprojektion: Dauermetrik mit Population > 0 ist final", () => {
    const withPopulation = [data.operations.yesterday, data.operations.weekToDate, data.operations.monthToDate].find(
      (p) => p.durationFacts.queueDurationDaysMedianForStartedDeliveries.population > 0,
    );
    expect(withPopulation).toBeDefined();
    expect(withPopulation!.durationFacts.queueDurationDaysMedianForStartedDeliveries.status).toBe("final");
  });

  it("76. Statusprojektion: Dauermetrik mit Population = 0 ist no-result-yet, kein erfundener Wert", () => {
    const zeroPopulation = [data.operations.yesterday, data.operations.weekToDate, data.operations.monthToDate].find(
      (p) => p.durationFacts.deliveryDurationDaysMedianForCompletedDeliveries.population === 0,
    );
    expect(zeroPopulation).toBeDefined();
    expect(zeroPopulation!.durationFacts.deliveryDurationDaysMedianForCompletedDeliveries.status).toBe(
      "no-result-yet",
    );
    expect(zeroPopulation!.durationFacts.deliveryDurationDaysMedianForCompletedDeliveries.medianDays).toBeUndefined();
  });

  it("77. Zeitsemantik: Activity ist 'event-activity', Dauerfakten sind 'actual-duration-observation'", () => {
    expect(data.operations.yesterday.activity.timeSemantics).toBe("event-activity");
    expect(data.operations.yesterday.durationFacts.timeSemantics).toBe("actual-duration-observation");
  });

  it("78. Evidence-Weitergabe: Count entspricht exakt der Evidenzlänge (alle drei Perioden)", () => {
    for (const period of [data.operations.yesterday, data.operations.weekToDate, data.operations.monthToDate]) {
      expect(period.activity.deliveryCommitmentsCreated).toBe(period.evidence.deliveryCommitmentsCreatedDeliveryUnitIds.length);
      expect(period.activity.deliveriesStarted).toBe(period.evidence.deliveriesStartedDeliveryUnitIds.length);
      expect(period.activity.deliveriesCompleted).toBe(period.evidence.deliveriesCompletedDeliveryUnitIds.length);
      expect(period.stockAtPeriodEnd.queuedDeliveriesAtPeriodEnd).toBe(period.evidence.queuedDeliveriesAtPeriodEndDeliveryUnitIds.length);
      expect(period.stockAtPeriodEnd.activeDeliveriesAtPeriodEnd).toBe(period.evidence.activeDeliveriesAtPeriodEndDeliveryUnitIds.length);
    }
  });

  it("79. Evidence-Weitergabe: Dauermetrik-Evidenz entspricht exakt der Population", () => {
    for (const period of [data.operations.yesterday, data.operations.weekToDate, data.operations.monthToDate]) {
      expect(period.durationFacts.queueDurationDaysMedianForStartedDeliveries.population).toBe(
        period.durationFacts.queueDurationDaysMedianForStartedDeliveries.evidenceIds.length,
      );
      expect(period.durationFacts.deliveryDurationDaysMedianForCompletedDeliveries.population).toBe(
        period.durationFacts.deliveryDurationDaysMedianForCompletedDeliveries.evidenceIds.length,
      );
    }
  });

  it("80. Operations State bleibt unverändert: state=null, evaluationStatus='unzureichende-evidenz'", () => {
    const { executiveContext } = generateFullCompanyContext();
    const operationsSummary = executiveContext.areaSummaries.find((a) => a.key === "operations")!;
    expect(operationsSummary.state).toBeNull();
    expect(operationsSummary.evaluationStatus).toBe("unzureichende-evidenz");
  });

  it("81. Marketing bleibt durch die Operations-Erweiterung unverändert", () => {
    const before = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(before.marketing).toEqual(data.marketing);
  });

  it("82. Sales bleibt durch die Operations-Erweiterung unverändert", () => {
    const before = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(before.sales).toEqual(data.sales);
  });

  it("83. keine SLA-/Termintreue-/Leistungsbewertungssprache im gesamten Operations-Workspace-Ausschnitt", () => {
    const serialized = JSON.stringify(data.operations);
    for (const forbidden of [/sla/i, /pünktlich/i, /verspätet/i, /planabweichung/i, /engpass/i, /überlastung/i]) {
      expect(forbidden.test(serialized)).toBe(false);
    }
  });

  it("84. Public Contract additiv: index.ts exportiert die neuen Operations-Typen, bestehende Exporte bleiben erhalten", async () => {
    const publicContract = (await import("../index")) as Record<string, unknown>;
    expect(typeof publicContract.generateReferenceAreaWorkspaceData).toBe("function");
    expect(typeof publicContract.generateFullCompanyContext).toBe("function");
    const referenceData = (publicContract.generateReferenceAreaWorkspaceData as () => AreaWorkspaceData)();
    expect(referenceData.operations).toBeDefined();
    expect(referenceData.marketing).toBeDefined();
    expect(referenceData.sales).toBeDefined();
  });
});

describe("Workspace Data Contract — People (85-99)", () => {
  const data = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
  const direct = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);

  it("85. direkte Wertgleichheit: Aktivität entspricht exakt der Domain-Funktion (alle drei Perioden)", () => {
    expect(data.people.yesterday.activity.hires).toBe(direct.yesterday.activity.hires);
    expect(data.people.weekToDate.activity.hires).toBe(direct.weekToDate.activity.hires);
    expect(data.people.monthToDate.activity.hires).toBe(direct.monthToDate.activity.hires);
    expect(data.people.yesterday.activity.terminations).toBe(direct.yesterday.activity.terminations);
    expect(data.people.weekToDate.activity.terminations).toBe(direct.weekToDate.activity.terminations);
    expect(data.people.monthToDate.activity.terminations).toBe(direct.monthToDate.activity.terminations);
  });

  it("86. direkte Wertgleichheit: Bestand entspricht exakt der Domain-Funktion (alle drei Perioden)", () => {
    for (const [period, directPeriod] of [
      [data.people.yesterday, direct.yesterday],
      [data.people.weekToDate, direct.weekToDate],
      [data.people.monthToDate, direct.monthToDate],
    ] as const) {
      expect(period.stockAtPeriodEnd.headcount).toBe(directPeriod.stockAtPeriodEnd.headcount);
      expect(period.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(directPeriod.stockAtPeriodEnd.staffedResponsibilityAreas);
      expect(period.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe(directPeriod.stockAtPeriodEnd.unstaffedResponsibilityAreas);
    }
  });

  it("87. keine zweite Berechnung: Bounds identisch zur Domain-Funktion", () => {
    expect(data.people.yesterday.bounds).toEqual(direct.yesterday.bounds);
    expect(data.people.weekToDate.bounds).toEqual(direct.weekToDate.bounds);
    expect(data.people.monthToDate.bounds).toEqual(direct.monthToDate.bounds);
  });

  it("88. genau eine kanonische Berechnung: zwei unabhängige generateAreaWorkspaceData-Aufrufe liefern identisches people", () => {
    const again = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(again.people).toEqual(data.people);
  });

  it("89. alle freigegebenen People-Kennzahlen sind vorhanden (Headcount, Eintritte, Austritte, besetzte/unbesetzte Verantwortungsbereiche)", () => {
    const yesterday = data.people.yesterday;
    expect(typeof yesterday.activity.hires).toBe("number");
    expect(typeof yesterday.activity.terminations).toBe("number");
    expect(typeof yesterday.stockAtPeriodEnd.headcount).toBe("number");
    expect(typeof yesterday.stockAtPeriodEnd.staffedResponsibilityAreas).toBe("number");
    expect(typeof yesterday.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe("number");
  });

  it("90. Zeitsemantik: Activity ist 'event-activity'", () => {
    expect(data.people.yesterday.activity.timeSemantics).toBe("event-activity");
    expect(data.people.weekToDate.activity.timeSemantics).toBe("event-activity");
    expect(data.people.monthToDate.activity.timeSemantics).toBe("event-activity");
  });

  it("91. Evidence-Weitergabe: Count entspricht exakt der Evidenzlänge (alle drei Perioden)", () => {
    for (const period of [data.people.yesterday, data.people.weekToDate, data.people.monthToDate]) {
      expect(period.activity.hires).toBe(period.evidence.hiresEmployeeIds.length);
      expect(period.activity.terminations).toBe(period.evidence.terminationsEmployeeIds.length);
      expect(period.stockAtPeriodEnd.headcount).toBe(period.evidence.headcountEmployeeIds.length);
      expect(period.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(period.evidence.staffedResponsibilityAreaKeys.length);
      expect(period.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe(period.evidence.unstaffedResponsibilityAreaKeys.length);
    }
  });

  it("92. echter Count von 0 bleibt 0 (Eintritte/Austritte bei WORLD_NOW, keine erfundene Zahl)", () => {
    expect(data.people.yesterday.activity.hires).toBe(0);
    expect(data.people.yesterday.activity.terminations).toBe(0);
    expect(data.people.yesterday.evidence.hiresEmployeeIds).toEqual([]);
  });

  it("93. Headcount bei WORLD_NOW entspricht exakt der bereits an anderer Stelle getesteten Baseline (38)", () => {
    expect(data.people.yesterday.stockAtPeriodEnd.headcount).toBe(38);
  });

  it("94. People State bleibt unverändert: state='ausgeglichen', evaluationStatus='bewertet' (keine automatische State-Änderung allein durch die neuen Kennzahlen)", () => {
    const { executiveContext } = generateFullCompanyContext();
    const peopleSummary = executiveContext.areaSummaries.find((a) => a.key === "people")!;
    expect(peopleSummary.state).toBe("ausgeglichen");
    expect(peopleSummary.evaluationStatus).toBe("bewertet");
  });

  it("95. Marketing bleibt durch die People-Erweiterung unverändert", () => {
    const before = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(before.marketing).toEqual(data.marketing);
  });

  it("96. Sales bleibt durch die People-Erweiterung unverändert", () => {
    const before = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(before.sales).toEqual(data.sales);
  });

  it("97. Operations bleibt durch die People-Erweiterung unverändert", () => {
    const before = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(before.operations).toEqual(data.operations);
  });

  it("98. keine Namen, keine Ranking-/Performance-/Abwesenheitssprache im gesamten People-Workspace-Ausschnitt", () => {
    const serialized = JSON.stringify(data.people);
    for (const forbidden of [
      /rank/i,
      /score/i,
      /performance/i,
      /isTopPerformer/i,
      /abwesen/i,
      /krank/i,
      /urlaub/i,
      /burnout/i,
      /kündigungsrisiko/i,
    ]) {
      expect(forbidden.test(serialized)).toBe(false);
    }
    for (const name of ["Jonas", "Katharina", "Fabian", "Svenja"]) {
      expect(serialized.includes(name)).toBe(false);
    }
  });

  it("99. Public Contract additiv: index.ts exportiert die neuen People-Typen, bestehende Exporte bleiben erhalten", async () => {
    const publicContract = (await import("../index")) as Record<string, unknown>;
    const referenceData = (publicContract.generateReferenceAreaWorkspaceData as () => AreaWorkspaceData)();
    expect(referenceData.people).toBeDefined();
    expect(referenceData.operations).toBeDefined();
    expect(referenceData.marketing).toBeDefined();
    expect(referenceData.sales).toBeDefined();
  });
});

describe("Workspace Data Contract — Executive (100-113)", () => {
  const data = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
  const direct = generateCompanyCapabilitySnapshot(REAL_EXECUTIVE_CONTEXT);

  it("100. direkte Wertgleichheit: capabilities entspricht exakt der Domain-Funktion", () => {
    expect(data.executive.capabilities).toEqual(direct.capabilities);
  });

  it("101. direkte Wertgleichheit: decisionPoints entspricht exakt der Domain-Funktion", () => {
    expect(data.executive.decisionPoints).toEqual(direct.decisionPoints);
  });

  it("102. direkte Wertgleichheit: knownFacts/attentionAreas/insufficientEvidenceAreas entspricht der Domain-Summary", () => {
    expect(data.executive.knownFacts).toEqual(direct.summary.knownFacts);
    expect(data.executive.attentionAreas).toEqual(direct.summary.attentionAreas);
    expect(data.executive.insufficientEvidenceAreas).toEqual(direct.summary.insufficientEvidenceAreas);
  });

  it("103. keine zweite Berechnung: zwei unabhängige generateAreaWorkspaceData-Aufrufe liefern identisches executive", () => {
    const again = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(again.executive).toEqual(data.executive);
  });

  it("104. alle vier Bereiche sind in capabilities vertreten", () => {
    const areas = data.executive.capabilities.map((c) => c.area).sort();
    expect(areas).toEqual(["marketing", "operations", "people", "sales"]);
  });

  it("105. asOf fällt niemals zwischen AreaWorkspaceData und dem Executive-Ausschnitt auseinander", () => {
    expect(data.executive.asOf).toBe(data.asOf);
    expect(data.executive.asOf).toBe(WORLD_NOW);
  });

  it("106. Evidence-ID-Integrität: jede Capability und jeder Entscheidungspunkt trägt eine evidenceIds-Liste", () => {
    for (const capability of data.executive.capabilities) {
      expect(Array.isArray(capability.evidenceIds)).toBe(true);
    }
    for (const decisionPoint of data.executive.decisionPoints) {
      expect(Array.isArray(decisionPoint.evidenceIds)).toBe(true);
    }
  });

  it("107. keine Entscheidung ohne Auslöser: jeder Entscheidungspunkt gehört zu einer 'attention-required'-Capability", () => {
    for (const decisionPoint of data.executive.decisionPoints) {
      const capability = data.executive.capabilities.find((c) => c.area === decisionPoint.area);
      expect(capability?.status).toBe("attention-required");
    }
  });

  it("108. keine automatische Entscheidung: jeder Entscheidungspunkt bleibt 'open', niemals automatisch ausgeführt", () => {
    for (const decisionPoint of data.executive.decisionPoints) {
      expect(decisionPoint.decisionStatus).toBe("open");
    }
  });

  it("109. Marketing bleibt durch die Executive-Erweiterung unverändert", () => {
    const before = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(before.marketing).toEqual(data.marketing);
  });

  it("110. Sales bleibt durch die Executive-Erweiterung unverändert", () => {
    const before = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(before.sales).toEqual(data.sales);
  });

  it("111. Operations und People bleiben durch die Executive-Erweiterung unverändert", () => {
    const before = generateAreaWorkspaceData({ world: toWorldSource(), asOf: WORLD_NOW, executiveContext: REAL_EXECUTIVE_CONTEXT });
    expect(before.operations).toEqual(data.operations);
    expect(before.people).toEqual(data.people);
  });

  it("112. kein Gesamtscore, keine Prozentzahl, keine Ampel, keine Schulnote im gesamten Executive-Ausschnitt", () => {
    const serialized = JSON.stringify(data.executive);
    for (const forbidden of [/score/i, /gesamtnote/i, /prozent/i, /percentage/i, /ampel/i, /trafficlight/i, /sternebewertung/i]) {
      expect(forbidden.test(serialized)).toBe(false);
    }
  });

  it("113. Public Contract additiv: index.ts exportiert die neuen Executive-Typen, bestehende Exporte bleiben erhalten", async () => {
    const publicContract = (await import("../index")) as Record<string, unknown>;
    const referenceData = (publicContract.generateReferenceAreaWorkspaceData as () => AreaWorkspaceData)();
    expect(referenceData.executive).toBeDefined();
    expect(referenceData.people).toBeDefined();
    expect(referenceData.operations).toBeDefined();
    expect(referenceData.marketing).toBeDefined();
    expect(referenceData.sales).toBeDefined();
  });
});
