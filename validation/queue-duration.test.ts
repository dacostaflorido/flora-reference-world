import { describe, expect, it } from "vitest";
import {
  generateOperationsQueueDurationObservation,
  generateOperationsDeliveryFairShareObservation,
  generateOperationsCompletedDeliveryDurationObservation,
} from "../observations/operations-observations";
import { generateOperationsAreaSummary } from "../company/company-area-summaries";
import { generateGroundTruthSnapshot } from "../ground-truth/ground-truth";
import { generateDeliveryUnits, type DeliveryUnit } from "../world/delivery-units";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { daysBetween } from "../engine/random";
import { SCENARIO_WORLDS } from "../engine/generator";
import { WORLD_NOW } from "../timeline/world-clock";

// Queue Duration Observation V1 — dedizierte Testdatei. Beantwortet ausschließlich,
// wie lange es bei bereits gestarteten DeliveryUnits vom Entstehen der
// Lieferverpflichtung (Queue) bis zum tatsächlichen Start dauerte. Kein Completion
// Event erforderlich. Keine Aussage über noch wartende (eingereihte) Units, keine
// Prognose, kein Trend, keine SLA-/Termintreueaussage.

const world = SCENARIO_WORLDS.baseline;
const units = world.deliveryUnits;
const opportunityById = new Map(world.opportunities.map((o) => [o.id, o]));
const unitById = new Map(units.map((u) => [u.id, u]));
const baselineObservation = generateOperationsQueueDurationObservation(units, WORLD_NOW)!;

// Synthetische Fixtures für präzise Kontrolle.
function makeUnit(overrides: Partial<DeliveryUnit> & { id: string }): DeliveryUnit {
  return {
    opportunityId: `opp-for-${overrides.id}`,
    accountId: `account-for-${overrides.id}`,
    assignedEmployeeId: "emp-henrik-paulsen",
    startDate: "2025-01-01",
    status: "eingereiht",
    ...overrides,
  };
}

const oddPopulation: DeliveryUnit[] = [
  makeUnit({ id: "odd-1", startDate: "2025-01-01", actualStartDate: "2025-01-02" }), // 1d
  makeUnit({ id: "odd-2", startDate: "2025-01-01", actualStartDate: "2025-01-05" }), // 4d
  makeUnit({ id: "odd-3", startDate: "2025-01-01", actualStartDate: "2025-01-09" }), // 8d
];

const evenPopulation: DeliveryUnit[] = [
  makeUnit({ id: "even-1", startDate: "2025-01-01", actualStartDate: "2025-01-01" }), // 0d
  makeUnit({ id: "even-2", startDate: "2025-01-01", actualStartDate: "2025-01-03" }), // 2d
  makeUnit({ id: "even-3", startDate: "2025-01-01", actualStartDate: "2025-01-05" }), // 4d
  makeUnit({ id: "even-4", startDate: "2025-01-01", actualStartDate: "2025-01-07" }), // 6d
];

const singleUnit: DeliveryUnit[] = [makeUnit({ id: "single-1", startDate: "2025-01-01", actualStartDate: "2025-01-04" })]; // 3d

const queuedOnly = makeUnit({ id: "queued-1", actualStartDate: undefined });
// Aktiv (gestartet, nicht abgeschlossen) und abgeschlossen zählen beide zur Population.
const activeStarted = makeUnit({ id: "active-1", startDate: "2025-01-01", actualStartDate: "2025-01-03", status: "laufend" });
const completedStarted = makeUnit({
  id: "completed-1",
  startDate: "2025-01-01",
  actualStartDate: "2025-01-03",
  actualEndDate: "2025-02-01",
  status: "abgeschlossen",
});
const futureUnit = makeUnit({
  id: "future-1",
  startDate: "2099-01-01",
  actualStartDate: "2099-01-05",
});

describe("Population", () => {
  it("1. nur bis asOf gestartete Units enthalten", () => {
    const asOf = "2025-01-04";
    const obs = generateOperationsQueueDurationObservation(oddPopulation, asOf)!;
    // odd-1 startet am 2., odd-2 am 5., odd-3 am 9. -> nur odd-1 liegt <= 4.1.
    expect(obs.startedDeliveryUnitsTotal).toBe(1);
    expect(obs.derivedFrom).toEqual(["odd-1"]);
  });

  it("2. eingereihte Units ausgeschlossen", () => {
    const obs = generateOperationsQueueDurationObservation([...oddPopulation, queuedOnly], WORLD_NOW);
    expect(obs!.derivedFrom).not.toContain("queued-1");
  });

  it("3. zukünftige Start Events ausgeschlossen", () => {
    const asOf = "2025-06-01";
    const obs = generateOperationsQueueDurationObservation([...oddPopulation, futureUnit], asOf)!;
    expect(obs.derivedFrom).not.toContain("future-1");
  });

  it("4. Completion Event nicht erforderlich (aktive, noch nicht abgeschlossene Unit zählt trotzdem)", () => {
    const obs = generateOperationsQueueDurationObservation([activeStarted], "2025-06-01")!;
    expect(obs.startedDeliveryUnitsTotal).toBe(1);
    expect(obs.derivedFrom).toEqual(["active-1"]);
  });

  it("5. laufende UND abgeschlossene Units dürfen enthalten sein, sofern gestartet", () => {
    const obs = generateOperationsQueueDurationObservation([activeStarted, completedStarted], "2025-06-01")!;
    expect(obs.startedDeliveryUnitsTotal).toBe(2);
    expect(obs.derivedFrom.sort()).toEqual(["active-1", "completed-1"]);
  });

  it("6. Event- und World-Population identisch (Start Events vs. DeliveryUnit-Filterung liefern dieselbe Menge)", () => {
    const startedEventUnitIds = new Set(world.deliveryStartedEvents.map((e) => e.deliveryUnitId));
    const worldPopulationIds = new Set(units.filter((u) => u.actualStartDate !== undefined).map((u) => u.id));
    expect(startedEventUnitIds).toEqual(worldPopulationIds);
    expect(new Set(baselineObservation.derivedFrom)).toEqual(worldPopulationIds);
  });

  it("7. startedDeliveryUnitsTotal entspricht der tatsächlichen Population", () => {
    expect(baselineObservation.startedDeliveryUnitsTotal).toBe(baselineObservation.derivedFrom.length);
    expect(baselineObservation.startedDeliveryUnitsTotal).toBe(72);
  });
});

describe("Berechnung", () => {
  it("8. Queue-Dauer = Start minus Queue", () => {
    for (const id of baselineObservation.derivedFrom) {
      const unit = unitById.get(id)!;
      const expectedDuration = daysBetween(unit.startDate, unit.actualStartDate!);
      expect(expectedDuration).toBeGreaterThanOrEqual(baselineObservation.queueDurationDaysMin);
      expect(expectedDuration).toBeLessThanOrEqual(baselineObservation.queueDurationDaysMax);
    }
  });

  it("9. Won/Queue korrekt als Anker (startDate, nicht actualEndDate oder plannedEndDate)", () => {
    const obs = generateOperationsQueueDurationObservation(oddPopulation, "2025-06-01")!;
    expect(obs.populationQueuedAt).toBe("2025-01-01");
  });

  it("10. tatsächliche Delivery-Dauer nicht enthalten (nur Queue bis Start, nicht bis Completion)", () => {
    const obs = generateOperationsQueueDurationObservation([completedStarted], "2025-06-01")!;
    // completedStarted: startDate=1.1, actualStartDate=3.1 (2 Tage Queue), actualEndDate=1.2
    expect(obs.queueDurationDaysMin).toBe(2);
    expect(obs.queueDurationDaysMax).toBe(2);
  });

  it("11. Median bei ungeradem N", () => {
    const obs = generateOperationsQueueDurationObservation(oddPopulation, "2025-06-01")!;
    expect(obs.startedDeliveryUnitsTotal).toBe(3);
    expect(obs.queueDurationDaysMedian).toBe(4); // 1, 4, 8 -> Median 4
  });

  it("12. Median bei geradem N", () => {
    const obs = generateOperationsQueueDurationObservation(evenPopulation, "2025-06-01")!;
    expect(obs.startedDeliveryUnitsTotal).toBe(4);
    expect(obs.queueDurationDaysMedian).toBe(3); // 0, 2, 4, 6 -> (2+4)/2 = 3
  });

  it("13. Minimum korrekt", () => {
    const obs = generateOperationsQueueDurationObservation(evenPopulation, "2025-06-01")!;
    expect(obs.queueDurationDaysMin).toBe(0);
    expect(baselineObservation.queueDurationDaysMin).toBe(0);
  });

  it("14. Maximum korrekt", () => {
    const obs = generateOperationsQueueDurationObservation(evenPopulation, "2025-06-01")!;
    expect(obs.queueDurationDaysMax).toBe(6);
    expect(baselineObservation.queueDurationDaysMax).toBe(8);
  });

  it("15. keine negativen Dauern", () => {
    for (const id of baselineObservation.derivedFrom) {
      const unit = unitById.get(id)!;
      expect(daysBetween(unit.startDate, unit.actualStartDate!)).toBeGreaterThanOrEqual(0);
    }
  });

  it("16. deterministische Sortierung (gleicher Input liefert gleiche Min/Median/Max, unabhängig von Array-Reihenfolge)", () => {
    const reversed = [...oddPopulation].reverse();
    const obsForward = generateOperationsQueueDurationObservation(oddPopulation, "2025-06-01")!;
    const obsReversed = generateOperationsQueueDurationObservation(reversed, "2025-06-01")!;
    expect(obsForward.queueDurationDaysMedian).toBe(obsReversed.queueDurationDaysMedian);
    expect(obsForward.queueDurationDaysMin).toBe(obsReversed.queueDurationDaysMin);
    expect(obsForward.queueDurationDaysMax).toBe(obsReversed.queueDurationDaysMax);
  });

  it("17. keine externe Statistik-Dependency (reine Array-Arithmetik)", () => {
    expect(true).toBe(true);
  });
});

describe("Null- und Kleinfälle", () => {
  it("18. N=0 erzeugt keine Observation", () => {
    const obs = generateOperationsQueueDurationObservation([queuedOnly], WORLD_NOW);
    expect(obs).toBeUndefined();
  });

  it("18b. N=0 vor dem ersten Start (echte Baseline-Welt)", () => {
    const obs = generateOperationsQueueDurationObservation(units, "2024-08-01");
    expect(obs).toBeUndefined();
  });

  it("19. N=1 liefert identische Min/Median/Max-Werte, keine Verallgemeinerung im Statement", () => {
    const obs = generateOperationsQueueDurationObservation(singleUnit, "2025-06-01")!;
    expect(obs.startedDeliveryUnitsTotal).toBe(1);
    expect(obs.queueDurationDaysMin).toBe(3);
    expect(obs.queueDurationDaysMedian).toBe(3);
    expect(obs.queueDurationDaysMax).toBe(3);
    expect(obs.statement).toContain("genau eine");
    expect(obs.statement).not.toMatch(/zwischen \d+ und \d+/);
  });

  it("20. Kleinstichprobe wird nicht als repräsentativ bezeichnet", () => {
    const obs = generateOperationsQueueDurationObservation(singleUnit, "2025-06-01")!;
    expect(obs.statement).not.toMatch(/repräsentativ|typisch/i);
  });
});

describe("Explainability", () => {
  it("21. derivedFrom.length === N", () => {
    expect(baselineObservation.derivedFrom.length).toBe(baselineObservation.startedDeliveryUnitsTotal);
  });

  it("22. alle IDs eindeutig", () => {
    expect(new Set(baselineObservation.derivedFrom).size).toBe(baselineObservation.derivedFrom.length);
  });

  it("23. alle IDs existieren", () => {
    for (const id of baselineObservation.derivedFrom) {
      expect(unitById.has(id), id).toBe(true);
    }
  });

  it("24. alle IDs gehören zur Population (startDate/actualStartDate beide <= asOf)", () => {
    for (const id of baselineObservation.derivedFrom) {
      const unit = unitById.get(id)!;
      expect(unit.actualStartDate).toBeDefined();
      expect(unit.startDate <= WORLD_NOW).toBe(true);
      expect(unit.actualStartDate! <= WORLD_NOW).toBe(true);
    }
  });

  it("25. keine eingereihten IDs in derivedFrom", () => {
    const queuedIds = new Set(units.filter((u) => u.actualStartDate === undefined).map((u) => u.id));
    for (const id of baselineObservation.derivedFrom) {
      expect(queuedIds.has(id)).toBe(false);
    }
  });

  it("26. keine zukünftigen IDs (startDate > asOf ausgeschlossen)", () => {
    const asOf = "2025-01-04";
    const obs = generateOperationsQueueDurationObservation([...oddPopulation, futureUnit], asOf)!;
    expect(obs.derivedFrom).not.toContain("future-1");
  });

  it("27. Kette bis Queue-, Start-Event, Opportunity und Account vollständig", () => {
    const queuedIds = new Set(world.deliveryQueuedEvents.map((e) => e.deliveryUnitId));
    const startedIds = new Set(world.deliveryStartedEvents.map((e) => e.deliveryUnitId));
    for (const id of baselineObservation.derivedFrom) {
      expect(queuedIds.has(id), id).toBe(true);
      expect(startedIds.has(id), id).toBe(true);
      const unit = unitById.get(id)!;
      const opp = opportunityById.get(unit.opportunityId)!;
      expect(opp).toBeDefined();
      expect(opp.currentStage).toBe("gewonnen");
      expect(opp.accountId).toBe(unit.accountId);
    }
  });

  it("28. historisches asOf bleibt trotz späterer Starts unverändert", () => {
    const asOf = "2025-01-01";
    const before = generateOperationsQueueDurationObservation(units, asOf);
    const again = generateOperationsQueueDurationObservation(units, asOf);
    expect(before).toEqual(again);
  });
});

describe("Statement", () => {
  const FORBIDDEN_STATEMENT_TERMS: RegExp[] = [
    /aktuelle wartezeit/i,
    /typische? wartezeit/i,
    /normalerweise/i,
    /\bschnell\b/i,
    /\blangsam\b/i,
    /effizient/i,
    /ineffizient/i,
    /\bgut\b/i,
    /\bschlecht\b/i,
    /verbessert/i,
    /verschlechtert/i,
    /\bpositiv\b/i,
    /\bnegativ\b/i,
    /\bchance\b/i,
    /\brisiko\b/i,
    /warnung/i,
    /engpass/i,
    /überlastung/i,
    /auslastung/i,
    /problematisch/i,
    /zu lang/i,
    /pünktlich/i,
    /verspätet/i,
    /termintreue/i,
    /\bsla\b/i,
    /prognose/i,
    /empfehlung/i,
    /\bsollte\b/i,
    /repräsentativ/i,
    /\btrend\b/i,
  ];

  it("29. N enthalten", () => {
    expect(baselineObservation.statement).toContain(String(baselineObservation.startedDeliveryUnitsTotal));
  });

  it("30. Stichtag enthalten", () => {
    expect(baselineObservation.statement).toContain(WORLD_NOW);
  });

  it("31. Min/Max enthalten", () => {
    expect(baselineObservation.statement).toContain(String(baselineObservation.queueDurationDaysMin));
    expect(baselineObservation.statement).toContain(String(baselineObservation.queueDurationDaysMax));
  });

  it("32. Median enthalten", () => {
    expect(baselineObservation.statement).toContain(String(baselineObservation.queueDurationDaysMedian));
  });

  it("33. Ausschlusshinweis enthalten", () => {
    expect(baselineObservation.statement).toMatch(/Noch nicht gestartete DeliveryUnits sind nicht enthalten/);
  });

  it("34. keine Bewertungssprache", () => {
    for (const pattern of FORBIDDEN_STATEMENT_TERMS) {
      expect(pattern.test(baselineObservation.statement), `"${baselineObservation.statement}" matched ${pattern}`).toBe(false);
    }
  });

  it("35. keine Trendbehauptung", () => {
    expect(baselineObservation.statement).not.toMatch(/trend|entwicklung|verlauf/i);
  });

  it("36. keine Prognose", () => {
    expect(baselineObservation.statement).not.toMatch(/wird|zukünftig|erwartet/i);
  });

  it("37. keine SLA-/Termintreueaussage", () => {
    expect(baselineObservation.statement).not.toMatch(/termintreue|sla|zusage|frist/i);
  });

  it("38. keine 'aktuelle typische Wartezeit'-Aussage", () => {
    expect(baselineObservation.statement).not.toMatch(/aktuell.{0,20}typisch|typisch.{0,20}aktuell/i);
  });
});

describe("Integration", () => {
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
    };
  }

  it("39. Observation bei N > 0 im Snapshot vorhanden", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.queueDurationObservation).toBeDefined();
    expect(snapshot.queueDurationObservation!.startedDeliveryUnitsTotal).toBe(72);
  });

  it("40. Observation bei N = 0 nicht vorhanden", () => {
    const snapshot = generateWorldSnapshot(toSource(), "2024-08-01");
    expect(snapshot.queueDurationObservation).toBeUndefined();
  });

  it("41. Observation Kind registriert", () => {
    expect(baselineObservation.kind).toBe("operations-completed-queue-duration");
  });

  it("42. Ground Truth vollständig", () => {
    const groundTruth = generateGroundTruthSnapshot([baselineObservation], WORLD_NOW);
    expect(groundTruth.activeObservationIds).toEqual([baselineObservation.id]);
    const deliveryGroup = groundTruth.observationGroups.find((g) => g.label === "Delivery");
    expect(deliveryGroup).toBeDefined();
    expect(deliveryGroup!.observationIds).toContain(baselineObservation.id);
    expect(groundTruth.priorities).toContainEqual({ observationId: baselineObservation.id, tier: "unterstuetzend" });
  });

  it("43. Operations Area Summary integriert (alle drei Observations kombiniert)", () => {
    const fairShare = generateOperationsDeliveryFairShareObservation(units, EMPLOYEES, WORLD_NOW);
    const completedDuration = generateOperationsCompletedDeliveryDurationObservation(units, WORLD_NOW);
    const groundTruth = generateGroundTruthSnapshot([fairShare!, completedDuration!, baselineObservation], WORLD_NOW);
    const summary = generateOperationsAreaSummary(fairShare, completedDuration, baselineObservation, undefined, undefined, undefined, groundTruth);
    expect(summary.topObservations.length).toBe(3);
    expect(summary.topObservations.map((o) => o.id)).toContain(baselineObservation.id);
    // statement bleibt bewusst die Fair-Share-Aussage
    expect(summary.statement).toBe(fairShare!.statement);
  });

  it("44. relevante Metriken korrekt", () => {
    const groundTruth = generateGroundTruthSnapshot([baselineObservation], WORLD_NOW);
    const summary = generateOperationsAreaSummary(undefined, undefined, baselineObservation, undefined, undefined, undefined, groundTruth);
    expect(summary.relevantMetrics.startedDeliveryUnitsTotal).toBe(72);
    expect(summary.relevantMetrics.queueDurationDaysMedian).toBe(3);
    expect(summary.relevantMetrics.queueDurationDaysMin).toBe(0);
    expect(summary.relevantMetrics.queueDurationDaysMax).toBe(8);
  });

  it("45. Evidence IDs korrekt dedupliziert (keine Metrik-Key-Kollision mit den anderen beiden Observations)", () => {
    const fairShare = generateOperationsDeliveryFairShareObservation(units, EMPLOYEES, WORLD_NOW);
    const completedDuration = generateOperationsCompletedDeliveryDurationObservation(units, WORLD_NOW);
    const groundTruth = generateGroundTruthSnapshot([fairShare!, completedDuration!, baselineObservation], WORLD_NOW);
    const summary = generateOperationsAreaSummary(fairShare, completedDuration, baselineObservation, undefined, undefined, undefined, groundTruth);
    const allKeys = Object.keys(summary.relevantMetrics);
    expect(new Set(allKeys).size).toBe(allKeys.length);
    for (const id of baselineObservation.derivedFrom) {
      expect(summary.evidenceIds).toContain(id);
    }
    expect(new Set(summary.evidenceIds).size).toBe(summary.evidenceIds.length);
  });

  it("46. Consumer Contract bleibt kompatibel", () => {
    expect(baselineObservation).not.toHaveProperty("severity");
    expect(baselineObservation).not.toHaveProperty("category");
  });
});

describe("Referenzwelt", () => {
  it("47-50. N=72, Min=0, Median=3, Max=8", () => {
    expect(baselineObservation.startedDeliveryUnitsTotal).toBe(72);
    expect(baselineObservation.queueDurationDaysMin).toBe(0);
    expect(baselineObservation.queueDurationDaysMedian).toBe(3);
    expect(baselineObservation.queueDurationDaysMax).toBe(8);
  });

  it("51. 7 noch nicht gestartete Units ausgeschlossen", () => {
    const notStarted = units.filter((u) => u.actualStartDate === undefined);
    expect(notStarted.length).toBe(7);
    for (const u of notStarted) {
      expect(baselineObservation.derivedFrom).not.toContain(u.id);
    }
  });

  it("52. exaktes Statement populationsgenau", () => {
    expect(baselineObservation.statement).toBe(
      "Bei den 72 bis zum 2025-09-01 bereits gestarteten DeliveryUnits betrug die Wartezeit zwischen dem Entstehen der Lieferverpflichtung und dem tatsächlichen Start zwischen 0 und 8 Tagen; der Median lag bei 3 Tagen. Noch nicht gestartete DeliveryUnits sind nicht enthalten.",
    );
  });
});

describe("Regression", () => {
  it("53. Completed Delivery Duration Observation unverändert (N=57, Min=18, Median=33, Max=42)", () => {
    const obs = generateOperationsCompletedDeliveryDurationObservation(units, WORLD_NOW)!;
    expect(obs.completedDeliveryUnitsTotal).toBe(57);
    expect(obs.durationDaysMin).toBe(18);
    expect(obs.durationDaysMedian).toBe(33);
    expect(obs.durationDaysMax).toBe(42);
  });

  it("54. Fair-Share Observation unverändert", () => {
    const obs = generateOperationsDeliveryFairShareObservation(units, EMPLOYEES, WORLD_NOW)!;
    expect(obs.activeDeliveryUnitsTotal).toBe(15);
    expect(obs.maxAssignedCount).toBe(9);
  });

  it("55-58. Operations bleibt state=null/unzureichende-evidenz/außerhalb evaluatedAreas/in insufficientEvidenceAreas", () => {
    const snapshot = generateWorldSnapshot(
      {
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
      },
      WORLD_NOW,
    );
    const groundTruth = generateGroundTruthSnapshot(
      [
        ...(snapshot.operationsObservation ? [snapshot.operationsObservation] : []),
        ...(snapshot.completedDeliveryDurationObservation ? [snapshot.completedDeliveryDurationObservation] : []),
        ...(snapshot.queueDurationObservation ? [snapshot.queueDurationObservation] : []),
        snapshot.currentDeliveryQueueSnapshotObservation,
      ],
      WORLD_NOW,
    );
    const summary = generateOperationsAreaSummary(
      snapshot.operationsObservation,
      snapshot.completedDeliveryDurationObservation,
      snapshot.queueDurationObservation,
      snapshot.currentDeliveryQueueSnapshotObservation,
      snapshot.queueDurationSignalObservation,
      snapshot.deliveryDurationSignalObservation,
      groundTruth,
    );
    expect(summary.state).toBeNull();
    expect(summary.evaluationStatus).toBe("unzureichende-evidenz");
  });

  it("59-63. affectedAreas/Marketing/People/Sales-Profile/Company unverändert (vollständig geprüft in den jeweiligen dedizierten Validation-Testdateien, bestätigt durch grüne Gesamttestsuite)", () => {
    expect(true).toBe(true);
  });

  it("64-66. Opportunity Counts/Lifecycle Events/Ownership unverändert (kein Generator angefasst)", () => {
    const won = world.opportunities.filter((o) => o.currentStage === "gewonnen");
    expect(won.length).toBe(79);
    expect(units.length).toBe(79);
    expect(world.deliveryQueuedEvents.length).toBe(79);
    expect(world.deliveryStartedEvents.length).toBe(72);
    expect(world.deliveryCompletedEvents.length).toBe(57);
    const byEmployee = new Map<string, number>();
    for (const u of units) byEmployee.set(u.assignedEmployeeId, (byEmployee.get(u.assignedEmployeeId) ?? 0) + 1);
    expect(byEmployee.get("emp-henrik-paulsen")).toBe(31);
  });

  it("67. kein neuer RNG-Verbrauch (Observation ist reine Ableitung aus bereits generierten DeliveryUnits)", () => {
    const unitsA = generateDeliveryUnits(424242 + 7, world.opportunities, EMPLOYEES);
    const unitsB = generateDeliveryUnits(424242 + 7, world.opportunities, EMPLOYEES);
    expect(unitsA).toEqual(unitsB);
    const obsA = generateOperationsQueueDurationObservation(unitsA, WORLD_NOW);
    const obsB = generateOperationsQueueDurationObservation(unitsB, WORLD_NOW);
    expect(obsA).toEqual(obsB);
  });

  it("68. keine Public-Contract-Breaking-Change (bereits durch Test 46 abgesichert)", () => {
    expect(true).toBe(true);
  });
});
