import { describe, expect, it } from "vitest";
import {
  generateOperationsPeriodMetrics,
  type OperationsPeriodMetricsSnapshot,
} from "../company/operations-period-metrics";
import { isDeliveryUnitActiveAt, type DeliveryUnit } from "../world/delivery-units";
import { generateScenarioWorld } from "../engine/generator";
import { WORLD_SEED } from "../engine/seed";
import { BASELINE_PROFILE } from "../engine/scenario-profiles";
import { WORLD_NOW } from "../timeline/world-clock";

// Operations Period Metrics V1 (Auftrag "Operations Workspace Data Contract +
// Entrepreneur View V1", D052) — Pflichttests laut Auftrag Phase D1-D6.
// Verbindliche fachliche Grenze, überall geprüft: kein SLA, keine
// Termintreue, keine Früh-/Pünktlich-/Spät-Klassifikation, keine
// Planabweichung, keine 30-Tage-Zusage — diese Begriffe dürfen an keiner
// Stelle in dieser Datei oder im geprüften Code vorkommen.

function unit(overrides: Partial<DeliveryUnit> & { id: string }): DeliveryUnit {
  return {
    opportunityId: `opp-${overrides.id}`,
    accountId: `acc-${overrides.id}`,
    assignedEmployeeId: "emp-1",
    startDate: "2025-01-01",
    status: "eingereiht",
    ...overrides,
  };
}

describe("Operations Period Metrics — D1 Periodengrenzen", () => {
  it("1. Yesterday ist genau der Kalendertag vor asOf", () => {
    const snap = generateOperationsPeriodMetrics("2025-03-15", []);
    expect(snap.yesterday.bounds).toEqual({ from: "2025-03-14", through: "2025-03-14" });
  });

  it("2. Week-to-Date beginnt am Montag der laufenden Woche", () => {
    // 2025-03-15 ist ein Samstag -> Montag dieser Woche ist 2025-03-10
    const snap = generateOperationsPeriodMetrics("2025-03-15", []);
    expect(snap.weekToDate.bounds).toEqual({ from: "2025-03-10", through: "2025-03-15" });
  });

  it("3. Month-to-Date beginnt am ersten Kalendertag des Monats", () => {
    const snap = generateOperationsPeriodMetrics("2025-03-15", []);
    expect(snap.monthToDate.bounds).toEqual({ from: "2025-03-01", through: "2025-03-15" });
  });

  it("4. Monatswechsel: asOf am 1. eines Monats liefert MTD = genau dieser eine Tag", () => {
    const snap = generateOperationsPeriodMetrics("2025-04-01", []);
    expect(snap.monthToDate.bounds).toEqual({ from: "2025-04-01", through: "2025-04-01" });
    expect(snap.yesterday.bounds).toEqual({ from: "2025-03-31", through: "2025-03-31" });
  });

  it("5. Jahreswechsel: Yesterday über den Jahreswechsel hinweg korrekt", () => {
    const snap = generateOperationsPeriodMetrics("2025-01-01", []);
    expect(snap.yesterday.bounds).toEqual({ from: "2024-12-31", through: "2024-12-31" });
  });

  it("6. Leap-Year: 29. Februar 2024 korrekt als Yesterday für 1. März 2024", () => {
    const snap = generateOperationsPeriodMetrics("2024-03-01", []);
    expect(snap.yesterday.bounds).toEqual({ from: "2024-02-29", through: "2024-02-29" });
  });

  it("7. Date-only: bounds enthalten keine Uhrzeit-/Zeitzonenkomponente", () => {
    const snap = generateOperationsPeriodMetrics("2025-03-15", []);
    for (const period of [snap.yesterday, snap.weekToDate, snap.monthToDate]) {
      expect(period.bounds.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(period.bounds.through).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("Operations Period Metrics — D2 Aktivität", () => {
  it("8. Commitment innerhalb der Periode wird gezählt", () => {
    const units = [unit({ id: "1", startDate: "2025-03-14" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.activity.deliveryCommitmentsCreated).toBe(1);
    expect(snap.yesterday.activity.deliveryCommitmentsCreatedDeliveryUnitIds).toEqual(["1"]);
  });

  it("9. Commitment außerhalb der Periode wird nicht gezählt", () => {
    const units = [unit({ id: "1", startDate: "2025-03-13" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.activity.deliveryCommitmentsCreated).toBe(0);
  });

  it("10. Start innerhalb der Periode wird gezählt", () => {
    const units = [unit({ id: "1", startDate: "2025-03-01", actualStartDate: "2025-03-14" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.activity.deliveriesStarted).toBe(1);
    expect(snap.yesterday.activity.deliveriesStartedDeliveryUnitIds).toEqual(["1"]);
  });

  it("11. Start außerhalb der Periode wird nicht gezählt", () => {
    const units = [unit({ id: "1", startDate: "2025-03-01", actualStartDate: "2025-03-10" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.activity.deliveriesStarted).toBe(0);
  });

  it("12. Abschluss innerhalb der Periode wird gezählt", () => {
    const units = [
      unit({ id: "1", startDate: "2025-02-01", actualStartDate: "2025-02-10", actualEndDate: "2025-03-14" }),
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.activity.deliveriesCompleted).toBe(1);
    expect(snap.yesterday.activity.deliveriesCompletedDeliveryUnitIds).toEqual(["1"]);
  });

  it("13. Abschluss außerhalb der Periode wird nicht gezählt", () => {
    const units = [
      unit({ id: "1", startDate: "2025-02-01", actualStartDate: "2025-02-10", actualEndDate: "2025-03-01" }),
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.activity.deliveriesCompleted).toBe(0);
  });

  it("14. Jede DeliveryUnit im Input ist strukturell aus einer gewonnenen Opportunity abgeleitet (Won = Commitment)", () => {
    // Diese Regel wird bereits an der Quelle erzwungen (generateDeliveryUnits,
    // world/delivery-units.ts) und in validation/operations-invariants.test.ts
    // ("deliveryUnits.length === won.length") geprüft. Hier wird zusätzlich
    // geprüft, dass Operations Period Metrics keine eigene Commitment-Quelle
    // einführt, sondern ausschließlich startDate liest.
    const units = [unit({ id: "1", startDate: "2025-03-14", opportunityId: "opp-won-1" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.activity.deliveryCommitmentsCreated).toBe(1);
  });

  it("15. Repeat-Wins bleiben einzelne, eigenständige Lieferverpflichtungen (kein Zusammenfassen nach Account)", () => {
    const units = [
      unit({ id: "1", startDate: "2025-03-14", accountId: "acc-shared" }),
      unit({ id: "2", startDate: "2025-03-14", accountId: "acc-shared" }),
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.activity.deliveryCommitmentsCreated).toBe(2);
    expect(snap.yesterday.activity.deliveryCommitmentsCreatedDeliveryUnitIds).toEqual(["1", "2"]);
  });

  it("16. Count entspricht immer exakt der Evidenzlänge (alle drei Aktivitätskennzahlen)", () => {
    const units = [
      unit({ id: "1", startDate: "2025-03-14" }),
      unit({ id: "2", startDate: "2025-03-01", actualStartDate: "2025-03-14" }),
      unit({ id: "3", startDate: "2025-02-01", actualStartDate: "2025-02-10", actualEndDate: "2025-03-14" }),
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    const { activity } = snap.yesterday;
    expect(activity.deliveryCommitmentsCreated).toBe(activity.deliveryCommitmentsCreatedDeliveryUnitIds.length);
    expect(activity.deliveriesStarted).toBe(activity.deliveriesStartedDeliveryUnitIds.length);
    expect(activity.deliveriesCompleted).toBe(activity.deliveriesCompletedDeliveryUnitIds.length);
  });
});

describe("Operations Period Metrics — D3 Dauer", () => {
  it("17. Queue Duration korrekt berechnet (daysBetween startDate/actualStartDate)", () => {
    const units = [unit({ id: "1", startDate: "2025-03-10", actualStartDate: "2025-03-14" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.durationFacts.queueDurationDaysMedianForStartedDeliveries.medianDays).toBe(4);
  });

  it("18. Delivery Duration korrekt berechnet (daysBetween actualStartDate/actualEndDate)", () => {
    const units = [
      unit({ id: "1", startDate: "2025-02-01", actualStartDate: "2025-02-10", actualEndDate: "2025-03-14" }),
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.durationFacts.deliveryDurationDaysMedianForCompletedDeliveries.medianDays).toBe(32);
  });

  it("19. N=0 liefert medianDays=undefined, kein erfundener Nullwert", () => {
    const snap = generateOperationsPeriodMetrics("2025-03-15", []);
    const queue = snap.yesterday.durationFacts.queueDurationDaysMedianForStartedDeliveries;
    const delivery = snap.yesterday.durationFacts.deliveryDurationDaysMedianForCompletedDeliveries;
    expect(queue.medianDays).toBeUndefined();
    expect(queue.population).toBe(0);
    expect(delivery.medianDays).toBeUndefined();
    expect(delivery.population).toBe(0);
  });

  it("20. N=1: Median entspricht dem einzigen Wert", () => {
    const units = [unit({ id: "1", startDate: "2025-03-10", actualStartDate: "2025-03-14" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    const queue = snap.yesterday.durationFacts.queueDurationDaysMedianForStartedDeliveries;
    expect(queue.population).toBe(1);
    expect(queue.medianDays).toBe(4);
    expect(queue.minDays).toBe(4);
    expect(queue.maxDays).toBe(4);
  });

  it("21. gerade Population: Median ist Mittelwert der beiden mittleren Werte", () => {
    const units = [
      unit({ id: "1", startDate: "2025-03-04", actualStartDate: "2025-03-14" }), // 10 Tage
      unit({ id: "2", startDate: "2025-03-10", actualStartDate: "2025-03-14" }), // 4 Tage
      unit({ id: "3", startDate: "2025-03-08", actualStartDate: "2025-03-14" }), // 6 Tage
      unit({ id: "4", startDate: "2025-03-06", actualStartDate: "2025-03-14" }), // 8 Tage
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    const queue = snap.yesterday.durationFacts.queueDurationDaysMedianForStartedDeliveries;
    expect(queue.population).toBe(4);
    // sortiert: 4,6,8,10 -> Median (6+8)/2 = 7
    expect(queue.medianDays).toBe(7);
  });

  it("22. ungerade Population: Median ist der mittlere sortierte Wert", () => {
    const units = [
      unit({ id: "1", startDate: "2025-03-04", actualStartDate: "2025-03-14" }), // 10
      unit({ id: "2", startDate: "2025-03-10", actualStartDate: "2025-03-14" }), // 4
      unit({ id: "3", startDate: "2025-03-08", actualStartDate: "2025-03-14" }), // 6
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    const queue = snap.yesterday.durationFacts.queueDurationDaysMedianForStartedDeliveries;
    // sortiert: 4,6,10 -> Median 6
    expect(queue.medianDays).toBe(6);
  });

  it("23. noch nicht gestartete Units gehören nicht in die Queue-Duration-Population", () => {
    const units = [
      unit({ id: "1", startDate: "2025-03-10", actualStartDate: "2025-03-14" }),
      unit({ id: "2", startDate: "2025-03-10" }), // kein actualStartDate
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.durationFacts.queueDurationDaysMedianForStartedDeliveries.population).toBe(1);
    expect(snap.yesterday.durationFacts.queueDurationDaysMedianForStartedDeliveries.deliveryUnitIds).toEqual(["1"]);
  });

  it("24. laufende (nicht abgeschlossene) Units gehören nicht in die Delivery-Duration-Population", () => {
    const units = [
      unit({ id: "1", startDate: "2025-02-01", actualStartDate: "2025-02-10", actualEndDate: "2025-03-14" }),
      unit({ id: "2", startDate: "2025-02-01", actualStartDate: "2025-02-10" }), // kein actualEndDate
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.durationFacts.deliveryDurationDaysMedianForCompletedDeliveries.population).toBe(1);
    expect(snap.yesterday.durationFacts.deliveryDurationDaysMedianForCompletedDeliveries.deliveryUnitIds).toEqual([
      "1",
    ]);
  });

  it("25. keine Früh-/Pünktlich-/Spät-Klassifikation und kein SLA in den erzeugten Werten oder Feldnamen", () => {
    const units = [
      unit({ id: "1", startDate: "2025-02-01", actualStartDate: "2025-02-10", actualEndDate: "2025-03-14" }),
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    const serialized = JSON.stringify(snap);
    for (const forbidden of [/sla/i, /pünktlich/i, /verspätet/i, /planabweichung/i, /30.?tage/i]) {
      expect(forbidden.test(serialized)).toBe(false);
    }
  });
});

describe("Operations Period Metrics — D4 Bestand", () => {
  it("26. eingereihte Unit (noch nicht gestartet) zählt zu queuedDeliveriesAtPeriodEnd", () => {
    const units = [unit({ id: "1", startDate: "2025-03-10" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.stockAtPeriodEnd.queuedDeliveriesAtPeriodEnd).toBe(1);
    expect(snap.yesterday.stockAtPeriodEnd.queuedDeliveriesAtPeriodEndDeliveryUnitIds).toEqual(["1"]);
  });

  it("27. laufende Unit (gestartet, nicht abgeschlossen) zählt zu activeDeliveriesAtPeriodEnd", () => {
    const units = [unit({ id: "1", startDate: "2025-03-01", actualStartDate: "2025-03-05" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.stockAtPeriodEnd.activeDeliveriesAtPeriodEnd).toBe(1);
    expect(snap.yesterday.stockAtPeriodEnd.activeDeliveriesAtPeriodEndDeliveryUnitIds).toEqual(["1"]);
    expect(isDeliveryUnitActiveAt(units[0]!, "2025-03-14")).toBe(true);
  });

  it("28. abgeschlossene Unit ist NICHT mehr active am Periodenende", () => {
    const units = [
      unit({ id: "1", startDate: "2025-03-01", actualStartDate: "2025-03-05", actualEndDate: "2025-03-10" }),
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.stockAtPeriodEnd.activeDeliveriesAtPeriodEnd).toBe(0);
    expect(snap.yesterday.stockAtPeriodEnd.queuedDeliveriesAtPeriodEnd).toBe(0);
  });

  it("29. ein Start NACH dem Periodenende lässt die Unit zu diesem historischen Stichtag weiterhin als queued gelten (future start)", () => {
    const units = [unit({ id: "1", startDate: "2025-03-10", actualStartDate: "2025-03-20" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.stockAtPeriodEnd.queuedDeliveriesAtPeriodEnd).toBe(1);
    expect(snap.yesterday.stockAtPeriodEnd.activeDeliveriesAtPeriodEnd).toBe(0);
  });

  it("30. ein Abschluss NACH dem Periodenende lässt die Unit zu diesem historischen Stichtag weiterhin als active gelten (future completion)", () => {
    const units = [
      unit({ id: "1", startDate: "2025-03-01", actualStartDate: "2025-03-05", actualEndDate: "2025-03-20" }),
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.stockAtPeriodEnd.activeDeliveriesAtPeriodEnd).toBe(1);
  });

  it("31. historische Stabilität: ein später gestarteter Unit verändert einen früher berechneten Bestand nicht rückwirkend", () => {
    const unitsBefore = [unit({ id: "1", startDate: "2025-03-10" })];
    const unitsAfter = [unit({ id: "1", startDate: "2025-03-10", actualStartDate: "2025-03-20" })];
    const snapBefore = generateOperationsPeriodMetrics("2025-03-15", unitsBefore);
    const snapAfter = generateOperationsPeriodMetrics("2025-03-15", unitsAfter);
    expect(snapBefore.yesterday.stockAtPeriodEnd).toEqual(snapAfter.yesterday.stockAtPeriodEnd);
  });

  it("32. historische Stabilität: ein später abgeschlossener Unit verändert einen früher berechneten aktiven Bestand nicht rückwirkend", () => {
    const unitsBefore = [
      unit({ id: "1", startDate: "2025-03-01", actualStartDate: "2025-03-05" }),
    ];
    const unitsAfter = [
      unit({ id: "1", startDate: "2025-03-01", actualStartDate: "2025-03-05", actualEndDate: "2025-03-25" }),
    ];
    const snapBefore = generateOperationsPeriodMetrics("2025-03-15", unitsBefore);
    const snapAfter = generateOperationsPeriodMetrics("2025-03-15", unitsAfter);
    expect(snapBefore.yesterday.stockAtPeriodEnd).toEqual(snapAfter.yesterday.stockAtPeriodEnd);
  });

  it("33. Count entspricht immer exakt der Evidenzlänge (Bestand)", () => {
    const units = [
      unit({ id: "1", startDate: "2025-03-10" }),
      unit({ id: "2", startDate: "2025-03-01", actualStartDate: "2025-03-05" }),
    ];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    const { stockAtPeriodEnd } = snap.yesterday;
    expect(stockAtPeriodEnd.queuedDeliveriesAtPeriodEnd).toBe(stockAtPeriodEnd.queuedDeliveriesAtPeriodEndDeliveryUnitIds.length);
    expect(stockAtPeriodEnd.activeDeliveriesAtPeriodEnd).toBe(stockAtPeriodEnd.activeDeliveriesAtPeriodEndDeliveryUnitIds.length);
  });

  it("34. Bestand wird zu bounds.through ausgewertet, nicht zu asOf (Gestern-Periode unterscheidet sich vom aktuellen Stichtag)", () => {
    // Unit startet tatsächlich am 15.03. (asOf) -> zu "Gestern" (bounds.through
    // = 14.03.) ist sie noch NICHT gestartet, zählt also dort als queued, nicht
    // als active.
    const units = [unit({ id: "1", startDate: "2025-03-01", actualStartDate: "2025-03-15" })];
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.stockAtPeriodEnd.queuedDeliveriesAtPeriodEnd).toBe(1);
    expect(snap.yesterday.stockAtPeriodEnd.activeDeliveriesAtPeriodEnd).toBe(0);
  });
});

describe("Operations Period Metrics — D9 As-of-Schutz (Future Leakage)", () => {
  it("35. asOf wird exakt verwendet — WORLD_NOW ersetzt nicht das übergebene asOf", () => {
    const units = [unit({ id: "1", startDate: "2025-01-01" })];
    const snap = generateOperationsPeriodMetrics("2025-06-01", units);
    expect(snap.asOf).toBe("2025-06-01");
    expect(snap.asOf).not.toBe(WORLD_NOW);
  });

  it("36. Perioden verwenden exakt bounds.through als Obergrenze (kein Wert nach through wird einbezogen)", () => {
    const units = [unit({ id: "1", startDate: "2025-03-16" })]; // ein Tag nach 'Gestern'
    const snap = generateOperationsPeriodMetrics("2025-03-15", units);
    expect(snap.yesterday.activity.deliveryCommitmentsCreated).toBe(0);
  });
});

describe("Operations Period Metrics — Referenzwelt (WORLD_NOW, empirisch gemessen)", () => {
  const world = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
  let snap: OperationsPeriodMetricsSnapshot;

  it("37. Referenzwelt lädt ohne Fehler und liefert 79 DeliveryUnits", () => {
    expect(world.deliveryUnits.length).toBe(79);
    snap = generateOperationsPeriodMetrics(WORLD_NOW, world.deliveryUnits);
    expect(snap.asOf).toBe(WORLD_NOW);
  });

  it("38. deterministisch: zwei Aufrufe mit denselben Parametern liefern identische Ergebnisse", () => {
    const first = generateOperationsPeriodMetrics(WORLD_NOW, world.deliveryUnits);
    const second = generateOperationsPeriodMetrics(WORLD_NOW, world.deliveryUnits);
    expect(first).toEqual(second);
  });

  it("39. jede Aktivitäts- und Bestandszahl entspricht exakt ihrer Evidenzlänge (alle drei Perioden)", () => {
    for (const period of [snap.yesterday, snap.weekToDate, snap.monthToDate]) {
      expect(period.activity.deliveryCommitmentsCreated).toBe(period.activity.deliveryCommitmentsCreatedDeliveryUnitIds.length);
      expect(period.activity.deliveriesStarted).toBe(period.activity.deliveriesStartedDeliveryUnitIds.length);
      expect(period.activity.deliveriesCompleted).toBe(period.activity.deliveriesCompletedDeliveryUnitIds.length);
      expect(period.stockAtPeriodEnd.queuedDeliveriesAtPeriodEnd).toBe(period.stockAtPeriodEnd.queuedDeliveriesAtPeriodEndDeliveryUnitIds.length);
      expect(period.stockAtPeriodEnd.activeDeliveriesAtPeriodEnd).toBe(period.stockAtPeriodEnd.activeDeliveriesAtPeriodEndDeliveryUnitIds.length);
    }
  });
});
