import { describe, expect, it } from "vitest";
import { generateScenarioWorld, SCENARIO_WORLDS } from "../engine/generator";
import { SCENARIO_PROFILES, BASELINE_PROFILE } from "../engine/scenario-profiles";
import { WORLD_SEED } from "../engine/seed";
import { WORLD_NOW } from "../timeline/world-clock";
import { addDays } from "../engine/random";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { LEADS, OPPORTUNITIES } from "../events/generate-sales-pipeline";
import { MARKETING_CAMPAIGNS } from "../world/marketing-campaigns";
import { generateMetaAdSpendRecords } from "../events/marketing-meta-ad-spend";
import { generateMetaCrmSource, resolveMarketingLeadMatchStatus } from "../events/marketing-meta-crm-source";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";

// AUFTRAG — Sales Period Metrics Checkpoint + Marketing Meta/CRM Source
// Foundation V1, B12, korrigiert durch KORREKTURAUFTRAG "Temporal Matching
// Truth mit eigenem Match-Event": Pflichttests für die kanonische Roh- und
// Matching-Grundlage (Meta Ad Spend, externe Lead-Generierung,
// CRM-Ingestion, eigenständiges append-only Identity-Match-Event).
// Ausdrücklich KEINE Kosten-KPIs/Raten/Benchmarks/Capability-Tests — nur
// Faktentreue, Kausalität, As-of-Sicherheit, Determinismus und Regression
// (harte Scope-Grenze, siehe B11).

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

const metaLeadById = new Map(world.metaLeadGeneratedEvents.map((e) => [e.id, e]));
const crmIngestedById = new Map(world.marketingCrmLeadIngestedEvents.map((e) => [e.id, e]));
const campaignIds = new Set(MARKETING_CAMPAIGNS.map((c) => c.id));
const externalCampaignIds = new Set(MARKETING_CAMPAIGNS.map((c) => c.externalCampaignId));

// matched Meta-Leads (per Match-Event) — abgeleitet, nicht gespeichert
const matchedMetaLeadIds = new Set(world.marketingLeadIdentityMatchedEvents.map((m) => m.metaLeadGeneratedEventId));
const matchedMetaLeadEvents = world.metaLeadGeneratedEvents.filter((e) => matchedMetaLeadIds.has(e.id));
const pendingMetaLeadEvents = world.metaLeadGeneratedEvents.filter((e) => !matchedMetaLeadIds.has(e.id));

// ============================================================================
// Spend (1-8)
// ============================================================================
describe("Marketing Meta/CRM Source Foundation — Spend (1-8)", () => {
  it("1. keine negativen Beträge", () => {
    for (const r of world.metaAdSpendRecords) {
      expect(r.amountMinor).toBeGreaterThan(0);
    }
  });

  it("2. Beträge sind ganzzahlige Minor Units", () => {
    for (const r of world.metaAdSpendRecords) {
      expect(Number.isInteger(r.amountMinor)).toBe(true);
    }
  });

  it("3. gültige, einzige Währung (EUR)", () => {
    for (const r of world.metaAdSpendRecords) {
      expect(r.currency).toBe("EUR");
    }
  });

  it("4. gültiger Campaign-Bezug", () => {
    for (const r of world.metaAdSpendRecords) {
      expect(externalCampaignIds.has(r.externalCampaignId)).toBe(true);
    }
  });

  it("5. eindeutige Record-IDs", () => {
    const ids = world.metaAdSpendRecords.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("6. spendDate ist strikt vom Importzeitpunkt getrennt (importedAt !== spendDate)", () => {
    for (const r of world.metaAdSpendRecords) {
      expect(r.importedAt).not.toBe(r.spendDate);
      expect(r.importedAt >= r.spendDate).toBe(true);
    }
  });

  it("7. kein Spend-Record nach WORLD_NOW", () => {
    for (const r of world.metaAdSpendRecords) {
      expect(r.spendDate <= WORLD_NOW).toBe(true);
      expect(r.importedAt <= WORLD_NOW).toBe(true);
    }
  });

  it("8. korrekter As-of-Filter: Snapshot(asOf) enthält nur Spend-Records mit spendDate <= asOf", () => {
    const asOf = addDays(WORLD_NOW, -90);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    expect(snapshot.metaAdSpendRecords.length).toBeGreaterThan(0);
    for (const r of snapshot.metaAdSpendRecords) {
      expect(r.spendDate <= asOf).toBe(true);
    }
    const excluded = world.metaAdSpendRecords.filter((r) => r.spendDate > asOf);
    expect(excluded.length).toBeGreaterThan(0);
    for (const r of excluded) {
      expect(snapshot.metaAdSpendRecords.some((s) => s.id === r.id)).toBe(false);
    }
  });
});

// ============================================================================
// Lead Generation (9-14)
// ============================================================================
describe("Marketing Meta/CRM Source Foundation — Lead Generation (9-14)", () => {
  it("9. eindeutige externe Meta-Lead-ID", () => {
    const ids = world.metaLeadGeneratedEvents.map((e) => e.externalLeadId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("10. stabile Event-ID", () => {
    const ids = world.metaLeadGeneratedEvents.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("11. gültiger Campaign-Bezug", () => {
    for (const e of world.metaLeadGeneratedEvents) {
      expect(campaignIds.has(e.campaignId)).toBe(true);
      expect(externalCampaignIds.has(e.externalCampaignId)).toBe(true);
    }
  });

  it("12. korrektes generatedAt: nie nach WORLD_NOW, nie nach dem zugehörigen Match-Zeitpunkt (falls gematcht)", () => {
    for (const e of world.metaLeadGeneratedEvents) {
      expect(e.generatedAt <= WORLD_NOW).toBe(true);
    }
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      const gen = metaLeadById.get(m.metaLeadGeneratedEventId)!;
      expect(gen.generatedAt <= m.matchedAt).toBe(true);
    }
  });

  it("13. MetaLeadGenerated enthält keinerlei CRM-/Match-Information (interne Lead-ID, CRM-ID, Match-Status, Match-Methode nicht sichtbar über das Meta-Event)", () => {
    for (const e of world.metaLeadGeneratedEvents) {
      expect(e).not.toHaveProperty("leadId");
      expect(e).not.toHaveProperty("externalCrmLeadId");
      expect(e).not.toHaveProperty("matchStatus");
      expect(e).not.toHaveProperty("method");
      expect(e).not.toHaveProperty("matchedAt");
    }
  });

  it("14. keine doppelte Lead-Wahrheit: Lead.createdAt bleibt vollständig unverändert (bit-identisch zur bestehenden Sales-Pipeline)", () => {
    expect(world.leads).toEqual(LEADS.slice(0, world.leads.length));
    for (const lead of world.leads) {
      const ingested = world.marketingCrmLeadIngestedEvents.find((e) => e.leadId === lead.id);
      expect(ingested).toBeDefined();
      expect(ingested!.ingestedAt).toBe(lead.createdAt);
    }
  });
});

// ============================================================================
// CRM Ingestion (15-20)
// ============================================================================
describe("Marketing Meta/CRM Source Foundation — CRM Ingestion (15-20)", () => {
  it("15. eindeutige CRM-ID", () => {
    const ids = world.marketingCrmLeadIngestedEvents.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const externalIds = world.marketingCrmLeadIngestedEvents.map((e) => e.externalCrmLeadId);
    expect(new Set(externalIds).size).toBe(externalIds.length);
  });

  it("16. gültiger interner Lead-Bezug", () => {
    const leadIds = new Set(world.leads.map((l) => l.id));
    for (const e of world.marketingCrmLeadIngestedEvents) {
      expect(leadIds.has(e.leadId)).toBe(true);
    }
  });

  it("17. genau ein CRM-Ingestion-Datensatz pro Lead (jeder existierende Lead landete per Definition im CRM)", () => {
    expect(world.marketingCrmLeadIngestedEvents.length).toBe(world.leads.length);
    const leadIdCounts = new Map<string, number>();
    for (const e of world.marketingCrmLeadIngestedEvents) {
      leadIdCounts.set(e.leadId, (leadIdCounts.get(e.leadId) ?? 0) + 1);
    }
    for (const count of leadIdCounts.values()) {
      expect(count).toBe(1);
    }
  });

  it("18. MarketingCrmLeadIngested trägt keinen gespeicherten Match-Status mehr (keine zweite Match-Wahrheit)", () => {
    for (const e of world.marketingCrmLeadIngestedEvents) {
      expect(e).not.toHaveProperty("matchStatus");
      expect(e).not.toHaveProperty("matchedMetaLeadGeneratedId");
    }
  });

  it("19. metaExternalLeadIdOnRecord ist ein roher CRM-Fakt, gesetzt genau bei tatsächlich Meta-attribuierten Leads", () => {
    const withField = world.marketingCrmLeadIngestedEvents.filter((e) => e.metaExternalLeadIdOnRecord !== undefined);
    expect(withField.length).toBeGreaterThan(0);
    expect(withField.length).toBeLessThan(world.marketingCrmLeadIngestedEvents.length);
    for (const e of withField) {
      const gen = world.metaLeadGeneratedEvents.find((g) => g.externalLeadId === e.metaExternalLeadIdOnRecord);
      expect(gen).toBeDefined();
    }
  });

  it("20. keine Future-Knowledge: ein historischer Snapshot enthält keine später eingegangenen CRM-Ingestion-Datensätze", () => {
    const asOf = addDays(WORLD_NOW, -120);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    for (const e of snapshot.marketingCrmLeadIngestedEvents) {
      expect(e.ingestedAt <= asOf).toBe(true);
    }
    const excluded = world.marketingCrmLeadIngestedEvents.filter((e) => e.ingestedAt > asOf);
    expect(excluded.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Match-Event — Eventintegrität (21-30)
// ============================================================================
describe("Marketing Meta/CRM Source Foundation — Match-Event Eventintegrität (21-30)", () => {
  it("21. jede Match-Event-ID ist eindeutig", () => {
    const ids = world.marketingLeadIdentityMatchedEvents.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("22. jede ID ist entity-stabil (leitet sich direkt aus der bereits stabilen Lead-ID ab)", () => {
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      expect(m.id).toBe(`marketing-lead-match-${m.leadId}`);
    }
  });

  it("23. keine ID basiert auf Arrayposition (Reihenfolge der Eingabe-Leads ändert keine Match-ID)", () => {
    const forward = generateMetaCrmSource(WORLD_SEED, LEADS, MARKETING_CAMPAIGNS);
    const reversed = generateMetaCrmSource(WORLD_SEED, [...LEADS].reverse(), MARKETING_CAMPAIGNS);
    const byId = new Map(forward.marketingLeadIdentityMatched.map((m) => [m.id, m]));
    for (const m of reversed.marketingLeadIdentityMatched) {
      expect(byId.get(m.id)).toEqual(m);
    }
  });

  it("24. jedes Match referenziert genau ein vorhandenes Meta-Generation-Event", () => {
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      expect(metaLeadById.has(m.metaLeadGeneratedEventId)).toBe(true);
    }
  });

  it("25. jedes Match referenziert genau ein vorhandenes CRM-Ingestion-Event", () => {
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      expect(crmIngestedById.has(m.crmLeadIngestedEventId)).toBe(true);
    }
  });

  it("26. externe Meta-ID stimmt über alle beteiligten Events überein", () => {
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      const gen = metaLeadById.get(m.metaLeadGeneratedEventId)!;
      expect(gen.externalLeadId).toBe(m.externalLeadId);
      const crm = crmIngestedById.get(m.crmLeadIngestedEventId)!;
      expect(crm.metaExternalLeadIdOnRecord).toBe(m.externalLeadId);
    }
  });

  it("27. externe CRM-ID stimmt mit dem CRM-Ingestion-Event überein", () => {
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      const crm = crmIngestedById.get(m.crmLeadIngestedEventId)!;
      expect(crm.externalCrmLeadId).toBe(m.externalCrmLeadId);
    }
  });

  it("28. interne Lead-ID stimmt mit dem CRM-Ingestion-Event überein", () => {
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      const crm = crmIngestedById.get(m.crmLeadIngestedEventId)!;
      expect(crm.leadId).toBe(m.leadId);
    }
  });

  it("29. Match-Methode ist ausschließlich direkte externe Meta-Lead-ID", () => {
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      expect(m.method).toBe("direct-external-meta-lead-id");
    }
  });

  it("30. kein doppeltes Match für dasselbe Paar (jedes Meta-Event und jedes CRM-Event erscheint höchstens einmal in matchEvents)", () => {
    const metaIds = world.marketingLeadIdentityMatchedEvents.map((m) => m.metaLeadGeneratedEventId);
    expect(new Set(metaIds).size).toBe(metaIds.length);
    const crmIds = world.marketingLeadIdentityMatchedEvents.map((m) => m.crmLeadIngestedEventId);
    expect(new Set(crmIds).size).toBe(crmIds.length);
  });
});

// ============================================================================
// Match-Event — Zeitliche Wahrheit (31-40)
// ============================================================================
describe("Marketing Meta/CRM Source Foundation — Match-Event Zeitliche Wahrheit (31-40)", () => {
  it("31. matchedAt >= generatedAt", () => {
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      const gen = metaLeadById.get(m.metaLeadGeneratedEventId)!;
      expect(m.matchedAt >= gen.generatedAt).toBe(true);
    }
  });

  it("32. matchedAt >= ingestedAt", () => {
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      const crm = crmIngestedById.get(m.crmLeadIngestedEventId)!;
      expect(m.matchedAt >= crm.ingestedAt).toBe(true);
    }
  });

  it("33. in der Referenzwelt gilt matchedAt === ingestedAt (synchrone Match-Methode)", () => {
    expect(world.marketingLeadIdentityMatchedEvents.length).toBeGreaterThan(0);
    for (const m of world.marketingLeadIdentityMatchedEvents) {
      const crm = crmIngestedById.get(m.crmLeadIngestedEventId)!;
      expect(m.matchedAt).toBe(crm.ingestedAt);
    }
  });

  it("34. Meta-Event ist bereits vor CRM-Eingang sichtbar, falls generatedAt < ingestedAt", () => {
    const delayedCase = world.marketingLeadIdentityMatchedEvents.find((m) => {
      const gen = metaLeadById.get(m.metaLeadGeneratedEventId)!;
      return gen.generatedAt < m.matchedAt;
    })!;
    expect(delayedCase).toBeDefined();
    const gen = metaLeadById.get(delayedCase.metaLeadGeneratedEventId)!;
    const asOf = addDays(delayedCase.matchedAt, -1);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    expect(snapshot.metaLeadGeneratedEvents.some((e) => e.id === gen.id)).toBe(true);
  });

  it("35. CRM-Ingestion ist vor ingestedAt unsichtbar", () => {
    const example = world.marketingCrmLeadIngestedEvents[0]!;
    const asOf = addDays(example.ingestedAt, -1);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    expect(snapshot.marketingCrmLeadIngestedEvents.some((e) => e.id === example.id)).toBe(false);
  });

  it("36. Match ist vor matchedAt unsichtbar", () => {
    const example = world.marketingLeadIdentityMatchedEvents[0]!;
    const asOf = addDays(example.matchedAt, -1);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    expect(snapshot.marketingLeadIdentityMatchedEvents.some((m) => m.id === example.id)).toBe(false);
  });

  it("37. Match ist exakt ab matchedAt sichtbar", () => {
    const example = world.marketingLeadIdentityMatchedEvents[0]!;
    const snapshot = generateWorldSnapshot(toSource(), example.matchedAt);
    expect(snapshot.marketingLeadIdentityMatchedEvents.some((m) => m.id === example.id)).toBe(true);
  });

  it("38. spätere Match-Events verändern frühere Snapshots nicht (deterministischer, unveränderlicher historischer Blick)", () => {
    const asOf = addDays(WORLD_NOW, -200);
    const snapshotA = generateWorldSnapshot(toSource(), asOf);
    const snapshotB = generateWorldSnapshot(toSource(), asOf);
    expect(snapshotB.marketingLeadIdentityMatchedEvents).toEqual(snapshotA.marketingLeadIdentityMatchedEvents);
    for (const m of snapshotA.marketingLeadIdentityMatchedEvents) {
      expect(m.matchedAt <= asOf).toBe(true);
    }
  });

  it("39. interne CRM-Lead-ID ist vor Ingestion nicht über das Meta-Event sichtbar", () => {
    for (const e of world.metaLeadGeneratedEvents) {
      expect(e).not.toHaveProperty("leadId");
    }
  });

  it("40. Match-Methode ist vor dem Match-Zeitpunkt nicht sichtbar (das gesamte Match-Event, inklusive method, ist erst ab matchedAt abrufbar)", () => {
    const example = world.marketingLeadIdentityMatchedEvents[0]!;
    const asOf = addDays(example.matchedAt, -1);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    const visibleForThisPair = snapshot.marketingLeadIdentityMatchedEvents.find((m) => m.id === example.id);
    expect(visibleForThisPair).toBeUndefined();
    // method ist ausschließlich als Feld des Match-Events selbst modelliert —
    // ohne sichtbares Match-Event existiert an keiner anderen Stelle ein
    // Zugriffspfad auf die Methode dieses konkreten Paares.
  });
});

// ============================================================================
// Match-Event — Statusprojektion (41-47)
// ============================================================================
describe("Marketing Meta/CRM Source Foundation — Statusprojektion (41-47)", () => {
  it("41. Meta-Lead ohne sichtbares Match ist pending", () => {
    expect(pendingMetaLeadEvents.length).toBeGreaterThan(0);
    for (const e of pendingMetaLeadEvents) {
      const status = resolveMarketingLeadMatchStatus(e.id, WORLD_NOW, world.marketingLeadIdentityMatchedEvents);
      expect(status).toBe("pending");
    }
  });

  it("42. Meta-Lead mit sichtbarem Match ist matched", () => {
    expect(matchedMetaLeadEvents.length).toBeGreaterThan(0);
    for (const e of matchedMetaLeadEvents) {
      const status = resolveMarketingLeadMatchStatus(e.id, WORLD_NOW, world.marketingLeadIdentityMatchedEvents);
      expect(status).toBe("matched");
    }
  });

  it("43. Standalone-Meta-Lead (nie CRM-ingested) ist nicht automatisch endgültig unmatched, sondern pending", () => {
    const standalone = world.metaLeadGeneratedEvents.filter((e) => !world.marketingCrmLeadIngestedEvents.some((c) => c.metaExternalLeadIdOnRecord === e.externalLeadId));
    expect(standalone.length).toBeGreaterThan(0);
    for (const e of standalone) {
      const status = resolveMarketingLeadMatchStatus(e.id, WORLD_NOW, world.marketingLeadIdentityMatchedEvents);
      expect(status).toBe("pending");
      expect(status).not.toBe("unmatched");
    }
  });

  it("44. kein pending Lead wird als matched gezählt", () => {
    const matchedCount = world.metaLeadGeneratedEvents.filter(
      (e) => resolveMarketingLeadMatchStatus(e.id, WORLD_NOW, world.marketingLeadIdentityMatchedEvents) === "matched",
    ).length;
    expect(matchedCount).toBe(world.marketingLeadIdentityMatchedEvents.length);
  });

  it("45. kein zukünftiges Match wird historisch gezählt", () => {
    const example = world.marketingLeadIdentityMatchedEvents.find((m) => {
      const gen = metaLeadById.get(m.metaLeadGeneratedEventId)!;
      return gen.generatedAt < m.matchedAt;
    })!;
    const asOf = addDays(example.matchedAt, -1);
    const status = resolveMarketingLeadMatchStatus(example.metaLeadGeneratedEventId, asOf, world.marketingLeadIdentityMatchedEvents);
    expect(status).toBe("pending");
  });

  it("46. Status wird ausschließlich über resolveMarketingLeadMatchStatus aus Events abgeleitet (keine gespeicherte Alternative existiert im Typsystem)", () => {
    for (const e of world.metaLeadGeneratedEvents) {
      expect(e).not.toHaveProperty("matchStatus");
    }
    for (const e of world.marketingCrmLeadIngestedEvents) {
      expect(e).not.toHaveProperty("matchStatus");
    }
  });

  it("47. kein paralleles gespeichertes matched-Flag vorhanden (weder auf Meta- noch auf CRM-Event)", () => {
    for (const e of world.metaLeadGeneratedEvents) {
      expect(Object.keys(e)).not.toContain("matched");
    }
    for (const e of world.marketingCrmLeadIngestedEvents) {
      expect(Object.keys(e)).not.toContain("matched");
    }
  });
});

// ============================================================================
// Match-Event — Referenzfall (48-50)
// ============================================================================
describe("Marketing Meta/CRM Source Foundation — Referenzfall (48-50)", () => {
  const delayedCase = world.marketingLeadIdentityMatchedEvents.find((m) => {
    const gen = metaLeadById.get(m.metaLeadGeneratedEventId)!;
    return gen.generatedAt < m.matchedAt;
  })!;
  const gen = metaLeadById.get(delayedCase.metaLeadGeneratedEventId)!;

  it("48. dedizierter Fall mit generatedAt < asOf < ingestedAt: Meta-Generation sichtbar, CRM-Ingestion unsichtbar, Match-Event unsichtbar, Status pending", () => {
    expect(gen.generatedAt < delayedCase.matchedAt).toBe(true);
    // asOf strikt zwischen generatedAt und matchedAt (matchedAt === ingestedAt)
    const asOf = addDays(delayedCase.matchedAt, -1);
    expect(asOf > gen.generatedAt).toBe(true);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    expect(snapshot.metaLeadGeneratedEvents.some((e) => e.id === gen.id)).toBe(true);
    expect(snapshot.marketingCrmLeadIngestedEvents.some((e) => e.id === delayedCase.crmLeadIngestedEventId)).toBe(false);
    expect(snapshot.marketingLeadIdentityMatchedEvents.some((m) => m.id === delayedCase.id)).toBe(false);
    const status = resolveMarketingLeadMatchStatus(gen.id, asOf, snapshot.marketingLeadIdentityMatchedEvents);
    expect(status).toBe("pending");
  });

  it("49. dedizierter Fall mit asOf === matchedAt: Meta-Generation sichtbar, CRM-Ingestion sichtbar, Match-Event sichtbar, Status matched", () => {
    const asOf = delayedCase.matchedAt;
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    expect(snapshot.metaLeadGeneratedEvents.some((e) => e.id === gen.id)).toBe(true);
    expect(snapshot.marketingCrmLeadIngestedEvents.some((e) => e.id === delayedCase.crmLeadIngestedEventId)).toBe(true);
    expect(snapshot.marketingLeadIdentityMatchedEvents.some((m) => m.id === delayedCase.id)).toBe(true);
    const status = resolveMarketingLeadMatchStatus(gen.id, asOf, snapshot.marketingLeadIdentityMatchedEvents);
    expect(status).toBe("matched");
  });

  it("50. Counts der sichtbaren Match-Events entsprechen exakt den als matched projizierten Leads", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const matchedCount = snapshot.metaLeadGeneratedEvents.filter(
      (e) => resolveMarketingLeadMatchStatus(e.id, WORLD_NOW, snapshot.marketingLeadIdentityMatchedEvents) === "matched",
    ).length;
    expect(matchedCount).toBe(snapshot.marketingLeadIdentityMatchedEvents.length);
  });
});

// ============================================================================
// Determinismus (51-58)
// ============================================================================
describe("Marketing Meta/CRM Source Foundation — Determinismus (51-58)", () => {
  it("51. gleicher Seed erzeugt bit-identische Spend-Records", () => {
    const a = generateMetaAdSpendRecords(WORLD_SEED, MARKETING_CAMPAIGNS);
    const b = generateMetaAdSpendRecords(WORLD_SEED, MARKETING_CAMPAIGNS);
    expect(a).toEqual(b);
  });

  it("52. gleicher Seed erzeugt identische Match-Events (bit-identisch, inklusive Lead-Generation/CRM-Ingestion)", () => {
    const a = generateMetaCrmSource(WORLD_SEED, LEADS, MARKETING_CAMPAIGNS);
    const b = generateMetaCrmSource(WORLD_SEED, LEADS, MARKETING_CAMPAIGNS);
    expect(a).toEqual(b);
  });

  it("53. veränderte Lead-Array-Reihenfolge verändert keine Match-ID (Order Independence)", () => {
    const forward = generateMetaCrmSource(WORLD_SEED, LEADS, MARKETING_CAMPAIGNS);
    const reversed = generateMetaCrmSource(WORLD_SEED, [...LEADS].reverse(), MARKETING_CAMPAIGNS);
    const byId = new Map(forward.marketingLeadIdentityMatched.map((m) => [m.id, m]));
    for (const m of reversed.marketingLeadIdentityMatched) {
      expect(byId.get(m.id)).toEqual(m);
    }
  });

  it("54. zusätzliche Campaign verändert bestehende Match-IDs nicht (nur die minimal notwendige Neuzuordnung der Campaign selbst)", () => {
    const baseline = generateMetaCrmSource(WORLD_SEED, LEADS, MARKETING_CAMPAIGNS);
    const withExtra = generateMetaCrmSource(WORLD_SEED, LEADS, [
      ...MARKETING_CAMPAIGNS,
      { id: "campaign-99", externalAdAccountId: "act-999", externalCampaignId: "cmp-999", name: "Test" },
    ]);
    expect(withExtra.marketingLeadIdentityMatched.map((m) => m.id).sort()).toEqual(
      baseline.marketingLeadIdentityMatched.map((m) => m.id).sort(),
    );
    const baselineMatchById = new Map(baseline.marketingLeadIdentityMatched.map((m) => [m.id, m]));
    for (const m of withExtra.marketingLeadIdentityMatched) {
      const before = baselineMatchById.get(m.id)!;
      expect(m.matchedAt).toBe(before.matchedAt);
      expect(m.leadId).toBe(before.leadId);
      expect(m.externalLeadId).toBe(before.externalLeadId);
    }
  });

  it("55. Match-Event-Erzeugung verändert keine Leads (unabhängige Domänen)", () => {
    const before = world.leads;
    generateMetaCrmSource(WORLD_SEED, LEADS, MARKETING_CAMPAIGNS);
    expect(world.leads).toBe(before);
  });

  it("56. Match-Event-Erzeugung verändert keine Opportunities oder Appointments (unabhängige Domänen)", () => {
    const beforeOpportunities = world.opportunities;
    const beforeAppointments = world.salesAppointments;
    generateMetaCrmSource(WORLD_SEED, LEADS, MARKETING_CAMPAIGNS);
    expect(world.opportunities).toBe(beforeOpportunities);
    expect(world.salesAppointments).toBe(beforeAppointments);
  });

  it("57. alle sechs Scenario Profiles erzeugen valide, konsistente Match-Events", () => {
    for (const profile of SCENARIO_PROFILES) {
      const w = SCENARIO_WORLDS[profile.id];
      expect(w.marketingLeadIdentityMatchedEvents.length).toBeGreaterThan(0);
      expect(w.marketingLeadIdentityMatchedEvents.length).toBeLessThan(w.metaLeadGeneratedEvents.length);
      for (const m of w.marketingLeadIdentityMatchedEvents) {
        const crm = w.marketingCrmLeadIngestedEvents.find((c) => c.id === m.crmLeadIngestedEventId)!;
        expect(m.matchedAt).toBe(crm.ingestedAt);
      }
    }
  });

  it("58. mehrere Seeds erzeugen jeweils in sich konsistente, aber untereinander unterschiedliche Match-Event-Mengen", () => {
    const a = generateMetaCrmSource(WORLD_SEED, LEADS, MARKETING_CAMPAIGNS);
    const b = generateMetaCrmSource(WORLD_SEED + 100_000, LEADS, MARKETING_CAMPAIGNS);
    expect(a.marketingLeadIdentityMatched).not.toEqual(b.marketingLeadIdentityMatched);
  });
});

// ============================================================================
// Regression (59-66)
// ============================================================================
describe("Marketing Meta/CRM Source Foundation — Regression (59-66)", () => {
  it("59. Leads unverändert: world.leads entspricht exakt der bestehenden Sales-Pipeline-Wahrheit", () => {
    expect(world.leads).toEqual(LEADS);
  });

  it("60. Opportunities unverändert", () => {
    expect(world.opportunities).toEqual(OPPORTUNITIES);
  });

  it("61. Sales Appointments unverändert durch die Match-Event-Korrektur", () => {
    const rebuilt = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    expect(rebuilt.salesAppointments).toEqual(world.salesAppointments);
  });

  it("62. Sales Period Metrics unverändert", () => {
    const rebuilt = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    const snapshotA = generateWorldSnapshot(toSource(), WORLD_NOW);
    const sourceB: WorldSnapshotSource = { ...toSource(), leads: rebuilt.leads, opportunities: rebuilt.opportunities };
    const snapshotB = generateWorldSnapshot(sourceB, WORLD_NOW);
    expect(snapshotB.salesPeriodMetrics).toEqual(snapshotA.salesPeriodMetrics);
  });

  it("63. Operations/Delivery unverändert", () => {
    const rebuilt = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    expect(rebuilt.deliveryUnits).toEqual(world.deliveryUnits);
  });

  it("64. Marketing Demand Model/Observations unverändert (unabhängig von der Match-Event-Struktur)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.marketingObservation).toBeDefined();
    const rebuilt = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    const sourceB: WorldSnapshotSource = { ...toSource(), leads: rebuilt.leads, opportunities: rebuilt.opportunities };
    const snapshotB = generateWorldSnapshot(sourceB, WORLD_NOW);
    expect(snapshotB.marketingObservation).toEqual(snapshot.marketingObservation);
  });

  it("65. People/Company/Ownership/Fairness unverändert (Employees, AccountOwnerships identisch)", () => {
    const rebuilt = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    expect(rebuilt.accountOwnerships).toEqual(world.accountOwnerships);
    expect(EMPLOYEES.length).toBeGreaterThan(0);
  });

  it("66. Public Contract unangetastet: index.ts exportiert keine neuen Meta/CRM-Laufzeitsymbole", async () => {
    // Statt Datei-Text-Scan (dieses Repository ist bewusst dependency-frei,
    // kein @types/node/node:fs — siehe Konvention in
    // validation/delivery-lifecycle.test.ts, "Kein erfundener Plan"):
    // Modul-Namespace zur Laufzeit inspiziert. Type-only Interfaces
    // (MetaAdSpendRecord, MetaLeadGenerated, MarketingCrmLeadIngested,
    // MarketingLeadIdentityMatched) werden beim Kompilieren ohnehin
    // vollständig entfernt und können hier nie als Laufzeitwert erscheinen —
    // die tatsächlich prüfbare Gefahr ist ein neu exportierter Laufzeitwert
    // (Generatorfunktion, Campaign-Liste).
    const publicContract = await import("../index");
    expect(publicContract).not.toHaveProperty("generateMetaAdSpendRecords");
    expect(publicContract).not.toHaveProperty("generateMetaCrmSource");
    expect(publicContract).not.toHaveProperty("resolveMarketingLeadMatchStatus");
    expect(publicContract).not.toHaveProperty("MARKETING_CAMPAIGNS");
  });
});
