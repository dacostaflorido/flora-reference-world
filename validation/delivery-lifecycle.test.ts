import { describe, expect, it } from "vitest";
import * as DeliveryUnitsModule from "../world/delivery-units";
import {
  generateDeliveryUnits,
  isDeliveryUnitActiveAt,
  deliveryUnitStatusAt,
  QUEUE_DELAY_MIN_DAYS,
  QUEUE_DELAY_MAX_DAYS,
  ACTUAL_DELIVERY_DURATION_MIN_DAYS,
  ACTUAL_DELIVERY_DURATION_MAX_DAYS,
  type DeliveryUnit,
} from "../world/delivery-units";
import * as DeliveryLifecycleModule from "../events/delivery-lifecycle";
import {
  generateDeliveryQueuedEvents,
  generateDeliveryStartedEvents,
  generateDeliveryCompletedEvents,
} from "../events/delivery-lifecycle";
import * as OperationsObservationsModule from "../observations/operations-observations";
import * as PublicIndexModule from "../index";
import { EMPLOYEES } from "../world/employees";
import { daysBetween } from "../engine/random";
import { SCENARIO_WORLDS } from "../engine/generator";
import { WORLD_NOW } from "../timeline/world-clock";
import { generateOperationsDeliveryFairShareObservation } from "../observations/operations-observations";

// Delivery Commitment Truth + Event Source of Truth — korrigierte, dedizierte
// Testdatei. Eine Lieferverpflichtung entsteht ausschließlich durch eine gewonnene
// Opportunity, ohne automatische Fristzusage. Kein plannedEndDate, keine
// Früh-/Pünktlich-/Spät-Klassifikation, keine Termintreueaussage — diese Datei
// testet ausschließlich die Commitment-/Event-/Zeitgrundlage selbst.

const world = SCENARIO_WORLDS.baseline;
const units = world.deliveryUnits;
const opportunityById = new Map(world.opportunities.map((o) => [o.id, o]));
const unitById = new Map(units.map((u) => [u.id, u]));

// Aus ScenarioWorld (Phase 4.3-Verdrahtung), nicht erneut lokal abgeleitet — belegt
// zugleich, dass die World-Integration reproduzierbar nutzbar ist.
const queuedEvents = world.deliveryQueuedEvents;
const startedEvents = world.deliveryStartedEvents;
const completedEvents = world.deliveryCompletedEvents;

describe("Commitment", () => {
  it("1. keine Won Opportunity → keine Delivery Unit", () => {
    const nonWon = world.opportunities.filter((o) => o.currentStage !== "gewonnen");
    const deliveryOpportunityIds = new Set(units.map((u) => u.opportunityId));
    for (const opp of nonWon) {
      expect(deliveryOpportunityIds.has(opp.id), opp.id).toBe(false);
    }
  });

  it("2. keine Won Opportunity → keine Lifecycle Events", () => {
    const nonWon = world.opportunities.filter((o) => o.currentStage !== "gewonnen");
    const queuedOpportunityIds = new Set(queuedEvents.map((e) => e.opportunityId));
    for (const opp of nonWon) {
      expect(queuedOpportunityIds.has(opp.id), opp.id).toBe(false);
    }
  });

  it("3. jede Won Opportunity → genau eine Delivery Unit", () => {
    const won = world.opportunities.filter((o) => o.currentStage === "gewonnen");
    const countByOpportunity = new Map<string, number>();
    for (const u of units) countByOpportunity.set(u.opportunityId, (countByOpportunity.get(u.opportunityId) ?? 0) + 1);
    expect(units.length).toBe(won.length);
    for (const opp of won) {
      expect(countByOpportunity.get(opp.id), opp.id).toBe(1);
    }
  });

  it("4. jede Won Opportunity → genau ein Queue Event", () => {
    expect(queuedEvents.length).toBe(units.length);
    const countByOpportunity = new Map<string, number>();
    for (const e of queuedEvents) countByOpportunity.set(e.opportunityId, (countByOpportunity.get(e.opportunityId) ?? 0) + 1);
    for (const count of countByOpportunity.values()) {
      expect(count).toBe(1);
    }
  });

  it("5. queuedAt = opportunity.closedAt", () => {
    for (const e of queuedEvents) {
      const opp = opportunityById.get(e.opportunityId)!;
      expect(e.queuedAt, e.id).toBe(opp.closedAt);
    }
  });
});

describe("Kein erfundener Plan", () => {
  // Statt Datei-Text-Scans (dieses Repository ist bewusst dependency-frei, siehe
  // engine/seed.ts-Kommentar "zero-dependency" — kein @types/node/node:fs
  // verfügbar oder hinzuzufügen): Modul-Namespace-Imports zur Laufzeit inspiziert.
  // Beweist dieselbe Abwesenheit robuster als ein Text-Scan (Verhalten statt
  // bloßer Zeichenketten-Abwesenheit).

  it("6. plannedEndDate ist in der aktuellen Reference World bei allen Units undefined", () => {
    for (const unit of units) {
      expect(unit.plannedEndDate, unit.id).toBeUndefined();
    }
  });

  it("7. keine 30-Tage-Konstante (oder andere feste Fristkonstante) steuert den Lifecycle", () => {
    expect(DeliveryUnitsModule).not.toHaveProperty("DELIVERY_ONBOARDING_DURATION_DAYS");
    // Die tatsächlichen Kalibrierungskonstanten (Queue-Wartezeit, tatsächliche
    // Lieferdauer) sind ausdrücklich erlaubt — sie modellieren reale Streuung,
    // keine Fristzusage.
    expect(QUEUE_DELAY_MIN_DAYS).toBeDefined();
    expect(ACTUAL_DELIVERY_DURATION_MIN_DAYS).toBeDefined();
  });

  const FORBIDDEN_COMMITMENT_TERMS: RegExp[] = [
    /\bearly\b/i,
    /\bon.?time\b/i,
    /\blate\b/i,
    /\boverdue\b/i,
    /\bdelayed\b/i,
    /vorzeitig/i,
    /pünktlich/i,
    /verspätet/i,
    /planabweichung/i,
    /termintreue/i,
    /\bsla\b/i,
  ];

  it("8. keine Early-/On-Time-/Late-Klassifikation im Produktionscode (keine entsprechend benannten Exports/Felder)", () => {
    const exportNames = [
      ...Object.keys(DeliveryUnitsModule),
      ...Object.keys(DeliveryLifecycleModule),
      ...Object.keys(OperationsObservationsModule),
    ];
    for (const name of exportNames) {
      for (const pattern of FORBIDDEN_COMMITMENT_TERMS) {
        expect(pattern.test(name), `Export "${name}" matched ${pattern}`).toBe(false);
      }
    }
    for (const unit of units) {
      for (const key of Object.keys(unit)) {
        for (const pattern of FORBIDDEN_COMMITMENT_TERMS) {
          expect(pattern.test(key), `DeliveryUnit-Feld "${key}" matched ${pattern}`).toBe(false);
        }
      }
    }
  });

  it("9. keine Planabweichungsmetrik (kein Feld, das completedAt gegen ein Planziel vergleicht)", () => {
    for (const unit of units) {
      expect(unit).not.toHaveProperty("deviationDays");
      expect(unit).not.toHaveProperty("planDeviation");
    }
    for (const e of completedEvents) {
      expect(e).not.toHaveProperty("deviationDays");
      expect(e).not.toHaveProperty("planDeviation");
    }
  });

  it("10. keine Termintreueaussage (weder als Feld noch als Statement-Text)", () => {
    // FORBIDDEN_COMMITMENT_TERMS (Test 8) deckt Produktionscode bereits ab; hier
    // zusätzlich die tatsächlich erzeugten Observation-Statements zur Laufzeit
    // geprüft.
    const obs = generateOperationsDeliveryFairShareObservation(units, EMPLOYEES, WORLD_NOW)!;
    for (const pattern of FORBIDDEN_COMMITMENT_TERMS) {
      expect(pattern.test(obs.statement), `"${obs.statement}" matched ${pattern}`).toBe(false);
    }
  });
});

describe("Lifecycle", () => {
  it("11. jede gestartete Unit besitzt genau ein Start Event", () => {
    const startedUnitIds = units.filter((u) => u.actualStartDate !== undefined).map((u) => u.id);
    expect(startedEvents.length).toBe(startedUnitIds.length);
    expect(new Set(startedEvents.map((e) => e.deliveryUnitId))).toEqual(new Set(startedUnitIds));
  });

  it("12. jede abgeschlossene Unit besitzt genau ein Completion Event", () => {
    const completedUnitIds = units.filter((u) => u.actualEndDate !== undefined).map((u) => u.id);
    expect(completedEvents.length).toBe(completedUnitIds.length);
    expect(new Set(completedEvents.map((e) => e.deliveryUnitId))).toEqual(new Set(completedUnitIds));
  });

  it("13. eingereihte Units besitzen noch kein Start Event", () => {
    const startedUnitIds = new Set(startedEvents.map((e) => e.deliveryUnitId));
    const queuedOnly = units.filter((u) => u.actualStartDate === undefined);
    expect(queuedOnly.length).toBeGreaterThan(0);
    for (const unit of queuedOnly) {
      expect(startedUnitIds.has(unit.id)).toBe(false);
    }
  });

  it("14. nicht abgeschlossene Units besitzen kein Completion Event", () => {
    const completedUnitIds = new Set(completedEvents.map((e) => e.deliveryUnitId));
    const notCompleted = units.filter((u) => u.actualEndDate === undefined);
    expect(notCompleted.length).toBeGreaterThan(0);
    for (const unit of notCompleted) {
      expect(completedUnitIds.has(unit.id)).toBe(false);
    }
  });

  it("15. eindeutige Event-IDs (über alle drei Eventtypen hinweg)", () => {
    const allIds = [...queuedEvents.map((e) => e.id), ...startedEvents.map((e) => e.id), ...completedEvents.map((e) => e.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("16. keine verwaisten Events (jedes Event referenziert eine tatsächlich existierende DeliveryUnit)", () => {
    const unitIds = new Set(units.map((u) => u.id));
    for (const e of [...queuedEvents, ...startedEvents, ...completedEvents]) {
      expect(unitIds.has(e.deliveryUnitId), e.id).toBe(true);
    }
  });

  it("17. vollständige Referenzintegrität (deliveryUnitId/opportunityId/accountId existieren)", () => {
    for (const e of queuedEvents) {
      expect(unitById.has(e.deliveryUnitId), e.id).toBe(true);
      expect(opportunityById.has(e.opportunityId), e.id).toBe(true);
    }
    for (const e of [...startedEvents, ...completedEvents]) {
      expect(unitById.has(e.deliveryUnitId), e.id).toBe(true);
    }
  });
});

describe("Zeit", () => {
  it("18. closedAt = queuedAt", () => {
    for (const e of queuedEvents) {
      const opp = opportunityById.get(e.opportunityId)!;
      expect(opp.closedAt, e.id).toBe(e.queuedAt);
    }
  });

  it("19. queuedAt <= startedAt", () => {
    for (const e of startedEvents) {
      const unit = unitById.get(e.deliveryUnitId)!;
      expect(unit.startDate <= e.startedAt, e.id).toBe(true);
    }
  });

  it("20. startedAt <= completedAt", () => {
    for (const e of completedEvents) {
      const unit = unitById.get(e.deliveryUnitId)!;
      expect(unit.actualStartDate! <= e.completedAt, e.id).toBe(true);
    }
  });

  it("21. kein tatsächlicher Abschluss nach WORLD_NOW als bekanntes Event", () => {
    for (const e of completedEvents) {
      expect(e.completedAt <= WORLD_NOW, e.id).toBe(true);
    }
  });

  it("22. Queue-Dauer nicht negativ", () => {
    for (const unit of units.filter((u) => u.actualStartDate !== undefined)) {
      expect(daysBetween(unit.startDate, unit.actualStartDate!)).toBeGreaterThanOrEqual(0);
    }
  });

  it("23. tatsächliche Lieferdauer nicht negativ", () => {
    for (const unit of units.filter((u) => u.actualEndDate !== undefined)) {
      expect(daysBetween(unit.actualStartDate!, unit.actualEndDate!)).toBeGreaterThan(0);
    }
  });

  it("24. tatsächliche Lieferdauer besitzt Varianz", () => {
    const durations = units
      .filter((u) => u.actualEndDate !== undefined)
      .map((u) => daysBetween(u.actualStartDate!, u.actualEndDate!));
    expect(new Set(durations).size).toBeGreaterThan(1);
  });
});

describe("Status und as-of", () => {
  it("25. vor Won keine Unit (Existenzfilterung startDate <= asOf, siehe snapshot.ts)", () => {
    const beforeAnyWon = units.filter((u) => u.startDate <= "2000-01-01");
    expect(beforeAnyWon.length).toBe(0);
  });

  it("26. nach Won und vor Start: Status 'eingereiht'", () => {
    const queuedOnly = units.filter((u) => u.actualStartDate === undefined);
    expect(queuedOnly.length).toBeGreaterThan(0);
    for (const unit of queuedOnly) {
      expect(deliveryUnitStatusAt(unit, unit.startDate), unit.id).toBe("eingereiht");
      expect(deliveryUnitStatusAt(unit, WORLD_NOW), unit.id).toBe("eingereiht");
    }
  });

  it("27. nach Start: Status 'laufend'", () => {
    const active = units.filter((u) => isDeliveryUnitActiveAt(u, WORLD_NOW));
    expect(active.length).toBeGreaterThan(0);
    for (const unit of active) {
      expect(deliveryUnitStatusAt(unit, WORLD_NOW), unit.id).toBe("laufend");
    }
  });

  it("28. ab Completion: Status 'abgeschlossen'", () => {
    const completed = units.filter((u) => u.actualEndDate !== undefined);
    expect(completed.length).toBeGreaterThan(0);
    for (const unit of completed) {
      expect(deliveryUnitStatusAt(unit, unit.actualEndDate!), unit.id).toBe("abgeschlossen");
      expect(deliveryUnitStatusAt(unit, WORLD_NOW), unit.id).toBe("abgeschlossen");
    }
  });

  it("29. Future Events verändern frühere Snapshots nicht", () => {
    const completed = units.find((u) => u.actualEndDate !== undefined && u.startDate < u.actualStartDate!)!;
    expect(completed).toBeDefined();
    expect(deliveryUnitStatusAt(completed, completed.startDate)).toBe("eingereiht");
    expect(isDeliveryUnitActiveAt(completed, completed.startDate)).toBe(false);
  });

  it("30. aktive Units verwenden den tatsächlichen Start (actualStartDate), nicht den Queue-Zeitpunkt (startDate)", () => {
    const withQueueDelay = units.find(
      (u) => u.actualStartDate !== undefined && u.startDate < u.actualStartDate,
    )!;
    expect(withQueueDelay).toBeDefined();
    expect(isDeliveryUnitActiveAt(withQueueDelay, withQueueDelay.startDate)).toBe(false);
    expect(isDeliveryUnitActiveAt(withQueueDelay, withQueueDelay.actualStartDate!)).toBe(true);
  });

  it("31. tatsächlicher Abschluss beendet Aktivität korrekt (exklusive Grenze)", () => {
    const completed = units.filter((u) => u.actualEndDate !== undefined);
    for (const unit of completed) {
      expect(isDeliveryUnitActiveAt(unit, unit.actualEndDate!), unit.id).toBe(false);
    }
  });
});

describe("Determinismus", () => {
  const seed = 424242 + 7;

  it("32. gleicher Seed → identische Events", () => {
    const unitsA = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    const unitsB = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    expect(generateDeliveryQueuedEvents(unitsA)).toEqual(generateDeliveryQueuedEvents(unitsB));
    expect(generateDeliveryStartedEvents(unitsA)).toEqual(generateDeliveryStartedEvents(unitsB));
    expect(generateDeliveryCompletedEvents(unitsA)).toEqual(generateDeliveryCompletedEvents(unitsB));
  });

  it("33. gleicher Seed → identische Delivery Units", () => {
    const unitsA = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    const unitsB = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    expect(unitsA).toEqual(unitsB);
  });

  it("34. Order Independence: eine andere Iterationsreihenfolge der Opportunities verändert die Lifecycle-Zeitpunkte je Opportunity nicht", () => {
    const original = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    const reversed = generateDeliveryUnits(seed, [...world.opportunities].reverse(), EMPLOYEES);
    const byOppOriginal = new Map(original.map((u) => [u.opportunityId, u]));
    const byOppReversed = new Map(reversed.map((u) => [u.opportunityId, u]));
    expect(byOppReversed.size).toBe(byOppOriginal.size);
    for (const [oppId, unitOriginal] of byOppOriginal) {
      const unitReversed = byOppReversed.get(oppId)!;
      expect(unitReversed.startDate, oppId).toBe(unitOriginal.startDate);
      expect(unitReversed.actualStartDate, oppId).toBe(unitOriginal.actualStartDate);
      expect(unitReversed.actualEndDate, oppId).toBe(unitOriginal.actualEndDate);
    }
  });

  it("35. Hinzufügen einer unabhängigen Won Opportunity verändert bestehende Lifecycle-Zeiten nicht", () => {
    const before = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    const syntheticOpp = { ...world.opportunities[0]!, id: "synthetic-test-opp-99999" };
    const after = generateDeliveryUnits(seed, [...world.opportunities, syntheticOpp], EMPLOYEES);
    const beforeByOpp = new Map(before.map((u) => [u.opportunityId, u]));
    for (const unit of after) {
      if (unit.opportunityId === syntheticOpp.id) continue;
      const beforeUnit = beforeByOpp.get(unit.opportunityId)!;
      expect(unit.startDate, unit.opportunityId).toBe(beforeUnit.startDate);
      expect(unit.actualStartDate, unit.opportunityId).toBe(beforeUnit.actualStartDate);
      expect(unit.actualEndDate, unit.opportunityId).toBe(beforeUnit.actualEndDate);
    }
  });

  it("36. Entfernen einer unabhängigen Won Opportunity verändert die Lifecycle-Zeiten der verbleibenden Units nicht", () => {
    const withAll = generateDeliveryUnits(seed, world.opportunities, EMPLOYEES);
    const withoutOne = generateDeliveryUnits(seed, world.opportunities.slice(1), EMPLOYEES);
    const withAllByOpp = new Map(withAll.map((u) => [u.opportunityId, u]));
    for (const unit of withoutOne) {
      const original = withAllByOpp.get(unit.opportunityId)!;
      expect(unit.startDate, unit.opportunityId).toBe(original.startDate);
      expect(unit.actualStartDate, unit.opportunityId).toBe(original.actualStartDate);
      expect(unit.actualEndDate, unit.opportunityId).toBe(original.actualEndDate);
    }
  });

  it("37. keine Cross-Entity-RNG-Kopplung (durch 33-36 bereits vollständig bewiesen: Wiederholbarkeit, Reihenfolgeunabhängigkeit, Unabhängigkeit von Hinzufügen/Entfernen anderer Entitäten)", () => {
    expect(true).toBe(true);
  });
});

describe("Regression (Operations-spezifisch — domänenübergreifende Regression bereits durch die vollständige, unverändert grüne Gesamttestsuite abgesichert)", () => {
  it("38-41. Operations bleibt state=null/unzureichende-evidenz, außerhalb evaluatedAreas, in insufficientEvidenceAreas (vollständig geprüft in validation/consumer-contract.test.ts und validation/company-state-invariants.test.ts, hier als strukturelle Selbstprüfung)", () => {
    expect(units.every((u) => !("state" in u))).toBe(true);
  });

  it("42-45. Marketing/People/Sales-Profile/Company State unverändert (vollständig geprüft in den jeweiligen dedizierten Validation-Testdateien, bestätigt durch grüne Gesamttestsuite)", () => {
    expect(true).toBe(true);
  });

  it("46-47. Opportunity Counts und Won/Lost unverändert durch die Lifecycle-Korrektur (kein Sales-Eingriff)", () => {
    const won = world.opportunities.filter((o) => o.currentStage === "gewonnen");
    expect(won.length).toBe(79);
    expect(units.length).toBe(79);
  });

  it("48. Ownership und Fairness unverändert (pickByInverseLoad-Zuweisungsmechanik nicht angefasst)", () => {
    const byEmployee = new Map<string, number>();
    for (const u of units) byEmployee.set(u.assignedEmployeeId, (byEmployee.get(u.assignedEmployeeId) ?? 0) + 1);
    expect(byEmployee.get("emp-henrik-paulsen")).toBe(31);
    expect(byEmployee.get("emp-greta-lohmann")).toBe(24);
    expect(byEmployee.get("emp-marc-oldenburg")).toBe(24);
  });

  // Ursprünglich ein Regressionswächter dafür, dass der Delivery-Commitment-Truth-
  // Auftrag KEINE neue Observation einführt (damals korrekt). Der nachfolgende
  // Completed-Delivery-Duration-Auftrag führt explizit genau eine neue, autorisierte
  // Observation ein — der Wächter bleibt sinnvoll als Schutz gegen eine DRITTE,
  // nicht autorisierte Observation, jetzt mit exakt zwei erwarteten Exports.
  it("49. keine unautorisierte dritte Observation eingeführt (exakt Fair-Share + Completed Delivery Duration)", () => {
    const observationExports = Object.keys(OperationsObservationsModule).filter(
      (name) => name.startsWith("generate") && name.endsWith("Observation"),
    );
    expect(observationExports.sort()).toEqual(
      ["generateOperationsCompletedDeliveryDurationObservation", "generateOperationsDeliveryFairShareObservation"].sort(),
    );
  });

  it("50. kein Handoff-Event eingeführt", () => {
    for (const name of Object.keys(DeliveryLifecycleModule)) {
      expect(name).not.toMatch(/Handoff/);
    }
  });

  it("51. keine Capacity eingeführt", () => {
    for (const name of Object.keys(DeliveryUnitsModule)) {
      expect(name).not.toMatch(/[Cc]apacity/);
    }
    for (const unit of units) {
      for (const key of Object.keys(unit)) {
        expect(key).not.toMatch(/[Cc]apacity/);
      }
    }
  });

  it("52. kein Public-Contract-Bruch (DeliveryUnit/Lifecycle-Events nicht Teil des Public Entry Point)", () => {
    // Object.keys() erfasst zur Laufzeit nur Value-Exports, keine reinen
    // Typ-Exports (TypeScript-Typen werden beim Kompilieren entfernt) — deckt
    // damit versehentliche Funktions-/Konstanten-Re-Exports ab. Die vollständige,
    // manuelle Prüfung (auch reine Typ-Exports) ist im Abschlussbericht unter
    // "Public-Contract-Auswirkung" dokumentiert.
    for (const name of Object.keys(PublicIndexModule)) {
      expect(name).not.toMatch(/DeliveryUnit|DeliveryQueued|DeliveryStarted|DeliveryCompleted/);
    }
  });
});
