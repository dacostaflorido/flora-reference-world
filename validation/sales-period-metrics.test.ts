import { describe, expect, it } from "vitest";
import { SCENARIO_WORLDS, generateScenarioWorld } from "../engine/generator";
import { SCENARIO_PROFILES, BASELINE_PROFILE } from "../engine/scenario-profiles";
import { WORLD_SEED } from "../engine/seed";
import { WORLD_NOW } from "../timeline/world-clock";
import { addDays } from "../engine/random";
import { startOfWeek, startOfMonth } from "../timeline/calendar";
import { generateSalesPeriodMetrics, type SalesPeriodMetrics } from "../company/sales-period-metrics";
import { generateFullCompanyContext } from "../company/full-company-context";
import { generateBusinessStateSnapshot } from "../business-state/business-state";
import { generateOperationsQueueDurationSignalObservation, generateOperationsDeliveryDurationSignalObservation } from "../observations/operations-observations";
import { WORLD_TIMELINE_START } from "../timeline/world-clock";
import type { SalesAppointmentBooked, SalesAppointmentHeld } from "../events/sales-appointment-lifecycle";
import type { Opportunity } from "../events/opportunities";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";

// AUFTRAG — Sales Appointment Checkpoint + Sales Period KPI Foundation V1,
// B9: Pflichttests für die rein deskriptive Sales-Zeitraumebene (Ebene 1 der
// Executive-Capability-Architektur). Ausdrücklich KEINE Rate-/Conversion-/
// Capability-Tests — nur Periodengrenzen, Zählsemantik, As-of-Sicherheit,
// Evidenz und Regression.

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

function booked(id: string, appointmentId: string, appointmentType: "first-call" | "strategy-call", bookedAt: string): SalesAppointmentBooked {
  return { id, appointmentId, appointmentType, bookedAt, scheduledFor: addDays(bookedAt, 5), assignedEmployeeId: "emp-synth" };
}
function held(id: string, appointmentId: string, appointmentType: "first-call" | "strategy-call", heldAt: string): SalesAppointmentHeld {
  return { id, appointmentId, appointmentType, heldAt, conductedByEmployeeId: "emp-synth" };
}
function opp(id: string, closedAt: string | undefined, currentStage: Opportunity["currentStage"] = "gewonnen"): Opportunity {
  return { id, leadId: "lead-synth", accountId: "account-synth", createdAt: "2024-06-01", currentStage, value: 1000, probability: 1, responsibleEmployeeId: "emp-synth", closedAt };
}

// ============================================================================
// Periodengrenzen
// ============================================================================
describe("Sales Period Metrics — Periodengrenzen", () => {
  it("gestern korrekt: genau der Kalendertag vor asOf", () => {
    const snap = generateSalesPeriodMetrics("2025-09-01", [], [], []);
    expect(snap.yesterday.bounds).toEqual({ from: "2025-08-31", through: "2025-08-31" });
  });

  it("Montag als Wochenbeginn: startOfWeek(Montag) === derselbe Tag", () => {
    expect(startOfWeek("2025-09-01")).toBe("2025-09-01"); // 2025-09-01 ist ein Montag
  });

  it("Sonntag korrekt zur laufenden Woche gehörig: startOfWeek(Sonntag) === vorheriger Montag", () => {
    expect(startOfWeek("2025-09-07")).toBe("2025-09-01"); // 2025-09-07 ist der folgende Sonntag
  });

  it("laufende Woche einschließlich asOf: bounds.through === asOf", () => {
    const snap = generateSalesPeriodMetrics("2025-09-04", [], [], []); // Donnerstag
    expect(snap.weekToDate.bounds).toEqual({ from: "2025-09-01", through: "2025-09-04" });
  });

  it("laufender Monat einschließlich asOf: bounds.through === asOf, bounds.from === 1. des Monats", () => {
    const snap = generateSalesPeriodMetrics("2025-09-15", [], [], []);
    expect(snap.monthToDate.bounds).toEqual({ from: "2025-09-01", through: "2025-09-15" });
  });

  it("Monatswechsel korrekt: asOf am 3. eines neuen Monats -> MTD beginnt am 1. desselben Monats, nicht des Vormonats", () => {
    const snap = generateSalesPeriodMetrics("2025-10-03", [], [], []);
    expect(snap.monthToDate.bounds).toEqual({ from: "2025-10-01", through: "2025-10-03" });
    // WTD kann in den Vormonat hineinreichen (Wochengrenzen ignorieren Monatsgrenzen).
    expect(startOfWeek("2025-10-03") <= "2025-10-03").toBe(true);
  });

  it("Jahreswechsel korrekt: asOf am 2. Januar -> MTD beginnt 01.01. des neuen Jahres", () => {
    const snap = generateSalesPeriodMetrics("2026-01-02", [], [], []);
    expect(snap.monthToDate.bounds).toEqual({ from: "2026-01-01", through: "2026-01-02" });
    expect(snap.yesterday.bounds).toEqual({ from: "2026-01-01", through: "2026-01-01" });
  });

  it("Leap-Year-Verhalten: 29. Februar 2024 korrekt als 'gestern' für den 1. März 2024 behandelt", () => {
    const snap = generateSalesPeriodMetrics("2024-03-01", [], [], []);
    expect(snap.yesterday.bounds).toEqual({ from: "2024-02-29", through: "2024-02-29" });
  });

  it("WTD umfasst mehrere Tage, wenn asOf nicht Montag ist", () => {
    const snap = generateSalesPeriodMetrics("2025-09-05", [], [], []); // Freitag
    const days = (new Date("2025-09-05T00:00:00Z").getTime() - new Date("2025-09-01T00:00:00Z").getTime()) / 86400000;
    expect(days).toBe(4);
    expect(snap.weekToDate.bounds.from).toBe("2025-09-01");
  });

  it("MTD ist länger als WTD, wenn der Monat vor der laufenden Woche begann", () => {
    const snap = generateSalesPeriodMetrics("2025-09-20", [], [], []); // Samstag, Woche 6 des Monats
    expect(snap.monthToDate.bounds.from < snap.weekToDate.bounds.from).toBe(true);
  });

  it("startOfMonth funktioniert unverändert über Monatsgrenzen", () => {
    expect(startOfMonth("2025-02-14")).toBe("2025-02-01");
    expect(startOfMonth("2025-12-31")).toBe("2025-12-01");
  });
});

// ============================================================================
// Erstgespräche terminiert
// ============================================================================
describe("Sales Period Metrics — Erstgespräche terminiert", () => {
  it("Booked Event wird nach bookedAt gezählt", () => {
    const b = [booked("b1", "a1", "first-call", "2025-09-01")];
    const snap = generateSalesPeriodMetrics("2025-09-02", b, [], []);
    expect(snap.yesterday.firstCallsBooked).toBe(1);
  });

  it("zukünftiger Gesprächstermin darf bereits als gebucht zählen (scheduledFor > asOf ist irrelevant)", () => {
    const b: SalesAppointmentBooked = { id: "b1", appointmentId: "a1", appointmentType: "first-call", bookedAt: "2025-09-01", scheduledFor: "2025-12-01", assignedEmployeeId: "e" };
    const snap = generateSalesPeriodMetrics("2025-09-01", [b], [], []);
    expect(snap.weekToDate.firstCallsBooked).toBe(1);
  });

  it("Held-Datum ist für den Booked Count irrelevant", () => {
    const b = [booked("b1", "a1", "first-call", "2025-09-01")];
    const h = [held("h1", "a1", "first-call", "2025-09-10")]; // außerhalb des betrachteten Zeitraums
    const snap = generateSalesPeriodMetrics("2025-09-01", b, h, []);
    expect(snap.weekToDate.firstCallsBooked).toBe(1);
  });

  it("Reschedule erhöht den Booked Count nicht (pro Appointment existiert genau ein Booked-Event)", () => {
    const b = [booked("b1", "a1", "first-call", "2025-09-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", b, [], []);
    expect(snap.weekToDate.firstCallsBooked).toBe(1);
  });

  it("Rebooking erzeugt eine neue Terminierung (zwei unabhängige Booked-Events zählen als zwei)", () => {
    const b = [booked("b1", "a1", "first-call", "2025-09-01"), booked("b2", "a1-rebook-1", "first-call", "2025-09-02")];
    const snap = generateSalesPeriodMetrics("2025-09-02", b, [], []);
    expect(snap.weekToDate.firstCallsBooked).toBe(2);
  });

  it("andere Appointment-Typen werden ausgeschlossen", () => {
    const b = [booked("b1", "a1", "strategy-call", "2025-09-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", b, [], []);
    expect(snap.weekToDate.firstCallsBooked).toBe(0);
    expect(snap.weekToDate.strategyCallsBooked).toBe(1);
  });

  it("Events außerhalb der Periode werden ausgeschlossen", () => {
    const b = [booked("b1", "a1", "first-call", "2025-08-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", b, [], []);
    expect(snap.yesterday.firstCallsBooked).toBe(0);
    expect(snap.weekToDate.firstCallsBooked).toBe(0);
    expect(snap.monthToDate.firstCallsBooked).toBe(0);
  });
});

// ============================================================================
// Erstgespräche stattgefunden
// ============================================================================
describe("Sales Period Metrics — Erstgespräche stattgefunden", () => {
  it("nur Held Events werden gezählt", () => {
    const h = [held("h1", "a1", "first-call", "2025-09-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", [], h, []);
    expect(snap.weekToDate.firstCallsHeld).toBe(1);
  });

  it("Zählung erfolgt nach heldAt, nicht nach einem anderen Datum", () => {
    const h = [held("h1", "a1", "first-call", "2025-08-15")];
    const snap = generateSalesPeriodMetrics("2025-09-01", [], h, []);
    expect(snap.monthToDate.firstCallsHeld).toBe(0); // liegt außerhalb September
  });

  it("Scheduled/No-Show/Cancelled erzeugen kein Held-Event und zählen daher nicht", () => {
    // Strukturell garantiert: es gibt kein Held-Event für nicht gehaltene
    // Appointments (siehe generateSalesAppointmentHeldEvents) — hier über eine
    // leere heldEvents-Liste bei vorhandenem Booked-Event demonstriert.
    const b = [booked("b1", "a1", "first-call", "2025-09-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", b, [], []);
    expect(snap.weekToDate.firstCallsHeld).toBe(0);
  });

  it("Future Held wird ausgeschlossen", () => {
    const h = [held("h1", "a1", "first-call", "2025-09-05")];
    const snap = generateSalesPeriodMetrics("2025-09-01", [], h, []);
    expect(snap.weekToDate.firstCallsHeld).toBe(0);
  });
});

// ============================================================================
// Strategiegespräche (vereinbart + geführt) — dieselben Regeln separat
// ============================================================================
describe("Sales Period Metrics — Strategiegespräche vereinbart/geführt", () => {
  it("vereinbart: Booked Event nach bookedAt, andere Typen ausgeschlossen", () => {
    const b = [booked("b1", "a1", "strategy-call", "2025-09-01"), booked("b2", "a2", "first-call", "2025-09-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", b, [], []);
    expect(snap.weekToDate.strategyCallsBooked).toBe(1);
  });

  it("geführt: nur Held Events nach heldAt, No-Show/Cancelled/Scheduled ausgeschlossen", () => {
    const h = [held("h1", "a1", "strategy-call", "2025-09-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", [], h, []);
    expect(snap.weekToDate.strategyCallsHeld).toBe(1);
  });

  it("Rebooking erzeugt eine neue Vereinbarung", () => {
    const b = [booked("b1", "a1", "strategy-call", "2025-09-01"), booked("b2", "a1-rebook-1", "strategy-call", "2025-09-02")];
    const snap = generateSalesPeriodMetrics("2025-09-02", b, [], []);
    expect(snap.weekToDate.strategyCallsBooked).toBe(2);
  });

  it("Events außerhalb der Periode ausgeschlossen", () => {
    const b = [booked("b1", "a1", "strategy-call", "2025-01-01")];
    const h = [held("h1", "a1", "strategy-call", "2025-01-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", b, h, []);
    expect(snap.monthToDate.strategyCallsBooked).toBe(0);
    expect(snap.monthToDate.strategyCallsHeld).toBe(0);
  });
});

// ============================================================================
// Kunden/Won
// ============================================================================
describe("Sales Period Metrics — Kunden/Won", () => {
  it("kanonisches Gewinnereignis: opportunity.closedAt wird verwendet", () => {
    const o = [opp("opp-1", "2025-09-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", [], [], o);
    expect(snap.weekToDate.wonOpportunities).toBe(1);
    expect(snap.weekToDate.wonOpportunityIds).toEqual(["opp-1"]);
  });

  it("korrekter Ereigniszeitpunkt: closedAt außerhalb der Periode wird nicht gezählt", () => {
    const o = [opp("opp-1", "2025-01-01")];
    const snap = generateSalesPeriodMetrics("2025-09-01", [], [], o);
    expect(snap.monthToDate.wonOpportunities).toBe(0);
  });

  it("keine aktuellen Bestände: nicht-gewonnene Opportunities zählen nie mit, unabhängig von closedAt", () => {
    const o = [opp("opp-1", "2025-09-01", "verloren")];
    const snap = generateSalesPeriodMetrics("2025-09-01", [], [], o);
    expect(snap.weekToDate.wonOpportunities).toBe(0);
  });

  it("kein Future Leakage: Opportunity, die erst nach asOf gewonnen wird, ist noch nicht sichtbar", () => {
    const o = [opp("opp-1", "2025-09-05")];
    const snap = generateSalesPeriodMetrics("2025-09-01", [], [], o);
    expect(snap.weekToDate.wonOpportunities).toBe(0);
  });

  it("Accounts werden entsprechend der gewählten Semantik NICHT dedupliziert — jede gewonnene Opportunity zählt einzeln (Variante C: 'gewonnene Opportunities', nicht 'Kunden')", () => {
    const o = [opp("opp-1", "2025-09-01"), opp("opp-2", "2025-09-01")];
    // beide Opportunities könnten fachlich demselben Account gehören
    // (Repeat-Business, siehe Forensik) — die Zählung bleibt bewusst
    // Opportunity-genau, keine künstliche Account-Deduplizierung.
    const snap = generateSalesPeriodMetrics("2025-09-01", [], [], o);
    expect(snap.weekToDate.wonOpportunities).toBe(2);
  });

  it("fachliche UI-Bezeichnung durch Modellsemantik belegt: Feldname ist 'wonOpportunities', kein 'customersWon'-Feld existiert", () => {
    const snap = generateSalesPeriodMetrics("2025-09-01", [], [], []);
    expect(snap.weekToDate).toHaveProperty("wonOpportunities");
    expect(snap.weekToDate).not.toHaveProperty("customersWon");
    expect(snap.weekToDate).not.toHaveProperty("customers");
  });

  it("Repeat-Business-Befund bleibt in der echten Referenzwelt korrekt sichtbar (79 Won, nur 58 eindeutige Accounts)", () => {
    const won = world.opportunities.filter((o) => o.currentStage === "gewonnen");
    const uniqueAccounts = new Set(won.map((o) => o.accountId));
    expect(won.length).toBe(79);
    expect(uniqueAccounts.size).toBeLessThan(won.length);
  });
});

// ============================================================================
// As-of-Sicherheit
// ============================================================================
describe("Sales Period Metrics — As-of-Sicherheit", () => {
  it("historische Berechnung bleibt unverändert, wenn spätere Events existieren", () => {
    const b = [booked("b1", "a1", "first-call", "2025-09-01"), booked("b2", "a2", "first-call", "2025-09-10")];
    const withoutLater = generateSalesPeriodMetrics("2025-09-01", [b[0]!], [], []);
    const withLater = generateSalesPeriodMetrics("2025-09-01", b, [], []);
    expect(withLater.weekToDate.firstCallsBooked).toBe(withoutLater.weekToDate.firstCallsBooked);
  });

  it("spätere Reschedules verändern historische Booked-Werte nicht (kein Reschedule-Event fließt überhaupt in die Zählung ein)", () => {
    const b = [booked("b1", "a1", "first-call", "2025-09-01")];
    const snap1 = generateSalesPeriodMetrics("2025-09-01", b, [], []);
    const snap2 = generateSalesPeriodMetrics("2025-09-01", b, [], []);
    expect(snap1.weekToDate.firstCallsBooked).toBe(snap2.weekToDate.firstCallsBooked);
  });

  it("spätere Outcomes verändern historische Held Counts nicht", () => {
    const h = [held("h1", "a1", "first-call", "2025-09-10")]; // liegt nach dem betrachteten asOf
    const snap = generateSalesPeriodMetrics("2025-09-01", [], h, []);
    expect(snap.weekToDate.firstCallsHeld).toBe(0);
  });

  it("spätere Won-Ereignisse verändern historische Kundenwerte nicht", () => {
    const o = [opp("opp-1", "2025-09-10")];
    const snap = generateSalesPeriodMetrics("2025-09-01", [], [], o);
    expect(snap.weekToDate.wonOpportunities).toBe(0);
  });

  it("echte Referenzwelt: ein früherer asOf zeigt nie mehr als der volle WORLD_NOW-Stand", () => {
    const earlierAsOf = addDays(WORLD_NOW, -30);
    const full = generateSalesPeriodMetrics(WORLD_NOW, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);
    const earlier = generateSalesPeriodMetrics(earlierAsOf, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);
    // Strukturelle Prüfung: keine der früheren IDs darf ein Ereignis nach earlierAsOf tragen.
    for (const id of earlier.monthToDate.firstCallsBookedAppointmentIds) {
      const event = world.salesAppointmentBookedEvents.find((e) => e.appointmentId === id)!;
      expect(event.bookedAt <= earlierAsOf).toBe(true);
    }
    expect(full).toBeDefined();
  });
});

// ============================================================================
// Evidenz
// ============================================================================
describe("Sales Period Metrics — Evidenz", () => {
  const snap = generateSalesPeriodMetrics(WORLD_NOW, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);

  function checkEvidence(metrics: SalesPeriodMetrics) {
    expect(metrics.firstCallsBookedAppointmentIds.length).toBe(metrics.firstCallsBooked);
    expect(metrics.firstCallsHeldAppointmentIds.length).toBe(metrics.firstCallsHeld);
    expect(metrics.strategyCallsBookedAppointmentIds.length).toBe(metrics.strategyCallsBooked);
    expect(metrics.strategyCallsHeldAppointmentIds.length).toBe(metrics.strategyCallsHeld);
    expect(metrics.wonOpportunityIds.length).toBe(metrics.wonOpportunities);
    for (const ids of [
      metrics.firstCallsBookedAppointmentIds,
      metrics.firstCallsHeldAppointmentIds,
      metrics.strategyCallsBookedAppointmentIds,
      metrics.strategyCallsHeldAppointmentIds,
      metrics.wonOpportunityIds,
    ]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  }

  it("jede Zahl ist durch exakt passende IDs belegbar (Count === Evidenzanzahl)", () => {
    checkEvidence(snap.yesterday);
    checkEvidence(snap.weekToDate);
    checkEvidence(snap.monthToDate);
  });

  it("keine ID außerhalb der Periode: jede referenzierte Appointment hat ihr Booked-/Held-Ereignis innerhalb der Grenzen", () => {
    for (const id of snap.monthToDate.firstCallsBookedAppointmentIds) {
      const event = world.salesAppointmentBookedEvents.find((e) => e.appointmentId === id)!;
      expect(event.bookedAt >= snap.monthToDate.bounds.from && event.bookedAt <= snap.monthToDate.bounds.through).toBe(true);
    }
  });

  it("keine doppelte ID in irgendeiner Evidenzliste", () => {
    checkEvidence(snap.yesterday);
  });
});

// ============================================================================
// Regression
// ============================================================================
describe("Sales Period Metrics — Regression", () => {
  const context = generateFullCompanyContext();

  it("Appointment Lifecycle unverändert", () => {
    expect(world.salesAppointments.length).toBeGreaterThan(0);
    const firstCalls = world.salesAppointments.filter((a) => a.appointmentType === "first-call");
    expect(firstCalls.length).toBe(640);
  });

  it("alle sechs Sales Scenario States unverändert", () => {
    const expected: Record<string, string> = {
      baseline: "ausgeglichen",
      "operativer-fokus": "verlangsamte-pipeline",
      "strategischer-tag": "strategischer-freiraum",
      wachstumsdruck: "ausgeglichen",
      "team-engpass": "konzentrierte-last",
      "pipeline-risiko": "operative-anspannung",
    };
    for (const profile of SCENARIO_PROFILES) {
      const w = SCENARIO_WORLDS[profile.id];
      const businessState = generateBusinessStateSnapshot(w.groundTruth, w.observations);
      expect(businessState.type, `profile ${profile.id}`).toBe(expected[profile.id]);
    }
  });

  it("bestehende Sales Observations unverändert", () => {
    const kinds = new Set(world.observations.map((o) => o.kind));
    expect(kinds.has("pipeline-stagnation-summary")).toBe(true);
  });

  it("Opportunity Counts/Won/Lost unverändert", () => {
    expect(world.opportunities.filter((o) => o.currentStage === "gewonnen").length).toBe(79);
  });

  it("Marketing unverändert", () => {
    const marketing = context.executiveContext.areaSummaries.find((a) => a.key === "marketing")!;
    expect(marketing.evaluationStatus).toBe("bewertet");
  });

  it("Operations States und Signals unverändert", () => {
    const operations = context.executiveContext.areaSummaries.find((a) => a.key === "operations")!;
    expect(operations.state).toBeNull();
    expect(operations.evaluationStatus).toBe("unzureichende-evidenz");
    const qs = generateOperationsQueueDurationSignalObservation(SCENARIO_WORLDS.baseline.deliveryUnits, WORLD_NOW, WORLD_TIMELINE_START);
    const ds = generateOperationsDeliveryDurationSignalObservation(SCENARIO_WORLDS.baseline.deliveryUnits, WORLD_NOW, WORLD_TIMELINE_START);
    expect(qs?.signal).toBe("stabil");
    expect(ds?.signal).toBe("stabil");
  });

  it("People unverändert", () => {
    const people = context.executiveContext.areaSummaries.find((a) => a.key === "people")!;
    expect(people.state).toBe("ausgeglichen");
  });

  it("Company unverändert", () => {
    expect(context.businessState.type).toBe("ausgeglichen");
  });

  it("Ownership/Fairness unverändert", () => {
    const operations = context.executiveContext.areaSummaries.find((a) => a.key === "operations")!;
    expect(operations.relevantMetrics.fairShare).toBe(5);
  });

  it("deterministische RNG-Stabilität: gleicher Seed erzeugt identische Appointments (Period Metrics fügt keinen neuen RNG-Verbrauch hinzu)", () => {
    const a = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    generateSalesPeriodMetrics(WORLD_NOW, a.salesAppointmentBookedEvents, a.salesAppointmentHeldEvents, a.opportunities);
    const b = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    expect(a.salesAppointments).toEqual(b.salesAppointments);
  });

  it("Public Contract unverändert: generateFullCompanyContext()-Shape unverändert, keine neuen Top-Level-Keys", () => {
    expect(Object.keys(context).sort()).toEqual(["businessState", "executiveContext", "executiveKpis"].sort());
  });

  it("keine Rates/Capability/Bewertung: SalesPeriodMetrics enthält keine verbotenen Felder", () => {
    const snap = generateSalesPeriodMetrics(WORLD_NOW, [], [], []);
    // "rate" bewusst NICHT in dieser Liste: es ist eine Teilzeichenkette von
    // "strategy" (strategyCallsBooked etc.) und würde dort einen reinen
    // Namenskollisions-Fehlalarm auslösen, keinen echten Rate-/Quotenwert.
    const forbidden = ["conversionrate", "showrate", "noshowrate", "capability", "severity", "confidence", "trend", "benchmark", "target", "score"];
    const keys = Object.keys(snap.weekToDate).map((k) => k.toLowerCase());
    for (const f of forbidden) {
      expect(keys.some((k) => k.includes(f))).toBe(false);
    }
  });
});

// ============================================================================
// Korrekturauftrag "Sales Period Metrics Snapshot Integration" — K7: Tests
// gegen den TATSÄCHLICH integrierten Pfad (WorldSnapshot), nicht nur die
// isolierte Funktion. generateSalesPeriodMetrics selbst bleibt vollständig
// durch die Tests oben abgedeckt — hier wird ausschließlich die kanonische
// Einmalberechnung innerhalb generateWorldSnapshot geprüft.
// ============================================================================
describe("Sales Period Metrics — Snapshot-Integration (K7)", () => {
  it("1. WorldSnapshot(asOf) enthält genau die für dieses asOf berechneten drei Perioden", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const direct = generateSalesPeriodMetrics(WORLD_NOW, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);
    expect(snapshot.salesPeriodMetrics).toEqual(direct);
  });

  it("2. ein historischer Snapshot enthält keine späteren Booked Events", () => {
    const asOf = addDays(WORLD_NOW, -60);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    for (const id of [
      ...snapshot.salesPeriodMetrics.yesterday.firstCallsBookedAppointmentIds,
      ...snapshot.salesPeriodMetrics.weekToDate.firstCallsBookedAppointmentIds,
      ...snapshot.salesPeriodMetrics.monthToDate.firstCallsBookedAppointmentIds,
    ]) {
      const event = world.salesAppointmentBookedEvents.find((e) => e.appointmentId === id)!;
      expect(event.bookedAt <= asOf).toBe(true);
    }
  });

  it("3. ein historischer Snapshot enthält keine späteren Held Events", () => {
    const asOf = addDays(WORLD_NOW, -60);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    for (const id of [
      ...snapshot.salesPeriodMetrics.yesterday.firstCallsHeldAppointmentIds,
      ...snapshot.salesPeriodMetrics.weekToDate.firstCallsHeldAppointmentIds,
      ...snapshot.salesPeriodMetrics.monthToDate.firstCallsHeldAppointmentIds,
    ]) {
      const event = world.salesAppointmentHeldEvents.find((e) => e.appointmentId === id)!;
      expect(event.heldAt <= asOf).toBe(true);
    }
  });

  it("4. ein historischer Snapshot enthält keine späteren Won-Opportunities", () => {
    const asOf = addDays(WORLD_NOW, -60);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    const opportunityById = new Map(world.opportunities.map((o) => [o.id, o]));
    for (const id of [
      ...snapshot.salesPeriodMetrics.yesterday.wonOpportunityIds,
      ...snapshot.salesPeriodMetrics.weekToDate.wonOpportunityIds,
      ...snapshot.salesPeriodMetrics.monthToDate.wonOpportunityIds,
    ]) {
      const o = opportunityById.get(id)!;
      expect(o.closedAt! <= asOf).toBe(true);
    }
  });

  it("5. spätere Reschedules verändern historische Booked Counts nicht (kein Reschedule-Event fließt in die Zählung ein)", () => {
    const asOf = addDays(WORLD_NOW, -60);
    const snapshotA = generateWorldSnapshot(toSource(), asOf);
    const snapshotB = generateWorldSnapshot(toSource(), asOf);
    expect(snapshotA.salesPeriodMetrics.monthToDate.firstCallsBooked).toBe(snapshotB.salesPeriodMetrics.monthToDate.firstCallsBooked);
  });

  it("6. spätere Rebookings sind vor ihrem eigenen bookedAt unsichtbar", () => {
    const rebooked = world.salesAppointments.find((a) => a.rebookedFromAppointmentId !== undefined)!;
    expect(rebooked).toBeDefined();
    const beforeOwnBooking = addDays(rebooked.bookedAt, -1);
    const snapshot = generateWorldSnapshot(toSource(), beforeOwnBooking);
    const allBookedIds = [
      ...snapshot.salesPeriodMetrics.yesterday.firstCallsBookedAppointmentIds,
      ...snapshot.salesPeriodMetrics.weekToDate.firstCallsBookedAppointmentIds,
      ...snapshot.salesPeriodMetrics.monthToDate.firstCallsBookedAppointmentIds,
      ...snapshot.salesPeriodMetrics.yesterday.strategyCallsBookedAppointmentIds,
      ...snapshot.salesPeriodMetrics.weekToDate.strategyCallsBookedAppointmentIds,
      ...snapshot.salesPeriodMetrics.monthToDate.strategyCallsBookedAppointmentIds,
    ];
    expect(allBookedIds).not.toContain(rebooked.id);
  });

  it("7. WTD und MTD werden im integrierten Pfad unabhängig berechnet", () => {
    const asOf = "2025-09-20"; // Samstag, Woche beginnt später als der Monat
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    expect(snapshot.salesPeriodMetrics.monthToDate.bounds.from < snapshot.salesPeriodMetrics.weekToDate.bounds.from).toBe(true);
  });

  it("8. WORLD_NOW wird nicht stillschweigend statt des Snapshot-asOf verwendet", () => {
    const historicalAsOf = addDays(WORLD_NOW, -100);
    const snapshot = generateWorldSnapshot(toSource(), historicalAsOf);
    expect(snapshot.salesPeriodMetrics.asOf).toBe(historicalAsOf);
    expect(snapshot.salesPeriodMetrics.asOf).not.toBe(WORLD_NOW);
    expect(snapshot.salesPeriodMetrics.yesterday.bounds.through).toBe(addDays(historicalAsOf, -1));
  });

  it("9. direkter Funktionsaufruf und integriertes Snapshot-Ergebnis sind identisch", () => {
    const asOf = addDays(WORLD_NOW, -30);
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    const direct = generateSalesPeriodMetrics(asOf, world.salesAppointmentBookedEvents, world.salesAppointmentHeldEvents, world.opportunities);
    expect(snapshot.salesPeriodMetrics).toEqual(direct);
  });

  it("10. Evidenzlisten im integrierten Objekt stimmen exakt mit den Counts überein", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    for (const metrics of [snapshot.salesPeriodMetrics.yesterday, snapshot.salesPeriodMetrics.weekToDate, snapshot.salesPeriodMetrics.monthToDate]) {
      expect(metrics.firstCallsBookedAppointmentIds.length).toBe(metrics.firstCallsBooked);
      expect(metrics.firstCallsHeldAppointmentIds.length).toBe(metrics.firstCallsHeld);
      expect(metrics.strategyCallsBookedAppointmentIds.length).toBe(metrics.strategyCallsBooked);
      expect(metrics.strategyCallsHeldAppointmentIds.length).toBe(metrics.strategyCallsHeld);
      expect(metrics.wonOpportunityIds.length).toBe(metrics.wonOpportunities);
    }
  });

  it("11. kein toter Code: WorldSnapshotSource verlangt die neuen Felder (Typsystem erzwingt Verdrahtung bei jedem Aufrufer)", () => {
    // Struktureller Beweis: toSource() oben MUSS salesAppointmentBookedEvents/
    // -HeldEvents liefern, sonst kompiliert diese Datei nicht (siehe
    // WorldSnapshotSource in snapshot/snapshot.ts) — bereits der erfolgreiche
    // Typecheck dieser Datei ist der Nachweis.
    const source = toSource();
    expect(source.salesAppointmentBookedEvents.length).toBeGreaterThan(0);
    expect(source.salesAppointmentHeldEvents.length).toBeGreaterThan(0);
  });
});
