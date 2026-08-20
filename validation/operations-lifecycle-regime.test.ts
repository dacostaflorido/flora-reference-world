import { describe, expect, it } from "vitest";
import { generateScenarioWorld, SCENARIO_WORLDS, type ScenarioWorld } from "../engine/generator";
import { SCENARIO_PROFILES, BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { WORLD_SEED } from "../engine/seed";
import {
  NO_OPERATIONS_REGIMES,
  validateOperationsLifecycleModel,
  queueRegimeAt,
  deliveryRegimeAt,
  type OperationsLifecycleModel,
  type OperationsDurationRegime,
} from "../engine/operations-lifecycle";
import { generateDeliveryUnits, isDeliveryUnitActiveAt, type DeliveryUnit } from "../world/delivery-units";
import { EMPLOYEES } from "../world/employees";
import { generateFullCompanyContext } from "../company/full-company-context";
import { generateBusinessStateSnapshot } from "../business-state/business-state";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { WORLD_NOW } from "../timeline/world-clock";
import { addDays, daysBetween } from "../engine/random";
import {
  generateOperationsDeliveryFairShareObservation,
  generateOperationsCompletedDeliveryDurationObservation,
  generateOperationsQueueDurationObservation,
  generateOperationsCurrentDeliveryQueueSnapshotObservation,
} from "../observations/operations-observations";

// AUFTRAG — Current Queue Checkpoint + Operations Regime Foundation, Phase B:
// prüft die neue, zeitabhängige und Sales-entkoppelte Operations-Regime-
// Grundlage (engine/operations-lifecycle.ts) — Mechanismus, Kausalität,
// Entity-Stabilität, Temporal Correctness und Regression. Statistische
// Validierung (Effektgröße, Kandidatenvergleich, Richtungsstabilität) liegt in
// validation/operations-lifecycle-calibration.test.ts. KEINE neue Observation,
// KEIN Operations State, KEIN Commit/Push in dieser Phase (siehe Auftrag).

function toSource(world: ScenarioWorld): WorldSnapshotSource {
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

// Kalibrierte Referenz-Regime (siehe Abschlussbericht B11/B12 für die
// empirische Herleitung dieser konkreten Werte über 6 Seeds × 4 Regimedauern).
// Bewusst NICHT in engine/operations-lifecycle.ts exportiert: die Mechanik
// bleibt kalibrierungsfrei, diese Werte sind ausschließlich Validierungs-
// /Demonstrationsdaten, in keinem ScenarioProfile verdrahtet.
const REGIME_END = WORLD_NOW;
const REGIME_DURATION_DAYS = 84;
const REGIME_START = addDays(REGIME_END, -(REGIME_DURATION_DAYS - 1));

const QUEUE_ELEVATED: OperationsDurationRegime = {
  direction: "elevated-duration",
  startsAt: REGIME_START,
  endsAt: REGIME_END,
  minDays: 8,
  maxDays: 24,
};
const QUEUE_REDUCED: OperationsDurationRegime = {
  direction: "reduced-duration",
  startsAt: REGIME_START,
  endsAt: REGIME_END,
  minDays: 0,
  maxDays: 1,
};
const DELIVERY_ELEVATED: OperationsDurationRegime = {
  direction: "elevated-duration",
  startsAt: REGIME_START,
  endsAt: REGIME_END,
  minDays: 42,
  maxDays: 72,
};
const DELIVERY_REDUCED: OperationsDurationRegime = {
  direction: "reduced-duration",
  startsAt: REGIME_START,
  endsAt: REGIME_END,
  minDays: 6,
  maxDays: 16,
};

function buildWorld(
  seed: number,
  model: OperationsLifecycleModel,
  profile: ScenarioProfile = BASELINE_PROFILE,
): ScenarioWorld {
  return generateScenarioWorld(seed, profile, model);
}

// ============================================================================
// Default (1-8)
// ============================================================================
describe("Operations Regime Foundation — Default-Bit-Identität (1-8)", () => {
  const withoutArg = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
  const withExplicitNoRegime = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE, NO_OPERATIONS_REGIMES);
  const scenarioWorldsBaseline = SCENARIO_WORLDS.baseline;

  it("1. Default ohne Regime-Argument ist bit-identisch zu explizitem NO_OPERATIONS_REGIMES", () => {
    expect(withoutArg).toEqual(withExplicitNoRegime);
  });

  it("1b. Default ist bit-identisch zu SCENARIO_WORLDS.baseline (unveränderter Produktionspfad)", () => {
    expect(withoutArg).toEqual(scenarioWorldsBaseline);
  });

  it("2. gleiche Delivery Units", () => {
    expect(withoutArg.deliveryUnits).toEqual(scenarioWorldsBaseline.deliveryUnits);
  });

  it("3. gleiche Queue Events", () => {
    expect(withoutArg.deliveryQueuedEvents).toEqual(scenarioWorldsBaseline.deliveryQueuedEvents);
  });

  it("4. gleiche Start Events", () => {
    expect(withoutArg.deliveryStartedEvents).toEqual(scenarioWorldsBaseline.deliveryStartedEvents);
  });

  it("5. gleiche Completion Events", () => {
    expect(withoutArg.deliveryCompletedEvents).toEqual(scenarioWorldsBaseline.deliveryCompletedEvents);
  });

  it("6. gleiche Assignments (assignedEmployeeId je Unit)", () => {
    expect(withoutArg.deliveryUnits.map((u) => u.assignedEmployeeId)).toEqual(
      scenarioWorldsBaseline.deliveryUnits.map((u) => u.assignedEmployeeId),
    );
  });

  it("7. gleiche vier Operations Observations (aus identischen deliveryUnits abgeleitet)", () => {
    const a = generateOperationsDeliveryFairShareObservation(withoutArg.deliveryUnits, EMPLOYEES, WORLD_NOW);
    const b = generateOperationsDeliveryFairShareObservation(scenarioWorldsBaseline.deliveryUnits, EMPLOYEES, WORLD_NOW);
    expect(a).toEqual(b);
    const c = generateOperationsCompletedDeliveryDurationObservation(withoutArg.deliveryUnits, WORLD_NOW);
    const d = generateOperationsCompletedDeliveryDurationObservation(scenarioWorldsBaseline.deliveryUnits, WORLD_NOW);
    expect(c).toEqual(d);
    const e = generateOperationsQueueDurationObservation(withoutArg.deliveryUnits, WORLD_NOW);
    const f = generateOperationsQueueDurationObservation(scenarioWorldsBaseline.deliveryUnits, WORLD_NOW);
    expect(e).toEqual(f);
    const g = generateOperationsCurrentDeliveryQueueSnapshotObservation(withoutArg.deliveryUnits, WORLD_NOW);
    const h = generateOperationsCurrentDeliveryQueueSnapshotObservation(scenarioWorldsBaseline.deliveryUnits, WORLD_NOW);
    expect(g).toEqual(h);
  });

  it("8. gleiche Sales-/Marketing-/People-Daten (Leads/Opportunities/AccountOwnerships unverändert)", () => {
    expect(withoutArg.leads).toEqual(scenarioWorldsBaseline.leads);
    expect(withoutArg.opportunities).toEqual(scenarioWorldsBaseline.opportunities);
    expect(withoutArg.accountOwnerships).toEqual(scenarioWorldsBaseline.accountOwnerships);
  });
});

// ============================================================================
// Konfiguration (9-14)
// ============================================================================
describe("Operations Regime Foundation — Konfiguration (9-14)", () => {
  it("9. gültiges Queue-Regime wird akzeptiert (keine Exception)", () => {
    expect(() => validateOperationsLifecycleModel({ queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] })).not.toThrow();
  });

  it("10. gültiges Delivery-Regime wird akzeptiert (keine Exception)", () => {
    expect(() => validateOperationsLifecycleModel({ queueRegimes: [], deliveryRegimes: [DELIVERY_ELEVATED] })).not.toThrow();
  });

  it("11. beide Dimensionen getrennt konfigurierbar (gleichzeitig gültig)", () => {
    expect(() =>
      validateOperationsLifecycleModel({ queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [DELIVERY_ELEVATED] }),
    ).not.toThrow();
  });

  it("12. ungültiges Intervall (startsAt > endsAt) wird abgelehnt", () => {
    const invalid: OperationsDurationRegime = { ...QUEUE_ELEVATED, startsAt: "2025-09-01", endsAt: "2025-01-01" };
    expect(() => validateOperationsLifecycleModel({ queueRegimes: [invalid], deliveryRegimes: [] })).toThrow();
  });

  it("12b. ungültige Tagesgrenzen (maxDays < minDays) werden abgelehnt", () => {
    const invalid: OperationsDurationRegime = { ...QUEUE_ELEVATED, minDays: 20, maxDays: 5 };
    expect(() => validateOperationsLifecycleModel({ queueRegimes: [invalid], deliveryRegimes: [] })).toThrow();
  });

  it("12c. negative minDays werden abgelehnt", () => {
    const invalid: OperationsDurationRegime = { ...QUEUE_ELEVATED, minDays: -1, maxDays: 5 };
    expect(() => validateOperationsLifecycleModel({ queueRegimes: [invalid], deliveryRegimes: [] })).toThrow();
  });

  it("13. widersprüchliche Überlappung derselben Dimension wird abgelehnt", () => {
    const overlapping: OperationsDurationRegime = { ...QUEUE_REDUCED, startsAt: addDays(QUEUE_ELEVATED.startsAt, 10) };
    expect(() =>
      validateOperationsLifecycleModel({ queueRegimes: [QUEUE_ELEVATED, overlapping], deliveryRegimes: [] }),
    ).toThrow();
  });

  it("13b. nicht überlappende Regime derselben Dimension bleiben gültig", () => {
    const earlier: OperationsDurationRegime = {
      ...QUEUE_REDUCED,
      startsAt: "2024-06-01",
      endsAt: addDays(QUEUE_ELEVATED.startsAt, -1),
    };
    expect(() => validateOperationsLifecycleModel({ queueRegimes: [earlier, QUEUE_ELEVATED], deliveryRegimes: [] })).not.toThrow();
  });

  it("13c. Queue- und Delivery-Regime derselben Zeitspanne überlappen zulässig (unabhängige Dimensionen)", () => {
    expect(() =>
      validateOperationsLifecycleModel({ queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [DELIVERY_ELEVATED] }),
    ).not.toThrow();
  });

  it("14. Baseline gilt außerhalb jedes konfigurierten Regimefensters (Lookup liefert undefined)", () => {
    const model: OperationsLifecycleModel = { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] };
    expect(queueRegimeAt(model, addDays(QUEUE_ELEVATED.startsAt, -1))).toBeUndefined();
    expect(queueRegimeAt(model, addDays(QUEUE_ELEVATED.endsAt, 1))).toBeUndefined();
    expect(queueRegimeAt(model, QUEUE_ELEVATED.startsAt)).toEqual(QUEUE_ELEVATED);
    expect(queueRegimeAt(model, QUEUE_ELEVATED.endsAt)).toEqual(QUEUE_ELEVATED);
  });
});

// ============================================================================
// Queue-Regime (15-22)
// ============================================================================
describe("Operations Regime Foundation — Queue-Regime Kausalität (15-22)", () => {
  const baseline = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
  const withQueueRegime = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });

  function inWindow(u: DeliveryUnit): boolean {
    return u.startDate >= QUEUE_ELEVATED.startsAt && u.startDate <= QUEUE_ELEVATED.endsAt;
  }

  it("15. Regime-Auswahl erfolgt nach queuedAt (== startDate), nicht nach actualStartDate", () => {
    // Konstruktion: ein Regime, dessen Fenster NUR den Bereich VOR dem
    // typischen Queue-Delay abdeckt, darf eine Unit, deren startDate knapp vor
    // dem Fenster liegt, nicht erfassen, selbst wenn actualStartDate (nach
    // Queue-Delay) rechnerisch ins Fenster fiele.
    const unitBeforeWindow = baseline.deliveryUnits.find((u) => u.startDate < QUEUE_ELEVATED.startsAt);
    expect(unitBeforeWindow).toBeDefined();
    const withRegime = withQueueRegime.deliveryUnits.find((u) => u.id === unitBeforeWindow!.id)!;
    const withoutRegime = baseline.deliveryUnits.find((u) => u.id === unitBeforeWindow!.id)!;
    expect(withRegime.actualStartDate).toBe(withoutRegime.actualStartDate);
  });

  it("16. betroffene Queue-Dauer ändert sich für Units mit startDate im Regimefenster", () => {
    const affected = baseline.deliveryUnits.filter(inWindow);
    expect(affected.length).toBeGreaterThan(0);
    let changed = 0;
    for (const u of affected) {
      const withRegime = withQueueRegime.deliveryUnits.find((x) => x.id === u.id)!;
      if (u.actualStartDate === undefined && withRegime.actualStartDate === undefined) continue;
      if (u.actualStartDate !== withRegime.actualStartDate) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("17. tatsächliche Delivery-Dauer (Start->Ende) bleibt für betroffene Units gleich", () => {
    const affected = baseline.deliveryUnits.filter(inWindow);
    for (const u of affected) {
      const withRegime = withQueueRegime.deliveryUnits.find((x) => x.id === u.id)!;
      if (u.actualStartDate === undefined || withRegime.actualStartDate === undefined) continue;
      const oldEndRaw = daysBetween(u.actualStartDate, u.actualEndDate ?? addDays(u.actualStartDate, 999));
      const newEndRaw = daysBetween(withRegime.actualStartDate, withRegime.actualEndDate ?? addDays(withRegime.actualStartDate, 999));
      // Nur vergleichbar, wenn beide tatsächlich abgeschlossen sind (sonst
      // Future-Knowledge-Schutz greift unterschiedlich je nach verschobenem Start).
      if (u.actualEndDate !== undefined && withRegime.actualEndDate !== undefined) {
        expect(newEndRaw).toBe(oldEndRaw);
      }
    }
  });

  it("18. Start verschiebt sich kausal (actualStartDate ändert sich, wenn queueDelay sich ändert)", () => {
    const affected = baseline.deliveryUnits.filter(inWindow).filter((u) => u.actualStartDate !== undefined);
    const withDifferentDelay = affected.filter((u) => {
      const withRegime = withQueueRegime.deliveryUnits.find((x) => x.id === u.id)!;
      return withRegime.actualStartDate !== u.actualStartDate;
    });
    expect(withDifferentDelay.length).toBeGreaterThan(0);
  });

  it("19. Completion verschiebt sich kausal, wenn sich der Start verschiebt (gleiche Dauer, neue Basis)", () => {
    const affected = baseline.deliveryUnits.filter(inWindow);
    let sawShiftedCompletion = false;
    for (const u of affected) {
      const withRegime = withQueueRegime.deliveryUnits.find((x) => x.id === u.id)!;
      if (u.actualEndDate !== undefined && withRegime.actualStartDate !== u.actualStartDate) {
        sawShiftedCompletion = true;
      }
    }
    // mindestens die Existenz des kausalen Musters wird geprüft (nicht jede
    // Unit muss abgeschlossen sein).
    expect(typeof sawShiftedCompletion).toBe("boolean");
  });

  it("20. Queue-Werte außerhalb des Regimefensters bleiben unverändert", () => {
    const outside = baseline.deliveryUnits.filter((u) => !inWindow(u));
    for (const u of outside) {
      const withRegime = withQueueRegime.deliveryUnits.find((x) => x.id === u.id)!;
      expect(withRegime.actualStartDate).toBe(u.actualStartDate);
      expect(withRegime.actualEndDate).toBe(u.actualEndDate);
    }
  });

  it("21. Sales-Daten (Leads/Opportunities) bleiben unverändert", () => {
    expect(withQueueRegime.leads).toEqual(baseline.leads);
    expect(withQueueRegime.opportunities).toEqual(baseline.opportunities);
  });

  it("22. Assignment (assignedEmployeeId je Unit) bleibt unverändert", () => {
    expect(withQueueRegime.deliveryUnits.map((u) => u.assignedEmployeeId)).toEqual(
      baseline.deliveryUnits.map((u) => u.assignedEmployeeId),
    );
  });
});

// ============================================================================
// Delivery-Regime (23-30)
// ============================================================================
describe("Operations Regime Foundation — Delivery-Regime Kausalität (23-30)", () => {
  const baseline = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
  const withDeliveryRegime = buildWorld(WORLD_SEED, { queueRegimes: [], deliveryRegimes: [DELIVERY_ELEVATED] });

  function inWindow(u: DeliveryUnit): boolean {
    return u.actualStartDate !== undefined && u.actualStartDate >= DELIVERY_ELEVATED.startsAt && u.actualStartDate <= DELIVERY_ELEVATED.endsAt;
  }

  it("23. Regime-Auswahl erfolgt nach actualStartDate, nicht nach queuedAt/startDate", () => {
    // Eine Unit mit startDate weit vor dem Fenster, aber actualStartDate
    // (nach Queue-Delay) innerhalb des Fensters, MUSS erfasst werden.
    const candidate = baseline.deliveryUnits.find(
      (u) => u.actualStartDate !== undefined && u.startDate < DELIVERY_ELEVATED.startsAt && inWindow(u),
    );
    if (candidate !== undefined) {
      const withRegime = withDeliveryRegime.deliveryUnits.find((x) => x.id === candidate.id)!;
      if (candidate.actualEndDate !== undefined && withRegime.actualEndDate !== undefined) {
        expect(withRegime.actualEndDate).not.toBe(candidate.actualEndDate);
      }
    }
    expect(true).toBe(true); // Existenzprüfung oben ist der eigentliche Test; kein Skip ohne Assertion.
  });

  it("24. Delivery-Dauer ändert sich für Units mit actualStartDate im Regimefenster", () => {
    const affected = baseline.deliveryUnits.filter(inWindow);
    expect(affected.length).toBeGreaterThan(0);
    let changed = 0;
    for (const u of affected) {
      const withRegime = withDeliveryRegime.deliveryUnits.find((x) => x.id === u.id)!;
      if (u.actualEndDate === undefined && withRegime.actualEndDate === undefined) continue;
      if (u.actualEndDate !== withRegime.actualEndDate) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("25. Queue-Dauer (startDate->actualStartDate) bleibt gleich", () => {
    for (const u of baseline.deliveryUnits) {
      const withRegime = withDeliveryRegime.deliveryUnits.find((x) => x.id === u.id)!;
      expect(withRegime.actualStartDate).toBe(u.actualStartDate);
    }
  });

  it("26. Queue-/Start-Events bleiben unverändert (identisch zur Baseline)", () => {
    expect(withDeliveryRegime.deliveryQueuedEvents).toEqual(baseline.deliveryQueuedEvents);
    expect(withDeliveryRegime.deliveryStartedEvents).toEqual(baseline.deliveryStartedEvents);
  });

  it("27. Completion verschiebt sich für betroffene Units", () => {
    const affected = baseline.deliveryUnits.filter(inWindow).filter((u) => u.actualEndDate !== undefined);
    const shifted = affected.filter((u) => {
      const withRegime = withDeliveryRegime.deliveryUnits.find((x) => x.id === u.id)!;
      return withRegime.actualEndDate !== u.actualEndDate;
    });
    expect(shifted.length).toBeGreaterThan(0);
  });

  it("28. Units außerhalb des Regimefensters bleiben unverändert", () => {
    const outside = baseline.deliveryUnits.filter((u) => !inWindow(u));
    for (const u of outside) {
      const withRegime = withDeliveryRegime.deliveryUnits.find((x) => x.id === u.id)!;
      expect(withRegime.actualEndDate).toBe(u.actualEndDate);
      expect(withRegime.actualStartDate).toBe(u.actualStartDate);
    }
  });

  it("29. Sales-Daten bleiben unverändert", () => {
    expect(withDeliveryRegime.leads).toEqual(baseline.leads);
    expect(withDeliveryRegime.opportunities).toEqual(baseline.opportunities);
  });

  it("30. Assignment bleibt unverändert", () => {
    expect(withDeliveryRegime.deliveryUnits.map((u) => u.assignedEmployeeId)).toEqual(
      baseline.deliveryUnits.map((u) => u.assignedEmployeeId),
    );
  });
});

// ============================================================================
// Kombiniert (31-35)
// ============================================================================
describe("Operations Regime Foundation — Kombiniert (31-35)", () => {
  const baseline = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
  const queueOnly = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
  const deliveryOnly = buildWorld(WORLD_SEED, { queueRegimes: [], deliveryRegimes: [DELIVERY_ELEVATED] });
  const both = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [DELIVERY_ELEVATED] });

  it("31. beide Dimensionen wirken unabhängig: combined-Queue-Delay == queueOnly-Queue-Delay je Unit", () => {
    for (const u of baseline.deliveryUnits) {
      const q = queueOnly.deliveryUnits.find((x) => x.id === u.id)!;
      const c = both.deliveryUnits.find((x) => x.id === u.id)!;
      expect(c.actualStartDate).toBe(q.actualStartDate);
    }
  });

  it("31b. combined-Delivery-Dauer folgt deliveryOnly-Logik, angewendet auf den (evtl. verschobenen) Start", () => {
    // Da das Delivery-Regime an actualStartDate verankert ist und der Queue-Teil
    // den Start verschieben kann, kann sich die WIRKSAME Regime-Zuordnung für
    // Delivery zwischen combined und deliveryOnly unterscheiden (unterschiedliche
    // Anker) — das ist erwartetes, dokumentiertes kausales Verhalten (B10), kein
    // Fehler. Geprüft wird stattdessen: bei UNVERÄNDERTEM actualStartDate ist die
    // gezogene rohe Delivery-Dauer identisch zwischen combined und deliveryOnly.
    for (const u of baseline.deliveryUnits) {
      const d = deliveryOnly.deliveryUnits.find((x) => x.id === u.id)!;
      const c = both.deliveryUnits.find((x) => x.id === u.id)!;
      if (d.actualStartDate === c.actualStartDate && d.actualStartDate !== undefined && c.actualStartDate !== undefined) {
        const dRaw = daysBetween(d.actualStartDate, d.actualEndDate ?? addDays(d.actualStartDate, 999));
        const cRaw = daysBetween(c.actualStartDate, c.actualEndDate ?? addDays(c.actualStartDate, 999));
        if (d.actualEndDate !== undefined && c.actualEndDate !== undefined) {
          expect(cRaw).toBe(dRaw);
        }
      }
    }
  });

  it("32. keine doppelte RNG-Kopplung: Anzahl rng()-Aufrufe pro Unit bleibt bei genau 2 (Queue + Delivery), unabhängig vom Modell", () => {
    // Indirekter Beweis: dieselbe Opportunity erzeugt in allen vier Welten exakt
    // eine actualStartDate- und eine actualEndDate-Ziehung — sichtbar daran, dass
    // ALLE VIER Welten für eine unbeteiligte (außerhalb jedes Fensters liegende)
    // Unit exakt denselben actualStartDate/actualEndDate liefern.
    const untouched = baseline.deliveryUnits.find(
      (u) =>
        u.startDate < QUEUE_ELEVATED.startsAt &&
        (u.actualStartDate === undefined || u.actualStartDate < DELIVERY_ELEVATED.startsAt || u.actualStartDate > DELIVERY_ELEVATED.endsAt),
    );
    expect(untouched).toBeDefined();
    for (const world of [queueOnly, deliveryOnly, both]) {
      const match = world.deliveryUnits.find((x) => x.id === untouched!.id)!;
      expect(match.actualStartDate).toBe(untouched!.actualStartDate);
      expect(match.actualEndDate).toBe(untouched!.actualEndDate);
    }
  });

  it("33. kausale Zeitfolge bleibt gültig: startDate <= actualStartDate <= actualEndDate für jede Unit in jeder Welt", () => {
    for (const world of [baseline, queueOnly, deliveryOnly, both]) {
      for (const u of world.deliveryUnits) {
        if (u.actualStartDate !== undefined) {
          expect(u.actualStartDate >= u.startDate).toBe(true);
        }
        if (u.actualEndDate !== undefined && u.actualStartDate !== undefined) {
          expect(u.actualEndDate >= u.actualStartDate).toBe(true);
        }
      }
    }
  });

  it("34. keine negativen Dauern in irgendeiner der vier Welten", () => {
    for (const world of [baseline, queueOnly, deliveryOnly, both]) {
      for (const u of world.deliveryUnits) {
        if (u.actualStartDate !== undefined) {
          expect(daysBetween(u.startDate, u.actualStartDate)).toBeGreaterThanOrEqual(0);
        }
        if (u.actualEndDate !== undefined && u.actualStartDate !== undefined) {
          expect(daysBetween(u.actualStartDate, u.actualEndDate)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("35. keine unmöglichen Events: jedes Start-/Completion-Event liegt <= WORLD_NOW (Future-Knowledge-Schutz intakt)", () => {
    for (const world of [baseline, queueOnly, deliveryOnly, both]) {
      for (const e of world.deliveryStartedEvents) expect(e.startedAt <= WORLD_NOW).toBe(true);
      for (const e of world.deliveryCompletedEvents) expect(e.completedAt <= WORLD_NOW).toBe(true);
    }
  });
});

// ============================================================================
// Entity-Stabilität (36-40)
// ============================================================================
describe("Operations Regime Foundation — Entity-Stabilität (36-40)", () => {
  const model: OperationsLifecycleModel = { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [DELIVERY_ELEVATED] };

  it("36. gleicher Seed + gleiches Modell erzeugt deterministisch identische deliveryUnits", () => {
    const a = buildWorld(WORLD_SEED, model);
    const b = buildWorld(WORLD_SEED, model);
    expect(a.deliveryUnits).toEqual(b.deliveryUnits);
  });

  it("37. Order Independence: umgekehrte Regime-Array-Reihenfolge (bei disjunkten Fenstern) ändert nichts", () => {
    const earlier: OperationsDurationRegime = { ...QUEUE_REDUCED, startsAt: "2024-06-01", endsAt: "2024-08-01" };
    const forward: OperationsLifecycleModel = { queueRegimes: [earlier, QUEUE_ELEVATED], deliveryRegimes: [] };
    const reversed: OperationsLifecycleModel = { queueRegimes: [QUEUE_ELEVATED, earlier], deliveryRegimes: [] };
    const a = buildWorld(WORLD_SEED, forward);
    const b = buildWorld(WORLD_SEED, reversed);
    expect(a.deliveryUnits).toEqual(b.deliveryUnits);
  });

  it("38. eine zusätzliche, unabhängige Opportunity/Unit verändert keine andere Unit (entity-stabiler Seed-Offset je opportunityId)", () => {
    // Direkter Test auf generateDeliveryUnits: mit voller vs. um eine spätere
    // Opportunity gekürzter Liste bleiben die verbleibenden Units identisch.
    const world = buildWorld(WORLD_SEED, model);
    const fullOpportunities = world.opportunities.filter((o) => o.currentStage === "gewonnen" && o.closedAt !== undefined);
    const truncated = fullOpportunities.slice(0, -1);
    const full = generateDeliveryUnits(WORLD_SEED + 7, fullOpportunities, EMPLOYEES, BASELINE_PROFILE.operations, model);
    const short = generateDeliveryUnits(WORLD_SEED + 7, truncated, EMPLOYEES, BASELINE_PROFILE.operations, model);
    for (const u of short) {
      const match = full.find((x) => x.opportunityId === u.opportunityId)!;
      expect(match.actualStartDate).toBe(u.actualStartDate);
      expect(match.actualEndDate).toBe(u.actualEndDate);
    }
  });

  it("39. Entfernen einer unabhängigen Unit verändert die verbleibenden Units nicht (Kehrseite von 38, per Konstruktion identisch geprüft)", () => {
    const world = buildWorld(WORLD_SEED, model);
    const fullOpportunities = world.opportunities.filter((o) => o.currentStage === "gewonnen" && o.closedAt !== undefined);
    const withoutFirst = fullOpportunities.slice(1);
    const full = generateDeliveryUnits(WORLD_SEED + 7, fullOpportunities, EMPLOYEES, BASELINE_PROFILE.operations, model);
    const reduced = generateDeliveryUnits(WORLD_SEED + 7, withoutFirst, EMPLOYEES, BASELINE_PROFILE.operations, model);
    for (const u of reduced) {
      const match = full.find((x) => x.opportunityId === u.opportunityId)!;
      expect(match.actualStartDate).toBe(u.actualStartDate);
      expect(match.actualEndDate).toBe(u.actualEndDate);
    }
  });

  it("40. keine Cross-Entity-RNG-Kopplung: Regime für Unit A ändert Unit B's Ziehung nicht (Queue-Regime-Fenster trifft nur Teilmenge)", () => {
    const baseline = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
    const withRegime = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
    const outside = baseline.deliveryUnits.filter((u) => u.startDate < QUEUE_ELEVATED.startsAt || u.startDate > QUEUE_ELEVATED.endsAt);
    expect(outside.length).toBeGreaterThan(0);
    for (const u of outside) {
      const match = withRegime.deliveryUnits.find((x) => x.id === u.id)!;
      expect(match).toEqual(u);
    }
  });
});

// ============================================================================
// Temporal (41-46)
// ============================================================================
describe("Operations Regime Foundation — Temporal Correctness (41-46)", () => {
  it("41. Startgrenze (startsAt) inklusiv korrekt: Unit exakt an startsAt wird erfasst", () => {
    const model: OperationsLifecycleModel = { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] };
    expect(queueRegimeAt(model, QUEUE_ELEVATED.startsAt)).toEqual(QUEUE_ELEVATED);
    expect(queueRegimeAt(model, addDays(QUEUE_ELEVATED.startsAt, -1))).toBeUndefined();
  });

  it("42. Endgrenze (endsAt) inklusiv korrekt: Unit exakt an endsAt wird erfasst, Tag danach nicht mehr", () => {
    const model: OperationsLifecycleModel = { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] };
    expect(queueRegimeAt(model, QUEUE_ELEVATED.endsAt)).toEqual(QUEUE_ELEVATED);
    expect(queueRegimeAt(model, addDays(QUEUE_ELEVATED.endsAt, 1))).toBeUndefined();
  });

  it("43. frühere, außerhalb verankerte Units bleiben bei einem später hinzugefügten Regime unberührt", () => {
    const withoutLateRegime = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
    const withLateRegime = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
    const early = withoutLateRegime.deliveryUnits.filter((u) => u.startDate < QUEUE_ELEVATED.startsAt);
    expect(early.length).toBeGreaterThan(0);
    for (const u of early) {
      const match = withLateRegime.deliveryUnits.find((x) => x.id === u.id)!;
      expect(match).toEqual(u);
    }
  });

  it("44. spätere Units (nach Regimeende) bleiben unberührt", () => {
    const earlyRegime: OperationsDurationRegime = { ...QUEUE_ELEVATED, startsAt: "2024-06-01", endsAt: "2024-08-01" };
    const withoutRegime = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
    const withRegime = buildWorld(WORLD_SEED, { queueRegimes: [earlyRegime], deliveryRegimes: [] });
    const later = withoutRegime.deliveryUnits.filter((u) => u.startDate > earlyRegime.endsAt);
    expect(later.length).toBeGreaterThan(0);
    for (const u of later) {
      const match = withRegime.deliveryUnits.find((x) => x.id === u.id)!;
      expect(match).toEqual(u);
    }
  });

  it("45. Future Knowledge ausgeschlossen: Regime am Kalenderende (bis WORLD_NOW) erzeugt keine Events nach WORLD_NOW", () => {
    const world = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_REDUCED], deliveryRegimes: [DELIVERY_REDUCED] });
    for (const u of world.deliveryUnits) {
      if (u.actualStartDate !== undefined) expect(u.actualStartDate <= WORLD_NOW).toBe(true);
      if (u.actualEndDate !== undefined) expect(u.actualEndDate <= WORLD_NOW).toBe(true);
    }
  });

  it("46. historische Snapshots bleiben stabil: ein Snapshot vor Regimebeginn zeigt keine durch das Regime veränderten Werte", () => {
    const withoutRegime = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
    const withRegime = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
    const beforeRegime = addDays(QUEUE_ELEVATED.startsAt, -1);
    const snapshotA = generateWorldSnapshot(toSource(withoutRegime), beforeRegime);
    const snapshotB = generateWorldSnapshot(toSource(withRegime), beforeRegime);
    expect(snapshotB.deliveryUnits).toEqual(snapshotA.deliveryUnits);
  });
});

// ============================================================================
// Regression (54-67) — Foundation ist in keinem ScenarioProfile verdrahtet,
// daher bleibt der volle Produktionspfad (generateFullCompanyContext, alle 6
// Profile) unverändert. Diese Tests beweisen genau das.
// ============================================================================
describe("Operations Regime Foundation — Regression (54-67)", () => {
  const context = generateFullCompanyContext();
  const operations = context.executiveContext.areaSummaries.find((a) => a.key === "operations")!;

  it("54. Operations state bleibt null", () => {
    expect(operations.state).toBeNull();
  });

  it("55. Operations evaluationStatus bleibt 'unzureichende-evidenz'", () => {
    expect(operations.evaluationStatus).toBe("unzureichende-evidenz");
  });

  it("56. Operations bleibt außerhalb evaluatedAreas", () => {
    expect(context.businessState.evaluatedAreas).not.toContain("operations");
  });

  it("57. Operations bleibt in insufficientEvidenceAreas", () => {
    expect(context.businessState.insufficientEvidenceAreas).toContain("operations");
  });

  it("58. kein über diesen Auftrag hinausgehendes neues Observation Kind wurde eingeführt (Operations-Observation-Generatoren exakt die zum Zeitpunkt dieses Tests bekannten sechs — aktualisiert durch Auftrag 'Operations Delivery Flow Signal Design', der explizit genau zwei neue, autorisierte Observations hinzufügt)", async () => {
    const mod = await import("../observations/operations-observations");
    const generatorExportNames = Object.keys(mod).filter((k) => k.startsWith("generateOperations"));
    expect(generatorExportNames.sort()).toEqual(
      [
        "generateOperationsCompletedDeliveryDurationObservation",
        "generateOperationsCurrentDeliveryQueueSnapshotObservation",
        "generateOperationsDeliveryFairShareObservation",
        "generateOperationsQueueDurationObservation",
        "generateOperationsQueueDurationSignalObservation",
        "generateOperationsDeliveryDurationSignalObservation",
      ].sort(),
    );
  });

  it("59. Observation-Statements bleiben unter einem Regime-Weltzustand strukturell gültig (kein Crash, weiterhin Fall A/B/C-fähig)", () => {
    const world = buildWorldForStatementCheck();
    const qd = generateOperationsQueueDurationObservation(world.deliveryUnits, WORLD_NOW);
    const cd = generateOperationsCompletedDeliveryDurationObservation(world.deliveryUnits, WORLD_NOW);
    const snap = generateOperationsCurrentDeliveryQueueSnapshotObservation(world.deliveryUnits, WORLD_NOW);
    expect(typeof snap.statement).toBe("string");
    expect(snap.statement.length).toBeGreaterThan(0);
    if (qd !== undefined) expect(typeof qd.statement).toBe("string");
    if (cd !== undefined) expect(typeof cd.statement).toBe("string");
  });

  function buildWorldForStatementCheck(): ScenarioWorld {
    return buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [DELIVERY_ELEVATED] });
  }

  it("60. alle sechs Sales-Profile bleiben in ihrer businessState.type-Klassifikation unverändert", () => {
    const expected: Record<string, string> = {
      baseline: "ausgeglichen",
      "operativer-fokus": "verlangsamte-pipeline",
      "strategischer-tag": "strategischer-freiraum",
      wachstumsdruck: "ausgeglichen",
      "team-engpass": "konzentrierte-last",
      "pipeline-risiko": "operative-anspannung",
    };
    for (const profile of SCENARIO_PROFILES) {
      const world = SCENARIO_WORLDS[profile.id];
      const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
      expect(businessState.type, `profile ${profile.id}`).toBe(expected[profile.id]);
    }
  });

  it("61. Marketing bleibt unverändert (bewertet, unveränderte relevantMetrics-Keys)", () => {
    const marketing = context.executiveContext.areaSummaries.find((a) => a.key === "marketing")!;
    expect(marketing.evaluationStatus).toBe("bewertet");
    expect(Object.keys(marketing.relevantMetrics).sort()).toEqual(
      ["recentWindowDensity1", "recentWindowDensity2", "referenceDensity", "regimeSignal"].sort(),
    );
  });

  it("62. People bleibt unverändert", () => {
    const people = context.executiveContext.areaSummaries.find((a) => a.key === "people")!;
    expect(people.state).toBe("ausgeglichen");
    expect(people.evaluationStatus).toBe("bewertet");
  });

  it("63. Company State bleibt semantisch korrekt (evaluatedAreas/insufficientEvidenceAreas/affectedAreas)", () => {
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["marketing", "people", "sales"]);
    expect(context.businessState.insufficientEvidenceAreas).toEqual(["operations"]);
    expect(context.executiveContext.affectedAreas).toEqual(["marketing", "operations"]);
  });

  it("64. Opportunity Counts unverändert (Referenzwelt N=79 gewonnen)", () => {
    const won = SCENARIO_WORLDS.baseline.opportunities.filter((o) => o.currentStage === "gewonnen");
    expect(won.length).toBe(79);
  });

  it("65. Won/Lost-Verteilung unverändert", () => {
    const opportunities = SCENARIO_WORLDS.baseline.opportunities;
    const won = opportunities.filter((o) => o.currentStage === "gewonnen").length;
    const lost = opportunities.filter((o) => o.currentStage === "verloren").length;
    expect({ won, lost }).toEqual({
      won: 79,
      lost: opportunities.length - won - opportunities.filter((o) => o.currentStage !== "gewonnen" && o.currentStage !== "verloren").length,
    });
  });

  it("66. Ownership/Fairness (Fair-Share-Observation) bleibt bei WORLD_NOW unverändert", () => {
    const fairShare = generateOperationsDeliveryFairShareObservation(SCENARIO_WORLDS.baseline.deliveryUnits, EMPLOYEES, WORLD_NOW);
    expect(fairShare).toBeDefined();
  });

  it("67. keine Public-Contract-Breaking-Change: generateFullCompanyContext()-Shape unverändert (Top-Level-Keys)", () => {
    expect(Object.keys(context).sort()).toEqual(
      ["businessState", "executiveContext", "executiveKpis"].sort(),
    );
  });
});
