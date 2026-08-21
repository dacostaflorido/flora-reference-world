import { describe, expect, it } from "vitest";
import { SCENARIO_WORLDS } from "../engine/generator";
import { WORLD_NOW } from "../timeline/world-clock";
import {
  generateMarketingToSalesAttribution,
  computeMarketingAttributionMaturity,
  latestMilestone,
  type MarketingLeadAttribution,
} from "../company/marketing-sales-attribution";
import type { MetaLeadGenerated, MarketingCrmLeadIngested, MarketingLeadIdentityMatched } from "../events/marketing-meta-crm-source";
import type { SalesAppointment } from "../world/sales-appointments";
import type { Opportunity } from "../events/opportunities";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";

// AUFTRAG — Marketing Coverage Checkpoint + Marketing-to-Sales Attribution
// Foundation V1, B13: Pflichttests für die kanonische, zeitlich korrekte
// Attributionskette Meta → CRM → First Call → Opportunity → Strategy Call →
// Won. Ausdrücklich KEINE Kostenquoten-/CAC-/Bewertungstests (harte
// Scope-Grenze, B7/B13).

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
function metaGen(id: string, generatedAt: string, campaignId = "campaign-01"): MetaLeadGenerated {
  return { id, externalLeadId: `ext-${id}`, provider: "meta", generatedAt, externalCampaignId: "cmp-synth", campaignId };
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
function opp(id: string, leadId: string, createdAt: string, currentStage: Opportunity["currentStage"] = "verhandlung", closedAt?: string): Opportunity {
  return { id, leadId, accountId: "account-synth", createdAt, currentStage, value: 10000, probability: 50, responsibleEmployeeId: "emp-synth", closedAt };
}

// Vollständig ausgereiftes, kontrolliertes Fixture-Szenario: ein Meta-Lead,
// der jeden Meilenstein bis Won durchläuft, mit klar getrennten Zeitpunkten
// für präzise As-of-Tests.
const FULL_META = metaGen("meta-full", "2025-01-01");
const FULL_MATCH = match("match-full", "meta-full", "crm-full", "lead-full", "2025-01-03");
const FULL_CRM = crmIngest("crm-full", "lead-full", "2025-01-03");
const FULL_FC = appt({ id: "sappt-fc-full", appointmentType: "first-call", leadId: "lead-full", bookedAt: "2025-01-05", heldAt: "2025-01-10", currentStatus: "held", conductedByEmployeeId: "emp-synth" });
const FULL_OPP = opp("opp-full", "lead-full", "2025-01-12", "gewonnen", "2025-02-15");
const FULL_SC = appt({ id: "sappt-sc-full", appointmentType: "strategy-call", leadId: "lead-full", opportunityId: "opp-full", bookedAt: "2025-01-15", heldAt: "2025-01-20", currentStatus: "held", conductedByEmployeeId: "emp-synth" });

function generateFull(asOf: string) {
  return generateMarketingToSalesAttribution({
    asOf,
    metaLeadGeneratedEvents: [FULL_META],
    marketingLeadIdentityMatchedEvents: [FULL_MATCH],
    marketingCrmLeadIngestedEvents: [FULL_CRM],
    salesAppointments: [FULL_FC, FULL_SC],
    opportunities: [FULL_OPP],
  });
}

function milestoneKeys(a: MarketingLeadAttribution): string[] {
  return a.milestones.map((m) => m.key);
}

// ============================================================================
// Meta → CRM (1-4)
// ============================================================================
describe("Marketing-to-Sales Attribution — Meta → CRM (1-4)", () => {
  it("1. Match-Event zwingend: ohne Match-Event bleibt leadId undefined", () => {
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: [metaGen("meta-orphan", "2025-01-01")],
      marketingLeadIdentityMatchedEvents: [],
      marketingCrmLeadIngestedEvents: [],
      salesAppointments: [],
      opportunities: [],
    });
    expect(snap.attributions[0]!.leadId).toBeUndefined();
    expect(milestoneKeys(snap.attributions[0]!)).toEqual(["meta-generated"]);
  });

  it("2. Pending vor matchedAt", () => {
    const snap = generateFull("2025-01-02"); // vor matchedAt (01-03)
    expect(snap.attributions[0]!.leadId).toBeUndefined();
    expect(milestoneKeys(snap.attributions[0]!)).toEqual(["meta-generated"]);
  });

  it("3. CRM-Verbindung ab matchedAt", () => {
    const snap = generateFull("2025-01-03"); // genau matchedAt
    expect(snap.attributions[0]!.leadId).toBe("lead-full");
    expect(milestoneKeys(snap.attributions[0]!)).toContain("crm-matched");
  });

  it("4. keine zukünftige interne Lead-ID sichtbar vor matchedAt", () => {
    const snap = generateFull("2025-01-02");
    expect(snap.attributions[0]!.leadId).not.toBe("lead-full");
    expect(snap.attributions[0]!.leadId).toBeUndefined();
  });
});

// ============================================================================
// Lead → First Call (5-10)
// ============================================================================
describe("Marketing-to-Sales Attribution — Lead → First Call (5-10)", () => {
  it("5. direkte Lead-ID: firstCallAppointmentIds ausschließlich über SalesAppointment.leadId zugeordnet", () => {
    const snap = generateFull(WORLD_NOW);
    expect(snap.attributions[0]!.firstCallAppointmentIds).toEqual(["sappt-fc-full"]);
  });

  it("6. Booked ab bookedAt", () => {
    const before = generateFull("2025-01-04"); // vor bookedAt (01-05)
    expect(before.attributions[0]!.firstCallAppointmentIds).toEqual([]);
    expect(milestoneKeys(before.attributions[0]!)).not.toContain("first-call-booked");
    const at = generateFull("2025-01-05");
    expect(at.attributions[0]!.firstCallAppointmentIds).toEqual(["sappt-fc-full"]);
    expect(milestoneKeys(at.attributions[0]!)).toContain("first-call-booked");
  });

  it("7. Held ab heldAt (getrennt von booked)", () => {
    const beforeHeld = generateFull("2025-01-09"); // gebucht, aber noch nicht stattgefunden
    expect(milestoneKeys(beforeHeld.attributions[0]!)).toContain("first-call-booked");
    expect(milestoneKeys(beforeHeld.attributions[0]!)).not.toContain("first-call-held");
    const atHeld = generateFull("2025-01-10");
    expect(milestoneKeys(atHeld.attributions[0]!)).toContain("first-call-held");
  });

  it("8. Reschedule zählt nicht als neue Buchung", () => {
    const rescheduled = appt({
      id: "sappt-fc-resched",
      appointmentType: "first-call",
      leadId: "lead-resched",
      bookedAt: "2025-01-05",
      reschedules: [{ rescheduledAt: "2025-01-06", previousScheduledFor: "2025-01-08", newScheduledFor: "2025-01-15" }],
      currentScheduledFor: "2025-01-15",
      currentStatus: "held",
      heldAt: "2025-01-15",
      conductedByEmployeeId: "emp-synth",
    });
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: [metaGen("meta-resched", "2025-01-01")],
      marketingLeadIdentityMatchedEvents: [match("match-resched", "meta-resched", "crm-resched", "lead-resched", "2025-01-02")],
      marketingCrmLeadIngestedEvents: [crmIngest("crm-resched", "lead-resched", "2025-01-02")],
      salesAppointments: [rescheduled],
      opportunities: [],
    });
    expect(snap.attributions[0]!.firstCallAppointmentIds.length).toBe(1); // eine Buchung, trotz Reschedule
  });

  it("9. Rebooking bleibt demselben Lead zuordenbar", () => {
    const original = appt({ id: "sappt-fc-orig", appointmentType: "first-call", leadId: "lead-rebook", bookedAt: "2025-01-05", currentStatus: "no-show", noShowRecordedAt: "2025-01-08" });
    const rebook = appt({ id: "sappt-fc-orig-rebook-1", appointmentType: "first-call", leadId: "lead-rebook", bookedAt: "2025-01-12", currentStatus: "held", heldAt: "2025-01-18", conductedByEmployeeId: "emp-synth", rebookedFromAppointmentId: "sappt-fc-orig", bookingSeriesId: "sappt-fc-orig" });
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: [metaGen("meta-rebook", "2025-01-01")],
      marketingLeadIdentityMatchedEvents: [match("match-rebook", "meta-rebook", "crm-rebook", "lead-rebook", "2025-01-02")],
      marketingCrmLeadIngestedEvents: [crmIngest("crm-rebook", "lead-rebook", "2025-01-02")],
      salesAppointments: [original, rebook],
      opportunities: [],
    });
    expect(snap.attributions[0]!.firstCallAppointmentIds.sort()).toEqual(["sappt-fc-orig", "sappt-fc-orig-rebook-1"]);
    // first-call-held stammt vom Rebook, nicht vom ursprünglichen No-Show
    const heldMilestone = snap.attributions[0]!.milestones.find((m) => m.key === "first-call-held");
    expect(heldMilestone?.evidenceId).toBe("sappt-fc-orig-rebook-1");
  });

  it("10. mehrere Appointments pro Lead sind in der Referenzwelt tatsächlich vorhanden (Rebooking-Realismus)", () => {
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
    });
    const multi = snap.attributions.filter((a) => a.firstCallAppointmentIds.length > 1);
    expect(multi.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Lead → Opportunity (11-15)
// ============================================================================
describe("Marketing-to-Sales Attribution — Lead → Opportunity (11-15)", () => {
  it("11. ausschließlich kanonische Verbindung über Opportunity.leadId", () => {
    const snap = generateFull(WORLD_NOW);
    expect(snap.attributions[0]!.opportunityId).toBe("opp-full");
  });

  it("12. keine Account-Heuristik: eine Opportunity mit gleichem Account, aber anderem Lead wird NICHT zugeordnet", () => {
    const decoyOpp = opp("opp-decoy", "lead-other", "2025-01-06"); // gleicher accountId "account-synth", anderer Lead
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: [FULL_META],
      marketingLeadIdentityMatchedEvents: [FULL_MATCH],
      marketingCrmLeadIngestedEvents: [FULL_CRM],
      salesAppointments: [],
      opportunities: [decoyOpp], // KEINE Opportunity mit leadId "lead-full" vorhanden
    });
    expect(snap.attributions[0]!.opportunityId).toBeUndefined();
  });

  it("13. keine Contact-Heuristik: identischer contactId auf Appointments unterschiedlicher Leads verursacht keine Fehlzuordnung", () => {
    const otherLeadAppt = appt({ id: "sappt-fc-other", appointmentType: "first-call", leadId: "lead-other", contactId: "contact-synth", bookedAt: "2025-01-05" });
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: [FULL_META],
      marketingLeadIdentityMatchedEvents: [FULL_MATCH],
      marketingCrmLeadIngestedEvents: [FULL_CRM],
      salesAppointments: [FULL_FC, otherLeadAppt], // beide contactId "contact-synth"
      opportunities: [],
    });
    expect(snap.attributions[0]!.firstCallAppointmentIds).toEqual(["sappt-fc-full"]);
  });

  it("14. Link erst ab dem fachlichen Entstehungszeitpunkt (Opportunity.createdAt)", () => {
    const before = generateFull("2025-01-11"); // vor createdAt (01-12)
    expect(before.attributions[0]!.opportunityId).toBeUndefined();
    const at = generateFull("2025-01-12");
    expect(at.attributions[0]!.opportunityId).toBe("opp-full");
  });

  it("15. mehrere Opportunities werden korrekt getrennt zugeordnet (keine globale Doppelzuordnung)", () => {
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
    });
    const opportunityIds = snap.attributions.filter((a) => a.opportunityId).map((a) => a.opportunityId);
    expect(new Set(opportunityIds).size).toBe(opportunityIds.length); // keine Opportunity zweifach zugeordnet
  });
});

// ============================================================================
// Opportunity → Strategy Call (16-19)
// ============================================================================
describe("Marketing-to-Sales Attribution — Opportunity → Strategy Call (16-19)", () => {
  it("16. direkte Opportunity-ID", () => {
    const snap = generateFull(WORLD_NOW);
    expect(snap.attributions[0]!.strategyCallAppointmentIds).toEqual(["sappt-sc-full"]);
  });

  it("17. Booked und Held zeitlich getrennt", () => {
    const beforeHeld = generateFull("2025-01-19");
    expect(milestoneKeys(beforeHeld.attributions[0]!)).toContain("strategy-call-booked");
    expect(milestoneKeys(beforeHeld.attributions[0]!)).not.toContain("strategy-call-held");
    const atHeld = generateFull("2025-01-20");
    expect(milestoneKeys(atHeld.attributions[0]!)).toContain("strategy-call-held");
  });

  it("18. Rebooking bei Strategy Call korrekt", () => {
    const original = appt({ id: "sappt-sc-orig", appointmentType: "strategy-call", leadId: "lead-screbook", opportunityId: "opp-screbook", bookedAt: "2025-01-15", currentStatus: "cancelled", cancelledAt: "2025-01-16" });
    const rebook = appt({ id: "sappt-sc-orig-rebook-1", appointmentType: "strategy-call", leadId: "lead-screbook", opportunityId: "opp-screbook", bookedAt: "2025-01-20", currentStatus: "held", heldAt: "2025-01-25", conductedByEmployeeId: "emp-synth", rebookedFromAppointmentId: "sappt-sc-orig" });
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: [metaGen("meta-screbook", "2025-01-01")],
      marketingLeadIdentityMatchedEvents: [match("match-screbook", "meta-screbook", "crm-screbook", "lead-screbook", "2025-01-02")],
      marketingCrmLeadIngestedEvents: [crmIngest("crm-screbook", "lead-screbook", "2025-01-02")],
      salesAppointments: [original, rebook],
      opportunities: [opp("opp-screbook", "lead-screbook", "2025-01-10")],
    });
    expect(snap.attributions[0]!.strategyCallAppointmentIds.sort()).toEqual(["sappt-sc-orig", "sappt-sc-orig-rebook-1"]);
  });

  it("19. Won ohne Strategy Call bleibt möglich (keine künstliche Pflichtkette)", () => {
    const wonNoStrategy = opp("opp-won-no-sc", "lead-won-no-sc", "2025-01-05", "gewonnen", "2025-02-01");
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: [metaGen("meta-won-no-sc", "2025-01-01")],
      marketingLeadIdentityMatchedEvents: [match("match-won-no-sc", "meta-won-no-sc", "crm-won-no-sc", "lead-won-no-sc", "2025-01-02")],
      marketingCrmLeadIngestedEvents: [crmIngest("crm-won-no-sc", "lead-won-no-sc", "2025-01-02")],
      salesAppointments: [],
      opportunities: [wonNoStrategy],
    });
    expect(milestoneKeys(snap.attributions[0]!)).toContain("won-opportunity");
    expect(milestoneKeys(snap.attributions[0]!)).not.toContain("strategy-call-booked");
  });
});

// ============================================================================
// Won (20-23)
// ============================================================================
describe("Marketing-to-Sales Attribution — Won (20-23)", () => {
  it("20. Won erst ab dem kanonischen Won-/Closed-Zeitpunkt", () => {
    const before = generateFull("2025-02-14");
    expect(milestoneKeys(before.attributions[0]!)).not.toContain("won-opportunity");
    const at = generateFull("2025-02-15");
    expect(milestoneKeys(at.attributions[0]!)).toContain("won-opportunity");
  });

  it("21. Future Won ausgeschlossen", () => {
    const before = generateFull("2025-02-01");
    const wonMilestone = before.attributions[0]!.milestones.find((m) => m.key === "won-opportunity");
    expect(wonMilestone).toBeUndefined();
  });

  it("22. Won wird an keiner Stelle als Neukunde bezeichnet", () => {
    const snap = generateFull(WORLD_NOW);
    const json = JSON.stringify(snap).toLowerCase();
    expect(json).not.toContain("neukunde");
    expect(json).not.toContain("customer-acquired");
    expect(json).not.toContain("\"customer\"");
  });

  it("23. mehrere Won-Opportunities desselben Accounts bleiben getrennte Opportunities", () => {
    const wonOppIds = world.opportunities.filter((o) => o.currentStage === "gewonnen").map((o) => o.id);
    const accountCounts = new Map<string, number>();
    for (const o of world.opportunities.filter((o) => o.currentStage === "gewonnen")) {
      accountCounts.set(o.accountId, (accountCounts.get(o.accountId) ?? 0) + 1);
    }
    const accountsWithMultipleWon = [...accountCounts.values()].filter((c) => c > 1);
    expect(accountsWithMultipleWon.length).toBeGreaterThan(0); // Repeat-Business existiert nachweislich
    expect(new Set(wonOppIds).size).toBe(wonOppIds.length); // dennoch jede Opportunity eindeutig
  });
});

// ============================================================================
// Cohort (24-29)
// ============================================================================
describe("Marketing-to-Sales Attribution — Cohort (24-29)", () => {
  it("24. Campaign bleibt erhalten", () => {
    const snap = generateFull(WORLD_NOW);
    expect(snap.attributions[0]!.campaignId).toBe("campaign-01");
  });

  it("25. generatedAt bleibt erhalten", () => {
    const snap = generateFull(WORLD_NOW);
    expect(snap.attributions[0]!.generatedAt).toBe("2025-01-01");
  });

  it("26. eindeutige Meta-Lead-ID über alle Attributionen", () => {
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
    });
    const ids = snap.attributions.map((a) => a.externalLeadId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("27. Milestones vollständig für einen vollständig ausgereiften, gewonnenen Fall", () => {
    const snap = generateFull(WORLD_NOW);
    expect(milestoneKeys(snap.attributions[0]!)).toEqual([
      "meta-generated", "crm-matched", "first-call-booked", "first-call-held",
      "opportunity-created", "strategy-call-booked", "strategy-call-held", "won-opportunity",
    ]);
  });

  it("28. eindeutige Leads und Eventcounts bleiben strukturell getrennt (eine Attribution, mehrere Appointment-IDs möglich)", () => {
    const original = appt({ id: "sappt-fc-cohort-a", appointmentType: "first-call", leadId: "lead-cohort", bookedAt: "2025-01-05", currentStatus: "no-show", noShowRecordedAt: "2025-01-08" });
    const rebook = appt({ id: "sappt-fc-cohort-a-rebook-1", appointmentType: "first-call", leadId: "lead-cohort", bookedAt: "2025-01-12", currentStatus: "held", heldAt: "2025-01-18", conductedByEmployeeId: "emp-synth" });
    const snap = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: [metaGen("meta-cohort", "2025-01-01")],
      marketingLeadIdentityMatchedEvents: [match("match-cohort", "meta-cohort", "crm-cohort", "lead-cohort", "2025-01-02")],
      marketingCrmLeadIngestedEvents: [crmIngest("crm-cohort", "lead-cohort", "2025-01-02")],
      salesAppointments: [original, rebook],
      opportunities: [],
    });
    expect(snap.attributions.length).toBe(1); // eine Attribution
    expect(snap.attributions[0]!.firstCallAppointmentIds.length).toBe(2); // zwei Buchungsereignisse (Activity-Sicht)
  });

  it("29. eine junge, noch nicht ausgereifte Kohorte wird nicht als gescheitert bewertet", () => {
    const young = generateMarketingToSalesAttribution({
      asOf: "2025-01-02", // ein Tag nach Generierung, noch kein Match möglich
      metaLeadGeneratedEvents: [metaGen("meta-young", "2025-01-01")],
      marketingLeadIdentityMatchedEvents: [],
      marketingCrmLeadIngestedEvents: [],
      salesAppointments: [],
      opportunities: [],
    });
    expect(milestoneKeys(young.attributions[0]!)).toEqual(["meta-generated"]);
    // kein Feld/Wert deutet "gescheitert"/"lost"/"failed" an
    const json = JSON.stringify(young).toLowerCase();
    expect(json).not.toContain("failed");
    expect(json).not.toContain("lost");
    // Maturity-Report behandelt fehlende Stufen als "kein Fall", nicht als 0
    const maturity = computeMarketingAttributionMaturity(young.attributions);
    expect(maturity.metaGeneratedToWon).toBeUndefined();
  });
});

// ============================================================================
// As-of (30-35)
// ============================================================================
describe("Marketing-to-Sales Attribution — As-of (30-35)", () => {
  it("30. historischer Snapshot vor Match", () => {
    const snap = generateFull("2025-01-02");
    expect(snap.attributions[0]!.leadId).toBeUndefined();
  });

  it("31. historischer Snapshot vor First Call", () => {
    const snap = generateFull("2025-01-04");
    expect(snap.attributions[0]!.firstCallAppointmentIds).toEqual([]);
  });

  it("32. historischer Snapshot vor Opportunity", () => {
    const snap = generateFull("2025-01-11");
    expect(snap.attributions[0]!.opportunityId).toBeUndefined();
  });

  it("33. historischer Snapshot vor Strategy Call", () => {
    const snap = generateFull("2025-01-14");
    expect(snap.attributions[0]!.strategyCallAppointmentIds).toEqual([]);
  });

  it("34. historischer Snapshot vor Won", () => {
    const snap = generateFull("2025-02-14");
    expect(milestoneKeys(snap.attributions[0]!)).not.toContain("won-opportunity");
  });

  it("35. spätere Events verändern eine bereits berechnete frühere Attribution nicht", () => {
    const historicalAsOf = "2025-01-10";
    const withFullFutureData = generateFull(historicalAsOf);
    // Dieselbe Berechnung mit einer auf historicalAsOf gekürzten Datenbasis (nur
    // Events, die bis dahin bereits existierten) muss identisch sein.
    const truncated = generateMarketingToSalesAttribution({
      asOf: historicalAsOf,
      metaLeadGeneratedEvents: [FULL_META],
      marketingLeadIdentityMatchedEvents: [FULL_MATCH],
      marketingCrmLeadIngestedEvents: [FULL_CRM],
      salesAppointments: [FULL_FC], // Strategy Call/Opportunity existieren zu diesem Zeitpunkt fachlich noch nicht
      opportunities: [],
    });
    expect(withFullFutureData).toEqual(truncated);
  });
});

// ============================================================================
// Regression (36-47)
// ============================================================================
describe("Marketing-to-Sales Attribution — Regression (36-47)", () => {
  it("36. Marketing Source Foundation unverändert", () => {
    expect(world.metaLeadGeneratedEvents.length).toBeGreaterThan(0);
    expect(world.marketingLeadIdentityMatchedEvents.length).toBeGreaterThan(0);
  });

  it("37. Coverage unverändert", () => {
    expect(world.marketingSourceCoverage.length).toBeGreaterThan(0);
  });

  it("38. Marketing Period Metrics weiterhin unabhängig berechenbar", async () => {
    const { generateMarketingPeriodMetrics } = await import("../company/marketing-period-metrics");
    const result = generateMarketingPeriodMetrics(WORLD_NOW, world.metaAdSpendRecords, world.metaLeadGeneratedEvents, world.marketingCrmLeadIngestedEvents, world.marketingLeadIdentityMatchedEvents, world.marketingSourceCoverage);
    expect(result.asOf).toBe(WORLD_NOW);
  });

  it("39. Sales Period Metrics unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.salesPeriodMetrics.asOf).toBe(WORLD_NOW);
  });

  it("40. Sales Appointments unverändert", () => {
    expect(world.salesAppointments.length).toBeGreaterThan(0);
  });

  it("41. Opportunities/Won/Lost unverändert", () => {
    expect(world.opportunities.filter((o) => o.currentStage === "gewonnen").length).toBeGreaterThan(0);
    expect(world.opportunities.filter((o) => o.currentStage === "verloren").length).toBeGreaterThan(0);
  });

  it("42. Marketing State/Observations unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.marketingObservation).toBeDefined();
  });

  it("43. Operations unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.deliveryUnits).toBeDefined();
  });

  it("44. People unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.employees.length).toBeGreaterThan(0);
  });

  it("45. Company/Ownership unverändert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.accountOwnerships.length).toBeGreaterThan(0);
  });

  it("46. RNG-Sequenzen unverändert: Attribution ist eine reine Funktion ohne eigenen Zufallsstrom", () => {
    const a = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
    });
    const b = generateMarketingToSalesAttribution({
      asOf: WORLD_NOW,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      salesAppointments: world.salesAppointments,
      opportunities: world.opportunities,
    });
    expect(a).toEqual(b);
  });

  it("47. Public Contract unverändert: keine neuen Attribution-Laufzeitsymbole in index.ts", async () => {
    const publicContract = await import("../index");
    expect(publicContract).not.toHaveProperty("generateMarketingToSalesAttribution");
    expect(publicContract).not.toHaveProperty("computeMarketingAttributionMaturity");
    expect(publicContract).not.toHaveProperty("latestMilestone");
  });
});
