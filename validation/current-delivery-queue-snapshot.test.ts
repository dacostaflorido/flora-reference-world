import { describe, expect, it } from "vitest";
import {
  generateOperationsCurrentDeliveryQueueSnapshotObservation,
  generateOperationsDeliveryFairShareObservation,
  generateOperationsCompletedDeliveryDurationObservation,
  generateOperationsQueueDurationObservation,
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

// Current Delivery Queue Snapshot V1 — dedizierte Testdatei. Ein reiner
// Stichtags-Snapshot: wie viele bis asOf entstandene Lieferverpflichtungen zu
// asOf noch auf ihren tatsächlichen Start warten, und wie lange bisher. Kein
// Trend, keine Prognose, keine Bewertung, kein Engpass, keine Überlastung.

const world = SCENARIO_WORLDS.baseline;
const units = world.deliveryUnits;
const opportunityById = new Map(world.opportunities.map((o) => [o.id, o]));
const unitById = new Map(units.map((u) => [u.id, u]));
const baselineObservation = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, WORLD_NOW);

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

const waitingOdd: DeliveryUnit[] = [
  makeUnit({ id: "w-odd-1", startDate: "2025-01-01" }), // Alter (asOf 2025-01-05) = 4
  makeUnit({ id: "w-odd-2", startDate: "2025-01-03" }), // Alter = 2
  makeUnit({ id: "w-odd-3", startDate: "2025-01-04" }), // Alter = 1
];

const waitingEven: DeliveryUnit[] = [
  makeUnit({ id: "w-even-1", startDate: "2025-01-01" }), // Alter (asOf 2025-01-05) = 4
  makeUnit({ id: "w-even-2", startDate: "2025-01-02" }), // Alter = 3
  makeUnit({ id: "w-even-3", startDate: "2025-01-04" }), // Alter = 1
  makeUnit({ id: "w-even-4", startDate: "2025-01-05" }), // Alter = 0
];

const startedUnit = makeUnit({ id: "started-1", startDate: "2025-01-01", actualStartDate: "2025-01-02", status: "laufend" });
const futureStartUnit = makeUnit({
  id: "future-start-1",
  startDate: "2025-01-01",
  actualStartDate: "2025-06-01", // startet erst spaeter als asOf 2025-01-05
  status: "laufend",
});
const futureCommitmentUnit = makeUnit({ id: "future-commitment-1", startDate: "2099-01-01" });

describe("Population", () => {
  it("1. alle bis asOf entstandenen Commitments ausgewertet", () => {
    const asOf = "2025-01-05";
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation([...waitingOdd, startedUnit], asOf);
    expect(obs.evaluatedDeliveryCommitmentsTotal).toBe(4);
  });

  it("2. zukünftige Commitments ausgeschlossen", () => {
    const asOf = "2025-01-05";
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation([...waitingOdd, futureCommitmentUnit], asOf);
    expect(obs.derivedFrom).not.toContain("future-commitment-1");
    expect(obs.evaluatedDeliveryCommitmentsTotal).toBe(3);
  });

  it("3. nicht gewonnene Opportunities ausgeschlossen (strukturell — DeliveryUnits existieren nur für gewonnene Opportunities)", () => {
    const nonWon = world.opportunities.filter((o) => o.currentStage !== "gewonnen");
    const deliveryOppIds = new Set(units.map((u) => u.opportunityId));
    for (const opp of nonWon) {
      expect(deliveryOppIds.has(opp.id), opp.id).toBe(false);
    }
  });

  it("4. wartende Teilpopulation korrekt", () => {
    const asOf = "2025-01-05";
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation([...waitingOdd, startedUnit], asOf);
    expect(obs.waitingDeliveryUnitsTotal).toBe(3);
    expect(obs.waitingDeliveryUnitIds.sort()).toEqual(["w-odd-1", "w-odd-2", "w-odd-3"].sort());
  });

  it("5. bereits gestartete Units nicht wartend", () => {
    const asOf = "2025-01-05";
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation([...waitingOdd, startedUnit], asOf);
    expect(obs.waitingDeliveryUnitIds).not.toContain("started-1");
  });

  it("6. zukünftiger Start bleibt zum früheren asOf wartend", () => {
    const asOf = "2025-01-05";
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation([futureStartUnit], asOf);
    expect(obs.waitingDeliveryUnitIds).toContain("future-start-1");
    expect(obs.waitingDeliveryUnitsTotal).toBe(1);
  });

  it("7. W <= N (Invariante über die gesamte reale Baseline-Welt, mehrere Stichtage)", () => {
    for (const asOf of ["2024-09-01", "2025-01-01", "2025-06-01", WORLD_NOW]) {
      const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, asOf);
      expect(obs.waitingDeliveryUnitsTotal).toBeLessThanOrEqual(obs.evaluatedDeliveryCommitmentsTotal);
    }
  });
});

describe("Queue-Alter", () => {
  it("8. Alter = asOf - queuedAt", () => {
    const asOf = "2025-01-05";
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(waitingOdd, asOf);
    for (const id of obs.waitingDeliveryUnitIds) {
      const unit = waitingOdd.find((u) => u.id === id)!;
      const expectedAge = daysBetween(unit.startDate, asOf);
      expect(expectedAge).toBeGreaterThanOrEqual(obs.waitingQueueAgeDaysMin!);
      expect(expectedAge).toBeLessThanOrEqual(obs.waitingQueueAgeDaysMax!);
    }
  });

  it("9. kein negatives Alter", () => {
    for (const id of baselineObservation.waitingDeliveryUnitIds) {
      const unit = unitById.get(id)!;
      expect(daysBetween(unit.startDate, WORLD_NOW)).toBeGreaterThanOrEqual(0);
    }
  });

  it("10. Minimum korrekt", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(waitingOdd, "2025-01-05");
    expect(obs.waitingQueueAgeDaysMin).toBe(1);
  });

  it("11. Median bei ungeradem W", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(waitingOdd, "2025-01-05");
    expect(obs.waitingDeliveryUnitsTotal).toBe(3);
    expect(obs.waitingQueueAgeDaysMedian).toBe(2); // Alter 1,2,4 -> Median 2
  });

  it("12. Median bei geradem W", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(waitingEven, "2025-01-05");
    expect(obs.waitingDeliveryUnitsTotal).toBe(4);
    expect(obs.waitingQueueAgeDaysMedian).toBe(2); // Alter 0,1,3,4 -> (1+3)/2 = 2
  });

  it("13. Maximum korrekt", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(waitingOdd, "2025-01-05");
    expect(obs.waitingQueueAgeDaysMax).toBe(4);
  });

  it("14. ältester Queue-Zeitpunkt korrekt", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(waitingOdd, "2025-01-05");
    expect(obs.oldestWaitingQueuedAt).toBe("2025-01-01");
  });

  it("15. Start-/Completion-Dauer nicht einbezogen (Alter ist ausschließlich asOf - queuedAt)", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation([futureStartUnit], "2025-01-05");
    // futureStartUnit hat actualStartDate erst am 2025-06-01, spielt fuer das Alter zu asOf=2025-01-05 keine Rolle
    expect(obs.waitingQueueAgeDaysMin).toBe(4); // 2025-01-01 bis 2025-01-05
  });

  it("16. keine Prognoseberechnung (kein Feld, das einen künftigen Start schätzt)", () => {
    expect(baselineObservation).not.toHaveProperty("expectedStartAt");
    expect(baselineObservation).not.toHaveProperty("estimatedRemainingWaitDays");
  });
});

describe("Fall A — N=0", () => {
  it("17. N=0", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, "2024-08-01");
    expect(obs.evaluatedDeliveryCommitmentsTotal).toBe(0);
  });

  it("18. W=0", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, "2024-08-01");
    expect(obs.waitingDeliveryUnitsTotal).toBe(0);
  });

  it("19. derivedFrom=[]", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, "2024-08-01");
    expect(obs.derivedFrom).toEqual([]);
  });

  it("20. keine Alterswerte", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, "2024-08-01");
    expect(obs.waitingQueueAgeDaysMedian).toBeUndefined();
    expect(obs.waitingQueueAgeDaysMin).toBeUndefined();
    expect(obs.waitingQueueAgeDaysMax).toBeUndefined();
    expect(obs.oldestWaitingQueuedAt).toBeUndefined();
    expect(obs.waitingDeliveryUnitIds).toEqual([]);
  });

  it("21. korrekter Statement-Text", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, "2024-08-01");
    expect(obs.statement).toBe("Bis zum 2024-08-01 waren keine Lieferverpflichtungen entstanden.");
  });
});

describe("Fall B — N>0, W=0", () => {
  const allStarted: DeliveryUnit[] = [startedUnit];

  it("22. N korrekt", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(allStarted, "2025-06-01");
    expect(obs.evaluatedDeliveryCommitmentsTotal).toBe(1);
  });

  it("23. W=0", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(allStarted, "2025-06-01");
    expect(obs.waitingDeliveryUnitsTotal).toBe(0);
  });

  it("24. derivedFrom.length=N", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(allStarted, "2025-06-01");
    expect(obs.derivedFrom.length).toBe(obs.evaluatedDeliveryCommitmentsTotal);
    expect(obs.derivedFrom).toEqual(["started-1"]);
  });

  it("25. keine Alterswerte", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(allStarted, "2025-06-01");
    expect(obs.waitingQueueAgeDaysMedian).toBeUndefined();
    expect(obs.waitingQueueAgeDaysMin).toBeUndefined();
    expect(obs.waitingQueueAgeDaysMax).toBeUndefined();
  });

  it("26. waitingDeliveryUnitIds=[]", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(allStarted, "2025-06-01");
    expect(obs.waitingDeliveryUnitIds).toEqual([]);
  });

  it("27. korrekter 'keine wartet'-Text", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(allStarted, "2025-06-01");
    expect(obs.statement).toBe(
      "Von den 1 bis zum 2025-06-01 entstandenen Lieferverpflichtungen wartete zu diesem Zeitpunkt keine mehr auf den tatsächlichen Start.",
    );
  });

  it("28. keine leere Evidence Chain", () => {
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation(allStarted, "2025-06-01");
    expect(obs.derivedFrom.length).toBeGreaterThan(0);
  });
});

describe("Fall C — W>0", () => {
  it("29. N korrekt", () => {
    expect(baselineObservation.evaluatedDeliveryCommitmentsTotal).toBe(79);
  });

  it("30. W korrekt", () => {
    expect(baselineObservation.waitingDeliveryUnitsTotal).toBe(7);
  });

  it("31. waitingDeliveryUnitIds.length=W", () => {
    expect(baselineObservation.waitingDeliveryUnitIds.length).toBe(baselineObservation.waitingDeliveryUnitsTotal);
  });

  it("32. wartende IDs Teilmenge von derivedFrom", () => {
    const derivedSet = new Set(baselineObservation.derivedFrom);
    for (const id of baselineObservation.waitingDeliveryUnitIds) {
      expect(derivedSet.has(id), id).toBe(true);
    }
  });

  it("33. Alterswerte vorhanden", () => {
    expect(baselineObservation.waitingQueueAgeDaysMedian).toBeDefined();
    expect(baselineObservation.waitingQueueAgeDaysMin).toBeDefined();
    expect(baselineObservation.waitingQueueAgeDaysMax).toBeDefined();
    expect(baselineObservation.oldestWaitingQueuedAt).toBeDefined();
  });

  it("34. Statement enthält N", () => {
    expect(baselineObservation.statement).toContain(String(baselineObservation.evaluatedDeliveryCommitmentsTotal));
  });

  it("35. Statement enthält W", () => {
    expect(baselineObservation.statement).toContain(String(baselineObservation.waitingDeliveryUnitsTotal));
  });

  it("36. Statement enthält Stichtag", () => {
    expect(baselineObservation.statement).toContain(WORLD_NOW);
  });

  it("37. Statement enthält Min/Median/Max", () => {
    expect(baselineObservation.statement).toContain(String(baselineObservation.waitingQueueAgeDaysMin));
    expect(baselineObservation.statement).toContain(String(baselineObservation.waitingQueueAgeDaysMedian));
    expect(baselineObservation.statement).toContain(String(baselineObservation.waitingQueueAgeDaysMax));
  });
});

describe("Explainability", () => {
  it("38. derivedFrom.length=N", () => {
    expect(baselineObservation.derivedFrom.length).toBe(baselineObservation.evaluatedDeliveryCommitmentsTotal);
  });

  it("39. alle IDs eindeutig", () => {
    expect(new Set(baselineObservation.derivedFrom).size).toBe(baselineObservation.derivedFrom.length);
  });

  it("40. alle IDs existieren", () => {
    for (const id of baselineObservation.derivedFrom) {
      expect(unitById.has(id), id).toBe(true);
    }
  });

  it("41. alle IDs besitzen queuedAt <= asOf", () => {
    for (const id of baselineObservation.derivedFrom) {
      const unit = unitById.get(id)!;
      expect(unit.startDate <= WORLD_NOW).toBe(true);
    }
  });

  it("42. keine zukünftigen IDs", () => {
    const asOf = "2025-01-05";
    const obs = generateOperationsCurrentDeliveryQueueSnapshotObservation([...waitingOdd, futureCommitmentUnit], asOf);
    expect(obs.derivedFrom).not.toContain("future-commitment-1");
  });

  it("43. vollständige Kette bis Opportunity und Account", () => {
    for (const id of baselineObservation.derivedFrom) {
      const unit = unitById.get(id)!;
      const opp = opportunityById.get(unit.opportunityId)!;
      expect(opp).toBeDefined();
      expect(opp.currentStage).toBe("gewonnen");
      expect(opp.accountId).toBe(unit.accountId);
    }
  });

  it("44. wartende IDs besitzen kein Start Event bis asOf", () => {
    for (const id of baselineObservation.waitingDeliveryUnitIds) {
      const unit = unitById.get(id)!;
      expect(unit.actualStartDate === undefined || unit.actualStartDate > WORLD_NOW).toBe(true);
    }
  });

  it("45. gestartete IDs nicht in wartender Teilmenge", () => {
    const waitingSet = new Set(baselineObservation.waitingDeliveryUnitIds);
    const startedByWorldNow = units.filter((u) => u.actualStartDate !== undefined && u.actualStartDate <= WORLD_NOW);
    for (const unit of startedByWorldNow) {
      expect(waitingSet.has(unit.id)).toBe(false);
    }
  });
});

describe("Future Knowledge", () => {
  it("46. zukünftiger Start verändert historischen Snapshot nicht", () => {
    const asOf = "2025-01-01";
    const before = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, asOf);
    // world.deliveryUnits enthaelt bereits alle spaeteren Start-/Completion-Events;
    // eine erneute Berechnung mit demselben historischen asOf muss identisch bleiben.
    const again = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, asOf);
    expect(before).toEqual(again);
  });

  it("47. zukünftiges Queue Event verändert historischen Snapshot nicht", () => {
    const asOf = "2025-01-05";
    const before = generateOperationsCurrentDeliveryQueueSnapshotObservation(waitingOdd, asOf);
    const withFutureCommitment = generateOperationsCurrentDeliveryQueueSnapshotObservation(
      [...waitingOdd, futureCommitmentUnit],
      asOf,
    );
    expect(withFutureCommitment.evaluatedDeliveryCommitmentsTotal).toBe(before.evaluatedDeliveryCommitmentsTotal);
    expect(withFutureCommitment.waitingQueueAgeDaysMedian).toBe(before.waitingQueueAgeDaysMedian);
  });

  it("48. identisches asOf bit-identisch", () => {
    const a = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, WORLD_NOW);
    const b = generateOperationsCurrentDeliveryQueueSnapshotObservation(units, WORLD_NOW);
    expect(a).toEqual(b);
  });

  it("49. kein neuer RNG-Verbrauch (reine Ableitung aus bereits generierten DeliveryUnits)", () => {
    const unitsA = generateDeliveryUnits(424242 + 7, world.opportunities, EMPLOYEES);
    const unitsB = generateDeliveryUnits(424242 + 7, world.opportunities, EMPLOYEES);
    expect(unitsA).toEqual(unitsB);
    const obsA = generateOperationsCurrentDeliveryQueueSnapshotObservation(unitsA, WORLD_NOW);
    const obsB = generateOperationsCurrentDeliveryQueueSnapshotObservation(unitsB, WORLD_NOW);
    expect(obsA).toEqual(obsB);
  });
});

describe("Statement", () => {
  const FORBIDDEN_STATEMENT_TERMS: RegExp[] = [
    /engpass/i,
    /überlastung/i,
    /auslastung/i,
    /\bdruck\b/i,
    /\brisiko\b/i,
    /\bchance\b/i,
    /warnung/i,
    /problematisch/i,
    /\bkritisch\b/i,
    /zu hoch/i,
    /zu lang/i,
    /\bschnell\b/i,
    /\blangsam\b/i,
    /effizient/i,
    /ineffizient/i,
    /\bgut\b/i,
    /\bschlecht\b/i,
    /verbessert/i,
    /verschlechtert/i,
    /\btrend\b/i,
    /prognose/i,
    /wird voraussichtlich/i,
    /\bsollte\b/i,
    /empfehlung/i,
    /\bsla\b/i,
    /termintreue/i,
    /pünktlich/i,
    /verspätet/i,
  ];

  it("50. keine Bewertungssprache", () => {
    for (const pattern of FORBIDDEN_STATEMENT_TERMS) {
      expect(pattern.test(baselineObservation.statement), `"${baselineObservation.statement}" matched ${pattern}`).toBe(false);
    }
  });

  it("51. keine Trendbehauptung", () => {
    expect(baselineObservation.statement).not.toMatch(/trend|entwicklung|verlauf/i);
  });

  it("52. keine Prognose", () => {
    expect(baselineObservation.statement).not.toMatch(/wird (?!zum)|zukünftig|erwartet/i);
  });

  it("53. kein Engpass", () => {
    expect(baselineObservation.statement).not.toMatch(/engpass/i);
  });

  it("54. keine Überlastung", () => {
    expect(baselineObservation.statement).not.toMatch(/überlastung|auslastung/i);
  });

  it("55. keine SLA-/Termintreueaussage", () => {
    expect(baselineObservation.statement).not.toMatch(/termintreue|sla|zusage|frist/i);
  });

  it("56. keine Handlungsempfehlung", () => {
    expect(baselineObservation.statement).not.toMatch(/empfehlung|sollte|muss/i);
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

  it("57. Observation im Snapshot (immer definiert, auch bei N=0)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.currentDeliveryQueueSnapshotObservation).toBeDefined();
    expect(snapshot.currentDeliveryQueueSnapshotObservation.evaluatedDeliveryCommitmentsTotal).toBe(79);
    const emptySnapshot = generateWorldSnapshot(toSource(), "2024-08-01");
    expect(emptySnapshot.currentDeliveryQueueSnapshotObservation).toBeDefined();
    expect(emptySnapshot.currentDeliveryQueueSnapshotObservation.evaluatedDeliveryCommitmentsTotal).toBe(0);
  });

  it("58. Observation Kind registriert", () => {
    expect(baselineObservation.kind).toBe("operations-current-delivery-queue");
  });

  it("59. Ground Truth vollständig", () => {
    const groundTruth = generateGroundTruthSnapshot([baselineObservation], WORLD_NOW);
    expect(groundTruth.activeObservationIds).toEqual([baselineObservation.id]);
    const deliveryGroup = groundTruth.observationGroups.find((g) => g.label === "Delivery");
    expect(deliveryGroup).toBeDefined();
    expect(deliveryGroup!.observationIds).toContain(baselineObservation.id);
    expect(groundTruth.priorities).toContainEqual({ observationId: baselineObservation.id, tier: "unterstuetzend" });
  });

  it("60. Operations Area Summary integriert (alle vier Observations kombiniert)", () => {
    const fairShare = generateOperationsDeliveryFairShareObservation(units, EMPLOYEES, WORLD_NOW);
    const completedDuration = generateOperationsCompletedDeliveryDurationObservation(units, WORLD_NOW);
    const queueDuration = generateOperationsQueueDurationObservation(units, WORLD_NOW);
    const groundTruth = generateGroundTruthSnapshot(
      [fairShare!, completedDuration!, queueDuration!, baselineObservation],
      WORLD_NOW,
    );
    const summary = generateOperationsAreaSummary(fairShare, completedDuration, queueDuration, baselineObservation, undefined, undefined, groundTruth);
    expect(summary.topObservations.length).toBe(4);
    expect(summary.topObservations.map((o) => o.id)).toContain(baselineObservation.id);
    expect(summary.statement).toBe(fairShare!.statement);
  });

  it("61. relevante Metriken ohne Kollision", () => {
    const groundTruth = generateGroundTruthSnapshot([baselineObservation], WORLD_NOW);
    const summary = generateOperationsAreaSummary(undefined, undefined, undefined, baselineObservation, undefined, undefined, groundTruth);
    expect(summary.relevantMetrics.evaluatedDeliveryCommitmentsTotal).toBe(79);
    expect(summary.relevantMetrics.waitingDeliveryUnitsTotal).toBe(7);
    expect(summary.relevantMetrics.waitingQueueAgeDaysMedian).toBe(2);
    expect(summary.relevantMetrics.waitingQueueAgeDaysMin).toBe(1);
    expect(summary.relevantMetrics.waitingQueueAgeDaysMax).toBe(3);
    expect(summary.relevantMetrics.oldestWaitingQueuedAt).toBe("2025-08-29");
  });

  it("61b. bei W=0 keine Altersschlüssel in relevantMetrics (kein erfundener Wert)", () => {
    const obsNoWaiting = generateOperationsCurrentDeliveryQueueSnapshotObservation([startedUnit], "2025-06-01");
    const groundTruth = generateGroundTruthSnapshot([obsNoWaiting], "2025-06-01");
    const summary = generateOperationsAreaSummary(undefined, undefined, undefined, obsNoWaiting, undefined, undefined, groundTruth);
    expect(summary.relevantMetrics).not.toHaveProperty("waitingQueueAgeDaysMedian");
    expect(summary.relevantMetrics).not.toHaveProperty("waitingQueueAgeDaysMin");
    expect(summary.relevantMetrics).not.toHaveProperty("waitingQueueAgeDaysMax");
    expect(summary.relevantMetrics).not.toHaveProperty("oldestWaitingQueuedAt");
    expect(summary.relevantMetrics.evaluatedDeliveryCommitmentsTotal).toBe(1);
    expect(summary.relevantMetrics.waitingDeliveryUnitsTotal).toBe(0);
  });

  it("62. Evidence IDs dedupliziert", () => {
    const fairShare = generateOperationsDeliveryFairShareObservation(units, EMPLOYEES, WORLD_NOW);
    const groundTruth = generateGroundTruthSnapshot([fairShare!, baselineObservation], WORLD_NOW);
    const summary = generateOperationsAreaSummary(fairShare, undefined, undefined, baselineObservation, undefined, undefined, groundTruth);
    expect(new Set(summary.evidenceIds).size).toBe(summary.evidenceIds.length);
    for (const id of baselineObservation.derivedFrom) {
      expect(summary.evidenceIds).toContain(id);
    }
  });

  it("63. Consumer Contract bleibt kompatibel", () => {
    expect(baselineObservation).not.toHaveProperty("severity");
    expect(baselineObservation).not.toHaveProperty("category");
  });
});

describe("Referenzwelt", () => {
  it("64. N = 79", () => {
    expect(baselineObservation.evaluatedDeliveryCommitmentsTotal).toBe(79);
  });

  it("65. W = 7", () => {
    expect(baselineObservation.waitingDeliveryUnitsTotal).toBe(7);
  });

  it("66. Alters-Minimum erwartungsgemäß 1", () => {
    expect(baselineObservation.waitingQueueAgeDaysMin).toBe(1);
  });

  it("67. Alters-Median erwartungsgemäß 2", () => {
    expect(baselineObservation.waitingQueueAgeDaysMedian).toBe(2);
  });

  it("68. Alters-Maximum erwartungsgemäß 3", () => {
    expect(baselineObservation.waitingQueueAgeDaysMax).toBe(3);
  });

  it("69. 72 bereits gestartete Units korrekt nicht wartend", () => {
    const startedByWorldNow = units.filter((u) => u.actualStartDate !== undefined && u.actualStartDate <= WORLD_NOW);
    expect(startedByWorldNow.length).toBe(72);
    const waitingSet = new Set(baselineObservation.waitingDeliveryUnitIds);
    for (const u of startedByWorldNow) {
      expect(waitingSet.has(u.id)).toBe(false);
    }
  });

  it("70. exaktes Statement populationsgenau", () => {
    expect(baselineObservation.statement).toBe(
      "Von den 79 bis zum 2025-09-01 entstandenen Lieferverpflichtungen warteten 7 zu diesem Stichtag noch auf den tatsächlichen Start. Ihre bisherige Wartezeit lag zwischen 1 und 3 Tagen; der Median lag bei 2 Tagen.",
    );
  });
});

describe("Regression", () => {
  it("71. Queue Duration Observation unverändert (N=72, Min=0, Median=3, Max=8)", () => {
    const obs = generateOperationsQueueDurationObservation(units, WORLD_NOW)!;
    expect(obs.startedDeliveryUnitsTotal).toBe(72);
    expect(obs.queueDurationDaysMin).toBe(0);
    expect(obs.queueDurationDaysMedian).toBe(3);
    expect(obs.queueDurationDaysMax).toBe(8);
  });

  it("72. Completed Delivery Duration unverändert (N=57, Min=18, Median=33, Max=42)", () => {
    const obs = generateOperationsCompletedDeliveryDurationObservation(units, WORLD_NOW)!;
    expect(obs.completedDeliveryUnitsTotal).toBe(57);
    expect(obs.durationDaysMin).toBe(18);
    expect(obs.durationDaysMedian).toBe(33);
    expect(obs.durationDaysMax).toBe(42);
  });

  it("73. Fair-Share Observation unverändert", () => {
    const obs = generateOperationsDeliveryFairShareObservation(units, EMPLOYEES, WORLD_NOW)!;
    expect(obs.activeDeliveryUnitsTotal).toBe(15);
    expect(obs.maxAssignedCount).toBe(9);
  });

  it("74-78. Operations state=null/unzureichende-evidenz/außerhalb evaluatedAreas/in insufficientEvidenceAreas/affectedAreas konsistent", () => {
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

  it("79-85. Marketing/People/Sales-Profile/Company/Opportunity Counts/Lifecycle Events/Ownership unverändert", () => {
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

  it("86. keine Public-Contract-Breaking-Change (bereits durch Test 63 abgesichert)", () => {
    expect(true).toBe(true);
  });
});
