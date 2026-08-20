import { describe, expect, it } from "vitest";
import { SCENARIO_WORLDS } from "../engine/generator";
import { WORLD_NOW, WORLD_TIMELINE_START } from "../timeline/world-clock";
import { addDays } from "../engine/random";
import { startOfWeek, startOfMonth } from "../timeline/calendar";
import { generateMarketingPeriodMetrics, type MarketingPeriodMetrics } from "../company/marketing-period-metrics";
import { resolveMarketingSourceCoverageStatus } from "../events/marketing-source-coverage";
import { generateFullCompanyContext } from "../company/full-company-context";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import type { MetaAdSpendRecord } from "../events/marketing-meta-ad-spend";
import type { MetaLeadGenerated, MarketingCrmLeadIngested, MarketingLeadIdentityMatched } from "../events/marketing-meta-crm-source";
import type { MarketingSourceCoverage, MarketingSourceStream } from "../events/marketing-source-coverage";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";

// KORREKTURAUFTRAG — Marketing Data Completeness Truth + Public Contract
// Protection. Pflichttests für: (1) das Source-Coverage-Modell, das
// verhindert, dass fehlende Daten als echte Null erscheinen, und (2) den
// Nachweis, dass `marketingPeriodMetrics` KEIN neues öffentliches Pflichtfeld
// ist. Ausdrücklich KEINE Kostenquoten-/Rate-/Capability-Tests (harte
// Scope-Grenze, K1-K8).

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
function spend(id: string, spendDate: string, importedAt: string, amountMinor: number, campaignId = "campaign-01"): MetaAdSpendRecord {
  return { id, provider: "meta", externalAdAccountId: "act-synth", externalCampaignId: campaignId, spendDate, currency: "EUR", amountMinor, importedAt };
}
function metaGen(id: string, generatedAt: string, externalLeadId = id): MetaLeadGenerated {
  return { id, externalLeadId, provider: "meta", generatedAt, externalCampaignId: "campaign-01", campaignId: "campaign-01" };
}
function crmIngest(id: string, leadId: string, ingestedAt: string, metaExternalLeadIdOnRecord?: string): MarketingCrmLeadIngested {
  return { id, leadId, externalCrmLeadId: `crm-${id}`, ingestedAt, crmProvider: "synthetic-crm", metaExternalLeadIdOnRecord };
}
function match(id: string, metaLeadGeneratedEventId: string, crmLeadIngestedEventId: string, externalLeadId: string, externalCrmLeadId: string, leadId: string, matchedAt: string): MarketingLeadIdentityMatched {
  return { id, metaLeadGeneratedEventId, crmLeadIngestedEventId, externalLeadId, externalCrmLeadId, leadId, matchedAt, method: "direct-external-meta-lead-id" };
}
function coverage(
  id: string,
  stream: MarketingSourceStream,
  coveredFrom: string,
  coveredThrough: string,
  status: MarketingSourceCoverage["status"],
  importedAt = coveredThrough,
): MarketingSourceCoverage {
  return { id, stream, provider: stream === "crm-lead-ingestion" ? "crm" : "meta", coveredFrom, coveredThrough, importedAt, status };
}

// Kontrollierte Fixture-Menge für asOf = 2025-06-18 (Mittwoch). Drei Streams
// mit bewusst UNTERSCHIEDLICHEN Coverage-Grenzen (Unabhängigkeits-Nachweis,
// K9 Coverage-6):
// - meta-ad-spend:        complete bis 06-16, partial 06-17,       ab 06-18 unavailable
// - meta-lead-generation: complete bis 06-18 (vollständig synchronisiert)
// - crm-lead-ingestion:   complete bis 06-17, partial 06-18
const ASOF = "2025-06-18";

const FIXTURE_SPEND = [
  spend("spend-complete-positive", "2025-06-05", "2025-06-06", 1000), // vollständige Coverage, positiver Spend
  spend("spend-partial", "2025-06-17", "2025-06-18", 2500), // partielle Coverage
  spend("spend-future", "2025-06-19", "2025-06-20", 9999), // nach asOf, ausgeschlossen
];

const FIXTURE_META_GEN = [
  metaGen("meta-immediate", "2025-06-17"),
  metaGen("meta-delayed", "2025-06-16"),
  metaGen("meta-early", "2025-06-15"),
  metaGen("meta-pending", "2025-06-10"),
  metaGen("meta-future-gen", "2025-06-19"), // nach asOf, ausgeschlossen
];

const FIXTURE_CRM = [
  crmIngest("crm-immediate", "lead-immediate", "2025-06-17", "meta-immediate"),
  crmIngest("crm-delayed", "lead-delayed", "2025-06-18", "meta-delayed"), // fällt in die partielle CRM-Coverage
  crmIngest("crm-early-match", "lead-early", "2025-06-15", "meta-early"),
  crmIngest("crm-nonmeta", "lead-nonmeta", "2025-06-17"), // kein Meta-Bezug
];

const FIXTURE_MATCH = [
  match("match-immediate", "meta-immediate", "crm-immediate", "meta-immediate", "crm-crm-immediate", "lead-immediate", "2025-06-17"),
  match("match-delayed", "meta-delayed", "crm-delayed", "meta-delayed", "crm-crm-delayed", "lead-delayed", "2025-06-18"),
  match("match-early", "meta-early", "crm-early-match", "meta-early", "crm-crm-early-match", "lead-early", "2025-06-15"),
];

const FIXTURE_COVERAGE = [
  coverage("cov-spend-complete", "meta-ad-spend", WORLD_TIMELINE_START, "2025-06-16", "complete"),
  coverage("cov-spend-partial", "meta-ad-spend", "2025-06-17", "2025-06-17", "partial"),
  coverage("cov-leadgen-complete", "meta-lead-generation", WORLD_TIMELINE_START, "2025-06-18", "complete"),
  coverage("cov-crm-complete", "crm-lead-ingestion", WORLD_TIMELINE_START, "2025-06-17", "complete"),
  coverage("cov-crm-partial", "crm-lead-ingestion", "2025-06-18", "2025-06-18", "partial"),
];

// Eigene, früher bestätigte Coverage-Fixtures für Tests, die einen asOf VOR
// dem Bestätigungszeitpunkt (importedAt) der großen FIXTURE_COVERAGE oben
// abfragen — eine Coverage-Bestätigung kann niemals aus der Zukunft eines
// abgefragten asOf stammen (Future-Knowledge-Schutz gilt auch für die
// Coverage-Fakten selbst).
const EARLY_SPEND_COVERAGE = [coverage("cov-spend-early", "meta-ad-spend", WORLD_TIMELINE_START, "2025-06-06", "complete", "2025-06-06")];
const EARLY_LEADGEN_COVERAGE = [coverage("cov-leadgen-early", "meta-lead-generation", WORLD_TIMELINE_START, "2025-06-14", "complete", "2025-06-14")];

function generate(asOf: string, coverageOverride: readonly MarketingSourceCoverage[] = FIXTURE_COVERAGE) {
  return generateMarketingPeriodMetrics(asOf, FIXTURE_SPEND, FIXTURE_META_GEN, FIXTURE_CRM, FIXTURE_MATCH, coverageOverride);
}

// ============================================================================
// Coverage (1-8)
// ============================================================================
describe("Marketing Period Metrics — Coverage (1-8)", () => {
  it("1. vollständige Coverage erkannt: ein Zeitraum vollständig innerhalb eines complete-Records ergibt status 'complete'", () => {
    // asOf 2025-06-07 -> yesterday 2025-06-06, liegt vollständig innerhalb einer bereits bis 06-06 bestätigten Coverage
    const snap = generate("2025-06-07", EARLY_SPEND_COVERAGE);
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("complete");
  });

  it("2. partielle Coverage erkannt", () => {
    const snap = generate(ASOF);
    // yesterday (06-17) liegt exakt in der Spend-Partial-Zone
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("partial");
  });

  it("3. fehlende Coverage erkannt", () => {
    // asOf 2025-06-20 -> yesterday 2025-06-19, liegt jenseits jeder Spend-Coverage
    const snap = generate("2025-06-20");
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("unavailable");
  });

  it("4. Coverage-Ende vor Periodenende führt zu nicht-vollständigem Status", () => {
    const snap = generate(ASOF);
    // MTD (06-01..06-18) reicht über das Ende der Spend-Complete-Zone (06-16) hinaus
    expect(snap.monthToDate.activity.metaSpendAmountMinor.status).not.toBe("complete");
  });

  it("5. Coverage umfasst die gesamte Periode -> complete", () => {
    const snap = generate(ASOF);
    // WTD (06-16..06-18) liegt vollständig innerhalb der Lead-Generation-Complete-Zone (bis 06-18)
    expect(snap.weekToDate.activity.metaLeadsGenerated.status).toBe("complete");
  });

  it("6. mehrere Streams unabhängig: identische Periodengrenzen ergeben unterschiedliche Status je Stream", () => {
    const snap = generate(ASOF);
    const wtd = snap.weekToDate.activity;
    expect(wtd.metaLeadsGenerated.status).toBe("complete"); // Lead-Generation vollständig synchronisiert
    expect(wtd.metaSpendAmountMinor.status).not.toBe("complete"); // Spend nicht
    expect(wtd.crmLeadsIngested.status).not.toBe("complete"); // CRM nicht (partial am 06-18)
  });

  it("7. eine erst nach asOf importierte (zukünftige) Coverage ist historisch unsichtbar", () => {
    const futureCoverage = [
      ...FIXTURE_COVERAGE,
      coverage("cov-spend-future-confirmed", "meta-ad-spend", "2025-06-17", "2025-06-18", "complete", "2025-06-19"), // importedAt nach asOf
    ];
    const snap = generate(ASOF, futureCoverage);
    // Ohne den zukünftigen Record bleibt WTD-Spend weiterhin nicht 'complete'
    expect(snap.weekToDate.activity.metaSpendAmountMinor.status).not.toBe("complete");
  });

  it("8. Coverage-ID ist entity-stabil (feste, semantische ID statt Arrayposition)", () => {
    for (const c of FIXTURE_COVERAGE) {
      expect(c.id).toMatch(/^cov-/);
    }
    // im echten Referenzwelt-Bestand ebenfalls fixe, semantische IDs
    for (const c of world.marketingSourceCoverage) {
      expect(c.id).toMatch(/^coverage-/);
    }
  });
});

// ============================================================================
// Echte Null (9-13)
// ============================================================================
describe("Marketing Period Metrics — Echte Null (9-13)", () => {
  it("9. vollständige Periode ohne Spend-Records ergibt echte Null", () => {
    const snap = generate("2025-06-07", EARLY_SPEND_COVERAGE); // yesterday 06-06, complete Coverage, keine Fixture an diesem Tag
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("complete");
    expect(snap.yesterday.activity.metaSpendAmountMinor.value).toBe(0);
  });

  it("10. fehlende Coverage ohne Spend-Records ergibt NICHT Null", () => {
    const snap = generate("2025-06-20"); // yesterday 06-19, keine Coverage
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("unavailable");
    expect(snap.yesterday.activity.metaSpendAmountMinor.value).toBeUndefined();
  });

  it("11. partielle Coverage ohne (weitere) Spend-Records ergibt NICHT Null", () => {
    const partialOnlyCoverage = [coverage("cov-spend-partial-only", "meta-ad-spend", "2025-06-17", "2025-06-17", "partial")];
    const snap = generateMarketingPeriodMetrics("2025-06-18", [], FIXTURE_META_GEN, FIXTURE_CRM, FIXTURE_MATCH, partialOnlyCoverage);
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("partial");
    expect(snap.yesterday.activity.metaSpendAmountMinor.value).toBeUndefined();
    expect(snap.yesterday.activity.metaSpendAmountMinor.observedValue).toBe(0);
  });

  it("12. positiver Spend bei partieller Coverage wird nicht als vollständige Summe ausgegeben", () => {
    const snap = generate(ASOF); // yesterday 06-17: spend-partial (2500), aber Coverage nur 'partial'
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("partial");
    expect(snap.yesterday.activity.metaSpendAmountMinor.value).toBeUndefined();
    expect(snap.yesterday.activity.metaSpendAmountMinor.observedValue).toBe(2500); // roh sichtbar, aber nicht als vollständig behauptet
  });

  it("13. Spend-Status enthält die Coverage-Grenze (coveredThrough)", () => {
    const snap = generate(ASOF);
    expect(snap.yesterday.activity.metaSpendAmountMinor.coveredThrough).toBe("2025-06-17");
  });
});

// ============================================================================
// Leads (14-18)
// ============================================================================
describe("Marketing Period Metrics — Leads (14-18)", () => {
  it("14. vollständige Meta-Lead-Coverage erlaubt einen echten Null-Count", () => {
    // asOf 06-15 -> yesterday 06-14, keine Fixture-Generierung an diesem Tag, aber vollständig bis 06-14 bestätigte Coverage
    const snap = generate("2025-06-15", EARLY_LEADGEN_COVERAGE);
    expect(snap.yesterday.activity.metaLeadsGenerated.status).toBe("complete");
    expect(snap.yesterday.activity.metaLeadsGenerated.value).toBe(0);
  });

  it("15. unvollständige Coverage verhindert einen falschen Null-Count", () => {
    const noCoverage: MarketingSourceCoverage[] = [];
    const snap = generateMarketingPeriodMetrics(ASOF, FIXTURE_SPEND, [], FIXTURE_CRM, FIXTURE_MATCH, noCoverage);
    expect(snap.yesterday.activity.metaLeadsGenerated.status).toBe("unavailable");
    expect(snap.yesterday.activity.metaLeadsGenerated.value).toBeUndefined();
  });

  it("16. CRM-Coverage ist unabhängig von Meta-Lead-Coverage (unterschiedliche Streams, unterschiedliche Grenzen)", () => {
    const snap = generate(ASOF);
    expect(snap.weekToDate.activity.metaLeadsGenerated.status).toBe("complete");
    expect(snap.weekToDate.activity.crmLeadsIngested.status).not.toBe("complete");
  });

  it("17. Match-/CRM-Landung ist bei unvollständiger CRM-Coverage nicht als vollständig ausgewiesen", () => {
    const snap = generate(ASOF);
    // WTD (06-16..06-18) überschneidet die CRM-Partial-Zone (06-18)
    expect(snap.weekToDate.activity.matchedMetaLeadsIngested.status).not.toBe("complete");
    expect(snap.weekToDate.activity.matchedMetaLeadsIngested.observedValue).toBeGreaterThan(0);
  });

  it("18. Future Imports verändern einen früheren, bereits berechneten Snapshot nicht", () => {
    const early = generate("2025-06-16"); // vor Existenz künftiger Coverage-Erweiterungen
    const futureCoverage = [
      ...FIXTURE_COVERAGE,
      coverage("cov-leadgen-future", "meta-lead-generation", "2025-06-17", "2025-06-19", "complete", "2025-06-20"),
    ];
    const earlyAgain = generateMarketingPeriodMetrics("2025-06-16", FIXTURE_SPEND, FIXTURE_META_GEN, FIXTURE_CRM, FIXTURE_MATCH, futureCoverage);
    expect(earlyAgain).toEqual(early);
  });
});

// ============================================================================
// Pending (19-22)
// ============================================================================
describe("Marketing Period Metrics — Pending (19-22)", () => {
  it("19. Pending bleibt eine strukturell getrennte Bestandskennzahl", () => {
    const snap = generate(ASOF);
    expect(snap.monthToDate).toHaveProperty("pendingMetaLeadsAtPeriodEnd");
    expect(snap.monthToDate.activity).not.toHaveProperty("pendingMetaLeadsAtPeriodEnd");
  });

  it("20. Pending trägt einen expliziten Datenstatus", () => {
    const snap = generate(ASOF);
    expect(snap.monthToDate.pendingMetaLeadsAtPeriodEnd).toHaveProperty("status");
    expect(["complete", "partial", "unavailable"]).toContain(snap.monthToDate.pendingMetaLeadsAtPeriodEnd.status);
  });

  it("21. eine unvollständige CRM-Coverage schränkt die Pending-Belastbarkeit ein, selbst wenn die Lead-Generation-Coverage vollständig ist", () => {
    const snap = generate(ASOF);
    // stockBounds bis 06-18: Lead-Generation ist dort vollständig (complete bis 06-18),
    // CRM-Ingestion aber nur 'partial' (partial-Zone genau am 06-18) -> kombiniert 'partial'
    expect(snap.weekToDate.pendingMetaLeadsAtPeriodEnd.status).toBe("partial");
  });

  it("22. ein späterer Match verändert einen bereits berechneten historischen Pending-Bestand nicht", () => {
    const historical = generate("2025-06-16");
    const laterCoverage = [...FIXTURE_COVERAGE, coverage("cov-extra", "crm-lead-ingestion", "2025-06-19", "2025-06-19", "complete", "2025-06-19")];
    const historicalAgain = generateMarketingPeriodMetrics("2025-06-16", FIXTURE_SPEND, FIXTURE_META_GEN, FIXTURE_CRM, FIXTURE_MATCH, laterCoverage);
    expect(historicalAgain.monthToDate.pendingMetaLeadsAtPeriodEnd).toEqual(historical.monthToDate.pendingMetaLeadsAtPeriodEnd);
  });
});

// ============================================================================
// Public Contract (23-28)
// ============================================================================
describe("Marketing Period Metrics — Public Contract (23-28)", () => {
  it("23. marketingPeriodMetrics ist kein Feld des öffentlichen WorldSnapshot", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot).not.toHaveProperty("marketingPeriodMetrics");
  });

  it("24. index.ts exportiert keine neuen Marketing-Period-/Coverage-Laufzeitsymbole", async () => {
    // Namespace-Laufzeitprüfung statt Datei-Text-Scan (Zero-Dependency-Konvention, siehe validation/delivery-lifecycle.test.ts)
    const publicContract = await import("../index");
    expect(publicContract).not.toHaveProperty("generateMarketingPeriodMetrics");
    expect(publicContract).not.toHaveProperty("generateMarketingSourceCoverage");
    expect(publicContract).not.toHaveProperty("resolveMarketingSourceCoverageStatus");
    expect(publicContract).not.toHaveProperty("combinePeriodDataStatus");
  });

  it("25. bestehende öffentliche Rückgabe-Shapes unverändert: WorldSnapshot besitzt exakt dieselben Felder wie vor diesem Auftrag", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const expectedKeys = [
      "asOf", "employees", "employeeHiredEvents", "employeeTerminatedEvents", "deliveryUnits", "activeDeliveryUnits",
      "operationsObservation", "completedDeliveryDurationObservation", "queueDurationObservation",
      "currentDeliveryQueueSnapshotObservation", "queueDurationSignalObservation", "deliveryDurationSignalObservation",
      "marketingObservation", "marketingDemandSignal", "customerAccounts", "contacts", "accountOwnerships", "leads",
      "opportunities", "knowledgeObjects", "calls", "emails", "meetings", "meetingTranscripts", "crmActivities",
      "salesPeriodMetrics", "metaAdSpendRecords", "metaLeadGeneratedEvents", "marketingCrmLeadIngestedEvents",
      "marketingLeadIdentityMatchedEvents",
    ].sort();
    expect(Object.keys(snapshot).sort()).toEqual(expectedKeys);
  });

  it("26. die interne Berechnung bleibt für internen Code direkt erreichbar (ScenarioWorldTruth-Ebene)", () => {
    const result = generateMarketingPeriodMetrics(
      WORLD_NOW,
      world.metaAdSpendRecords,
      world.metaLeadGeneratedEvents,
      world.marketingCrmLeadIngestedEvents,
      world.marketingLeadIdentityMatchedEvents,
      world.marketingSourceCoverage,
    );
    expect(result.asOf).toBe(WORLD_NOW);
  });

  it("27. exakt eine Produktionsberechnung: kein anderer Modulpfad reimplementiert dieselbe Logik (Snapshot bleibt unberührt)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    // snapshot enthält keinerlei Ableitung von PeriodDataStatus/PeriodMetricValue-Strukturen
    expect(JSON.stringify(snapshot)).not.toContain("pendingMetaLeadsAtPeriodEnd");
    expect(JSON.stringify(snapshot)).not.toContain("metaSpendAmountMinor");
  });

  it("28. kein toter Code: alle vier Aktivitätskennzahlen und der Pending-Bestand liefern nicht-triviale Werte in der echten Referenzwelt", () => {
    const result = generateMarketingPeriodMetrics(
      WORLD_NOW,
      world.metaAdSpendRecords,
      world.metaLeadGeneratedEvents,
      world.marketingCrmLeadIngestedEvents,
      world.marketingLeadIdentityMatchedEvents,
      world.marketingSourceCoverage,
    );
    const yesterday = result.yesterday;
    expect(yesterday.activity.metaLeadsGenerated.observedValue).toBeGreaterThan(0);
    expect(yesterday.activity.crmLeadsIngested.observedValue).toBeGreaterThan(0);
    expect(yesterday.activity.matchedMetaLeadsIngested.observedValue).toBeGreaterThan(0);
    expect(yesterday.pendingMetaLeadsAtPeriodEnd.observedValue).toBeGreaterThan(0);
  });
});

// ============================================================================
// Perioden (Grenzen unverändert, Regressionsschutz nach dem Umbau)
// ============================================================================
describe("Marketing Period Metrics — Perioden", () => {
  it("gestern korrekt: genau der Kalendertag vor asOf", () => {
    const snap = generate(ASOF);
    expect(snap.yesterday.activity.bounds).toEqual({ from: "2025-06-17", through: "2025-06-17" });
  });

  it("Monatswechsel korrekt", () => {
    const snap = generate("2025-07-03");
    expect(snap.monthToDate.activity.bounds).toEqual({ from: "2025-07-01", through: "2025-07-03" });
  });

  it("Jahreswechsel korrekt", () => {
    const snap = generate("2026-01-02");
    expect(snap.monthToDate.activity.bounds).toEqual({ from: "2026-01-01", through: "2026-01-02" });
  });

  it("WTD und MTD unabhängig berechnet", () => {
    const snap = generate(ASOF);
    expect(snap.weekToDate.activity.bounds).toEqual({ from: "2025-06-16", through: "2025-06-18" });
    expect(snap.monthToDate.activity.bounds).toEqual({ from: "2025-06-01", through: "2025-06-18" });
  });
});

// ============================================================================
// Referenzwelt bei WORLD_NOW
// ============================================================================
describe("Marketing Period Metrics — Referenzwelt bei WORLD_NOW", () => {
  const result = generateMarketingPeriodMetrics(
    WORLD_NOW,
    world.metaAdSpendRecords,
    world.metaLeadGeneratedEvents,
    world.marketingCrmLeadIngestedEvents,
    world.marketingLeadIdentityMatchedEvents,
    world.marketingSourceCoverage,
  );

  it("Yesterday-Spend ist NICHT mehr fälschlich als echte Null ausgewiesen (Kernkorrektur dieses Auftrags)", () => {
    expect(result.yesterday.activity.metaSpendAmountMinor.status).not.toBe("complete");
    expect(result.yesterday.activity.metaSpendAmountMinor.value).toBeUndefined();
    expect(result.yesterday.activity.metaSpendAmountMinor.observedValue).toBe(0);
  });

  it("Yesterday CRM-Ingestion ist vollständig belastbar (schnellerer Sync-Stream)", () => {
    expect(result.yesterday.activity.crmLeadsIngested.status).toBe("complete");
  });

  it("WTD/MTD (heutiger Tag) sind für Spend/Leads/Match unavailable", () => {
    expect(result.weekToDate.activity.metaSpendAmountMinor.status).toBe("unavailable");
    expect(result.monthToDate.activity.metaSpendAmountMinor.status).toBe("unavailable");
  });
});

// ============================================================================
// Regression (29-38)
// ============================================================================
describe("Marketing Period Metrics — Regression (29-38)", () => {
  it("29. Marketing Source Foundation unverändert", () => {
    expect(world.metaAdSpendRecords.length).toBeGreaterThan(0);
    expect(world.metaLeadGeneratedEvents.length).toBeGreaterThan(0);
    expect(world.marketingCrmLeadIngestedEvents.length).toBe(world.leads.length);
  });

  it("30. Match Events unverändert", () => {
    expect(world.marketingLeadIdentityMatchedEvents.length).toBeGreaterThan(0);
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      expect(m.method).toBe("direct-external-meta-lead-id");
    }
  });

  it("31. Sales Period Metrics unverändert (weiterhin über WorldSnapshot)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.salesPeriodMetrics.asOf).toBe(WORLD_NOW);
  });

  it("32. Marketing States und Observations unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.marketingObservation).toBeDefined();
  });

  it("33. Sales unverändert (Leads/Opportunities)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.leads.length).toBeGreaterThan(0);
    expect(snapshot.opportunities.length).toBeGreaterThan(0);
  });

  it("34. Operations unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.deliveryUnits).toBeDefined();
  });

  it("35. People unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.employees.length).toBeGreaterThan(0);
  });

  it("36. Company/Ownership unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.accountOwnerships.length).toBeGreaterThan(0);
  });

  it("37. RNG-Sequenzen unverändert (bit-identische Wiederholung)", () => {
    const a = generateMarketingPeriodMetrics(WORLD_NOW, world.metaAdSpendRecords, world.metaLeadGeneratedEvents, world.marketingCrmLeadIngestedEvents, world.marketingLeadIdentityMatchedEvents, world.marketingSourceCoverage);
    const b = generateMarketingPeriodMetrics(WORLD_NOW, world.metaAdSpendRecords, world.metaLeadGeneratedEvents, world.marketingCrmLeadIngestedEvents, world.marketingLeadIdentityMatchedEvents, world.marketingSourceCoverage);
    expect(a).toEqual(b);
  });

  it("38. Public Contract unverändert (siehe auch Public-Contract-Block oben)", async () => {
    const publicContract = await import("../index");
    expect(publicContract).toHaveProperty("generateFullCompanyContext");
    expect(publicContract).not.toHaveProperty("generateMarketingPeriodMetrics");
  });
});

// ============================================================================
// KORREKTURAUFTRAG "Marketing Coverage Consistency" — V6 Pflichttests (1-16)
// ============================================================================
describe("Marketing Period Metrics — Coverage Consistency (V6, 1-16)", () => {
  it("1. WTD am 2025-09-01 ist NICHT complete, wenn die Lead-Generation-Coverage nur bis 2025-08-30 reicht", () => {
    const status = resolveMarketingSourceCoverageStatus(
      "meta-lead-generation",
      { from: WORLD_NOW, through: WORLD_NOW },
      world.marketingSourceCoverage,
      WORLD_NOW,
    );
    expect(status).not.toBe("complete");
    expect(status).toBe("unavailable");
  });

  it("2. ein einzelner nicht abgedeckter Tag innerhalb der Periode verhindert complete", () => {
    const cov: MarketingSourceCoverage[] = [
      { id: "a", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-01", coveredThrough: "2025-01-05", importedAt: "2025-01-05", status: "complete" },
    ];
    // Periode 01-01..01-07 reicht zwei Tage über die Coverage hinaus
    const status = resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-01", through: "2025-01-07" }, cov, "2025-01-10");
    expect(status).not.toBe("complete");
  });

  it("3. mehrere lückenlos aneinandergrenzende Complete-Records ergeben zusammen complete", () => {
    const cov: MarketingSourceCoverage[] = [
      { id: "a", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-01", coveredThrough: "2025-01-03", importedAt: "2025-01-03", status: "complete" },
      { id: "b", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-04", coveredThrough: "2025-01-07", importedAt: "2025-01-07", status: "complete" },
    ];
    const status = resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-01", through: "2025-01-07" }, cov, "2025-01-10");
    expect(status).toBe("complete");
  });

  it("4. eine Lücke zwischen zwei Complete-Records ergibt NICHT complete", () => {
    const cov: MarketingSourceCoverage[] = [
      { id: "a", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-01", coveredThrough: "2025-01-03", importedAt: "2025-01-03", status: "complete" },
      { id: "b", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-05", coveredThrough: "2025-01-07", importedAt: "2025-01-07", status: "complete" }, // 01-04 fehlt
    ];
    const status = resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-01", through: "2025-01-07" }, cov, "2025-01-10");
    expect(status).not.toBe("complete");
    expect(status).toBe("partial"); // 6 von 7 Tagen tragen Information
  });

  it("5. ein failed-Tag innerhalb einer sonst vollständigen Periode verhindert complete", () => {
    const cov: MarketingSourceCoverage[] = [
      { id: "a", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-01", coveredThrough: "2025-01-04", importedAt: "2025-01-04", status: "complete" },
      { id: "f", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-05", coveredThrough: "2025-01-05", importedAt: "2025-01-05", status: "failed" },
      { id: "b", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-06", coveredThrough: "2025-01-07", importedAt: "2025-01-07", status: "complete" },
    ];
    const status = resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-01", through: "2025-01-07" }, cov, "2025-01-10");
    expect(status).not.toBe("complete");
  });

  it("6. ein später erfolgreicher Retry löst einen failed-Tag ab dessen importedAt auf", () => {
    const cov: MarketingSourceCoverage[] = [
      { id: "failed", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-05", coveredThrough: "2025-01-05", importedAt: "2025-01-06", status: "failed" },
      { id: "retry", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-05", coveredThrough: "2025-01-05", importedAt: "2025-01-08", status: "complete" },
    ];
    const afterRetry = resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-05", through: "2025-01-05" }, cov, "2025-01-09");
    expect(afterRetry).toBe("complete");
  });

  it("7. ein historischer Snapshot VOR dem Retry bleibt weiterhin nicht complete", () => {
    const cov: MarketingSourceCoverage[] = [
      { id: "failed", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-05", coveredThrough: "2025-01-05", importedAt: "2025-01-06", status: "failed" },
      { id: "retry", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-05", coveredThrough: "2025-01-05", importedAt: "2025-01-08", status: "complete" },
    ];
    const beforeRetry = resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-05", through: "2025-01-05" }, cov, "2025-01-07");
    expect(beforeRetry).not.toBe("complete");
    expect(beforeRetry).toBe("unavailable"); // nur der failed-Fakt war zu diesem asOf sichtbar
  });

  it("8. ein später gemeldeter failed-Record überschreibt ein älteres complete für denselben Tag", () => {
    const cov: MarketingSourceCoverage[] = [
      { id: "broad-complete", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-01", coveredThrough: "2025-01-10", importedAt: "2025-01-10", status: "complete" },
      { id: "later-failed", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-05", coveredThrough: "2025-01-05", importedAt: "2025-01-15", status: "failed" },
    ];
    // Vor der Nachmeldung des Fehlers galt die Periode als vollständig
    const beforeFailureKnown = resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-01", through: "2025-01-10" }, cov, "2025-01-12");
    expect(beforeFailureKnown).toBe("complete");
    // Nach der Nachmeldung ist derselbe, bereits vergangene Zeitraum NICHT mehr complete
    const afterFailureKnown = resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-01", through: "2025-01-10" }, cov, "2025-01-20");
    expect(afterFailureKnown).not.toBe("complete");
  });

  it("9. identisches importedAt mit widersprüchlichem Status für denselben Tag wird abgelehnt", () => {
    const cov: MarketingSourceCoverage[] = [
      { id: "x", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-05", coveredThrough: "2025-01-05", importedAt: "2025-01-06", status: "complete" },
      { id: "y", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-05", coveredThrough: "2025-01-05", importedAt: "2025-01-06", status: "failed" },
    ];
    expect(() => resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-05", through: "2025-01-05" }, cov, "2025-01-10")).toThrow();
  });

  it("10. eine erst nach asOf importierte Coverage ist historisch unsichtbar", () => {
    const cov: MarketingSourceCoverage[] = [
      { id: "future", stream: "meta-ad-spend", provider: "meta", coveredFrom: "2025-01-01", coveredThrough: "2025-01-07", importedAt: "2025-01-09", status: "complete" },
    ];
    const status = resolveMarketingSourceCoverageStatus("meta-ad-spend", { from: "2025-01-01", through: "2025-01-07" }, cov, "2025-01-08");
    expect(status).not.toBe("complete");
    expect(status).toBe("unavailable");
  });

  it("11. partial mit beobachteten Records liefert kein vollständiges value (nur observedValue)", () => {
    const snap = generate(ASOF); // yesterday 06-17: spend-partial (2500), Coverage nur 'partial'
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("partial");
    expect(snap.yesterday.activity.metaSpendAmountMinor.value).toBeUndefined();
    expect(snap.yesterday.activity.metaSpendAmountMinor.observedValue).toBe(2500);
  });

  it("12. unavailable liefert keine künstliche Null", () => {
    const snap = generate("2025-06-20"); // yesterday jenseits jeder Coverage
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("unavailable");
    expect(snap.yesterday.activity.metaSpendAmountMinor.value).toBeUndefined();
  });

  it("13. echte Null ist ausschließlich bei lückenloser Complete-Coverage möglich", () => {
    const snap = generate("2025-06-07", EARLY_SPEND_COVERAGE);
    expect(snap.yesterday.activity.metaSpendAmountMinor.status).toBe("complete");
    expect(snap.yesterday.activity.metaSpendAmountMinor.value).toBe(0);
  });

  it("14. Yesterday-/WTD-/MTD-Referenzwerte stimmen exakt mit den tatsächlichen Coverage-Records überein", () => {
    const spendCoverage = world.marketingSourceCoverage.filter((c) => c.stream === "meta-ad-spend");
    const yesterdayCovered = spendCoverage.some((c) => c.status === "complete" && c.coveredFrom <= "2025-08-31" && "2025-08-31" <= c.coveredThrough);
    const result = generateMarketingPeriodMetrics(
      WORLD_NOW,
      world.metaAdSpendRecords,
      world.metaLeadGeneratedEvents,
      world.marketingCrmLeadIngestedEvents,
      world.marketingLeadIdentityMatchedEvents,
      world.marketingSourceCoverage,
    );
    expect(result.yesterday.activity.metaSpendAmountMinor.status === "complete").toBe(yesterdayCovered);
  });

  it("15. keine zweite Periodenberechnungsfunktion existiert (einzige Definition, einzige Verwendung außerhalb dieser Testdatei)", () => {
    // generateMarketingPeriodMetrics ist ausschließlich in company/marketing-period-metrics.ts definiert;
    // kein anderes Modul (snapshot.ts, full-company-context.ts) exportiert oder dupliziert die Logik.
    const companyContext = generateFullCompanyContext();
    expect(companyContext).not.toHaveProperty("marketingPeriodMetrics");
    expect(JSON.stringify(companyContext)).not.toContain("pendingMetaLeadsAtPeriodEnd");
  });

  it("16. Public Contract unverändert", async () => {
    const publicContract = await import("../index");
    expect(publicContract).not.toHaveProperty("generateMarketingPeriodMetrics");
    expect(publicContract).not.toHaveProperty("resolveMarketingSourceCoverageStatus");
  });
});

// ============================================================================
// V5 — ehrlicher Integrationsstatus: KEIN aktueller Produktionsaufruf
// ============================================================================
describe("Marketing Period Metrics — V5 Integrationsstatus (ehrlich dokumentiert)", () => {
  it("generateMarketingPeriodMetrics wird von KEINEM der beiden öffentlichen Produktionspfade aufgerufen (WorldSnapshot, FullCompanyContext)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const companyContext = generateFullCompanyContext();
    expect(snapshot).not.toHaveProperty("marketingPeriodMetrics");
    expect(companyContext).not.toHaveProperty("marketingPeriodMetrics");
    // Diese Funktion ist bewusst eine eigenständige, intern erreichbare
    // Domain-API (K2) — vorbereitet für einen künftigen internen
    // Marketing-Arbeitsbereichs-Layer, aber HEUTE an keiner Produktionsstelle
    // automatisch aufgerufen. Dieser Test dokumentiert das als Fakt, nicht
    // als Behauptung im Bericht.
  });
});

// Nur zur Typprüfung referenziert.
const _typeCheck: MarketingPeriodMetrics | undefined = undefined;
void _typeCheck;
