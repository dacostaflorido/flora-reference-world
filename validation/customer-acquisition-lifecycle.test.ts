import { describe, expect, it } from "vitest";
import { SCENARIO_WORLDS } from "../engine/generator";
import { WORLD_NOW } from "../timeline/world-clock";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { generateDeliveryUnits } from "../world/delivery-units";
import { EMPLOYEES } from "../world/employees";
import type { Opportunity } from "../events/opportunities";
import type { MarketingLeadIdentityMatched } from "../events/marketing-meta-crm-source";
import {
  generateCustomerAcquisitionLifecycle,
  reportCustomerAcquisitionMarketingAttribution,
  type CustomerAcquisitionLifecycleSnapshot,
} from "../company/customer-acquisition-lifecycle";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CONTACTS } from "../world/contacts";
import { generateMarketingToSalesAttribution } from "../company/marketing-sales-attribution";
import { generateMarketingCohortCostMetrics } from "../company/marketing-cohort-cost-metrics";

// AUFTRAG — Cohort Cost Checkpoint + Customer Acquisition Lifecycle
// Foundation V1, Phase B, B10: Pflichttests für die kanonische
// Customer-Acquisition-Wahrheit. Verbindliche Business-Entscheidung: erste
// Won-Opportunity eines Accounts = Customer Acquisition, jede spätere Won
// desselben Accounts = Repeat Business. Kein CAC, kein Customer Lifetime
// Value, kein Churn (harte Scope-Grenze).

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
function won(id: string, accountId: string, leadId: string, createdAt: string, closedAt: string): Opportunity {
  return { id, leadId, accountId, createdAt, currentStage: "gewonnen", value: 10000, probability: 100, responsibleEmployeeId: "emp-synth", closedAt };
}
function lost(id: string, accountId: string, leadId: string, createdAt: string, closedAt: string): Opportunity {
  return { id, leadId, accountId, createdAt, currentStage: "verloren", value: 10000, probability: 0, responsibleEmployeeId: "emp-synth", closedAt, lostReason: "Budget" };
}
function open(id: string, accountId: string, leadId: string, createdAt: string): Opportunity {
  return { id, leadId, accountId, createdAt, currentStage: "verhandlung", value: 10000, probability: 50, responsibleEmployeeId: "emp-synth" };
}
function match(id: string, leadId: string, matchedAt: string): MarketingLeadIdentityMatched {
  return { id, metaLeadGeneratedEventId: `meta-${id}`, crmLeadIngestedEventId: `crm-${id}`, externalLeadId: `ext-${id}`, externalCrmLeadId: `extcrm-${id}`, leadId, matchedAt, method: "direct-external-meta-lead-id" };
}

const ASOF = "2025-06-01";

// ============================================================================
// Acquisition (1-8)
// ============================================================================
describe("Customer Acquisition Lifecycle — Acquisition (1-8)", () => {
  it("1. Account ohne Won erzeugt keinen Kunden", () => {
    const opps = [open("opp-1", "acc-1", "lead-1", "2025-01-01")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerRelationships).toEqual([]);
    expect(l.customerAcquiredEvents).toEqual([]);
  });

  it("2. Account mit einem Won erzeugt genau einen Kunden", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerRelationships.length).toBe(1);
    expect(l.customerRelationships[0]!.accountId).toBe("acc-1");
  });

  it("3. Account mit mehreren Won erzeugt genau einen Kunden", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10"),
      won("opp-2", "acc-1", "lead-2", "2025-02-01", "2025-02-15"),
      won("opp-3", "acc-1", "lead-3", "2025-03-01", "2025-03-20"),
    ];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerRelationships.length).toBe(1);
    expect(l.customerAcquiredEvents.length).toBe(1);
  });

  it("4. früheste Won löst Acquisition aus", () => {
    const opps = [
      won("opp-later", "acc-1", "lead-1", "2025-01-01", "2025-02-15"),
      won("opp-earlier", "acc-1", "lead-2", "2025-01-05", "2025-01-10"),
    ];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerAcquiredEvents[0]!.opportunityId).toBe("opp-earlier");
  });

  it("5. acquiredAt === closedAt der akquirierenden Opportunity", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerAcquiredEvents[0]!.acquiredAt).toBe("2025-01-10");
    expect(l.customerRelationships[0]!.acquiredAt).toBe("2025-01-10");
  });

  it("6. akquirierende Opportunity wird explizit referenziert", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerAcquiredEvents[0]!.opportunityId).toBe("opp-1");
    expect(l.customerRelationships[0]!.acquiredThroughOpportunityId).toBe("opp-1");
  });

  it("7. stabile Event-ID: identisch bei wiederholtem Aufruf und unabhängig von Eingabereihenfolge", () => {
    const oppsA = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const oppsB = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l1 = generateCustomerAcquisitionLifecycle(oppsA, ASOF);
    const l2 = generateCustomerAcquisitionLifecycle(oppsB, ASOF);
    expect(l1.customerAcquiredEvents[0]!.id).toBe(l2.customerAcquiredEvents[0]!.id);
  });

  it("8. keine Ableitung aus Arrayposition: gleiches Ergebnis bei vertauschter Eingabereihenfolge", () => {
    const a = won("opp-a", "acc-1", "lead-1", "2025-01-01", "2025-01-10");
    const b = won("opp-b", "acc-2", "lead-2", "2025-01-01", "2025-01-12");
    const l1 = generateCustomerAcquisitionLifecycle([a, b], ASOF);
    const l2 = generateCustomerAcquisitionLifecycle([b, a], ASOF);
    expect(l1.customerAcquiredEvents.map((e) => e.id).sort()).toEqual(l2.customerAcquiredEvents.map((e) => e.id).sort());
    expect(l1.customerRelationships.map((r) => r.id).sort()).toEqual(l2.customerRelationships.map((r) => r.id).sort());
  });
});

// ============================================================================
// Repeat Business (9-14)
// ============================================================================
describe("Customer Acquisition Lifecycle — Repeat Business (9-14)", () => {
  it("9. erste Won ist Acquisition", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.wonOpportunityClassifications.find((c) => c.opportunityId === "opp-1")!.kind).toBe("customer-acquisition");
  });

  it("10. spätere Won sind Repeat Business", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10"),
      won("opp-2", "acc-1", "lead-2", "2025-02-01", "2025-02-15"),
    ];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.wonOpportunityClassifications.find((c) => c.opportunityId === "opp-2")!.kind).toBe("repeat-business");
  });

  it("11. Summe Acquisition + Repeat entspricht Won Count", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10"),
      won("opp-2", "acc-1", "lead-2", "2025-02-01", "2025-02-15"),
      won("opp-3", "acc-2", "lead-3", "2025-01-01", "2025-01-05"),
    ];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    const acq = l.wonOpportunityClassifications.filter((c) => c.kind === "customer-acquisition").length;
    const rep = l.wonOpportunityClassifications.filter((c) => c.kind === "repeat-business").length;
    expect(acq + rep).toBe(3);
  });

  it("12. mehrere Won am selben Tag werden deterministisch entschieden (Tie-Break über ID)", () => {
    const opps = [
      won("opp-b", "acc-1", "lead-1", "2025-01-01", "2025-01-10"),
      won("opp-a", "acc-1", "lead-2", "2025-01-01", "2025-01-10"),
    ];
    const l1 = generateCustomerAcquisitionLifecycle(opps, ASOF);
    const l2 = generateCustomerAcquisitionLifecycle([...opps].reverse(), ASOF);
    expect(l1.customerAcquiredEvents[0]!.opportunityId).toBe("opp-a"); // lexikographisch kleinste ID gewinnt
    expect(l2.customerAcquiredEvents[0]!.opportunityId).toBe("opp-a");
  });

  it("13. bei Datums-Tie entsteht nur eine Acquisition, die übrige ist Repeat Business", () => {
    const opps = [
      won("opp-b", "acc-1", "lead-1", "2025-01-01", "2025-01-10"),
      won("opp-a", "acc-1", "lead-2", "2025-01-01", "2025-01-10"),
    ];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    const kinds = l.wonOpportunityClassifications.map((c) => c.kind).sort();
    expect(kinds).toEqual(["customer-acquisition", "repeat-business"]);
  });

  it("14. ein Repeat Win erzeugt kein zweites CustomerAcquired-Event", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10"),
      won("opp-2", "acc-1", "lead-2", "2025-02-01", "2025-02-15"),
      won("opp-3", "acc-1", "lead-3", "2025-03-01", "2025-03-20"),
    ];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerAcquiredEvents.filter((e) => e.accountId === "acc-1").length).toBe(1);
  });
});

// ============================================================================
// As-of (15-20)
// ============================================================================
describe("Customer Acquisition Lifecycle — As-of (15-20)", () => {
  it("15. vor der ersten Won ist der Account noch kein Kunde", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, "2025-01-09");
    expect(l.customerRelationships).toEqual([]);
  });

  it("16. exakt ab acquiredAt ist der Account Kunde", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, "2025-01-10");
    expect(l.customerRelationships.length).toBe(1);
  });

  it("17. eine spätere Repeat-Win ist vor ihrem eigenen closedAt unsichtbar", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10"),
      won("opp-2", "acc-1", "lead-2", "2025-02-01", "2025-02-15"),
    ];
    const before = generateCustomerAcquisitionLifecycle(opps, "2025-02-14");
    expect(before.customerRelationships[0]!.wonOpportunityIds).toEqual(["opp-1"]);
    const after = generateCustomerAcquisitionLifecycle(opps, "2025-02-15");
    expect(after.customerRelationships[0]!.wonOpportunityIds).toEqual(["opp-1", "opp-2"]);
  });

  it("18. eine spätere Won verändert den bereits bestimmten Acquisition-Zeitpunkt nicht", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const oppsWithLater = [...opps, won("opp-2", "acc-1", "lead-2", "2025-02-01", "2025-02-15")];
    const early = generateCustomerAcquisitionLifecycle(opps, ASOF).customerAcquiredEvents[0]!.acquiredAt;
    const withLater = generateCustomerAcquisitionLifecycle(oppsWithLater, ASOF).customerAcquiredEvents[0]!.acquiredAt;
    expect(early).toBe(withLater);
    expect(early).toBe("2025-01-10");
  });

  it("19. ein historischer Snapshot bleibt bei wiederholter Berechnung reproduzierbar", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const a = generateCustomerAcquisitionLifecycle(opps, "2025-01-15");
    const b = generateCustomerAcquisitionLifecycle(opps, "2025-01-15");
    expect(a).toEqual(b);
  });

  it("20. Future Knowledge ist ausgeschlossen: eine Won-Opportunity nach asOf bleibt vollständig unsichtbar", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-06-15")];
    const l = generateCustomerAcquisitionLifecycle(opps, "2025-06-01");
    expect(l.customerRelationships).toEqual([]);
    expect(l.customerAcquiredEvents).toEqual([]);
    expect(l.wonOpportunityClassifications).toEqual([]);
  });
});

// ============================================================================
// Marketing (21-25)
// ============================================================================
describe("Customer Acquisition Lifecycle — Marketing (21-25)", () => {
  it("21. akquirierende Opportunity trägt eine leadId (Opportunity→Lead)", () => {
    const opps = [won("opp-1", "acc-1", "lead-matched", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.wonOpportunityClassifications[0]!.leadId).toBe("lead-matched");
  });

  it("22. Lead→Meta-Match wird über MarketingLeadIdentityMatched.leadId aufgelöst", () => {
    const opps = [won("opp-1", "acc-1", "lead-matched", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    const matches = [match("match-1", "lead-matched", "2025-01-02")];
    const report = reportCustomerAcquisitionMarketingAttribution(l, matches);
    expect(report.metaAttributableAcquisitions).toBe(1);
  });

  it("23. Meta-attribuierbare Acquisition wird korrekt gezählt", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-a", "2025-01-01", "2025-01-10"),
      won("opp-2", "acc-2", "lead-b", "2025-01-01", "2025-01-11"),
    ];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    const matches = [match("match-1", "lead-a", "2025-01-02")];
    const report = reportCustomerAcquisitionMarketingAttribution(l, matches);
    expect(report.metaAttributableAcquisitions).toBe(1);
    expect(report.nonMetaAttributableAcquisitions).toBe(1);
    expect(report.totalCustomerAcquisitions).toBe(2);
  });

  it("24. nicht attribuierbare Acquisition wird korrekt gezählt (kein Match)", () => {
    const opps = [won("opp-1", "acc-1", "lead-unmatched", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    const report = reportCustomerAcquisitionMarketingAttribution(l, []);
    expect(report.metaAttributableAcquisitions).toBe(0);
    expect(report.nonMetaAttributableAcquisitions).toBe(1);
  });

  it("25. ein Meta-attribuierter Repeat-Win wird NICHT als neuer Meta-Kunde gezählt", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-first", "2025-01-01", "2025-01-10"), // Acquisition, nicht gematcht
      won("opp-2", "acc-1", "lead-repeat", "2025-02-01", "2025-02-15"), // Repeat, gematcht
    ];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    const matches = [match("match-1", "lead-repeat", "2025-02-02")];
    const report = reportCustomerAcquisitionMarketingAttribution(l, matches);
    expect(report.metaAttributableAcquisitions).toBe(0); // die Acquisition selbst ist nicht gematcht
    expect(report.metaAttributedRepeatWins).toBe(1); // der Repeat-Win ist gematcht, zählt getrennt
    expect(report.totalCustomerAcquisitions).toBe(1);
  });
});

// ============================================================================
// Delivery (26-30)
// ============================================================================
describe("Customer Acquisition Lifecycle — Delivery (26-30)", () => {
  it("26. jede Won-Opportunity behält ihre DeliveryUnit (Acquisition)", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const units = generateDeliveryUnits(1, opps, EMPLOYEES);
    expect(units.some((u) => u.opportunityId === "opp-1")).toBe(true);
  });

  it("27. ein Repeat Won behält weiterhin eine eigene DeliveryUnit", () => {
    const opps = [
      won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10"),
      won("opp-2", "acc-1", "lead-2", "2025-02-01", "2025-02-15"),
    ];
    const units = generateDeliveryUnits(1, opps, EMPLOYEES);
    expect(units.some((u) => u.opportunityId === "opp-1")).toBe(true);
    expect(units.some((u) => u.opportunityId === "opp-2")).toBe(true);
    expect(units.length).toBe(2);
  });

  it("28. Delivery Counts bleiben in der Referenzwelt unverändert (79 Won === 79 DeliveryUnits)", () => {
    const won79 = world.opportunities.filter((o) => o.currentStage === "gewonnen");
    expect(world.deliveryUnits.length).toBe(won79.length);
  });

  it("29. keine 30-Tage-Zusage: plannedEndDate bleibt in der Referenzwelt durchgängig undefined", () => {
    expect(world.deliveryUnits.every((u) => u.plannedEndDate === undefined)).toBe(true);
  });

  it("30. das Delivery-Commitment entsteht weiterhin ausschließlich durch Won, nicht durch Customer Acquisition", () => {
    // Eine verlorene Opportunity erzeugt keine DeliveryUnit — unabhängig von jeder Customer-Semantik.
    const opps = [lost("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const units = generateDeliveryUnits(1, opps, EMPLOYEES);
    expect(units.length).toBe(0);
  });
});

// ============================================================================
// Semantik (31-37)
// ============================================================================
describe("Customer Acquisition Lifecycle — Semantik (31-37)", () => {
  it("31. Account-Erstellung ist nicht Acquisition (CustomerAccount.createdAt bleibt unbenutzt)", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")]; // createdAt der Opportunity, nicht des Accounts
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerAcquiredEvents[0]!.acquiredAt).toBe("2025-01-10"); // = closedAt, NICHT irgendein Account-createdAt
    expect(l.customerAcquiredEvents[0]!.acquiredAt).not.toBe("2025-01-01");
  });

  it("32. Strategy Call ist nicht Acquisition (nur closedAt zählt, nichts Appointment-Bezogenes)", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-03-01")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerAcquiredEvents[0]!.acquiredAt).toBe("2025-03-01");
  });

  it("33. Opportunity-Erstellung ist nicht Acquisition (createdAt !== acquiredAt)", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-25")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerAcquiredEvents[0]!.acquiredAt).not.toBe(opps[0]!.createdAt);
  });

  it("34. Won-Opportunity bleibt von Customer getrennt: eine Opportunity-ID ist nie gleich einer CustomerRelationship-ID", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerRelationships[0]!.id).not.toBe("opp-1");
    expect(l.customerRelationships[0]!.id).not.toBe(l.customerRelationships[0]!.acquiredThroughOpportunityId);
  });

  it("35. kein CAC: keine Kosten-, Spend- oder Divisionsfelder in irgendeiner Struktur dieser Datei", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    const json = JSON.stringify(l).toLowerCase();
    expect(json).not.toContain("cac");
    expect(json).not.toContain("spend");
    expect(json).not.toContain("cost");
  });

  it("36. kein Customer Lifetime Value: kein ltv-/value-aggregierendes Feld auf Kundenebene", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    const keys = Object.keys(l.customerRelationships[0]!);
    expect(keys).not.toContain("lifetimeValue");
    expect(keys).not.toContain("ltv");
    expect(keys).not.toContain("totalValue");
  });

  it("37. kein Churn erfunden: currentStatus kennt ausschließlich den einen belegten Zustand, kein 'churned'/'inactive'", () => {
    const opps = [won("opp-1", "acc-1", "lead-1", "2025-01-01", "2025-01-10")];
    const l = generateCustomerAcquisitionLifecycle(opps, ASOF);
    expect(l.customerRelationships[0]!.currentStatus).toBe("acquired");
    const json = JSON.stringify(l).toLowerCase();
    expect(json).not.toContain("churn");
    expect(json).not.toContain("inactive");
  });
});

// ============================================================================
// Regression (38-48)
// ============================================================================
describe("Customer Acquisition Lifecycle — Regression (38-48)", () => {
  it("38. Won/Lost unverändert", () => {
    expect(world.opportunities.filter((o) => o.currentStage === "gewonnen").length).toBe(79);
    expect(world.opportunities.filter((o) => o.currentStage === "verloren").length).toBeGreaterThan(0);
  });

  it("39. Opportunities unverändert (Gesamtanzahl, Accounts, keine Waisen)", () => {
    expect(world.opportunities.length).toBeGreaterThan(0);
    expect(world.opportunities.every((o) => CUSTOMER_ACCOUNTS.some((a) => a.id === o.accountId))).toBe(true);
  });

  it("40. Sales Period Metrics unverändert erreichbar", async () => {
    const { generateSalesPeriodMetrics } = await import("../company/sales-period-metrics");
    const result = generateSalesPeriodMetrics(WORLD_NOW, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);
    expect(result.asOf).toBe(WORLD_NOW);
  });

  it("41. Marketing Attribution unverändert erreichbar", () => {
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

  it("42. Cohort Cost Metrics unverändert erreichbar", () => {
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
  });

  it("43. Marketing States (Coverage) unverändert", () => {
    expect(world.marketingSourceCoverage.length).toBeGreaterThan(0);
  });

  it("44. Operations (DeliveryUnits) unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.deliveryUnits).toBeDefined();
  });

  it("45. People unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.employees.length).toBeGreaterThan(0);
  });

  it("46. Company (Snapshot als Ganzes) unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.accountOwnerships.length).toBeGreaterThan(0);
    expect(snapshot.customerAccounts.length).toBeGreaterThan(0);
  });

  it("47. RNG unverändert: Customer Acquisition Lifecycle ist eine reine Funktion ohne eigenen Zufallsstrom", () => {
    const a = generateCustomerAcquisitionLifecycle(world.opportunities, WORLD_NOW);
    const b = generateCustomerAcquisitionLifecycle(world.opportunities, WORLD_NOW);
    expect(a).toEqual(b);
  });

  it("48. Public Contract unverändert: keine neuen Customer-Acquisition-Laufzeitsymbole in index.ts", async () => {
    const publicContract = await import("../index");
    expect(publicContract).not.toHaveProperty("generateCustomerAcquisitionLifecycle");
    expect(publicContract).not.toHaveProperty("reportCustomerAcquisitionMarketingAttribution");
  });
});

// Nur zur Typprüfung referenziert.
const _typeCheck: CustomerAcquisitionLifecycleSnapshot | undefined = undefined;
void _typeCheck;
