import { describe, expect, it } from "vitest";
import { SCENARIO_WORLDS } from "../engine/generator";
import { WORLD_NOW } from "../timeline/world-clock";
import { generateCustomerAcquisitionPeriodMetrics } from "../company/customer-period-metrics";
import { generateCustomerAcquisitionLifecycle } from "../company/customer-acquisition-lifecycle";
import {
  generateMarketingCohortForBounds,
  generateMarketingCohortCostMetrics,
  type MarketingCohortBounds,
} from "../company/marketing-cohort-cost-metrics";
import type { MetaAdSpendRecord } from "../events/marketing-meta-ad-spend";
import type { MetaLeadGenerated, MarketingCrmLeadIngested, MarketingLeadIdentityMatched } from "../events/marketing-meta-crm-source";
import type { SalesAppointment } from "../world/sales-appointments";
import type { Opportunity } from "../events/opportunities";
import type { MarketingSourceCoverage, MarketingSourceStream } from "../events/marketing-source-coverage";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { generateDeliveryUnits } from "../world/delivery-units";
import { generateMarketingToSalesAttribution } from "../company/marketing-sales-attribution";
import { generateSalesPeriodMetrics } from "../company/sales-period-metrics";
import { generateMarketingPeriodMetrics } from "../company/marketing-period-metrics";

// AUFTRAG — Customer Lifecycle Checkpoint + Customer Period Metrics + Cohort
// CAC V1, Phase B, B14: Pflichttests für Customer Period Metrics (Zählung
// nach acquiredAt) und die kohortenbasierte costPerCustomerAcquired.
// Verbindliche Semantik: 79 Won-Opportunities ≠ 79 Kunden — nur
// CustomerAcquired-Events zählen als neue Kunden, Repeat-Wins nie.

const world = SCENARIO_WORLDS.baseline;

function toSource(): WorldSnapshotSource {
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
function lost(id: string, accountId: string, leadId: string, createdAt: string, closedAt: string): Opportunity {
  return { id, leadId, accountId, createdAt, currentStage: "verloren", value: 10000, probability: 0, responsibleEmployeeId: "emp-synth", closedAt, lostReason: "Budget" };
}
function coverage(id: string, stream: MarketingSourceStream, coveredFrom: string, coveredThrough: string, status: MarketingSourceCoverage["status"], importedAt = coveredThrough): MarketingSourceCoverage {
  return { id, stream, provider: stream === "meta-ad-spend" || stream === "meta-lead-generation" ? "meta" : "crm", coveredFrom, coveredThrough, importedAt, status };
}

const ASOF = "2025-06-01";

// Kohorte "Januar" (Kohortenbounds: 2025-01-01, ein Tag): eine Campaign
// (cmp-01), ein Meta-Lead, der zur AKQUIRIERENDEN Opportunity eines neuen
// Kunden führt (account-full).
const FULL_META = metaGen("meta-full", "2025-01-01", "campaign-01", "cmp-01");
const FULL_MATCH = match("match-full", "meta-full", "crm-full", "lead-full", "2025-01-03");
const FULL_CRM = crmIngest("crm-full", "lead-full", "2025-01-03");
const FULL_OPP = won("opp-full", "account-full", "lead-full", "2025-01-10", "2025-02-01"); // erste Won von account-full => Acquisition
const FULL_SPEND = spend("spend-full", "2025-01-01", "2025-01-02", 10000, "cmp-01");
const FULL_SPEND_ZERO_LEAD = spend("spend-zero-lead", "2025-01-01", "2025-01-02", 5000, "cmp-99");

// Repeat-Win desselben Accounts, aus einem ANDEREN Meta-Lead derselben
// Kohortenperiode — muss costPerCustomerAcquired NICHT beeinflussen (B7),
// darf costPerWonOpportunity aber weiterhin beeinflussen.
const REPEAT_META = metaGen("meta-repeat", "2025-01-01", "campaign-01", "cmp-01");
const REPEAT_MATCH = match("match-repeat", "meta-repeat", "crm-repeat", "lead-repeat", "2025-01-04");
const REPEAT_CRM = crmIngest("crm-repeat", "lead-repeat", "2025-01-04");
const REPEAT_OPP = won("opp-repeat", "account-full", "lead-repeat", "2025-03-01", "2025-03-15"); // SPÄTER als opp-full => Repeat Business

const FULL_COVERAGE: MarketingSourceCoverage[] = [
  coverage("cov-spend", "meta-ad-spend", "2024-06-01", ASOF, "complete"),
  coverage("cov-leadgen", "meta-lead-generation", "2024-06-01", ASOF, "complete"),
  coverage("cov-crm", "crm-lead-ingestion", "2024-06-01", ASOF, "complete"),
  coverage("cov-appt", "crm-sales-appointment-lifecycle", "2024-06-01", ASOF, "complete"),
  coverage("cov-opp", "crm-opportunity-lifecycle", "2024-06-01", ASOF, "complete"),
];

function generateFull(asOf: string, overrides?: {
  coverage?: MarketingSourceCoverage[];
  metaLeadGeneratedEvents?: MetaLeadGenerated[];
  salesAppointments?: SalesAppointment[];
  opportunities?: Opportunity[];
  marketingLeadIdentityMatchedEvents?: MarketingLeadIdentityMatched[];
  marketingCrmLeadIngestedEvents?: MarketingCrmLeadIngested[];
  metaAdSpendRecords?: MetaAdSpendRecord[];
}) {
  return generateMarketingCohortForBounds(
    "reference",
    { from: "2025-01-01", through: "2025-01-01" },
    asOf,
    overrides?.metaAdSpendRecords ?? [FULL_SPEND, FULL_SPEND_ZERO_LEAD],
    overrides?.metaLeadGeneratedEvents ?? [FULL_META, REPEAT_META],
    overrides?.marketingLeadIdentityMatchedEvents ?? [FULL_MATCH, REPEAT_MATCH],
    overrides?.marketingCrmLeadIngestedEvents ?? [FULL_CRM, REPEAT_CRM],
    overrides?.salesAppointments ?? [],
    overrides?.opportunities ?? [FULL_OPP, REPEAT_OPP],
    overrides?.coverage ?? FULL_COVERAGE,
  );
}

// ============================================================================
// Customer Period Metrics (1-13)
// ============================================================================
describe("Customer Period Metrics (1-13)", () => {
  it("1. Zählung nach acquiredAt, nicht nach Won-Erstellung/-Datum", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-05-10")];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-05-10");
    expect(m.monthToDate.customersAcquired).toBe(1);
    expect(m.monthToDate.acquiringOpportunityIds).toEqual(["opp-1"]);
  });

  it("2. Account-Erstellung ist irrelevant (CustomerAccount.createdAt fließt nirgends ein)", () => {
    // Kein CustomerAccount-Objekt wird überhaupt übergeben — nur Opportunity.accountId.
    const opps = [won("opp-1", "acc-1", "lead-1", "2018-01-15", "2025-08-20")]; // Account fiktiv seit 2018 "alt"
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-20");
    expect(m.yesterday.customersAcquired + m.weekToDate.customersAcquired + m.monthToDate.customersAcquired).toBeGreaterThanOrEqual(0);
    expect(m.monthToDate.accountIds).toEqual(["acc-1"]); // zählt im August (closedAt), nicht 2018
  });

  it("3. Opportunity-Erstellung ist irrelevant (createdAt !== acquiredAt-Filter)", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-08-15")];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-15");
    expect(m.monthToDate.customersAcquired).toBe(1); // zählt im August, obwohl Opportunity im Januar erstellt wurde
  });

  it("4. Repeat-Win wird ausgeschlossen", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10"),
      won("opp-2", "acc-1", "lead-2", "2025-08-01", "2025-08-10"), // Repeat, im selben Monat wie asOf
    ];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-10");
    expect(m.monthToDate.customersAcquired).toBe(0); // die einzige sichtbare Änderung ist ein Repeat-Win, kein neuer Kunde
  });

  it("5. Yesterday korrekt", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-08-19")];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-20");
    expect(m.yesterday.bounds).toEqual({ from: "2025-08-19", through: "2025-08-19" });
    expect(m.yesterday.customersAcquired).toBe(1);
  });

  it("6. WTD korrekt", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-08-18")]; // Montag der Woche von 2025-08-20
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-20");
    expect(m.weekToDate.customersAcquired).toBe(1);
  });

  it("7. MTD korrekt", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-08-01")];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-20");
    expect(m.monthToDate.customersAcquired).toBe(1);
  });

  it("8. Monatswechsel: eine Acquisition im Vormonat zählt nicht in MTD", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-07-31")];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-01");
    expect(m.monthToDate.customersAcquired).toBe(0);
  });

  it("9. Jahreswechsel: eine Acquisition im Vorjahr zählt nicht in MTD des neuen Jahres", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2024-01-01", "2024-12-31")];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-01-01");
    expect(m.monthToDate.customersAcquired).toBe(0);
  });

  it("10. eine zukünftige Acquisition wird ausgeschlossen", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-08-25")];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-20"); // asOf VOR closedAt
    expect(m.monthToDate.customersAcquired).toBe(0);
    expect(m.monthToDate.accountIds).toEqual([]);
  });

  it("11. customersAcquired entspricht der Evidenzlänge", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-08-05"),
      won("opp-2", "acc-2", "lead-2", "2025-01-01", "2025-08-10"),
    ];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-20");
    expect(m.monthToDate.customersAcquired).toBe(m.monthToDate.customerAcquiredEventIds.length);
    expect(m.monthToDate.customersAcquired).toBe(m.monthToDate.accountIds.length);
    expect(m.monthToDate.customersAcquired).toBe(m.monthToDate.acquiringOpportunityIds.length);
  });

  it("12. Account IDs sind eindeutig", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-08-05"),
      won("opp-2", "acc-2", "lead-2", "2025-01-01", "2025-08-10"),
    ];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-20");
    expect(new Set(m.monthToDate.accountIds).size).toBe(m.monthToDate.accountIds.length);
  });

  it("13. Opportunity IDs sind eindeutig", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-08-05"),
      won("opp-2", "acc-2", "lead-2", "2025-01-01", "2025-08-10"),
    ];
    const m = generateCustomerAcquisitionPeriodMetrics(opps, "2025-08-20");
    expect(new Set(m.monthToDate.acquiringOpportunityIds).size).toBe(m.monthToDate.acquiringOpportunityIds.length);
  });
});

// ============================================================================
// Customer Attribution (14-20)
// ============================================================================
describe("Customer Attribution (14-20)", () => {
  it("14. akquirierende Opportunity trägt eine leadId (Opportunity→Lead)", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCustomerAcquired.denominatorEvidenceIds).toEqual(["customer-acquired-account-full"]);
  });

  it("15. Lead→Meta-Match wird korrekt aufgelöst", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCustomerAcquired.denominatorCount).toBe(1);
  });

  it("16. richtige Meta-Kohorte: die Januar-Kohorte enthält die Acquisition ihres eigenen Meta-Leads", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCustomerAcquired.denominatorEvidenceIds).toContain("customer-acquired-account-full");
  });

  it("17. eine fremde Kohorte (anderer Monat) wird ausgeschlossen", () => {
    const febMeta = metaGen("meta-feb", "2025-02-01", "campaign-01", "cmp-01");
    const febMatch = match("match-feb", "meta-feb", "crm-feb", "lead-feb", "2025-02-03");
    const febCrm = crmIngest("crm-feb", "lead-feb", "2025-02-03");
    const febOpp = won("opp-feb", "account-feb", "lead-feb", "2025-02-10", "2025-02-20");
    const c = generateFull(ASOF, {
      metaLeadGeneratedEvents: [FULL_META, REPEAT_META, febMeta],
      marketingLeadIdentityMatchedEvents: [FULL_MATCH, REPEAT_MATCH, febMatch],
      marketingCrmLeadIngestedEvents: [FULL_CRM, REPEAT_CRM, febCrm],
      opportunities: [FULL_OPP, REPEAT_OPP, febOpp],
    });
    // Kohortenbounds bleiben 2025-01-01 (ein Tag) — der Februar-Lead ist gar
    // nicht Mitglied dieser Kohorte, seine Acquisition darf daher nicht zählen.
    expect(c.costPerCustomerAcquired.denominatorEvidenceIds).not.toContain("customer-acquired-account-feb");
    expect(c.costPerCustomerAcquired.denominatorCount).toBe(1);
  });

  it("18. eine nicht Meta-attribuierbare Acquisition wird ausgeschlossen", () => {
    // account-organic wird gewonnen, aber sein Lead hat NIE ein Meta-Match.
    const organicOpp = won("opp-organic", "account-organic", "lead-organic", "2025-01-05", "2025-01-20");
    const c = generateFull(ASOF, { opportunities: [FULL_OPP, REPEAT_OPP, organicOpp] });
    expect(c.costPerCustomerAcquired.denominatorEvidenceIds).not.toContain("customer-acquired-account-organic");
    expect(c.costPerCustomerAcquired.denominatorCount).toBe(1); // unverändert, nur die echte Meta-Acquisition zählt
  });

  it("19. ein Repeat-Win wird ausgeschlossen, obwohl sein Meta-Lead Mitglied derselben Kohorte ist", () => {
    const c = generateFull(ASOF);
    // REPEAT_OPP (aus REPEAT_META, derselben Kohorte) darf NICHT im Nenner erscheinen.
    expect(c.costPerCustomerAcquired.denominatorCount).toBe(1); // nur opp-full, nicht opp-repeat
  });

  it("20. mehrere Won-Opportunities desselben Accounts erzeugen nur eine Acquisition im CAC-Nenner", () => {
    const c = generateFull(ASOF);
    const accountFullCount = c.costPerCustomerAcquired.denominatorEvidenceIds.filter((id) => id === "customer-acquired-account-full").length;
    expect(accountFullCount).toBe(1);
  });
});

// ============================================================================
// CAC (21-29)
// ============================================================================
describe("CAC (21-29)", () => {
  it("21. Zähler ist der gesamte Kohortenspend", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCustomerAcquired.numeratorAmountMinor).toBe(c.spendAmountMinor);
  });

  it("22. Null-Lead-Campaign-Spend bleibt im CAC-Zähler enthalten", () => {
    const c = generateFull(ASOF);
    expect(c.spendAmountMinor).toBe(15000); // 10000 (cmp-01) + 5000 (cmp-99, keine Leads)
    expect(c.costPerCustomerAcquired.numeratorAmountMinor).toBe(15000);
  });

  it("23. Nenner enthält ausschließlich CustomerAcquired-Events, keine Won-Opportunity-IDs", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCustomerAcquired.denominatorEvidenceIds).toEqual(["customer-acquired-account-full"]);
    expect(c.costPerCustomerAcquired.denominatorEvidenceIds).not.toContain("opp-full");
    expect(c.costPerCustomerAcquired.denominatorEvidenceIds).not.toContain("opp-repeat");
  });

  it("24. korrekte Division: Spend / Anzahl Customer Acquisitions", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCustomerAcquired.provisionalAmountMinor).toBe(15000); // 15000 / 1
  });

  it("25. Minor-Unit-Rundung: kaufmännisch auf die nächste Minor Unit", () => {
    const secondMeta = metaGen("meta-second-acq", "2025-01-01", "campaign-01", "cmp-01");
    const secondMatch = match("match-second-acq", "meta-second-acq", "crm-second-acq", "lead-second-acq", "2025-01-03");
    const secondCrm = crmIngest("crm-second-acq", "lead-second-acq", "2025-01-03");
    const secondOpp = won("opp-second-acq", "account-second", "lead-second-acq", "2025-01-10", "2025-01-25");
    const spendUneven = spend("spend-uneven", "2025-01-01", "2025-01-02", 100, "cmp-01"); // 100/3 leads... aber hier 2 Acquisitions
    const c = generateFull(ASOF, {
      metaLeadGeneratedEvents: [FULL_META, REPEAT_META, secondMeta],
      marketingLeadIdentityMatchedEvents: [FULL_MATCH, REPEAT_MATCH, secondMatch],
      marketingCrmLeadIngestedEvents: [FULL_CRM, REPEAT_CRM, secondCrm],
      opportunities: [FULL_OPP, REPEAT_OPP, secondOpp],
      metaAdSpendRecords: [spendUneven],
    });
    expect(c.costPerCustomerAcquired.denominatorCount).toBe(2);
    expect(c.costPerCustomerAcquired.provisionalAmountMinor).toBe(50); // Math.round(100/2)
    expect(Number.isInteger(c.costPerCustomerAcquired.provisionalAmountMinor)).toBe(true);
  });

  it("26. Nenner 0 ergibt kein Infinity", () => {
    const c = generateFull(ASOF, { opportunities: [] });
    expect(c.costPerCustomerAcquired.availability).toBe("no-denominator-events");
    expect(c.costPerCustomerAcquired.provisionalAmountMinor).not.toBe(Infinity);
  });

  it("27. Nenner 0 ergibt kein NaN", () => {
    const c = generateFull(ASOF, { opportunities: [] });
    expect(Number.isNaN(c.costPerCustomerAcquired.denominatorCount)).toBe(false);
    expect(c.costPerCustomerAcquired.amountMinor).toBeUndefined();
  });

  it("28. ein Repeat-Win verändert den CAC-Nenner nicht", () => {
    const withoutRepeat = generateFull(ASOF, { metaLeadGeneratedEvents: [FULL_META], marketingLeadIdentityMatchedEvents: [FULL_MATCH], marketingCrmLeadIngestedEvents: [FULL_CRM], opportunities: [FULL_OPP] });
    const withRepeat = generateFull(ASOF); // inkl. REPEAT_OPP
    expect(withoutRepeat.costPerCustomerAcquired.denominatorCount).toBe(1);
    expect(withRepeat.costPerCustomerAcquired.denominatorCount).toBe(1);
    expect(withoutRepeat.costPerCustomerAcquired.provisionalAmountMinor).toBe(withRepeat.costPerCustomerAcquired.provisionalAmountMinor);
  });

  it("29. Won-Count und Customer-Count bleiben getrennte Zahlen", () => {
    const c = generateFull(ASOF);
    expect(c.costPerWonOpportunity.denominatorCount).toBe(2); // opp-full + opp-repeat
    expect(c.costPerCustomerAcquired.denominatorCount).toBe(1); // nur opp-full ist eine Acquisition
  });
});

// ============================================================================
// Coverage (30-36)
// ============================================================================
describe("CAC — Coverage (30-36)", () => {
  it("30. Spend-Coverage wird nur über die Kohortenperiode geprüft", () => {
    // Ein Spend-Fehltag WEIT NACH der Kohortenperiode darf CAC nicht beeinflussen.
    const laterGapCoverage = FULL_COVERAGE.map((c) => (c.stream === "meta-ad-spend" ? coverage("cov-spend-gap", "meta-ad-spend", "2024-06-01", "2025-01-01", "complete") : c));
    // Kein Record für 2025-01-02..ASOF -> irrelevant, da Kohortenbounds nur 2025-01-01 umfassen.
    const c = generateFull(ASOF, { coverage: laterGapCoverage });
    expect(c.costPerCustomerAcquired.availability).not.toBe("unavailable-data");
  });

  it("31. Leadgen-Coverage wird nur über die Kohortenperiode geprüft", () => {
    const laterGapCoverage = FULL_COVERAGE.map((c) => (c.stream === "meta-lead-generation" ? coverage("cov-leadgen-gap", "meta-lead-generation", "2024-06-01", "2025-01-01", "complete") : c));
    const c = generateFull(ASOF, { coverage: laterGapCoverage });
    expect(c.costPerCustomerAcquired.availability).not.toBe("unavailable-data");
  });

  it("32. CRM-Coverage wird nur über das Match-Fenster geprüft", () => {
    // CRM-Coverage endet direkt nach dem 6-Tage-Match-Fenster (2025-01-07) — muss reichen.
    const crmWindowOnly = FULL_COVERAGE.map((c) => (c.stream === "crm-lead-ingestion" ? coverage("cov-crm-window", "crm-lead-ingestion", "2024-06-01", "2025-01-07", "complete") : c));
    const c = generateFull(ASOF, { coverage: crmWindowOnly });
    expect(c.costPerCustomerAcquired.availability).not.toBe("unavailable-data");
  });

  it("33. Opportunity-Coverage wird bis asOf geprüft", () => {
    const noOpp = FULL_COVERAGE.filter((c) => c.stream !== "crm-opportunity-lifecycle");
    const c = generateFull(ASOF, { coverage: noOpp });
    expect(c.costPerCustomerAcquired.availability).toBe("unavailable-data");
  });

  it("34. partial Coverage verhindert einen finalen/vollständigen Wert (bleibt partial-data)", () => {
    const partial = FULL_COVERAGE.map((c) => (c.stream === "crm-opportunity-lifecycle" ? coverage("cov-opp-partial", "crm-opportunity-lifecycle", "2025-01-01", "2025-01-01", "partial") : c));
    const c = generateFull(ASOF, { coverage: partial });
    expect(c.costPerCustomerAcquired.availability).toBe("partial-data");
    expect(c.costPerCustomerAcquired.amountMinor).toBeUndefined();
  });

  it("35. unavailable Coverage verhindert jeden Wert", () => {
    const c = generateFull(ASOF, { coverage: [] });
    expect(c.costPerCustomerAcquired.availability).toBe("unavailable-data");
    expect(c.costPerCustomerAcquired.amountMinor).toBeUndefined();
    expect(c.costPerCustomerAcquired.provisionalAmountMinor).toBeUndefined();
  });

  it("36. eine erst nach asOf importierte Coverage ist historisch unsichtbar", () => {
    const futureCoverage: MarketingSourceCoverage[] = [
      ...FULL_COVERAGE,
      coverage("cov-opp-future", "crm-opportunity-lifecycle", "2025-01-01", "2025-06-01", "complete", "2025-06-02"),
    ];
    const c1 = generateFull(ASOF, { coverage: FULL_COVERAGE });
    const c2 = generateFull(ASOF, { coverage: futureCoverage });
    expect(c1.costPerCustomerAcquired).toEqual(c2.costPerCustomerAcquired);
  });
});

// ============================================================================
// Maturity (37-42)
// ============================================================================
describe("CAC — Maturity (37-42)", () => {
  it("37. costPerCustomerAcquired ist immer indeterminate", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCustomerAcquired.maturity).toBe("indeterminate");
  });

  it("38. vollständige Coverage ergibt ausschließlich provisional", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCustomerAcquired.availability).toBe("provisional");
  });

  it("39. costPerCustomerAcquired wird niemals final (kein amountMinor)", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCustomerAcquired.amountMinor).toBeUndefined();
    expect(c.costPerCustomerAcquired.provisionalAmountMinor).toBeDefined();
  });

  it("40. eine junge Kohorte ohne sichtbare Acquisition wird nicht als gescheitert dargestellt", () => {
    const young = generateFull("2025-01-05", { opportunities: [] });
    const json = JSON.stringify(young.costPerCustomerAcquired).toLowerCase();
    expect(json).not.toContain("failed");
    expect(json).not.toContain("gescheitert");
  });

  it("41. eine spätere Acquisition kann den Kohorten-CAC nachträglich verändern (kein statischer Cutoff)", () => {
    const before = generateFull("2025-01-15", { opportunities: [FULL_OPP] }); // FULL_OPP.closedAt=2025-02-01, noch nicht sichtbar
    const after = generateFull(ASOF, { opportunities: [FULL_OPP] }); // jetzt sichtbar
    expect(before.costPerCustomerAcquired.denominatorCount).toBe(0);
    expect(after.costPerCustomerAcquired.denominatorCount).toBe(1);
  });

  it("42. eine frühere As-of-Sicht bleibt bei wiederholter Berechnung reproduzierbar", () => {
    const a = generateFull("2025-01-15");
    const b = generateFull("2025-01-15");
    expect(a.costPerCustomerAcquired).toEqual(b.costPerCustomerAcquired);
  });
});

// ============================================================================
// Regression (43-52)
// ============================================================================
describe("Regression (43-52)", () => {
  it("43. Customer Lifecycle unverändert erreichbar", () => {
    const l = generateCustomerAcquisitionLifecycle(world.opportunities, WORLD_NOW);
    expect(l.customerAcquiredEvents.length).toBeGreaterThan(0);
  });

  it("44. Cohort Costs (die übrigen sieben Kennzahlen) bleiben unverändert berechenbar", () => {
    const c = generateFull(ASOF);
    expect(c.costPerMetaLead.availability).toBe("available");
    expect(c.costPerWonOpportunity.denominatorCount).toBe(2);
  });

  it("45. Marketing Attribution unverändert erreichbar", () => {
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

  it("46. Marketing Period Metrics unverändert erreichbar", () => {
    const result = generateMarketingPeriodMetrics(WORLD_NOW, world.metaAdSpendRecords, world.metaLeadGeneratedEvents, world.marketingCrmLeadIngestedEvents, world.marketingLeadIdentityMatchedEvents, world.marketingSourceCoverage);
    expect(result.asOf).toBe(WORLD_NOW);
  });

  it("47. Sales Period Metrics unverändert erreichbar", () => {
    const result = generateSalesPeriodMetrics(WORLD_NOW, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);
    expect(result.asOf).toBe(WORLD_NOW);
  });

  it("48. Opportunities/Won/Lost unverändert", () => {
    expect(world.opportunities.filter((o) => o.currentStage === "gewonnen").length).toBe(79);
    expect(world.opportunities.filter((o) => o.currentStage === "verloren").length).toBeGreaterThan(0);
  });

  it("49. DeliveryUnits unverändert (79 Won === 79 DeliveryUnits, unabhängig von Customer-Semantik)", () => {
    const won79 = world.opportunities.filter((o) => o.currentStage === "gewonnen");
    expect(world.deliveryUnits.length).toBe(won79.length);
    const fresh = generateDeliveryUnits(1, world.opportunities, EMPLOYEES);
    expect(fresh.length).toBe(won79.length);
  });

  it("50. Bereichsstates (Snapshot) unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.deliveryUnits).toBeDefined();
    expect(snapshot.customerAccounts.length).toBeGreaterThan(0);
  });

  it("51. RNG unverändert: Cohort-CAC ist eine reine Funktion ohne eigenen Zufallsstrom", () => {
    const params = {
      asOf: WORLD_NOW,
      metaAdSpendRecords: world.metaAdSpendRecords,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
      marketingSourceCoverage: world.marketingSourceCoverage,
    };
    const a = generateMarketingCohortCostMetrics(params);
    const b = generateMarketingCohortCostMetrics(params);
    expect(a).toEqual(b);
  });

  it("52. Public Contract unverändert: keine neuen Laufzeitsymbole in index.ts", async () => {
    const publicContract = await import("../index");
    expect(publicContract).not.toHaveProperty("generateCustomerAcquisitionPeriodMetrics");
    expect(publicContract).not.toHaveProperty("generateMarketingCohortCostMetrics");
    expect(publicContract).not.toHaveProperty("costPerCustomerAcquired");
  });
});

// Nur zur Typprüfung referenziert.
const _typeCheck: MarketingCohortBounds | undefined = undefined;
void _typeCheck;
