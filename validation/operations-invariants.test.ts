import { describe, expect, it } from "vitest";
import { generateDeliveryUnits, isDeliveryUnitActiveAt, activeDeliveryUnitsAt, type DeliveryUnit } from "../world/delivery-units";
import { EMPLOYEES } from "../world/employees";
import { addDays } from "../engine/random";
import { SCENARIO_WORLDS } from "../engine/generator";
import { SCENARIO_PROFILES } from "../engine/scenario-profiles";
import { WORLD_NOW } from "../timeline/world-clock";
import { generateOperationsDeliveryFairShareObservation, type OperationsObservation } from "../observations/operations-observations";
import {
  generateGroundTruthSnapshot,
  GROUND_TRUTH_SNAPSHOTS,
  PEOPLE_GROUND_TRUTH_SNAPSHOTS,
  type ObservationLike,
} from "../ground-truth/ground-truth";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";

const world = SCENARIO_WORLDS.baseline;
const opportunityById = new Map(world.opportunities.map((o) => [o.id, o]));
const activeOperationsEmployeeIds = new Set(
  EMPLOYEES.filter((e) => e.departmentId === "dept-operations" && e.terminatedAt === undefined).map((e) => e.id),
);

describe("DeliveryUnit-Invarianten (Operations Foundation, Schritt 2)", () => {
  it("1. jede DeliveryUnit besitzt eine eindeutige ID", () => {
    const ids = world.deliveryUnits.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("2. jede DeliveryUnit referenziert eine existierende Opportunity", () => {
    for (const du of world.deliveryUnits) {
      expect(opportunityById.has(du.opportunityId), du.id).toBe(true);
    }
  });

  it("3. die referenzierte Opportunity ist tatsächlich gewonnen", () => {
    for (const du of world.deliveryUnits) {
      const opp = opportunityById.get(du.opportunityId)!;
      expect(opp.currentStage, du.id).toBe("gewonnen");
    }
  });

  it("4. accountId === opportunity.accountId", () => {
    for (const du of world.deliveryUnits) {
      const opp = opportunityById.get(du.opportunityId)!;
      expect(du.accountId, du.id).toBe(opp.accountId);
    }
  });

  it("5. startDate === opportunity.closedAt", () => {
    for (const du of world.deliveryUnits) {
      const opp = opportunityById.get(du.opportunityId)!;
      expect(du.startDate, du.id).toBe(opp.closedAt);
    }
  });

  // Delivery Commitment Truth: eine gewonnene Opportunity erzeugt keine
  // automatische Fristzusage. plannedEndDate ist deshalb bei JEDER DeliveryUnit
  // undefined — es existiert keine kanonische Plan-/Vertrags-/
  // Projektmanagementquelle in diesem Modell (siehe world/delivery-units.ts,
  // DeliveryUnit-Dokumentation). Ersetzt die vorherige, fachlich falsche Annahme
  // "plannedEndDate === startDate + 30 Tage".
  it("6. plannedEndDate ist bei jeder DeliveryUnit undefined (keine erfundene Fristzusage)", () => {
    for (const du of world.deliveryUnits) {
      expect(du.plannedEndDate, du.id).toBeUndefined();
    }
  });

  it("7. assignedEmployeeId referenziert einen aktiven Operations-Mitarbeiter", () => {
    for (const du of world.deliveryUnits) {
      expect(activeOperationsEmployeeIds.has(du.assignedEmployeeId), du.id).toBe(true);
    }
  });

  it("8. keine DeliveryUnit für eine nicht gewonnene Opportunity", () => {
    const deliveryOpportunityIds = new Set(world.deliveryUnits.map((d) => d.opportunityId));
    const nonWon = world.opportunities.filter((o) => o.currentStage !== "gewonnen");
    for (const opp of nonWon) {
      expect(deliveryOpportunityIds.has(opp.id), opp.id).toBe(false);
    }
  });

  it("9. exakt eine DeliveryUnit je gewonnener Opportunity", () => {
    const won = world.opportunities.filter((o) => o.currentStage === "gewonnen");
    const countByOpportunity = new Map<string, number>();
    for (const du of world.deliveryUnits) {
      countByOpportunity.set(du.opportunityId, (countByOpportunity.get(du.opportunityId) ?? 0) + 1);
    }
    expect(world.deliveryUnits.length).toBe(won.length);
    for (const opp of won) {
      expect(countByOpportunity.get(opp.id), opp.id).toBe(1);
    }
  });

  it("10./11. Generator ist deterministisch — gleiche Inputs erzeugen gleiche IDs/Zuweisungen", () => {
    const seed = 424242 + 7;
    const runA = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    const runB = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    expect(runA).toEqual(runB);

    const byId = new Map<string, DeliveryUnit>(runA.map((d) => [d.id, d]));
    for (const du of runB) {
      expect(byId.get(du.id)?.assignedEmployeeId).toBe(du.assignedEmployeeId);
      expect(byId.get(du.id)?.startDate).toBe(du.startDate);
    }
  });

  it("12. keine Sales-Daten werden durch die Generierung verändert", () => {
    const opportunitiesBefore = JSON.parse(JSON.stringify(world.opportunities));
    generateDeliveryUnits(424242 + 7, world.opportunities, EMPLOYEES);
    expect(world.opportunities).toEqual(opportunitiesBefore);
    // Zusätzlich: EMPLOYEES (Quelle für Operations-Zuordnung) bleibt unangetastet.
    const employeesBefore = JSON.parse(JSON.stringify(EMPLOYEES));
    generateDeliveryUnits(424242 + 7, world.opportunities, EMPLOYEES);
    expect(EMPLOYEES).toEqual(employeesBefore);
  });
});

describe("Zeitabhängige DeliveryUnit-Sicht (Phase 6, Semantik seit Real Delivery Lifecycle V1 korrigiert): actualStartDate <= X && (kein actualEndDate || X < actualEndDate)", () => {
  const wonDate = "2025-01-10";
  // actualStartDate hier bewusst identisch zu wonDate (queueDelayDays=0) — diese
  // Testgruppe prüft die reine start/end-Grenzlogik von isDeliveryUnitActiveAt,
  // nicht die Kalibrierung der Queue-Verzögerung selbst (separat in
  // delivery-lifecycle.test.ts getestet). Die "30" hier ist ein rein testlokaler
  // Abstand für die Fixture-Zeitachse, keine Produktionskonstante mehr (Delivery
  // Commitment Truth: es gibt keine Fristzusage) — plannedEndDate bleibt bewusst
  // ungesetzt, exakt wie in der Produktion.
  const actualEnd = addDays(wonDate, 30);
  const runningUnit: DeliveryUnit = {
    id: "test-du-running",
    opportunityId: "test-opp",
    accountId: "test-account",
    assignedEmployeeId: "emp-henrik-paulsen",
    startDate: wonDate,
    actualStartDate: wonDate,
    status: "laufend",
  };
  const completedUnit: DeliveryUnit = { ...runningUnit, id: "test-du-completed", actualEndDate: actualEnd, status: "abgeschlossen" };

  it("Tag vor tatsächlichem Start: nicht aktiv", () => {
    expect(isDeliveryUnitActiveAt(runningUnit, addDays(wonDate, -1))).toBe(false);
  });

  it("am tatsächlichen Start-Tag selbst: aktiv", () => {
    expect(isDeliveryUnitActiveAt(runningUnit, wonDate)).toBe(true);
  });

  it("noch eingereiht (kein actualStartDate): nicht aktiv, auch nicht am/nach dem Queue-Zeitpunkt", () => {
    const queuedOnly: DeliveryUnit = { ...runningUnit, id: "test-du-queued", actualStartDate: undefined, status: "eingereiht" };
    expect(isDeliveryUnitActiveAt(queuedOnly, wonDate)).toBe(false);
    expect(isDeliveryUnitActiveAt(queuedOnly, addDays(wonDate, 100))).toBe(false);
  });

  it("zwischen Start und (geplantem/tatsächlichem) Ende: aktiv", () => {
    expect(isDeliveryUnitActiveAt(runningUnit, addDays(wonDate, 15))).toBe(true);
    expect(isDeliveryUnitActiveAt(completedUnit, addDays(wonDate, 15))).toBe(true);
  });

  it("am Tag des tatsächlichen Abschlusses: nicht mehr aktiv (exklusive Grenze, konsistent mit OpportunityStageHistory)", () => {
    expect(isDeliveryUnitActiveAt(completedUnit, actualEnd)).toBe(false);
  });

  it("nach dem tatsächlichen Abschluss: nicht mehr aktiv", () => {
    expect(isDeliveryUnitActiveAt(completedUnit, addDays(actualEnd, 5))).toBe(false);
  });

  it("ohne actualEndDate (weiterhin laufend) bleibt auch weit über die Fixture-Zeitachse hinaus aktiv — keine Annahme über ein nicht eingetretenes Ereignis", () => {
    expect(isDeliveryUnitActiveAt(runningUnit, addDays(actualEnd, 100))).toBe(true);
  });

  it("keine Zukunftskenntnis: eine Unit mit actualStartDate in der Zukunft relativ zu asOf ist nicht aktiv, unabhängig von actualEndDate", () => {
    const futureUnit: DeliveryUnit = {
      ...runningUnit,
      id: "test-du-future",
      startDate: "2099-01-01",
      actualStartDate: "2099-01-01",
    };
    expect(isDeliveryUnitActiveAt(futureUnit, WORLD_NOW)).toBe(false);
  });

  it("activeDeliveryUnitsAt filtert korrekt über eine gemischte Menge", () => {
    const mixed = [runningUnit, completedUnit];
    expect(activeDeliveryUnitsAt(mixed, addDays(wonDate, 15)).map((u) => u.id).sort()).toEqual(
      ["test-du-completed", "test-du-running"].sort(),
    );
    expect(activeDeliveryUnitsAt(mixed, actualEnd).map((u) => u.id)).toEqual(["test-du-running"]);
  });

  it("gegen echte Baseline-Daten: activeDeliveryUnitsAt(world.deliveryUnits, WORLD_NOW) enthält nur Units mit startDate <= WORLD_NOW", () => {
    const active = activeDeliveryUnitsAt(world.deliveryUnits, WORLD_NOW);
    for (const unit of active) {
      expect(unit.startDate <= WORLD_NOW).toBe(true);
      expect(unit.actualEndDate === undefined || WORLD_NOW < unit.actualEndDate).toBe(true);
    }
  });
});

const FORBIDDEN_WORDS: RegExp[] = [
  /kritisch/i,
  /überlastet/i,
  /problematisch/i,
  /zu hoch/i,
  /ineffizient/i,
  /\bsollte\b/i,
  /\bmuss\b/i,
];

describe("Operations Fair-Share-Observation (Phase 7/8): schwellenfrei, rein deskriptiv", () => {
  const observation = generateOperationsDeliveryFairShareObservation(world.deliveryUnits, EMPLOYEES, WORLD_NOW)!;

  // Marketing Demand Model — World Generation First / Sales Ownership Decoupling:
  // diese Werte änderten sich mehrfach (10/4/4/2 → 17/5/5/7 → 15/5/3/7 → 21/11/7/3),
  // weil (a) Lead.createdAt aus einem eigenen, unabhängigen `demandRng`-Strom kommt
  // statt aus der bisherigen Gleichverteilung über `rng` und (b) dieser Strom seit
  // dem Decoupling-Auftrag entity-stabil je Lead-Index statt gemeinsam sequenziell
  // verbraucht wird (siehe events/generate-sales-pipeline.ts,
  // MARKETING_DEMAND_SEED_OFFSET-Kommentar). DeliveryUnits sind über
  // Opportunity.closedAt kausal an die Sales-Pipeline gekoppelt
  // (company-area-summaries.ts: "Sales → Operations Kausalkette") — ein anderer
  // Zufallsstrom für Lead-Timing verschiebt zwangsläufig, welche Opportunities
  // wann gewinnen.
  //
  // Real Delivery Lifecycle V1: zusätzlicher, unabhängiger Kausalpfad — "aktiv"
  // bedeutet jetzt tatsächlich gestartet (actualStartDate, entity-stabile
  // Queue-Verzögerung 0-8 Tage + reale Lieferdauer 18-42 Tage, siehe
  // world/delivery-units.ts), nicht mehr bloß eingereiht (startDate ==
  // opportunity.closedAt). Bei denselben 79 Won-Opportunities sinkt die aktive
  // Menge dadurch von 21 auf 15: mehr Units sind bei WORLD_NOW bereits wieder
  // abgeschlossen (57 von 79, echte Varianz statt fixer 30-Tage-Konstante) oder
  // noch eingereiht (7 von 79, Queue-Verzögerung reicht über WORLD_NOW hinaus),
  // statt wie zuvor pauschal "aktiv, bis exakt 30 Tage nach Won verstrichen sind".
  // Kausalkette für jeden geänderten Wert: Won Opportunity → DeliveryQueued
  // (startDate=closedAt) → DeliveryStarted (actualStartDate, entity-stabiler
  // Lifecycle-RNG) → DeliveryCompleted oder weiterhin aktiv →
  // activeDeliveryUnitsAt(WORLD_NOW) → Fair-Share-Observation.
  it("Baseline-Fakten bei WORLD_NOW entsprechen den nach Real Delivery Lifecycle V1 gemessenen Werten", () => {
    expect(observation).toBeDefined();
    expect(observation.activeDeliveryUnitsTotal).toBe(15);
    expect(observation.activeUnitsByEmployeeId).toEqual({
      "emp-henrik-paulsen": 9,
      "emp-greta-lohmann": 5,
      "emp-marc-oldenburg": 1,
    });
    expect(observation.fairShare).toBeCloseTo(15 / 3, 10);
    expect(observation.maxAssignedCount).toBe(9);
    expect(observation.maxAssignedEmployeeId).toBe("emp-henrik-paulsen");
    expect(observation.maxShare).toBeCloseTo(9 / 15, 10);
    expect(observation.fairShareRatio).toBeCloseTo(9 / 15 / (1 / 3), 10);
  });

  it("derivedFrom referenziert exakt die aktiven DeliveryUnit-IDs, keine anderen", () => {
    const expectedActiveIds = new Set(activeDeliveryUnitsAt(world.deliveryUnits, WORLD_NOW).map((u) => u.id));
    expect(new Set(observation.derivedFrom)).toEqual(expectedActiveIds);
    expect(observation.derivedFrom.length).toBe(observation.activeDeliveryUnitsTotal);
  });

  it("statement enthält keine Bewertungs-/Handlungssprache", () => {
    for (const pattern of FORBIDDEN_WORDS) {
      expect(pattern.test(observation.statement), `"${observation.statement}" matched ${pattern}`).toBe(false);
    }
  });

  it("confidence ist 'unzureichend' — keine neue Confidence-Skala, keine erfundene Severity", () => {
    expect(observation.confidence).toBe("unzureichend");
    expect(observation).not.toHaveProperty("severity");
    expect(observation).not.toHaveProperty("category");
  });

  it("keine aktiven Units (hypothetischer Zeitpunkt vor jedem Won-Datum): Observation existiert weiterhin, Werte sind 0", () => {
    const early = generateOperationsDeliveryFairShareObservation(world.deliveryUnits, EMPLOYEES, "2020-01-01")!;
    expect(early.activeDeliveryUnitsTotal).toBe(0);
    expect(early.derivedFrom).toEqual([]);
    expect(early.fairShare).toBe(0);
    expect(early.maxShare).toBe(0);
    expect(early.fairShareRatio).toBe(0);
  });
});

describe("Zero-Active-Explainability-Fix (Operations Evidence Audit, Phase C)", () => {
  // Synthetische Fixtures, unabhängig von der realen Baseline-Welt — decken exakt
  // die drei fachlich unterschiedlichen Fälle ab (A3): keine Population, geprüfte
  // Population ohne aktive Einheit, aktive Einheiten.
  const completed1: DeliveryUnit = {
    id: "test-du-completed-1",
    opportunityId: "test-opp-1",
    accountId: "test-account-1",
    assignedEmployeeId: "emp-henrik-paulsen",
    startDate: "2025-01-01",
    actualStartDate: "2025-01-01",
    actualEndDate: "2025-01-31",
    status: "abgeschlossen",
  };
  const completed2: DeliveryUnit = {
    ...completed1,
    id: "test-du-completed-2",
    opportunityId: "test-opp-2",
    accountId: "test-account-2",
    assignedEmployeeId: "emp-greta-lohmann",
  };
  const futureUnit: DeliveryUnit = {
    ...completed1,
    id: "test-du-future",
    opportunityId: "test-opp-future",
    accountId: "test-account-future",
    startDate: "2099-01-01",
    actualStartDate: undefined,
    actualEndDate: undefined,
    status: "eingereiht",
  };
  const runningUnit: DeliveryUnit = {
    ...completed1,
    id: "test-du-running",
    opportunityId: "test-opp-running",
    accountId: "test-account-running",
    actualEndDate: undefined,
    status: "laufend",
  };

  it("1. vor der ersten DeliveryUnit: derivedFrom=[] bleibt korrekt (keine geprüfte Population)", () => {
    const obs = generateOperationsDeliveryFairShareObservation([completed1, completed2], EMPLOYEES, "2024-01-01")!;
    expect(obs.activeDeliveryUnitsTotal).toBe(0);
    expect(obs.derivedFrom).toEqual([]);
  });

  it("2. bereits gestartete und abgeschlossene Units, keine aktiv: derivedFrom referenziert die geprüfte Population, nicht leer", () => {
    const asOf = "2025-02-15";
    const obs = generateOperationsDeliveryFairShareObservation([completed1, completed2], EMPLOYEES, asOf)!;
    expect(obs.activeDeliveryUnitsTotal).toBe(0);
    expect(obs.derivedFrom.slice().sort()).toEqual(["test-du-completed-1", "test-du-completed-2"]);
    expect(obs.derivedFrom.length).toBeGreaterThan(0);
  });

  it("2b. derivedFrom enthält bei 0 aktiven Units ausschließlich Units mit startDate <= asOf, keine anderen", () => {
    const asOf = "2025-02-15";
    const obs = generateOperationsDeliveryFairShareObservation([completed1, completed2, futureUnit], EMPLOYEES, asOf)!;
    expect(obs.derivedFrom).not.toContain("test-du-future");
    expect(obs.derivedFrom.slice().sort()).toEqual(["test-du-completed-1", "test-du-completed-2"]);
  });

  it("3. aktive Units vorhanden: bestehendes Verhalten unverändert — derivedFrom exakt die aktiven IDs, nicht die gesamte gestartete Population", () => {
    const asOf = "2025-02-15";
    const obs = generateOperationsDeliveryFairShareObservation([completed1, completed2, runningUnit], EMPLOYEES, asOf)!;
    expect(obs.activeDeliveryUnitsTotal).toBe(1);
    expect(obs.derivedFrom).toEqual(["test-du-running"]);
  });

  it("4. Future Knowledge: eine DeliveryUnit mit startDate > asOf erscheint niemals in derivedFrom, auch nicht im Zero-Active-Fall", () => {
    const asOf = "2024-06-01";
    const obs = generateOperationsDeliveryFairShareObservation([futureUnit], EMPLOYEES, asOf)!;
    expect(obs.activeDeliveryUnitsTotal).toBe(0);
    expect(obs.derivedFrom).toEqual([]);
  });

  it("5. Determinismus: identischer Input und asOf erzeugen identische Observation", () => {
    const asOf = "2025-02-15";
    const runA = generateOperationsDeliveryFairShareObservation([completed1, completed2], EMPLOYEES, asOf);
    const runB = generateOperationsDeliveryFairShareObservation([completed1, completed2], EMPLOYEES, asOf);
    expect(runA).toEqual(runB);
  });

  // 6. Ursprünglich ein Regressionstest gegen vier konkrete reale Baseline-Tage
  // (29.03.-01.04.2025), an denen die alte, feste 30-Tage-Konstante einen
  // Zero-Active-mit-Population-Fall erzeugte. Real Delivery Lifecycle V1 fügt echte
  // Queue-/Lieferdauer-Varianz hinzu, wodurch Abschlüsse über die Zeit gestreut
  // statt in starren 30-Tage-Kohorten gebündelt werden — an den ursprünglichen vier
  // Tagen tritt der Fall in der aktuellen Baseline dadurch nicht mehr auf (geprüft:
  // 0 Tage im gesamten Zeitraum). Statt eines jetzt gegenstandslosen
  // Datums-Regressionstests prüft dieser Test die zugrunde liegende Invariante
  // direkt über den vollständigen realen Zeitraum: an JEDEM Tag, an dem
  // "aktiv=0" gilt, muss derivedFrom exakt der bereits gestarteten Population
  // entsprechen — unabhängig davon, ob ein solcher Tag aktuell existiert.
  it("6. echte Baseline-Welt, gesamter Zeitraum: an jedem Zero-Active-Tag entspricht derivedFrom exakt der bereits gestarteten Population", () => {
    const sorted = [...world.deliveryUnits].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
    let cursor = sorted[0]!.startDate;
    let daysChecked = 0;
    let zeroActiveDaysFound = 0;
    while (cursor <= WORLD_NOW && daysChecked < 400) {
      const startedByThen = new Set(world.deliveryUnits.filter((u) => u.startDate <= cursor).map((u) => u.id));
      const obs = generateOperationsDeliveryFairShareObservation(world.deliveryUnits, EMPLOYEES, cursor)!;
      if (obs.activeDeliveryUnitsTotal === 0 && startedByThen.size > 0) {
        zeroActiveDaysFound++;
        expect(obs.derivedFrom.length, cursor).toBe(startedByThen.size);
        for (const id of obs.derivedFrom) {
          expect(startedByThen.has(id), `${cursor}: ${id}`).toBe(true);
        }
      }
      cursor = addDays(cursor, 1);
      daysChecked++;
    }
    // Dokumentiert den aktuellen Stand explizit, statt ihn stillschweigend
    // vorauszusetzen — bei 0 gefundenen Tagen prüft die Schleife oben zwar nichts
    // Zusätzliches, die synthetischen Tests 1/2/2b/7/8/9/10 decken den Fall aber
    // bereits unabhängig von der realen Baseline-Welt vollständig ab.
    expect(daysChecked).toBeGreaterThan(0);
    expect(zeroActiveDaysFound).toBe(0);
  });

  it("7./8. keine leeren oder unbekannten IDs in derivedFrom (Zero-Active-Fall)", () => {
    const asOf = "2025-02-15";
    const obs = generateOperationsDeliveryFairShareObservation([completed1, completed2], EMPLOYEES, asOf)!;
    const knownIds = new Set(["test-du-completed-1", "test-du-completed-2"]);
    for (const id of obs.derivedFrom) {
      expect(id.length).toBeGreaterThan(0);
      expect(knownIds.has(id)).toBe(true);
    }
  });

  it("9. keine duplizierten IDs in derivedFrom (Zero-Active-Fall)", () => {
    const asOf = "2025-02-15";
    const obs = generateOperationsDeliveryFairShareObservation([completed1, completed2], EMPLOYEES, asOf)!;
    expect(new Set(obs.derivedFrom).size).toBe(obs.derivedFrom.length);
  });

  it("10. statement und numerische Metriken bleiben im Zero-Active-Fall unverändert konsistent (nur derivedFrom betroffen)", () => {
    const asOf = "2025-02-15";
    const obs = generateOperationsDeliveryFairShareObservation([completed1, completed2], EMPLOYEES, asOf)!;
    expect(obs.statement).toBe(`Zum ${asOf} sind keine DeliveryUnits aktiv.`);
    expect(obs.activeDeliveryUnitsTotal).toBe(0);
    expect(obs.fairShare).toBe(0);
    expect(obs.maxAssignedCount).toBe(0);
    expect(obs.maxShare).toBe(0);
    expect(obs.fairShareRatio).toBe(0);
    expect(obs.confidence).toBe("unzureichend");
  });
});

describe("Operations Ground Truth (Phase 10): generischer Generator wiederverwendet, eigene Gruppe 'Delivery'", () => {
  const observation = generateOperationsDeliveryFairShareObservation(world.deliveryUnits, EMPLOYEES, WORLD_NOW)!;
  const operationsObservations: ObservationLike[] = [observation];
  const groundTruth = generateGroundTruthSnapshot(operationsObservations, WORLD_NOW);

  it("enthält ausschließlich die Operations-Observation", () => {
    expect(groundTruth.activeObservationIds).toEqual([observation.id]);
  });

  it("Gruppe 'Delivery' enthält genau diese Observation", () => {
    const deliveryGroup = groundTruth.observationGroups.find((g) => g.label === "Delivery");
    expect(deliveryGroup).toBeDefined();
    expect(deliveryGroup!.observationIds).toEqual([observation.id]);
  });

  it("Priorität ist 'unterstuetzend' (keine implizite Bewertung ohne Kalibrierung)", () => {
    expect(groundTruth.priorities).toEqual([{ observationId: observation.id, tier: "unterstuetzend" }]);
  });

  it("Backward Explainability: Operations Ground Truth → Observation → DeliveryUnit-IDs → Opportunity-IDs → Account/closedAt", () => {
    for (const id of observation.derivedFrom) {
      const unit = world.deliveryUnits.find((u) => u.id === id)!;
      expect(unit).toBeDefined();
      const opp = opportunityById.get(unit.opportunityId)!;
      expect(opp).toBeDefined();
      expect(opp.currentStage).toBe("gewonnen");
      expect(opp.accountId).toBe(unit.accountId);
      expect(opp.closedAt).toBe(unit.startDate);
    }
  });

  it("bestehende Sales-/People-Ground-Truth bleiben durch die generische Typ-Verengung (ObservationLike) unverändert", () => {
    expect(GROUND_TRUTH_SNAPSHOTS.length).toBe(1);
    expect(PEOPLE_GROUND_TRUTH_SNAPSHOTS.length).toBe(1);
    expect(PEOPLE_GROUND_TRUTH_SNAPSHOTS[0]!.activeObservationIds).toEqual([]);
  });
});

describe("ScenarioProfile.operations / Concentrated-Modus (Phase 12/13)", () => {
  const seed = 424242 + 7;

  it("alle 6 bestehenden Scenario Profiles tragen operations mit assignmentStrategy 'balanced' — Baseline-Verhalten unverändert", () => {
    for (const profile of SCENARIO_PROFILES) {
      expect(profile.operations).toEqual({
        assignmentStrategy: "balanced",
        concentratedEmployeeIds: [],
        concentrationWeightMultiplier: 1,
      });
    }
  });

  it("'balanced' erzeugt bit-identisches Ergebnis zum Aufruf ohne config (Default)", () => {
    const withDefault = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    const withExplicitBalanced = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES, {
      assignmentStrategy: "balanced",
      concentratedEmployeeIds: [],
      concentrationWeightMultiplier: 1,
    });
    expect(withDefault).toEqual(withExplicitBalanced);
  });

  it("'concentrated' weicht sichtbar und deterministisch von 'balanced' ab (gemessen bei WORLD_NOW, gleiche Sales-Opportunities)", () => {
    const balanced = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES, {
      assignmentStrategy: "balanced",
      concentratedEmployeeIds: [],
      concentrationWeightMultiplier: 1,
    });
    // concentrationWeightMultiplier: 4 — bewusst derselbe, bereits validierte Wert wie
    // TEAM_ENGPASS_PROFILE.sales.overloadWeightMultiplier (scenario-profiles.ts),
    // keine neu erfundene Zahl.
    const concentrated = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES, {
      assignmentStrategy: "concentrated",
      concentratedEmployeeIds: ["emp-henrik-paulsen"],
      concentrationWeightMultiplier: 4,
    });

    const activeBalanced = activeDeliveryUnitsAt(balanced, WORLD_NOW);
    const activeConcentrated = activeDeliveryUnitsAt(concentrated, WORLD_NOW);

    const countFor = (units: DeliveryUnit[], employeeId: string) =>
      units.filter((u) => u.assignedEmployeeId === employeeId).length;

    // Tatsächlich gemessene Werte nach Real Delivery Lifecycle V1 (siehe Erklärung
    // bei "Baseline-Fakten bei WORLD_NOW..." oben: "aktiv" bedeutet jetzt
    // tatsächlich gestartet, nicht mehr bloß eingereiht — dieselben 79
    // Won-Opportunities, aber weniger davon sind bei WORLD_NOW noch im aktiven
    // Fenster):
    // Balanced: Henrik 9, Greta 5, Marc 1 von 15 aktiven Units.
    // Concentrated: Henrik 13, Greta 2, Marc 0 von 15 aktiven Units.
    expect(activeBalanced.length).toBe(15);
    expect(countFor(activeBalanced, "emp-henrik-paulsen")).toBe(9);
    expect(activeConcentrated.length).toBe(15);
    expect(countFor(activeConcentrated, "emp-henrik-paulsen")).toBe(13);

    // Die Kernaussage von Phase 13: sichtbar unterschiedlich, keine Aussage darüber,
    // ob/ab wann das "Engpass" bedeutet.
    expect(countFor(activeConcentrated, "emp-henrik-paulsen")).toBeGreaterThan(
      countFor(activeBalanced, "emp-henrik-paulsen"),
    );
  });

  it("'concentrated' bleibt deterministisch — gleicher Seed erzeugt exakt dasselbe Ergebnis", () => {
    const config = { assignmentStrategy: "concentrated" as const, concentratedEmployeeIds: ["emp-henrik-paulsen"], concentrationWeightMultiplier: 4 };
    const runA = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES, config);
    const runB = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES, config);
    expect(runA).toEqual(runB);
  });

  it("'concentrated' verändert keine bestehenden Sales-Daten (opportunities bleiben unverändert)", () => {
    const before = JSON.parse(JSON.stringify(world.opportunities));
    generateDeliveryUnits(seed, world.opportunities, EMPLOYEES, {
      assignmentStrategy: "concentrated",
      concentratedEmployeeIds: ["emp-henrik-paulsen"],
      concentrationWeightMultiplier: 4,
    });
    expect(world.opportunities).toEqual(before);
  });
});

describe("Snapshot-Integration (Phase 14): DeliveryUnits/Operations Observation, keine Zukunftskenntnis", () => {
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
    };
  }

  it("Snapshot lange vor jedem Won-Datum: keine DeliveryUnits, keine aktiven Units, Operations Observation mit 0 aktiven Units", () => {
    const snapshot = generateWorldSnapshot(toSource(), "2020-01-01");
    expect(snapshot.deliveryUnits).toEqual([]);
    expect(snapshot.activeDeliveryUnits).toEqual([]);
    expect(snapshot.operationsObservation).toBeDefined();
    expect(snapshot.operationsObservation!.activeDeliveryUnitsTotal).toBe(0);
  });

  it("Snapshot zu einem mittleren Zeitpunkt: enthält nur DeliveryUnits mit startDate <= asOf, keine späteren", () => {
    const asOf = "2025-01-01";
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    const expectedIds = new Set(world.deliveryUnits.filter((u) => u.startDate <= asOf).map((u) => u.id));
    expect(new Set(snapshot.deliveryUnits.map((u) => u.id))).toEqual(expectedIds);
    for (const unit of snapshot.deliveryUnits) {
      expect(unit.startDate <= asOf).toBe(true);
    }
    // Weniger als die Gesamtzahl (69) — echte zeitliche Einschränkung, kein No-Op.
    expect(snapshot.deliveryUnits.length).toBeGreaterThan(0);
    expect(snapshot.deliveryUnits.length).toBeLessThan(world.deliveryUnits.length);
  });

  // Real Delivery Lifecycle V1: siehe Erklärung bei "Baseline-Fakten bei
  // WORLD_NOW..." weiter oben in dieser Datei.
  it("Snapshot bei WORLD_NOW: identisch zu den nach Real Delivery Lifecycle V1 verifizierten Baseline-Fakten", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(snapshot.activeDeliveryUnits.length).toBe(15);
    expect(snapshot.operationsObservation!.activeDeliveryUnitsTotal).toBe(15);
    expect(snapshot.operationsObservation!.maxAssignedCount).toBe(9);
  });

  it("keine zukünftigen Won-Deals: eine DeliveryUnit deren Opportunity erst nach asOf schließt, erscheint nicht im Snapshot", () => {
    const future = world.deliveryUnits.filter((u) => u.startDate > "2025-01-01")[0]!;
    const snapshot = generateWorldSnapshot(toSource(), "2025-01-01");
    expect(snapshot.deliveryUnits.some((u) => u.id === future.id)).toBe(false);
    expect(snapshot.operationsObservation!.derivedFrom).not.toContain(future.id);
  });

  it("activeDeliveryUnits ist stets eine Teilmenge von deliveryUnits", () => {
    for (const asOf of ["2024-08-01", "2025-01-01", WORLD_NOW]) {
      const snapshot = generateWorldSnapshot(toSource(), asOf);
      const ids = new Set(snapshot.deliveryUnits.map((u) => u.id));
      for (const unit of snapshot.activeDeliveryUnits) {
        expect(ids.has(unit.id)).toBe(true);
      }
    }
  });
});
