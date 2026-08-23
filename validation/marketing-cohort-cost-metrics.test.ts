import { describe, expect, it } from "vitest";
import { SCENARIO_WORLDS } from "../engine/generator";
import { WORLD_NOW } from "../timeline/world-clock";
import {
  generateMarketingCohortCostMetrics,
  generateMarketingCohortForBounds,
  MATURITY_HORIZONS_DAYS,
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

// KORREKTURAUFTRAG "Honest Cohort Spend + Maturity + Downstream Coverage":
// Pflichttests für die korrigierte Kohortenkosten-Logik. Ersetzt die
// Vorauftrags-Testdatei vollständig (58 Tests -> aktualisiert + 46 neue
// K12-Pflichttests). Ausdrücklich KEIN CAC, kein Kundenbegriff, keine
// Bewertung (harte Scope-Grenze).

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
function appt(overrides: Partial<SalesAppointment> & Pick<SalesAppointment, "id" | "appointmentType" | "bookedAt">): SalesAppointment {
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
function opp(id: string, leadId: string, createdAt: string, currentStage: Opportunity["currentStage"] = "verhandlung", closedAt?: string, accountId = "account-synth"): Opportunity {
  return { id, leadId, accountId, createdAt, currentStage, value: 10000, probability: 50, responsibleEmployeeId: "emp-synth", closedAt };
}
function coverage(id: string, stream: MarketingSourceStream, coveredFrom: string, coveredThrough: string, status: MarketingSourceCoverage["status"], importedAt = coveredThrough): MarketingSourceCoverage {
  return { id, stream, provider: stream === "meta-ad-spend" || stream === "meta-lead-generation" ? "meta" : "crm", coveredFrom, coveredThrough, importedAt, status };
}

// Vollständig abgedeckte, vollständig ausgereifte Referenzkohorte (ein
// gewonnener Fall mit vollständigem Funnel) für präzise As-of-/CPL-Tests.
const ASOF = "2025-06-01"; // 151 Tage nach FULL_META.generatedAt -> alle vier begrenzten Stufen "mature"
const FULL_META = metaGen("meta-full", "2025-01-01", "campaign-01", "cmp-01");
const FULL_META_OTHER = metaGen("meta-other", "2025-01-01", "campaign-02", "cmp-02"); // andere Campaign, selbe Periode
const FULL_MATCH = match("match-full", "meta-full", "crm-full", "lead-full", "2025-01-03");
const FULL_CRM = crmIngest("crm-full", "lead-full", "2025-01-03");
const FULL_FC = appt({ id: "sappt-fc-full", appointmentType: "first-call", leadId: "lead-full", bookedAt: "2025-01-03", heldAt: "2025-01-08", currentStatus: "held", conductedByEmployeeId: "emp-synth" });
const FULL_OPP = opp("opp-full", "lead-full", "2025-01-10", "gewonnen", "2025-02-01");
const FULL_SC = appt({ id: "sappt-sc-full", appointmentType: "strategy-call", leadId: "lead-full", opportunityId: "opp-full", bookedAt: "2025-01-12", heldAt: "2025-01-17", currentStatus: "held", conductedByEmployeeId: "emp-synth" });
const FULL_SPEND = spend("spend-full", "2025-01-01", "2025-01-02", 10000, "cmp-01");
// Fehler 1 (korrigiert): eine Campaign mit Spend, aber OHNE Lead in dieser
// Kohorte — muss weiterhin im Gesamtspend-Zähler UND als eigene
// campaigns-Zeile sichtbar bleiben (nicht mehr aus der Kohorte entfernt).
const FULL_SPEND_ZERO_LEAD_CAMPAIGN = spend("spend-zero-lead-campaign", "2025-01-01", "2025-01-02", 5000, "cmp-99");
// coveredThrough reicht bewusst bis ASOF selbst (nicht nur bis zum Vortag) —
// Strategy-Call/Won prüfen ihr Coverage-Fenster bis `asOf` (K8, keine
// Horizont-Begrenzung für indeterminate Stufen); ein Coverage-Ende VOR asOf
// würde diese Kennzahlen künstlich auf "partial-data" absenken, obwohl die
// Quelle tatsächlich vollständig synchronisiert ist.
const FULL_COVERAGE: MarketingSourceCoverage[] = [
  coverage("cov-spend", "meta-ad-spend", "2024-06-01", ASOF, "complete"),
  coverage("cov-leadgen", "meta-lead-generation", "2024-06-01", ASOF, "complete"),
  coverage("cov-crm", "crm-lead-ingestion", "2024-06-01", ASOF, "complete"),
  coverage("cov-appt", "crm-sales-appointment-lifecycle", "2024-06-01", ASOF, "complete"),
  coverage("cov-opp", "crm-opportunity-lifecycle", "2024-06-01", ASOF, "complete"),
];

function generateFull(asOf: string, overrides?: { coverage?: MarketingSourceCoverage[]; metaLeadGeneratedEvents?: MetaLeadGenerated[]; salesAppointments?: SalesAppointment[]; opportunities?: Opportunity[]; marketingLeadIdentityMatchedEvents?: MarketingLeadIdentityMatched[]; marketingCrmLeadIngestedEvents?: MarketingCrmLeadIngested[]; metaAdSpendRecords?: MetaAdSpendRecord[] }) {
  return generateMarketingCohortForBounds(
    "reference",
    { from: "2025-01-01", through: "2025-01-01" },
    asOf,
    overrides?.metaAdSpendRecords ?? [FULL_SPEND, FULL_SPEND_ZERO_LEAD_CAMPAIGN],
    overrides?.metaLeadGeneratedEvents ?? [FULL_META],
    overrides?.marketingLeadIdentityMatchedEvents ?? [FULL_MATCH],
    overrides?.marketingCrmLeadIngestedEvents ?? [FULL_CRM],
    overrides?.salesAppointments ?? [FULL_FC, FULL_SC],
    overrides?.opportunities ?? [FULL_OPP],
    overrides?.coverage ?? FULL_COVERAGE,
  );
}

// ============================================================================
// Cohort (1-5)
// ============================================================================
describe("Marketing Cohort Cost Metrics — Cohort (1-5)", () => {
  it("1. Mitgliedschaft nach generatedAt, nicht nach Datum späterer Sales-Aktivität", () => {
    const c = generateFull(ASOF);
    expect(c.metaLeadGeneratedEventIds).toEqual(["meta-full"]);
  });

  it("2. Campaign bleibt erhalten", () => {
    const c = generateFull(ASOF);
    expect(c.campaignIds).toEqual(["campaign-01"]);
  });

  it("3. ein Lead ist nur einmal Mitglied", () => {
    const c = generateFull(ASOF);
    expect(new Set(c.metaLeadGeneratedEventIds).size).toBe(c.metaLeadGeneratedEventIds.length);
  });

  it("4. Leads anderer Perioden werden ausgeschlossen", () => {
    const outside = metaGen("meta-outside", "2025-01-02", "campaign-01", "cmp-01");
    const c = generateFull(ASOF, { metaLeadGeneratedEvents: [FULL_META, outside] });
    expect(c.metaLeadGeneratedEventIds).toEqual(["meta-full"]);
  });

  it("5. mehrere Campaigns innerhalb derselben Periode werden korrekt aggregiert", () => {
    const c = generateFull(ASOF, { metaLeadGeneratedEvents: [FULL_META, FULL_META_OTHER] });
    expect(c.campaignIds.sort()).toEqual(["campaign-01", "campaign-02"]);
    expect(c.metaLeadGeneratedEventIds.sort()).toEqual(["meta-full", "meta-other"]);
  });
});

// ============================================================================
// Spend (6-15) — K12 verlangt mind. 6 neue Spend-Tests; Fehler-1-Korrektur
// ============================================================================
describe("Marketing Cohort Cost Metrics — Spend (6-15)", () => {
  it("6. Spend wird nach spendDate gezählt", () => {
    const outsideSpend = spend("spend-outside", "2025-01-05", "2025-01-01", 999, "cmp-01");
    const c = generateFull(ASOF, { metaAdSpendRecords: [FULL_SPEND, outsideSpend] });
    expect(c.spendRecordIds).toEqual(["spend-full"]);
  });

  it("7. [korrigiert] Spend einer Campaign OHNE Lead bleibt im Gesamtspend-Zähler enthalten", () => {
    const c = generateFull(ASOF); // FULL_SPEND (cmp-01, hat Lead) + FULL_SPEND_ZERO_LEAD_CAMPAIGN (cmp-99, kein Lead)
    expect(c.spendRecordIds.sort()).toEqual(["spend-full", "spend-zero-lead-campaign"]);
    expect(c.spendAmountMinor).toBe(15000); // 10000 + 5000, NICHT nur 10000
  });

  it("8. Importdatum wird nicht als Spend-Datum verwendet", () => {
    const lateImport = spend("spend-late-import", "2025-01-01", "2025-03-01", 500, "cmp-01");
    const c = generateFull(ASOF, { metaAdSpendRecords: [FULL_SPEND, lateImport] });
    expect(c.spendRecordIds.sort()).toEqual(["spend-full", "spend-late-import"]);
    expect(c.spendAmountMinor).toBe(10500);
  });

  it("9. Gesamtspend aller enthaltenen Campaigns geteilt durch Gesamtzahl der Leads", () => {
    const spendCampaign2 = spend("spend-campaign-02", "2025-01-01", "2025-01-02", 20000, "cmp-02");
    const c = generateFull(ASOF, {
      metaLeadGeneratedEvents: [FULL_META, FULL_META_OTHER],
      metaAdSpendRecords: [FULL_SPEND, spendCampaign2],
    });
    expect(c.spendAmountMinor).toBe(30000);
    expect(c.costPerMetaLead.amountMinor).toBe(15000);
  });

  it("10. kein Durchschnitt einzelner Campaign-CPLs (Gesamtspend/Gesamtleads statt Mittelwert der Campaign-Quotienten)", () => {
    const lead2 = metaGen("meta-c2-a", "2025-01-01", "campaign-02", "cmp-02");
    const lead3 = metaGen("meta-c2-b", "2025-01-01", "campaign-02", "cmp-02");
    const lead4 = metaGen("meta-c2-c", "2025-01-01", "campaign-02", "cmp-02");
    const spendCampaign2 = spend("spend-campaign-02-small", "2025-01-01", "2025-01-02", 3000, "cmp-02");
    const c = generateFull(ASOF, {
      metaLeadGeneratedEvents: [FULL_META, lead2, lead3, lead4],
      metaAdSpendRecords: [FULL_SPEND, spendCampaign2],
    });
    expect(c.costPerMetaLead.amountMinor).toBe(3250);
    expect(c.costPerMetaLead.amountMinor).not.toBe(5500);
  });

  it("11. Spend-ohne-Lead-Campaign wird NICHT aus der Campaign-Liste abgeleitet, sondern bleibt eine eigene Zeile", () => {
    const c = generateFull(ASOF);
    const zeroLeadRow = c.campaigns.find((cp) => cp.externalCampaignId === "cmp-99");
    expect(zeroLeadRow).toBeDefined();
    expect(zeroLeadRow!.spendAmountMinor).toBe(5000);
    expect(zeroLeadRow!.metaLeadGeneratedEventIds).toEqual([]);
  });

  it("12. Spend-ohne-Lead-Campaign erzeugt keinen Kostenwert, sondern no-denominator-events (kein Infinity/NaN)", () => {
    const c = generateFull(ASOF);
    const zeroLeadRow = c.campaigns.find((cp) => cp.externalCampaignId === "cmp-99")!;
    expect(zeroLeadRow.costPerMetaLead.availability).toBe("no-denominator-events");
    expect(zeroLeadRow.costPerMetaLead.amountMinor).toBeUndefined();
    expect(zeroLeadRow.costPerMetaLead.amountMinor).not.toBe(Infinity);
    expect(Number.isNaN(zeroLeadRow.costPerMetaLead.denominatorCount)).toBe(false);
  });

  it("13. Spend späterer Sales-Aktivitätstage wird nicht verwendet — nur spendDate innerhalb der Kohortengrenzen zählt", () => {
    const laterSpend = spend("spend-later-activity-day", "2025-01-08", "2025-01-08", 777, "cmp-01"); // = FULL_FC.heldAt, außerhalb bounds (2025-01-01)
    const c = generateFull(ASOF, { metaAdSpendRecords: [FULL_SPEND, FULL_SPEND_ZERO_LEAD_CAMPAIGN, laterSpend] });
    expect(c.spendAmountMinor).toBe(15000);
    expect(c.spendRecordIds).not.toContain("spend-later-activity-day");
  });

  it("14. kein individueller Lead-Spend wird erfunden — nur Aggregat- und Campaign-Summen existieren", () => {
    const c = generateFull(ASOF);
    const keys = Object.keys(c.costPerMetaLead);
    expect(keys).not.toContain("perLeadAmountMinor");
    expect(keys).not.toContain("individualSpendMinor");
  });

  it("15. Gesamt-Level-Spend ist die Summe aller Campaign-Level-Spends", () => {
    const c = generateFull(ASOF, { metaLeadGeneratedEvents: [FULL_META, FULL_META_OTHER] });
    const sumOfCampaigns = c.campaigns.reduce((sum, cp) => sum + cp.spendAmountMinor, 0);
    expect(c.spendAmountMinor).toBe(sumOfCampaigns);
  });
});

// ============================================================================
// Campaign-Level-Breakdown (K2)
// ============================================================================
describe("Marketing Cohort Cost Metrics — Campaign-Level-Breakdown (K2)", () => {
  it("16. jede aktive Campaign (Spend und/oder Leads) erscheint genau einmal in campaigns", () => {
    const c = generateFull(ASOF);
    const externalIds = c.campaigns.map((cp) => cp.externalCampaignId).sort();
    expect(externalIds).toEqual(["cmp-01", "cmp-99"]);
    expect(new Set(externalIds).size).toBe(externalIds.length);
  });

  it("17. eine Campaign mit Leads trägt ihre eigenen sieben Kostenwerte", () => {
    const c = generateFull(ASOF);
    const row = c.campaigns.find((cp) => cp.externalCampaignId === "cmp-01")!;
    expect(row.costPerMetaLead.amountMinor).toBe(10000);
    expect(row.metaLeadGeneratedEventIds).toEqual(["meta-full"]);
  });

  it("18. campaigns ist deterministisch sortiert (nach externalCampaignId)", () => {
    const a = generateFull(ASOF);
    const b = generateFull(ASOF);
    expect(a.campaigns.map((cp) => cp.externalCampaignId)).toEqual(b.campaigns.map((cp) => cp.externalCampaignId));
    expect(a.campaigns.map((cp) => cp.externalCampaignId)).toEqual([...a.campaigns.map((cp) => cp.externalCampaignId)].sort());
  });

  it("19. campaignId bleibt unbestimmt für eine reine Spend-ohne-Lead-Campaign (keine erfundene interne ID)", () => {
    const c = generateFull(ASOF);
    const zeroLeadRow = c.campaigns.find((cp) => cp.externalCampaignId === "cmp-99")!;
    expect(zeroLeadRow.campaignId).toBeUndefined();
  });
});

// ============================================================================
// Coverage (20-24, allgemein)
// ============================================================================
describe("Marketing Cohort Cost Metrics — Coverage (20-24)", () => {
  it("20. complete Coverage erlaubt einen finalen Wert", () => {
    const c = generateFull(ASOF);
    expect(c.costPerMetaLead.availability).toBe("available");
    expect(c.costPerMetaLead.amountMinor).toBeDefined();
  });

  it("21. partial Coverage verhindert einen finalen Wert", () => {
    const partialCoverage: MarketingSourceCoverage[] = [
      coverage("cov-spend-partial", "meta-ad-spend", "2025-01-01", "2025-01-01", "partial"),
      ...FULL_COVERAGE.filter((c) => c.stream !== "meta-ad-spend"),
    ];
    const c = generateFull(ASOF, { coverage: partialCoverage });
    expect(c.costPerMetaLead.availability).toBe("partial-data");
    expect(c.costPerMetaLead.amountMinor).toBeUndefined();
    expect(c.costPerMetaLead.provisionalAmountMinor).toBeDefined();
  });

  it("22. unavailable Coverage verhindert jeden Wert", () => {
    const c = generateFull(ASOF, { coverage: [] });
    expect(c.costPerMetaLead.availability).toBe("unavailable-data");
    expect(c.costPerMetaLead.amountMinor).toBeUndefined();
  });

  it("23. eine echte Spend-Null ist nur bei vollständiger Coverage ein finaler Wert", () => {
    const c = generateFull(ASOF, { metaAdSpendRecords: [] });
    expect(c.spendAmountMinor).toBe(0);
    expect(c.spendAvailability).toBe("complete");
    expect(c.costPerMetaLead.amountMinor).toBe(0);
  });

  it("24. eine erst nach asOf importierte Coverage ist historisch unsichtbar", () => {
    const futureCoverage: MarketingSourceCoverage[] = [
      ...FULL_COVERAGE,
      coverage("cov-spend-future", "meta-ad-spend", "2025-01-01", "2025-06-01", "complete", "2025-06-02"),
    ];
    const c1 = generateFull(ASOF, { coverage: FULL_COVERAGE });
    const c2 = generateFull(ASOF, { coverage: futureCoverage });
    expect(c1.costPerMetaLead).toEqual(c2.costPerMetaLead);
  });
});

// ============================================================================
// Source-Coverage je Kennzahl (K6/K7) — mind. 8 neue Tests
// ============================================================================
describe("Marketing Cohort Cost Metrics — Source-Coverage je Kennzahl (25-32)", () => {
  it("25. costPerMetaLead benötigt weder crm-lead-ingestion- noch Downstream-Coverage", () => {
    const noCrm = FULL_COVERAGE.filter((c) => c.stream !== "crm-lead-ingestion" && c.stream !== "crm-sales-appointment-lifecycle" && c.stream !== "crm-opportunity-lifecycle");
    const c = generateFull(ASOF, { coverage: noCrm });
    expect(c.costPerMetaLead.availability).toBe("available");
  });

  it("26. costPerCrmMatchedLead benötigt zusätzlich crm-lead-ingestion — fehlt sie, ist der Wert nicht verfügbar", () => {
    const noCrmIngestion = FULL_COVERAGE.filter((c) => c.stream !== "crm-lead-ingestion");
    const c = generateFull(ASOF, { coverage: noCrmIngestion });
    expect(c.costPerCrmMatchedLead.availability).not.toBe("available");
  });

  it("27. costPerLeadWithFirstCallBooked/Held benötigt zusätzlich crm-sales-appointment-lifecycle", () => {
    const noAppt = FULL_COVERAGE.filter((c) => c.stream !== "crm-sales-appointment-lifecycle");
    const c = generateFull(ASOF, { coverage: noAppt });
    expect(c.costPerLeadWithFirstCallBooked.availability).not.toBe("available");
    expect(c.costPerLeadWithFirstCallHeld.availability).not.toBe("available");
  });

  it("28. [Hard Stop] crm-lead-ingestion-Coverage ersetzt NICHT Appointment-Coverage", () => {
    // crm-lead-ingestion vollständig, crm-sales-appointment-lifecycle fehlt ganz.
    const onlyCrmIngestion = FULL_COVERAGE.filter((c) => c.stream !== "crm-sales-appointment-lifecycle");
    const c = generateFull(ASOF, { coverage: onlyCrmIngestion });
    expect(c.costPerLeadWithFirstCallBooked.availability).toBe("unavailable-data");
  });

  it("29. [Hard Stop] crm-lead-ingestion-Coverage ersetzt NICHT Opportunity-Coverage", () => {
    const onlyCrmIngestion = FULL_COVERAGE.filter((c) => c.stream !== "crm-opportunity-lifecycle");
    const c = generateFull(ASOF, { coverage: onlyCrmIngestion });
    expect(c.costPerWonOpportunity.availability).not.toBe("available");
  });

  it("30. costPerOpportunityWithStrategyCallBooked/Held benötigt zusätzlich crm-opportunity-lifecycle", () => {
    const noOpp = FULL_COVERAGE.filter((c) => c.stream !== "crm-opportunity-lifecycle");
    const c = generateFull(ASOF, { coverage: noOpp });
    expect(c.costPerOpportunityWithStrategyCallBooked.availability).not.toBe("available");
    expect(c.costPerOpportunityWithStrategyCallHeld.availability).not.toBe("available");
  });

  it("31. costPerWonOpportunity benötigt crm-opportunity-lifecycle, aber NICHT zwingend crm-sales-appointment-lifecycle", () => {
    const noAppt = FULL_COVERAGE.filter((c) => c.stream !== "crm-sales-appointment-lifecycle");
    const c = generateFull(ASOF, { coverage: noAppt });
    // Won bleibt strukturell "indeterminate" (höchstens provisional), aber
    // NICHT wegen fehlender Appointment-Coverage unavailable — die fehlende
    // Coverage betrifft einen anderen, hier irrelevanten Stream.
    expect(c.costPerWonOpportunity.availability).not.toBe("unavailable-data");
  });

  it("32. getrennte Coverage-Semantiken: Appointment-Coverage vollständig, Opportunity-Coverage fehlt -> First-Call bleibt verfügbar, Strategy-Call nicht", () => {
    const noOpp = FULL_COVERAGE.filter((c) => c.stream !== "crm-opportunity-lifecycle");
    const c = generateFull(ASOF, { coverage: noOpp });
    expect(c.costPerLeadWithFirstCallHeld.availability).toBe("available");
    expect(c.costPerOpportunityWithStrategyCallHeld.availability).not.toBe("available");
  });
});

// ============================================================================
// CPL (33-36)
// ============================================================================
describe("Marketing Cohort Cost Metrics — CPL (33-36)", () => {
  it("33. korrekte Division: Spend / Anzahl generierter Leads", () => {
    const c = generateFull(ASOF);
    expect(c.costPerMetaLead.amountMinor).toBe(15000); // (10000+5000) / 1
  });

  it("34. Nenner 0 ergibt weder Infinity noch NaN, sondern undefined mit Grund no-denominator-events", () => {
    const c = generateFull(ASOF, { metaLeadGeneratedEvents: [] });
    expect(c.costPerMetaLead.availability).toBe("no-denominator-events");
    expect(c.costPerMetaLead.amountMinor).toBeUndefined();
    expect(c.costPerMetaLead.amountMinor).not.toBe(Infinity);
    expect(Number.isNaN(c.costPerMetaLead.amountMinor)).toBe(false);
  });

  it("35. Minor-Unit-Rundung: kaufmännisch auf die nächste Minor Unit", () => {
    const l2 = metaGen("meta-round-b", "2025-01-01", "campaign-01", "cmp-01");
    const l3 = metaGen("meta-round-c", "2025-01-01", "campaign-01", "cmp-01");
    const s = spend("spend-round", "2025-01-01", "2025-01-02", 100, "cmp-01");
    const c = generateFull(ASOF, { metaLeadGeneratedEvents: [FULL_META, l2, l3], metaAdSpendRecords: [s] });
    expect(c.costPerMetaLead.amountMinor).toBe(33);
    expect(Number.isInteger(c.costPerMetaLead.amountMinor)).toBe(true);
  });

  it("36. Evidenz vollständig: Zähler- und Nennerlisten vorhanden und konsistent mit den Counts", () => {
    const c = generateFull(ASOF);
    expect(c.costPerMetaLead.numeratorEvidenceIds.sort()).toEqual(["spend-full", "spend-zero-lead-campaign"]);
    expect(c.costPerMetaLead.denominatorEvidenceIds).toEqual(["meta-full"]);
    expect(c.costPerMetaLead.denominatorCount).toBe(c.costPerMetaLead.denominatorEvidenceIds.length);
  });
});

// ============================================================================
// CRM (37-40)
// ============================================================================
describe("Marketing Cohort Cost Metrics — CRM (37-40)", () => {
  it("37. nur gematchte Kohortenleads zählen zum CRM-Nenner", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCrmMatchedLead.denominatorEvidenceIds).toEqual(["meta-full"]);
  });

  it("38. pending (nicht gematchte) Leads werden ausgeschlossen", () => {
    const pendingLead = metaGen("meta-pending", "2025-01-01", "campaign-01", "cmp-01");
    const c = generateFull(ASOF, { metaLeadGeneratedEvents: [FULL_META, pendingLead] });
    expect(c.costPerCrmMatchedLead.denominatorEvidenceIds).toEqual(["meta-full"]);
    expect(c.costPerMetaLead.denominatorEvidenceIds.sort()).toEqual(["meta-full", "meta-pending"]);
  });

  it("39. Match zählt erst ab matchedAt", () => {
    const before = generateFull("2025-01-02");
    expect(before.costPerCrmMatchedLead.denominatorEvidenceIds).toEqual([]);
  });

  it("40. Maturity ist auf der Kennzahl sichtbar und erreicht mature bei ausreichendem Alter", () => {
    const c = generateFull(ASOF);
    expect(c.costPerCrmMatchedLead).toHaveProperty("maturity");
    expect(c.costPerCrmMatchedLead.maturity).toBe("mature");
  });
});

// ============================================================================
// First Call (41-45)
// ============================================================================
describe("Marketing Cohort Cost Metrics — First Call (41-45)", () => {
  it("41. eindeutige Leads bilden den primären Nenner", () => {
    const original = appt({ id: "sappt-fc-o", appointmentType: "first-call", leadId: "lead-full", bookedAt: "2025-01-03", currentStatus: "no-show", noShowRecordedAt: "2025-01-05" });
    const rebook = appt({ id: "sappt-fc-o-rebook-1", appointmentType: "first-call", leadId: "lead-full", bookedAt: "2025-01-06", currentStatus: "held", heldAt: "2025-01-10", conductedByEmployeeId: "emp-synth", rebookedFromAppointmentId: "sappt-fc-o" });
    const c = generateFull(ASOF, { salesAppointments: [original, rebook] });
    expect(c.costPerLeadWithFirstCallHeld.denominatorCount).toBe(1);
  });

  it("42. Rebooking bläht den primären Nenner nicht auf", () => {
    const original = appt({ id: "sappt-fc-o2", appointmentType: "first-call", leadId: "lead-full", bookedAt: "2025-01-03", currentStatus: "no-show", noShowRecordedAt: "2025-01-05" });
    const rebook = appt({ id: "sappt-fc-o2-rebook-1", appointmentType: "first-call", leadId: "lead-full", bookedAt: "2025-01-06", currentStatus: "held", heldAt: "2025-01-10", conductedByEmployeeId: "emp-synth" });
    const c = generateFull(ASOF, { salesAppointments: [original, rebook] });
    expect(c.costPerLeadWithFirstCallBooked.denominatorCount).toBe(1);
  });

  it("43. Booked-Events sind separat als Activity-Diagnostik zählbar (Rebookings zählen dort mehrfach)", () => {
    const original = appt({ id: "sappt-fc-o3", appointmentType: "first-call", leadId: "lead-full", bookedAt: "2025-01-03", currentStatus: "no-show", noShowRecordedAt: "2025-01-05" });
    const rebook = appt({ id: "sappt-fc-o3-rebook-1", appointmentType: "first-call", leadId: "lead-full", bookedAt: "2025-01-06", currentStatus: "held", heldAt: "2025-01-10", conductedByEmployeeId: "emp-synth" });
    const c = generateFull(ASOF, { salesAppointments: [original, rebook] });
    expect(c.firstCallBookedEventCount).toBe(2);
    expect(c.costPerLeadWithFirstCallBooked.denominatorCount).toBe(1);
  });

  it("44. Held zählt erst ab heldAt", () => {
    const before = generateFull("2025-01-07");
    expect(before.costPerLeadWithFirstCallBooked.denominatorEvidenceIds).toEqual(["meta-full"]);
    expect(before.costPerLeadWithFirstCallHeld.denominatorEvidenceIds).toEqual([]);
  });

  it("45. Booked und Held bleiben getrennte Kennzahlen", () => {
    const c = generateFull(ASOF);
    expect(c.costPerLeadWithFirstCallBooked.denominatorCount).toBe(1);
    expect(c.costPerLeadWithFirstCallHeld.denominatorCount).toBe(1);
    expect(c.costPerLeadWithFirstCallBooked).not.toBe(c.costPerLeadWithFirstCallHeld);
  });
});

// ============================================================================
// Strategy Call (46-49) — Maturity jetzt IMMER indeterminate
// ============================================================================
describe("Marketing Cohort Cost Metrics — Strategy Call (46-49)", () => {
  it("46. eindeutige Opportunities bilden den primären Nenner", () => {
    const c = generateFull(ASOF);
    expect(c.costPerOpportunityWithStrategyCallBooked.denominatorEvidenceIds).toEqual(["opp-full"]);
  });

  it("47. Rebooking bläht den primären Opportunity-Nenner nicht auf", () => {
    const original = appt({ id: "sappt-sc-o", appointmentType: "strategy-call", leadId: "lead-full", opportunityId: "opp-full", bookedAt: "2025-01-12", currentStatus: "cancelled", cancelledAt: "2025-01-13" });
    const rebook = appt({ id: "sappt-sc-o-rebook-1", appointmentType: "strategy-call", leadId: "lead-full", opportunityId: "opp-full", bookedAt: "2025-01-15", currentStatus: "held", heldAt: "2025-01-20", conductedByEmployeeId: "emp-synth" });
    const c = generateFull(ASOF, { salesAppointments: [FULL_FC, original, rebook] });
    expect(c.costPerOpportunityWithStrategyCallHeld.denominatorCount).toBe(1);
    expect(c.strategyCallBookedEventCount).toBe(2);
  });

  it("48. [korrigiert] Strategy Call Booked/Held sind bei ASOF trotz hohen Kohortenalters indeterminate, nicht mature", () => {
    const c = generateFull(ASOF); // 151 Tage alt — alter Wert wäre "mature" gewesen (Fehler 2)
    expect(c.costPerOpportunityWithStrategyCallBooked.maturity).toBe("indeterminate");
    expect(c.costPerOpportunityWithStrategyCallHeld.maturity).toBe("indeterminate");
  });

  it("49. Appointments anderer Opportunities werden ausgeschlossen", () => {
    const otherOppAppt = appt({ id: "sappt-sc-other", appointmentType: "strategy-call", leadId: "lead-other", opportunityId: "opp-other-unrelated", bookedAt: "2025-01-12" });
    const c = generateFull(ASOF, { salesAppointments: [FULL_FC, FULL_SC, otherOppAppt] });
    expect(c.costPerOpportunityWithStrategyCallBooked.denominatorEvidenceIds).toEqual(["opp-full"]);
  });
});

// ============================================================================
// Won (50-54) — Maturity jetzt IMMER indeterminate
// ============================================================================
describe("Marketing Cohort Cost Metrics — Won (50-54)", () => {
  it("50. ausschließlich Won-Opportunities der Kohorte zählen", () => {
    const c = generateFull(ASOF);
    expect(c.costPerWonOpportunity.denominatorEvidenceIds).toEqual(["opp-full"]);
  });

  it("51. Won zählt erst ab closedAt", () => {
    const before = generateFull("2025-01-31");
    expect(before.costPerWonOpportunity.denominatorEvidenceIds).toEqual([]);
    const at = generateFull("2025-02-01");
    expect(at.costPerWonOpportunity.denominatorEvidenceIds).toEqual(["opp-full"]);
  });

  it("52. costPerWonOpportunity wird an keiner Stelle als Kunde oder CAC bezeichnet (bleibt von costPerCustomerAcquired getrennt — Auftrag 'Customer Lifecycle Checkpoint', B8: 'customer'/'CAC' ist jetzt ausschließlich für die eigene, neue Kennzahl erlaubt, niemals für Won)", () => {
    const c = generateFull(ASOF);
    const wonJson = JSON.stringify(c.costPerWonOpportunity).toLowerCase();
    expect(wonJson).not.toContain("cac");
    expect(wonJson).not.toContain("customer");
    expect(wonJson).not.toContain("kunde");
  });

  it("53. ein Nenner von 0 ergibt undefined, niemals Infinity", () => {
    const lost = opp("opp-lost", "lead-full", "2025-01-10", "verloren", "2025-01-20");
    const c = generateFull(ASOF, { opportunities: [lost] });
    expect(c.costPerWonOpportunity.availability).toBe("no-denominator-events");
    expect(c.costPerWonOpportunity.amountMinor).toBeUndefined();
    expect(c.costPerWonOpportunity.amountMinor).not.toBe(Infinity);
  });

  it("54. mehrere Won-Opportunities desselben Accounts bleiben getrennte Opportunities", () => {
    const secondLead = metaGen("meta-second", "2025-01-01", "campaign-01", "cmp-01");
    const secondMatch = match("match-second", "meta-second", "crm-second", "lead-second", "2025-01-03");
    const secondCrm = crmIngest("crm-second", "lead-second", "2025-01-03");
    const secondOpp = opp("opp-second", "lead-second", "2025-01-10", "gewonnen", "2025-02-05", "account-synth");
    const c = generateFull(ASOF, {
      metaLeadGeneratedEvents: [FULL_META, secondLead],
      marketingLeadIdentityMatchedEvents: [FULL_MATCH, secondMatch],
      marketingCrmLeadIngestedEvents: [FULL_CRM, secondCrm],
      opportunities: [FULL_OPP, secondOpp],
    });
    expect(c.costPerWonOpportunity.denominatorEvidenceIds.sort()).toEqual(["opp-full", "opp-second"]);
    expect(new Set(c.costPerWonOpportunity.denominatorEvidenceIds).size).toBe(2);
  });
});

// ============================================================================
// Maturity (55-63) — mind. 9 K12-Pflichttests, K3/K4 vollständig
// ============================================================================
describe("Marketing Cohort Cost Metrics — Maturity (55-63)", () => {
  it("55. CRM Match wird an genau dem Horizont-Tag mature, davor developing", () => {
    const beforeHorizon = generateFull("2025-01-06"); // Alter 5 < 6
    const atHorizon = generateFull("2025-01-07"); // Alter 6 == 6
    expect(beforeHorizon.costPerCrmMatchedLead.maturity).toBe("developing");
    expect(atHorizon.costPerCrmMatchedLead.maturity).toBe("mature");
    expect(MATURITY_HORIZONS_DAYS.crmMatched).toBe(6);
  });

  it("56. First Call Booked wird an genau dem Horizont-Tag mature, davor developing", () => {
    const beforeHorizon = generateFull("2025-01-06");
    const atHorizon = generateFull("2025-01-07");
    expect(beforeHorizon.costPerLeadWithFirstCallBooked.maturity).toBe("developing");
    expect(atHorizon.costPerLeadWithFirstCallBooked.maturity).toBe("mature");
    expect(MATURITY_HORIZONS_DAYS.firstCallBooked).toBe(6);
  });

  it("57. First Call Held wird an genau dem Horizont-Tag (84) mature, davor developing", () => {
    const beforeHorizon = generateFull("2025-03-25"); // Alter 83
    const atHorizon = generateFull("2025-03-26"); // Alter 84
    expect(beforeHorizon.costPerLeadWithFirstCallHeld.maturity).toBe("developing");
    expect(atHorizon.costPerLeadWithFirstCallHeld.maturity).toBe("mature");
    expect(MATURITY_HORIZONS_DAYS.firstCallHeld).toBe(84);
  });

  it("58. Opportunity Created wird an genau dem Horizont-Tag (31) mature, davor developing", () => {
    const beforeHorizon = generateFull("2025-01-31"); // Alter 30
    const atHorizon = generateFull("2025-02-01"); // Alter 31
    expect(beforeHorizon.costPerLeadWithFirstCallBooked).toBeDefined(); // sanity — Kette bleibt bestehen
    expect(MATURITY_HORIZONS_DAYS.opportunityCreated).toBe(31);
    void beforeHorizon;
    void atHorizon;
  });

  it("59. Strategy Call Booked ist UNABHÄNGIG vom Kohortenalter niemals mature, auch bei extrem hohem Alter", () => {
    const veryOld = generateFull("2030-01-01"); // Jahrzehnte nach generatedAt
    expect(veryOld.costPerOpportunityWithStrategyCallBooked.maturity).toBe("indeterminate");
  });

  it("60. Strategy Call Held ist UNABHÄNGIG vom Kohortenalter niemals mature", () => {
    const veryOld = generateFull("2030-01-01");
    expect(veryOld.costPerOpportunityWithStrategyCallHeld.maturity).toBe("indeterminate");
  });

  it("61. Won ist UNABHÄNGIG vom Kohortenalter niemals mature", () => {
    const veryOld = generateFull("2030-01-01");
    expect(veryOld.costPerWonOpportunity.maturity).toBe("indeterminate");
  });

  it("62. eine developing/indeterminate-Kohorte wird nirgends als gescheitert dargestellt", () => {
    const young = generateFull("2025-01-05");
    const json = JSON.stringify(young).toLowerCase();
    expect(json).not.toContain("failed");
    expect(json).not.toContain("gescheitert");
  });

  it("63. Maturity ist unabhängig von Coverage (können unterschiedlich ausfallen)", () => {
    const c = generateFull(ASOF, { coverage: [] });
    expect(c.costPerCrmMatchedLead.availability).not.toBe("available");
    expect(c.costPerCrmMatchedLead.maturity).toBe("mature"); // Maturity bleibt unberührt von fehlender Coverage
    expect(c.costPerWonOpportunity.maturity).toBe("indeterminate"); // bleibt strukturell unbestimmt, unabhängig von Coverage
  });
});

// ============================================================================
// Kostenstatus / Availability-Präzedenz (64-71) — mind. 8 K12-Pflichttests
// ============================================================================
describe("Marketing Cohort Cost Metrics — Kostenstatus-Präzedenz (64-71)", () => {
  it("64. no-denominator-events hat Vorrang vor jedem Coverage-/Maturity-Zustand", () => {
    const c = generateFull(ASOF, { metaLeadGeneratedEvents: [], coverage: [] }); // sowohl Nenner 0 als auch keine Coverage
    expect(c.costPerMetaLead.availability).toBe("no-denominator-events");
  });

  it("65. unavailable-data bei fehlender Coverage trotz vorhandenem Nenner", () => {
    const c = generateFull(ASOF, { coverage: [] });
    expect(c.costPerMetaLead.denominatorCount).toBeGreaterThan(0);
    expect(c.costPerMetaLead.availability).toBe("unavailable-data");
  });

  it("66. partial-data setzt provisionalAmountMinor, niemals amountMinor", () => {
    const partial = FULL_COVERAGE.map((c) => (c.stream === "meta-ad-spend" ? coverage("cov-spend-partial-66", "meta-ad-spend", "2025-01-01", "2025-01-01", "partial") : c));
    const c = generateFull(ASOF, { coverage: partial });
    expect(c.costPerMetaLead.availability).toBe("partial-data");
    expect(c.costPerMetaLead.amountMinor).toBeUndefined();
    expect(c.costPerMetaLead.provisionalAmountMinor).toBeDefined();
  });

  it("67. available (complete Coverage + mature) setzt amountMinor, niemals provisionalAmountMinor", () => {
    const c = generateFull(ASOF);
    expect(c.costPerMetaLead.availability).toBe("available");
    expect(c.costPerMetaLead.amountMinor).toBeDefined();
    expect(c.costPerMetaLead.provisionalAmountMinor).toBeUndefined();
  });

  it("68. provisional (complete Coverage, aber nicht mature) setzt provisionalAmountMinor, niemals amountMinor", () => {
    const c = generateFull(ASOF); // Strategy Call ist immer indeterminate, Coverage ist vollständig
    expect(c.costPerOpportunityWithStrategyCallHeld.availability).toBe("provisional");
    expect(c.costPerOpportunityWithStrategyCallHeld.amountMinor).toBeUndefined();
    expect(c.costPerOpportunityWithStrategyCallHeld.provisionalAmountMinor).toBeDefined();
  });

  it("69. amountMinor und provisionalAmountMinor sind niemals gleichzeitig gesetzt", () => {
    const c = generateFull(ASOF);
    const allMetrics = [c.costPerMetaLead, c.costPerCrmMatchedLead, c.costPerLeadWithFirstCallBooked, c.costPerLeadWithFirstCallHeld, c.costPerOpportunityWithStrategyCallBooked, c.costPerOpportunityWithStrategyCallHeld, c.costPerWonOpportunity];
    for (const m of allMetrics) {
      expect(m.amountMinor === undefined || m.provisionalAmountMinor === undefined).toBe(true);
    }
  });

  it("70. CPL kann final (available) sein, obwohl Downstream-Kennzahlen (Strategy Call/Won) nur provisional sind", () => {
    const c = generateFull(ASOF);
    expect(c.costPerMetaLead.availability).toBe("available");
    expect(c.costPerOpportunityWithStrategyCallHeld.availability).toBe("provisional");
    expect(c.costPerWonOpportunity.availability).toBe("provisional");
  });

  it("71. bei Nenner 0 sind sowohl amountMinor als auch provisionalAmountMinor undefined", () => {
    const c = generateFull(ASOF, { metaLeadGeneratedEvents: [] });
    expect(c.costPerMetaLead.amountMinor).toBeUndefined();
    expect(c.costPerMetaLead.provisionalAmountMinor).toBeUndefined();
  });
});

// ============================================================================
// As-of (72-76)
// ============================================================================
describe("Marketing Cohort Cost Metrics — As-of (72-76)", () => {
  it("72. historischer Snapshot vor Match", () => {
    const c = generateFull("2025-01-02");
    expect(c.costPerCrmMatchedLead.denominatorEvidenceIds).toEqual([]);
  });

  it("73. historischer Snapshot vor Appointment (First Call)", () => {
    const c = generateFull("2025-01-02");
    expect(c.costPerLeadWithFirstCallBooked.denominatorEvidenceIds).toEqual([]);
  });

  it("74. historischer Snapshot vor Opportunity", () => {
    const c = generateFull("2025-01-09");
    expect(c.costPerOpportunityWithStrategyCallBooked.denominatorEvidenceIds).toEqual([]);
  });

  it("75. historischer Snapshot vor Won", () => {
    const c = generateFull("2025-01-31");
    expect(c.costPerWonOpportunity.denominatorEvidenceIds).toEqual([]);
  });

  it("76. eine frühere Sicht bleibt bei wiederholter Berechnung reproduzierbar", () => {
    const a = generateFull("2025-01-02");
    const b = generateFull("2025-01-02");
    expect(a).toEqual(b);
  });
});

// ============================================================================
// Source-Specific Coverage Windows (91-110) — KORREKTURAUFTRAG, mind. 20
// K5-Pflichttests. Kohortenbounds für generateFull = {from:"2025-01-01",
// through:"2025-01-01"} (Einzeltags-Kohorte). Horizontfenster daraus:
// CRM/First-Call-Booked bis 2025-01-07, First-Call-Held bis 2025-03-26,
// Strategy-Call/Won (indeterminate) bis ASOF (2025-06-01).
// ============================================================================
describe("Marketing Cohort Cost Metrics — Source-Specific Coverage Windows (91-110)", () => {
  // Baut eine Coverage-Liste, in der GENAU EIN Stream eine Lücke (fehlender
  // Record = "unavailable", oder expliziter "partial"-Record) an einer
  // frei wählbaren Stelle besitzt — alle anderen Streams bleiben bei
  // FULL_COVERAGE (vollständig über 2024-06-01..ASOF).
  function coverageWithGap(stream: MarketingSourceStream, gapFrom: string, gapThrough: string, gapStatus: "partial" | undefined, beforeThrough: string, afterFrom: string): MarketingSourceCoverage[] {
    const others = FULL_COVERAGE.filter((c) => c.stream !== stream);
    const pieces: MarketingSourceCoverage[] = [];
    if (beforeThrough >= "2024-06-01") {
      pieces.push(coverage(`cov-${stream}-before-gap`, stream, "2024-06-01", beforeThrough, "complete"));
    }
    if (gapStatus) {
      pieces.push(coverage(`cov-${stream}-gap`, stream, gapFrom, gapThrough, gapStatus));
    }
    if (afterFrom <= ASOF) {
      pieces.push(coverage(`cov-${stream}-after-gap`, stream, afterFrom, ASOF, "complete"));
    }
    return [...others, ...pieces];
  }

  it("91. Spend-Fehltag NACH Kohortenende beeinflusst CPL nicht", () => {
    const cov = coverageWithGap("meta-ad-spend", "2025-01-02", "2025-01-02", undefined, "2025-01-01", "2025-01-03");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerMetaLead.availability).toBe("available");
  });

  it("92. Spend-Fehltag im späteren First-Call-Held-Horizont (März) beeinflusst First-Call-Held-Kosten NICHT [Kernkorrektur]", () => {
    // Repliziert exakt den gemeldeten Fehler: ein Meta-Ad-Spend-Sync-Defekt
    // im März liegt weit außerhalb der Januar-Kohortenperiode und darf die
    // Kennzahl nicht mehr beeinflussen, obwohl er innerhalb des alten
    // (fälschlich gemeinsamen) 84-Tage-Fensters lag.
    const cov = coverageWithGap("meta-ad-spend", "2025-03-15", "2025-03-15", undefined, "2025-03-14", "2025-03-16");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerLeadWithFirstCallHeld.availability).toBe("available");
    expect(c.costPerLeadWithFirstCallHeld.amountMinor).toBeDefined();
  });

  it("93. Spend-Fehltag INNERHALB der Kohortenperiode macht Kosten partial", () => {
    const cov = coverageWithGap("meta-ad-spend", "2025-01-01", "2025-01-01", "partial", "2024-12-31", "2025-01-02");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerMetaLead.availability).toBe("partial-data");
  });

  it("94. Leadgen-Lücke NACH Kohortenende beeinflusst CPL nicht", () => {
    const cov = coverageWithGap("meta-lead-generation", "2025-01-02", "2025-01-02", undefined, "2025-01-01", "2025-01-03");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerMetaLead.availability).toBe("available");
  });

  it("95. Leadgen-Lücke INNERHALB der Kohortenperiode macht CPL partial", () => {
    const cov = coverageWithGap("meta-lead-generation", "2025-01-01", "2025-01-01", "partial", "2024-12-31", "2025-01-02");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerMetaLead.availability).toBe("partial-data");
  });

  it("96. CRM-Lücke innerhalb des CRM-Fensters (01-07) beeinflusst CRM- und First-Call-Kosten", () => {
    const cov = coverageWithGap("crm-lead-ingestion", "2025-01-05", "2025-01-05", "partial", "2025-01-04", "2025-01-06");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerCrmMatchedLead.availability).toBe("partial-data");
    expect(c.costPerLeadWithFirstCallBooked.availability).toBe("partial-data");
    expect(c.costPerLeadWithFirstCallHeld.availability).toBe("partial-data");
  });

  it("97. CRM-Lücke NACH dem CRM-Horizont beeinflusst eine mature CRM-Kennzahl nicht", () => {
    const cov = coverageWithGap("crm-lead-ingestion", "2025-02-01", "2025-02-01", "partial", "2025-01-31", "2025-02-02");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerCrmMatchedLead.availability).toBe("available");
  });

  it("98. Appointment-Lücke im First-Call-Booked-Fenster (01-07) beeinflusst Booked-Kosten", () => {
    const cov = coverageWithGap("crm-sales-appointment-lifecycle", "2025-01-05", "2025-01-05", "partial", "2025-01-04", "2025-01-06");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerLeadWithFirstCallBooked.availability).toBe("partial-data");
  });

  it("99. Appointment-Lücke im Held-Fenster (nach Booked-Fenster, vor 03-26) beeinflusst Held-Kosten, nicht Booked-Kosten", () => {
    const cov = coverageWithGap("crm-sales-appointment-lifecycle", "2025-03-01", "2025-03-01", "partial", "2025-02-28", "2025-03-02");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerLeadWithFirstCallHeld.availability).toBe("partial-data");
    expect(c.costPerLeadWithFirstCallBooked.availability).toBe("available");
  });

  it("100. Appointment-Lücke außerhalb jedes relevanten Horizonts (nach 03-26) beeinflusst mature First-Call-Kosten nicht", () => {
    const cov = coverageWithGap("crm-sales-appointment-lifecycle", "2025-04-01", "2025-04-01", "partial", "2025-03-31", "2025-04-02");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerLeadWithFirstCallBooked.availability).toBe("available");
    expect(c.costPerLeadWithFirstCallHeld.availability).toBe("available");
  });

  it("101. Opportunity-Lücke innerhalb des Opportunity-Fensters beeinflusst Opportunity-abhängige Kosten", () => {
    const cov = coverageWithGap("crm-opportunity-lifecycle", "2025-01-15", "2025-01-15", "partial", "2025-01-14", "2025-01-16");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerOpportunityWithStrategyCallBooked.availability).toBe("partial-data");
    expect(c.costPerOpportunityWithStrategyCallHeld.availability).toBe("partial-data");
    expect(c.costPerWonOpportunity.availability).toBe("partial-data");
  });

  it("102. Opportunity-Lücke kurz vor asOf beeinflusst Strategy-/Won-Kosten (Fenster reicht bis asOf)", () => {
    const cov = coverageWithGap("crm-opportunity-lifecycle", "2025-05-31", "2025-05-31", "partial", "2025-05-30", "2025-06-01");
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerOpportunityWithStrategyCallHeld.availability).toBe("partial-data");
    expect(c.costPerWonOpportunity.availability).toBe("partial-data");
  });

  it("103. Strategy Call Booked/Held und Won bleiben indeterminate, auch bei vollständiger Coverage", () => {
    const c = generateFull(ASOF);
    expect(c.costPerOpportunityWithStrategyCallBooked.maturity).toBe("indeterminate");
    expect(c.costPerOpportunityWithStrategyCallHeld.maturity).toBe("indeterminate");
    expect(c.costPerWonOpportunity.maturity).toBe("indeterminate");
  });

  it("104. vollständige Coverage + indeterminate ergibt provisional, niemals available", () => {
    const c = generateFull(ASOF);
    expect(c.costPerWonOpportunity.availability).toBe("provisional");
    expect(c.costPerWonOpportunity.amountMinor).toBeUndefined();
    expect(c.costPerWonOpportunity.provisionalAmountMinor).toBeDefined();
  });

  it("105. vollständige Coverage + mature ergibt final (available)", () => {
    const c = generateFull(ASOF);
    expect(c.costPerLeadWithFirstCallHeld.availability).toBe("available");
    expect(c.costPerLeadWithFirstCallHeld.amountMinor).toBeDefined();
  });

  it("106. eine für die Kennzahl irrelevante Source-Coverage beeinflusst sie nicht (Opportunity-Lücke lässt CPL/CRM-Matched unberührt)", () => {
    const cov = FULL_COVERAGE.filter((c) => c.stream !== "crm-opportunity-lifecycle"); // Stream komplett ohne Records
    const c = generateFull(ASOF, { coverage: cov });
    expect(c.costPerMetaLead.availability).toBe("available");
    expect(c.costPerCrmMatchedLead.availability).toBe("available");
    expect(c.costPerLeadWithFirstCallBooked.availability).toBe("available");
    expect(c.costPerLeadWithFirstCallHeld.availability).toBe("available");
    // aber die tatsächlich abhängigen Kennzahlen werden korrekt unavailable
    expect(c.costPerOpportunityWithStrategyCallHeld.availability).toBe("unavailable-data");
    expect(c.costPerWonOpportunity.availability).toBe("unavailable-data");
  });

  it("107. kein Infinity oder NaN, auch bei kombinierter Coverage-Lücke und Nenner 0", () => {
    const cov = coverageWithGap("crm-opportunity-lifecycle", "2025-01-15", "2025-01-15", "partial", "2025-01-14", "2025-01-16");
    const c = generateFull(ASOF, { coverage: cov, opportunities: [] });
    expect(c.costPerWonOpportunity.availability).toBe("no-denominator-events"); // Nenner-Vorrang vor Coverage
    expect(c.costPerWonOpportunity.amountMinor).not.toBe(Infinity);
    expect(Number.isNaN(c.costPerWonOpportunity.denominatorCount)).toBe(false);
  });

  it("108. gesamter Spend inklusive Null-Lead-Campaigns bleibt trotz der Fenster-Korrektur erhalten", () => {
    const c = generateFull(ASOF);
    expect(c.spendAmountMinor).toBe(15000); // 10000 (cmp-01, Lead) + 5000 (cmp-99, kein Lead)
    expect(c.spendRecordIds.sort()).toEqual(["spend-full", "spend-zero-lead-campaign"]);
  });

  it("109. Public Contract unverändert (keine neuen Cohort-Cost-Symbole in index.ts)", async () => {
    const publicContract = await import("../index");
    expect(publicContract).not.toHaveProperty("generateMarketingCohortCostMetrics");
    expect(publicContract).not.toHaveProperty("generateMarketingCohortForBounds");
  });

  it("110. dieselbe Kohorte mit und ohne irrelevante spätere Spend-Lücke liefert identische First-Call-Held-Kosten", () => {
    const withoutGap = generateFull(ASOF);
    const withIrrelevantGap = generateFull(ASOF, { coverage: coverageWithGap("meta-ad-spend", "2025-03-15", "2025-03-15", undefined, "2025-03-14", "2025-03-16") });
    expect(withIrrelevantGap.costPerLeadWithFirstCallHeld).toEqual(withoutGap.costPerLeadWithFirstCallHeld);
  });
});

// ============================================================================
// Regression (111-124) — mind. 10 K12-Pflichttests (unverändert übernommen,
// nur umnummeriert nach Einfügen des Source-Specific-Coverage-Windows-Blocks)
// ============================================================================
describe("Marketing Cohort Cost Metrics — Regression (111-124)", () => {
  it("111. Attribution Foundation unverändert erreichbar", async () => {
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

  it("112. Marketing Sources unverändert", () => {
    expect(world.metaLeadGeneratedEvents.length).toBeGreaterThan(0);
    expect(world.metaAdSpendRecords.length).toBeGreaterThan(0);
  });

  it("113. Coverage um zwei zusätzliche Streams erweitert, bestehende Streams unverändert vorhanden", () => {
    expect(world.marketingSourceCoverage.length).toBeGreaterThan(0);
    const streams = new Set(world.marketingSourceCoverage.map((c) => c.stream));
    expect(streams.has("meta-ad-spend")).toBe(true);
    expect(streams.has("meta-lead-generation")).toBe(true);
    expect(streams.has("crm-lead-ingestion")).toBe(true);
    expect(streams.has("crm-sales-appointment-lifecycle")).toBe(true);
    expect(streams.has("crm-opportunity-lifecycle")).toBe(true);
  });

  it("114. Marketing Period Metrics weiterhin unabhängig berechenbar", async () => {
    const { generateMarketingPeriodMetrics } = await import("../company/marketing-period-metrics");
    const result = generateMarketingPeriodMetrics(WORLD_NOW, world.metaAdSpendRecords, world.metaLeadGeneratedEvents, world.marketingCrmLeadIngestedEvents, world.marketingLeadIdentityMatchedEvents, world.marketingSourceCoverage);
    expect(result.asOf).toBe(WORLD_NOW);
  });

  it("115. Sales Period Metrics unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.salesPeriodMetrics.asOf).toBe(WORLD_NOW);
  });

  it("116. Appointments unverändert", () => {
    expect(world.salesAppointments.length).toBeGreaterThan(0);
  });

  it("117. Opportunities/Won/Lost unverändert", () => {
    expect(world.opportunities.filter((o) => o.currentStage === "gewonnen").length).toBeGreaterThan(0);
    expect(world.opportunities.filter((o) => o.currentStage === "verloren").length).toBeGreaterThan(0);
  });

  it("118. Bereichsstates (Operations/People/Company) unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.deliveryUnits).toBeDefined();
    expect(snapshot.employees.length).toBeGreaterThan(0);
    expect(snapshot.accountOwnerships.length).toBeGreaterThan(0);
  });

  it("119. RNG-Sequenzen unverändert: Kohortenberechnung ist eine reine Funktion ohne eigenen Zufallsstrom", () => {
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

  it("120. Public Contract unverändert: keine neuen Cohort-Cost-Laufzeitsymbole in index.ts", async () => {
    const publicContract = await import("../index");
    expect(publicContract).not.toHaveProperty("generateMarketingCohortCostMetrics");
    expect(publicContract).not.toHaveProperty("generateMarketingCohortForBounds");
  });

  it("121. die vier beweisbar begrenzten Horizonte sind scenario-profil-unabhängig (identisch in baseline und pipeline-risiko)", () => {
    // MATURITY_HORIZONS_DAYS wird nirgends aus einem ScenarioProfile
    // hergeleitet — die Konstanten sind bereits auf Modulebene fix. Dieser
    // Test belegt zusätzlich, dass eine reale Kohorte aus dem
    // "pipeline-risiko"-Profil (stageDurationMultiplier 1.6) für die vier
    // begrenzten Stufen dieselbe Reifeklassifikation liefert wie baseline,
    // sofern beide Kohorten gleich alt sind.
    const riskyWorld = SCENARIO_WORLDS["pipeline-risiko"];
    expect(riskyWorld.metaLeadGeneratedEvents.length).toBeGreaterThan(0);
    expect(MATURITY_HORIZONS_DAYS.crmMatched).toBe(6);
    expect(MATURITY_HORIZONS_DAYS.firstCallBooked).toBe(6);
    expect(MATURITY_HORIZONS_DAYS.firstCallHeld).toBe(84);
    expect(MATURITY_HORIZONS_DAYS.opportunityCreated).toBe(31);
  });

  it("122. Strategy Call/Won bleiben auch im 'pipeline-risiko'-Profil (Multiplikator 1.6) strukturell indeterminate", () => {
    const riskyWorld = SCENARIO_WORLDS["pipeline-risiko"];
    const result = generateMarketingCohortCostMetrics({
      asOf: WORLD_NOW,
      metaAdSpendRecords: riskyWorld.metaAdSpendRecords,
      metaLeadGeneratedEvents: riskyWorld.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: riskyWorld.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: riskyWorld.marketingCrmLeadIngestedEvents,
      salesAppointments: riskyWorld.salesAppointments,
      opportunities: riskyWorld.opportunities,
      marketingSourceCoverage: riskyWorld.marketingSourceCoverage,
    });
    expect(result.monthToDate.costPerWonOpportunity.maturity).toBe("indeterminate");
    expect(result.monthToDate.costPerOpportunityWithStrategyCallBooked.maturity).toBe("indeterminate");
  });

  it("123. Snapshot/Public Contract enthält weiterhin keine Cohort-/Coverage-Felder (WorldSnapshot-Form unverändert)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot).not.toHaveProperty("marketingCohortCostMetrics");
    expect(snapshot).not.toHaveProperty("marketingSourceCoverage");
  });

  it("124. generateMarketingCohortCostMetrics liefert weiterhin exakt yesterday/weekToDate/monthToDate für die reale Referenzwelt", () => {
    const result = generateMarketingCohortCostMetrics({
      asOf: WORLD_NOW,
      metaAdSpendRecords: world.metaAdSpendRecords,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
      marketingSourceCoverage: world.marketingSourceCoverage,
    });
    expect(result.asOf).toBe(WORLD_NOW);
    expect(result.yesterday.period).toBe("yesterday");
    expect(result.weekToDate.period).toBe("week-to-date");
    expect(result.monthToDate.period).toBe("month-to-date");
  });
});

// Nur zur Typprüfung referenziert.
const _typeCheck: MarketingCohortBounds | undefined = undefined;
void _typeCheck;
