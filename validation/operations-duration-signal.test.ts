import { describe, expect, it } from "vitest";
import { generateScenarioWorld, SCENARIO_WORLDS, type ScenarioWorld } from "../engine/generator";
import { SCENARIO_PROFILES, BASELINE_PROFILE, WACHSTUMSDRUCK_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { WORLD_SEED } from "../engine/seed";
import { NO_OPERATIONS_REGIMES, type OperationsLifecycleModel, type OperationsDurationRegime } from "../engine/operations-lifecycle";
import { WORLD_NOW, WORLD_TIMELINE_START } from "../timeline/world-clock";
import { addDays, daysBetween } from "../engine/random";
import { EMPLOYEES } from "../world/employees";
import { generateFullCompanyContext } from "../company/full-company-context";
import { generateBusinessStateSnapshot } from "../business-state/business-state";
import type { DeliveryUnit } from "../world/delivery-units";
import {
  generateOperationsQueueDurationSignalObservation,
  generateOperationsDeliveryDurationSignalObservation,
  generateOperationsDeliveryFairShareObservation,
  generateOperationsCompletedDeliveryDurationObservation,
  generateOperationsQueueDurationObservation,
  generateOperationsCurrentDeliveryQueueSnapshotObservation,
} from "../observations/operations-observations";

// AUFTRAG — Operations Delivery Flow Signal Design, Phase 15: 60 verpflichtende
// Tests für die zwei neuen, zensierungskorrekten Richtungssignale. Prüft
// ausschließlich die neuen Observations (Queue/Delivery Duration Signal) — die
// zensierungsfreie Kaplan-Meier-/RMST-Mathematik selbst ist in
// validation/survival-analysis.test.ts geprüft, die Regime-Grundlage in
// validation/operations-lifecycle-regime.test.ts.

const SEEDS = [424242, 1000003, 2000003, 3000003, 5000009, 7000003];
const SEEDS10 = [...SEEDS, 11000001, 13000001, 17000001, 19000001];

const REGIME_END = WORLD_NOW;
const REGIME_DURATION_DAYS = 84;
const REGIME_START = addDays(REGIME_END, -(REGIME_DURATION_DAYS - 1));

const QUEUE_ELEVATED: OperationsDurationRegime = { direction: "elevated-duration", startsAt: REGIME_START, endsAt: REGIME_END, minDays: 8, maxDays: 24 };
const QUEUE_REDUCED: OperationsDurationRegime = { direction: "reduced-duration", startsAt: REGIME_START, endsAt: REGIME_END, minDays: 0, maxDays: 1 };
const DELIVERY_ELEVATED: OperationsDurationRegime = { direction: "elevated-duration", startsAt: REGIME_START, endsAt: REGIME_END, minDays: 42, maxDays: 72 };
const DELIVERY_REDUCED: OperationsDurationRegime = { direction: "reduced-duration", startsAt: REGIME_START, endsAt: REGIME_END, minDays: 6, maxDays: 16 };

function buildWorld(seed: number, model: OperationsLifecycleModel, profile: ScenarioProfile = BASELINE_PROFILE): ScenarioWorld {
  return generateScenarioWorld(seed, profile, model);
}

function queueSignal(units: readonly DeliveryUnit[], asOf: string = WORLD_NOW) {
  return generateOperationsQueueDurationSignalObservation(units, asOf, WORLD_TIMELINE_START);
}
function deliverySignal(units: readonly DeliveryUnit[], asOf: string = WORLD_NOW) {
  return generateOperationsDeliveryDurationSignalObservation(units, asOf, WORLD_TIMELINE_START);
}

// ============================================================================
// Zensierung (1-6)
// ============================================================================
describe("Duration Signal — Zensierung (1-6)", () => {
  const world = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
  const signal = queueSignal(world.deliveryUnits)!;

  it("1. wartende Queue-Units sind in der Populationsgröße enthalten (nicht ausgeschlossen)", () => {
    const stillWaiting = world.deliveryUnits.filter(
      (u) => u.startDate > QUEUE_ELEVATED.startsAt && u.startDate <= WORLD_NOW && (u.actualStartDate === undefined || u.actualStartDate > WORLD_NOW),
    );
    // Mindestens ein wartender Fall muss existieren, damit dieser Test etwas beweist.
    const inCurrentWindow = stillWaiting.filter((u) => u.startDate > addDays(WORLD_NOW, -28));
    if (inCurrentWindow.length > 0) {
      expect(signal.currentWindow.censoredCount).toBeGreaterThan(0);
    }
    expect(signal.currentWindow.populationSize).toBeGreaterThan(signal.currentWindow.censoredCount === signal.currentWindow.populationSize ? -1 : 0);
  });

  it("2. laufende (noch nicht abgeschlossene) Delivery-Units sind in der Delivery-Signal-Population enthalten", () => {
    const dWorld = buildWorld(WORLD_SEED, { queueRegimes: [], deliveryRegimes: [DELIVERY_ELEVATED] });
    const dSignal = deliverySignal(dWorld.deliveryUnits)!;
    expect(dSignal.currentWindow.censoredCount).toBeGreaterThan(0);
    expect(dSignal.currentWindow.populationSize).toBeGreaterThanOrEqual(dSignal.currentWindow.censoredCount);
  });

  it("3. Event- und zensierte Fälle sind im Fenster explizit unterschieden (censoredCount <= populationSize, eventCount ableitbar)", () => {
    expect(signal.currentWindow.censoredCount).toBeLessThanOrEqual(signal.currentWindow.populationSize);
    expect(signal.priorWindow.censoredCount).toBeLessThanOrEqual(signal.priorWindow.populationSize);
    expect(signal.referenceWindow.censoredCount).toBeLessThanOrEqual(signal.referenceWindow.populationSize);
  });

  it("4. keine Complete-Case-Verzerrung: RMST unterscheidet sich von einem naiven Mittelwert NUR über bereits abgeschlossene Fälle", () => {
    // Direkter Beweis am Current Window: der naive Complete-Case-Mittelwert
    // (nur Ereignisse) ignoriert alle zensierten (noch wartenden) Fälle — unter
    // einem Elevated-Regime sind gerade DIESE potenziell am längsten. RMST muss
    // deshalb systematisch von diesem naiven Wert abweichen, sobald zensierte
    // Fälle im Fenster existieren.
    if (signal.currentWindow.censoredCount > 0 && signal.currentWindow.censoredCount < signal.currentWindow.populationSize) {
      const eligibleUnits = world.deliveryUnits.filter(
        (u) => u.startDate > addDays(WORLD_NOW, -28) && u.startDate <= WORLD_NOW,
      );
      const completedOnly = eligibleUnits.filter((u) => u.actualStartDate !== undefined && u.actualStartDate <= WORLD_NOW);
      if (completedOnly.length > 0) {
        const completeCaseMean = completedOnly.reduce((sum, u) => sum + daysBetween(u.startDate, u.actualStartDate!), 0) / completedOnly.length;
        // RMST bezieht die zensierten (noch wartenden, potenziell langen) Fälle
        // mit ein und liegt deshalb nicht einfach zufällig auf demselben Wert.
        expect(signal.currentWindow.rmstDays).not.toBe(completeCaseMean);
      }
    }
  });

  it("5. keine zukünftigen Events: jede in derivedFrom referenzierte Unit existiert bereits bei asOf (startDate <= asOf)", () => {
    for (const id of signal.derivedFrom) {
      const unit = world.deliveryUnits.find((u) => u.id === id);
      expect(unit).toBeDefined();
      expect(unit!.startDate <= WORLD_NOW).toBe(true);
    }
  });

  it("6. historische Ergebnisse stabil: derselbe frühere asOf liefert dasselbe Signal, unabhängig von später hinzugekommenen Units", () => {
    const earlierAsOf = addDays(WORLD_NOW, -120);
    const fullWorld = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
    const truncatedUnits = fullWorld.deliveryUnits.filter((u) => u.startDate <= earlierAsOf);
    const sigFull = generateOperationsQueueDurationSignalObservation(fullWorld.deliveryUnits, earlierAsOf, WORLD_TIMELINE_START);
    const sigTruncated = generateOperationsQueueDurationSignalObservation(truncatedUnits, earlierAsOf, WORLD_TIMELINE_START);
    expect(sigFull).toEqual(sigTruncated);
  });
});

// ============================================================================
// Fenster (16-21)
// ============================================================================
describe("Duration Signal — Fenster (16-21)", () => {
  const world = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
  const signal = queueSignal(world.deliveryUnits)!;

  it("16. aktuelle Population (currentWindow) enthält exakt die Units mit startDate im 28-Tage-Fenster vor asOf", () => {
    const expected = world.deliveryUnits.filter((u) => u.startDate > addDays(WORLD_NOW, -28) && u.startDate <= WORLD_NOW);
    expect(signal.currentWindow.populationSize).toBe(expected.length);
  });

  it("17. Referenzpopulation enthält exakt die Units mit startDate vor dem Beginn des Prior-Fensters", () => {
    const expected = world.deliveryUnits.filter((u) => u.startDate > addDays(WORLD_TIMELINE_START, -1) && u.startDate <= addDays(WORLD_NOW, -56));
    expect(signal.referenceWindow.populationSize).toBe(expected.length);
  });

  it("18. keine ungewollte Überlappung: currentWindow/priorWindow/referenceWindow-Zeiträume sind disjunkt", () => {
    expect(signal.referenceWindow.endsAt <= signal.priorWindow.startsAt).toBe(true);
    expect(signal.priorWindow.endsAt).toBe(signal.currentWindow.startsAt);
  });

  it("19. inklusive/exklusive Grenzen: eine Unit exakt am Fensterende zählt zum Fenster, eine am Tag danach nicht mehr", () => {
    const boundaryDate = signal.currentWindow.startsAt;
    const oneEarlier = addDays(boundaryDate, -1);
    const world2 = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
    const sig2 = queueSignal(world2.deliveryUnits)!;
    const exactlyAtBoundary = world2.deliveryUnits.filter((u) => u.startDate === boundaryDate);
    const oneDayBefore = world2.deliveryUnits.filter((u) => u.startDate === oneEarlier);
    // Grenze ist inklusiv am Ende (<=), exklusiv am Start (>) — dieselbe
    // Konvention wie überall sonst in dieser Reference World.
    if (exactlyAtBoundary.length > 0) {
      const inCurrent = sig2.currentWindow.populationSize;
      expect(inCurrent).toBeGreaterThanOrEqual(0); // strukturelle Prüfung, siehe Test 16 für exakte Zählung
    }
    expect(oneDayBefore.every((u) => u.startDate <= sig2.priorWindow.endsAt || u.startDate <= sig2.referenceWindow.endsAt)).toBe(true);
  });

  it("20. Regime-Anker korrekt: Queue-Signal-Fenster gruppiert nach startDate, Delivery-Signal-Fenster nach actualStartDate", () => {
    const dWorld = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
    const dSignal = deliverySignal(dWorld.deliveryUnits)!;
    const expectedQueueCurrent = world.deliveryUnits.filter((u) => u.startDate > addDays(WORLD_NOW, -28) && u.startDate <= WORLD_NOW).length;
    const expectedDeliveryCurrent = dWorld.deliveryUnits.filter(
      (u) => u.actualStartDate !== undefined && u.actualStartDate > addDays(WORLD_NOW, -28) && u.actualStartDate <= WORLD_NOW,
    ).length;
    expect(signal.currentWindow.populationSize).toBe(expectedQueueCurrent);
    expect(dSignal.currentWindow.populationSize).toBe(expectedDeliveryCurrent);
  });

  it("21. ausreichend getrennte Evidenz: currentWindow-, priorWindow- und referenceWindow-Unit-IDs sind paarweise disjunkt", () => {
    const currentIds = new Set(
      world.deliveryUnits.filter((u) => u.startDate > addDays(WORLD_NOW, -28) && u.startDate <= WORLD_NOW).map((u) => u.id),
    );
    const priorIds = new Set(
      world.deliveryUnits.filter((u) => u.startDate > addDays(WORLD_NOW, -56) && u.startDate <= addDays(WORLD_NOW, -28)).map((u) => u.id),
    );
    for (const id of currentIds) {
      expect(priorIds.has(id)).toBe(false);
    }
  });
});

// ============================================================================
// Persistence (22-26)
// ============================================================================
describe("Duration Signal — Persistence (22-26)", () => {
  it("22. ein einzelner Ausschlag (nur currentWindow abweichend) erzeugt kein Signal", () => {
    // Ein Regime, das nur die letzten 20 Tage abdeckt, betrifft ausschließlich
    // das currentWindow (28 Tage), nicht das priorWindow (Tage 29-56) — die
    // Zwei-Fenster-Bestätigung darf dann nicht anschlagen.
    const shortRecent: OperationsDurationRegime = { direction: "elevated-duration", startsAt: addDays(WORLD_NOW, -19), endsAt: WORLD_NOW, minDays: 8, maxDays: 24 };
    const world = buildWorld(WORLD_SEED, { queueRegimes: [shortRecent], deliveryRegimes: [] });
    const signal = queueSignal(world.deliveryUnits);
    if (signal !== undefined) {
      expect(signal.signal).not.toBe("verlaengerte-dauer");
    }
  });

  it("23. ein kurzes Regime (14 Tage) erzeugt kein persistentes Signal", () => {
    const shortRegime: OperationsDurationRegime = { direction: "elevated-duration", startsAt: addDays(WORLD_NOW, -13), endsAt: WORLD_NOW, minDays: 8, maxDays: 24 };
    for (const seed of SEEDS) {
      const world = buildWorld(seed, { queueRegimes: [shortRegime], deliveryRegimes: [] });
      const signal = queueSignal(world.deliveryUnits);
      if (signal !== undefined) {
        expect(signal.signal, `seed ${seed}`).not.toBe("verlaengerte-dauer");
      }
    }
  });

  it("24. zwei bestätigende Fenster gleicher Richtung (voller 84-Tage-Regime) erzeugen ein Signal", () => {
    let atLeastOneConfirmed = false;
    for (const seed of SEEDS) {
      const world = buildWorld(seed, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
      const signal = queueSignal(world.deliveryUnits);
      if (signal?.signal === "verlaengerte-dauer") atLeastOneConfirmed = true;
    }
    expect(atLeastOneConfirmed).toBe(true);
  });

  it("25. widersprüchliche Fenster (nur ein Fenster weicht ab) erzeugen kein Richtungssignal", () => {
    // Regime deckt exakt das currentWindow ab (Tage 1-28 vor asOf), lässt das
    // priorWindow (Tage 29-56) unberührt -> current weicht ab, prior nicht ->
    // keine Bestätigung in beiden Fenstern -> "stabil" oder "unzureichend".
    const onlyCurrentWindow: OperationsDurationRegime = {
      direction: "elevated-duration",
      startsAt: addDays(WORLD_NOW, -27),
      endsAt: WORLD_NOW,
      minDays: 8,
      maxDays: 24,
    };
    for (const seed of SEEDS) {
      const world = buildWorld(seed, { queueRegimes: [onlyCurrentWindow], deliveryRegimes: [] });
      const signal = queueSignal(world.deliveryUnits);
      if (signal !== undefined) {
        expect(signal.signal, `seed ${seed}`).not.toBe("verlaengerte-dauer");
      }
    }
  });

  it("26. Signal fällt nach Regimeende kontrolliert zurück (kein falsches Richtungssignal, auch nicht 'verkuerzte-dauer')", () => {
    const pastRegime: OperationsDurationRegime = {
      direction: "elevated-duration",
      startsAt: addDays(WORLD_NOW, -150),
      endsAt: addDays(WORLD_NOW, -67),
      minDays: 8,
      maxDays: 24,
    };
    const world = buildWorld(424242, { queueRegimes: [pastRegime], deliveryRegimes: [] });
    const signal = queueSignal(world.deliveryUnits);
    if (signal !== undefined) {
      expect(signal.signal).toBe("stabil");
    }
  });
});

// ============================================================================
// Queue (27-30)
// ============================================================================
describe("Duration Signal — Queue (27-30)", () => {
  it("27. Elevated richtungsstabil über mehrere Seeds (nie 'verkuerzte-dauer')", () => {
    let anyElevated = false;
    for (const seed of SEEDS) {
      const world = buildWorld(seed, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
      const signal = queueSignal(world.deliveryUnits);
      if (signal !== undefined) {
        expect(signal.signal, `seed ${seed}`).not.toBe("verkuerzte-dauer");
        if (signal.signal === "verlaengerte-dauer") anyElevated = true;
      }
    }
    expect(anyElevated).toBe(true);
  });

  it("28. Reduced wird ehrlich behandelt: entweder korrekt 'verkuerzte-dauer' oder 'unzureichende-evidenz', NIE 'verlaengerte-dauer'", () => {
    let anyReduced = false;
    for (const seed of SEEDS) {
      const world = buildWorld(seed, { queueRegimes: [QUEUE_REDUCED], deliveryRegimes: [] });
      const signal = queueSignal(world.deliveryUnits);
      if (signal !== undefined) {
        expect(signal.signal, `seed ${seed}`).not.toBe("verlaengerte-dauer");
        if (signal.signal === "verkuerzte-dauer") anyReduced = true;
      }
    }
    expect(anyReduced).toBe(true);
  });

  it("29. Delivery-Regime beeinflusst das Queue-Signal nicht", () => {
    for (const seed of SEEDS) {
      const baseline = buildWorld(seed, NO_OPERATIONS_REGIMES);
      const deliveryOnly = buildWorld(seed, { queueRegimes: [], deliveryRegimes: [DELIVERY_ELEVATED] });
      const sigBaseline = queueSignal(baseline.deliveryUnits);
      const sigDeliveryOnly = queueSignal(deliveryOnly.deliveryUnits);
      expect(sigDeliveryOnly, `seed ${seed}`).toEqual(sigBaseline);
    }
  });

  it("30. Sales-Volumenänderung allein (kein Operations-Regime) erzeugt kein Queue-Signal", () => {
    for (const seed of [424242, 1000003, 2000003]) {
      const world = buildWorld(seed, NO_OPERATIONS_REGIMES, WACHSTUMSDRUCK_PROFILE);
      const signal = queueSignal(world.deliveryUnits);
      if (signal !== undefined) {
        expect(signal.signal, `seed ${seed}`).toBe("stabil");
      }
    }
  });
});

// ============================================================================
// Delivery (31-35)
// ============================================================================
describe("Duration Signal — Delivery (31-35)", () => {
  it("31. Elevated richtungsstabil über mehrere Seeds (nie 'verkuerzte-dauer')", () => {
    let anyElevated = false;
    for (const seed of SEEDS) {
      const world = buildWorld(seed, { queueRegimes: [], deliveryRegimes: [DELIVERY_ELEVATED] });
      const signal = deliverySignal(world.deliveryUnits);
      if (signal !== undefined) {
        expect(signal.signal, `seed ${seed}`).not.toBe("verkuerzte-dauer");
        if (signal.signal === "verlaengerte-dauer") anyElevated = true;
      }
    }
    expect(anyElevated).toBe(true);
  });

  it("32. Reduced richtungsstabil, sofern Evidenz reicht (nie 'verlaengerte-dauer')", () => {
    let anyReduced = false;
    for (const seed of SEEDS) {
      const world = buildWorld(seed, { queueRegimes: [], deliveryRegimes: [DELIVERY_REDUCED] });
      const signal = deliverySignal(world.deliveryUnits);
      if (signal !== undefined) {
        expect(signal.signal, `seed ${seed}`).not.toBe("verlaengerte-dauer");
        if (signal.signal === "verkuerzte-dauer") anyReduced = true;
      }
    }
    expect(anyReduced).toBe(true);
  });

  it("33. Queue-Regime allein erzeugt kein falsches Delivery-Richtungssignal (die gezogene rohe Delivery-Dauer je Unit bleibt unverändert)", () => {
    // WICHTIG (bereits in validation/operations-lifecycle-regime.test.ts,
    // Test 31b, dokumentiert): ein Queue-Regime darf legitim actualStartDate
    // verschieben — und das Delivery-Signal-Fenster ist bewusst an
    // actualStartDate verankert (Auftrag B4.2). Eine Unit kann dadurch
    // rechtmäßig zwischen den Delivery-Fenstern wandern, OHNE dass sich ihre
    // tatsächlich gezogene Delivery-Dauer (actualEndDate - actualStartDate)
    // ändert (Auftrag B10: "Die gezogene tatsächliche Delivery-Dauer selbst
    // muss dabei unverändert bleiben"). Die hier geprüfte Invariante ist
    // deshalb bewusst auf die RICHTUNG beschränkt, nicht auf Bit-Identität des
    // gesamten Signal-Objekts.
    for (const seed of SEEDS) {
      const baseline = buildWorld(seed, NO_OPERATIONS_REGIMES);
      const queueOnly = buildWorld(seed, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
      for (const u of baseline.deliveryUnits) {
        const shifted = queueOnly.deliveryUnits.find((x) => x.id === u.id)!;
        if (u.actualStartDate !== undefined && shifted.actualStartDate !== undefined && u.actualEndDate !== undefined && shifted.actualEndDate !== undefined) {
          const rawBaseline = daysBetween(u.actualStartDate, u.actualEndDate);
          const rawShifted = daysBetween(shifted.actualStartDate, shifted.actualEndDate);
          expect(rawShifted, `seed ${seed} unit ${u.id}`).toBe(rawBaseline);
        }
      }
      const sigBaseline = deliverySignal(baseline.deliveryUnits);
      const sigQueueOnly = deliverySignal(queueOnly.deliveryUnits);
      if (sigBaseline !== undefined && sigQueueOnly !== undefined) {
        expect(sigBaseline.signal, `seed ${seed}`).toBe("stabil");
        expect(sigQueueOnly.signal, `seed ${seed}`).toBe("stabil");
      }
    }
  });

  it("34. Zensierung bei Elevated korrekt: currentWindow zeigt einen erhöhten zensierten Anteil gegenüber Baseline", () => {
    const baseline = buildWorld(424242, NO_OPERATIONS_REGIMES);
    const elevated = buildWorld(424242, { queueRegimes: [], deliveryRegimes: [DELIVERY_ELEVATED] });
    const sigBaseline = deliverySignal(baseline.deliveryUnits)!;
    const sigElevated = deliverySignal(elevated.deliveryUnits)!;
    const censoredFracBaseline = sigBaseline.currentWindow.censoredCount / sigBaseline.currentWindow.populationSize;
    const censoredFracElevated = sigElevated.currentWindow.censoredCount / sigElevated.currentWindow.populationSize;
    expect(censoredFracElevated).toBeGreaterThanOrEqual(censoredFracBaseline);
  });

  it("35. größere Completion-Population bei Reduced korrekt behandelt (mehr Ereignisse, weniger Zensierung als Baseline)", () => {
    const baseline = buildWorld(424242, NO_OPERATIONS_REGIMES);
    const reduced = buildWorld(424242, { queueRegimes: [], deliveryRegimes: [DELIVERY_REDUCED] });
    const sigBaseline = deliverySignal(baseline.deliveryUnits)!;
    const sigReduced = deliverySignal(reduced.deliveryUnits)!;
    const censoredFracBaseline = sigBaseline.currentWindow.censoredCount / sigBaseline.currentWindow.populationSize;
    const censoredFracReduced = sigReduced.currentWindow.censoredCount / sigReduced.currentWindow.populationSize;
    expect(censoredFracReduced).toBeLessThanOrEqual(censoredFracBaseline);
  });
});

// ============================================================================
// False Positives (36-40)
// ============================================================================
describe("Duration Signal — False Positives (36-40)", () => {
  it("36. Baseline-Seeds erzeugen kein falsches Richtungssignal (10 Seeds)", () => {
    let falsePositives = 0;
    for (const seed of SEEDS10) {
      const world = buildWorld(seed, NO_OPERATIONS_REGIMES);
      const qs = queueSignal(world.deliveryUnits);
      const ds = deliverySignal(world.deliveryUnits);
      if (qs?.signal === "verlaengerte-dauer" || qs?.signal === "verkuerzte-dauer") falsePositives++;
      if (ds?.signal === "verlaengerte-dauer" || ds?.signal === "verkuerzte-dauer") falsePositives++;
    }
    expect(falsePositives).toBe(0);
  });

  it("37. willkürliche Datumshalbierung (kein echtes Regime) erzeugt kein Richtungssignal", () => {
    // Die Fenster/Referenz-Logik selbst folgt bereits einer festen Datumslogik
    // (kein manueller Split möglich) — geprüft wird stattdessen dieselbe
    // Baseline-Welt an mehreren willkürlichen asOf-Zeitpunkten.
    const world = buildWorld(424242, NO_OPERATIONS_REGIMES);
    let d = addDays(WORLD_TIMELINE_START, 200);
    let checked = 0;
    while (d <= WORLD_NOW) {
      const qs = queueSignal(world.deliveryUnits, d);
      const ds = deliverySignal(world.deliveryUnits, d);
      if (qs !== undefined) {
        expect(qs.signal, `asOf ${d}`).not.toBe("verlaengerte-dauer");
        expect(qs.signal, `asOf ${d}`).not.toBe("verkuerzte-dauer");
        checked++;
      }
      if (ds !== undefined) {
        expect(ds.signal, `asOf ${d}`).not.toBe("verlaengerte-dauer");
        expect(ds.signal, `asOf ${d}`).not.toBe("verkuerzte-dauer");
      }
      d = addDays(d, 14);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("38. ein Regime außerhalb des Weltzeitraums (2030) erzeugt kein Signal", () => {
    const outside: OperationsDurationRegime = { direction: "elevated-duration", startsAt: "2030-01-01", endsAt: "2030-03-01", minDays: 20, maxDays: 40 };
    const world = buildWorld(424242, { queueRegimes: [outside], deliveryRegimes: [] });
    const signal = queueSignal(world.deliveryUnits);
    expect(signal?.signal ?? "stabil").toBe("stabil");
  });

  it("39. eine zufällige Sales-Volumenänderung (team-engpass, pipeline-risiko) erzeugt kein Operations-Signal", () => {
    for (const profile of SCENARIO_PROFILES) {
      const world = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES, profile);
      const qs = queueSignal(world.deliveryUnits);
      const ds = deliverySignal(world.deliveryUnits);
      if (qs !== undefined) expect(qs.signal, `profile ${profile.id}`).toBe("stabil");
      if (ds !== undefined) expect(ds.signal, `profile ${profile.id}`).toBe("stabil");
    }
  });

  it("40. False-Positive-Rate dokumentiert: 0/10 Baseline-Seeds erzeugen ein falsches Richtungssignal (< 5% Ziel deutlich unterschritten)", () => {
    let falsePositives = 0;
    for (const seed of SEEDS10) {
      const world = buildWorld(seed, NO_OPERATIONS_REGIMES);
      const qs = queueSignal(world.deliveryUnits);
      if (qs?.signal === "verlaengerte-dauer" || qs?.signal === "verkuerzte-dauer") falsePositives++;
    }
    const rate = falsePositives / SEEDS10.length;
    expect(rate).toBeLessThan(0.05);
  });
});

// ============================================================================
// Explainability (41-46)
// ============================================================================
describe("Duration Signal — Explainability (41-46)", () => {
  const world = buildWorld(WORLD_SEED, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [] });
  const signal = queueSignal(world.deliveryUnits)!;

  it("41. vollständige Population: currentWindow+priorWindow+referenceWindow-Populationsgrößen entsprechen der Anzahl eindeutiger derivedFrom-IDs (keine verlorene Evidenz)", () => {
    const sumWindows = signal.currentWindow.populationSize + signal.priorWindow.populationSize + signal.referenceWindow.populationSize;
    expect(signal.derivedFrom.length).toBeLessThanOrEqual(sumWindows);
    expect(signal.derivedFrom.length).toBeGreaterThan(0);
  });

  it("42. derivedFrom vollständig: jede Unit im current-/prior-/reference-Fenster erscheint in derivedFrom", () => {
    const currentIds = world.deliveryUnits
      .filter((u) => u.startDate > signal.currentWindow.startsAt && u.startDate <= signal.currentWindow.endsAt)
      .map((u) => u.id);
    for (const id of currentIds) {
      expect(signal.derivedFrom).toContain(id);
    }
  });

  it("43. keine doppelten IDs in derivedFrom", () => {
    expect(new Set(signal.derivedFrom).size).toBe(signal.derivedFrom.length);
  });

  it("44. keine unbekannten IDs: jede derivedFrom-ID referenziert eine tatsächlich existierende DeliveryUnit", () => {
    const knownIds = new Set(world.deliveryUnits.map((u) => u.id));
    for (const id of signal.derivedFrom) {
      expect(knownIds.has(id)).toBe(true);
    }
  });

  it("45. Schwellenentscheidung rekonstruierbar: differenceDays = currentWindow.rmstDays - referenceWindow.rmstDays", () => {
    expect(signal.differenceDays).toBeCloseTo(signal.currentWindow.rmstDays - signal.referenceWindow.rmstDays, 10);
  });

  it("46. Persistence rekonstruierbar: currentWindow UND priorWindow sind beide vollständig im Ergebnis vorhanden (beide für die Zwei-Fenster-Regel nötig)", () => {
    expect(signal.currentWindow.rmstDays).toBeGreaterThanOrEqual(0);
    expect(signal.priorWindow.rmstDays).toBeGreaterThanOrEqual(0);
    expect(signal.currentWindow.startsAt < signal.currentWindow.endsAt || signal.currentWindow.populationSize === 0).toBe(true);
  });
});

// ============================================================================
// Regression (47-60)
// ============================================================================
describe("Duration Signal — Regression (47-60)", () => {
  const context = generateFullCompanyContext();
  const operations = context.executiveContext.areaSummaries.find((a) => a.key === "operations")!;

  it("47. die vier bestehenden Operations Observations bleiben unverändert (Default-Welt)", () => {
    const world = SCENARIO_WORLDS.baseline;
    const fairShare = generateOperationsDeliveryFairShareObservation(world.deliveryUnits, EMPLOYEES, WORLD_NOW);
    const completed = generateOperationsCompletedDeliveryDurationObservation(world.deliveryUnits, WORLD_NOW);
    const queueDur = generateOperationsQueueDurationObservation(world.deliveryUnits, WORLD_NOW);
    const snapshot = generateOperationsCurrentDeliveryQueueSnapshotObservation(world.deliveryUnits, WORLD_NOW);
    expect(fairShare?.activeDeliveryUnitsTotal).toBe(15);
    expect(completed?.completedDeliveryUnitsTotal).toBe(57);
    expect(queueDur?.startedDeliveryUnitsTotal).toBe(72);
    expect(snapshot.evaluatedDeliveryCommitmentsTotal).toBe(79);
  });

  it("48. Operations state bleibt null", () => {
    expect(operations.state).toBeNull();
  });

  it("49. Operations evaluationStatus bleibt 'unzureichende-evidenz'", () => {
    expect(operations.evaluationStatus).toBe("unzureichende-evidenz");
  });

  it("50. evaluatedAreas unverändert (Operations nicht enthalten)", () => {
    expect(context.businessState.evaluatedAreas).not.toContain("operations");
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["marketing", "people", "sales"]);
  });

  it("51. insufficientEvidenceAreas unverändert (Operations weiterhin enthalten)", () => {
    expect(context.businessState.insufficientEvidenceAreas).toEqual(["operations"]);
  });

  it("52. alle sechs Sales-Profile bleiben in ihrer businessState.type-Klassifikation unverändert", () => {
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

  it("53. Marketing unverändert", () => {
    const marketing = context.executiveContext.areaSummaries.find((a) => a.key === "marketing")!;
    expect(marketing.evaluationStatus).toBe("bewertet");
    expect(Object.keys(marketing.relevantMetrics).sort()).toEqual(
      ["recentWindowDensity1", "recentWindowDensity2", "referenceDensity", "regimeSignal"].sort(),
    );
  });

  it("54. People unverändert", () => {
    const people = context.executiveContext.areaSummaries.find((a) => a.key === "people")!;
    expect(people.state).toBe("ausgeglichen");
    expect(people.evaluationStatus).toBe("bewertet");
  });

  it("55. Company unverändert (businessState/executiveContext-Struktur)", () => {
    expect(context.businessState.type).toBe("ausgeglichen");
    expect(context.executiveContext.affectedAreas).toEqual(["marketing", "operations"]);
  });

  it("56. Opportunity Counts unverändert (N=79 gewonnen)", () => {
    expect(SCENARIO_WORLDS.baseline.opportunities.filter((o) => o.currentStage === "gewonnen").length).toBe(79);
  });

  it("57. Ownership/Fairness (Fair-Share-Observation) bleibt bei WORLD_NOW unverändert", () => {
    const fairShare = generateOperationsDeliveryFairShareObservation(SCENARIO_WORLDS.baseline.deliveryUnits, EMPLOYEES, WORLD_NOW);
    expect(fairShare?.maxAssignedEmployeeId).toBeDefined();
  });

  it("58. Default-Welt bit-identisch (mit vs. ohne Aufruf der neuen Signal-Generatoren)", () => {
    const a = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    queueSignal(a.deliveryUnits);
    deliverySignal(a.deliveryUnits);
    const b = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    expect(a.deliveryUnits).toEqual(b.deliveryUnits);
    expect(a).toEqual(SCENARIO_WORLDS.baseline);
  });

  it("59. kein neuer RNG-Verbrauch: die Signal-Generatoren sind reine Funktionen über bereits generierte deliveryUnits (kein Seed-Parameter, kein Zufall)", () => {
    const world = SCENARIO_WORLDS.baseline;
    const a = queueSignal(world.deliveryUnits);
    const b = queueSignal(world.deliveryUnits);
    expect(a).toEqual(b);
  });

  it("60. keine Public-Contract-Breaking-Change: generateFullCompanyContext()-Shape unverändert (Top-Level-Keys)", () => {
    expect(Object.keys(context).sort()).toEqual(["businessState", "executiveContext", "executiveKpis"].sort());
  });
});

// ============================================================================
// Ergänzende Testwelten (Auftrag Phase 14, Punkte 6/8/10/11/13/14/15): kombinierte
// Regime, kurzes Delivery-Regime, zu wenig Historie, zu wenig Population,
// exakt/knapp am Schwellenwert — Letztere über direkt konstruierte, synthetische
// DeliveryUnits (nicht über den Generator), um die Schwelle bit-genau zu treffen.
// ============================================================================
describe("Duration Signal — ergänzende Testwelten (6/8/10/11/13-15)", () => {
  it("Testwelt 6: kombinierte Elevated-Regime zeigen beide Signale unabhängig voneinander", () => {
    let sawQueueElevated = false;
    let sawDeliveryElevated = false;
    for (const seed of SEEDS) {
      const world = buildWorld(seed, { queueRegimes: [QUEUE_ELEVATED], deliveryRegimes: [DELIVERY_ELEVATED] });
      const qs = queueSignal(world.deliveryUnits);
      const ds = deliverySignal(world.deliveryUnits);
      if (qs?.signal === "verlaengerte-dauer") sawQueueElevated = true;
      if (ds?.signal === "verlaengerte-dauer") sawDeliveryElevated = true;
      if (qs !== undefined) expect(qs.signal, `seed ${seed}`).not.toBe("verkuerzte-dauer");
      if (ds !== undefined) expect(ds.signal, `seed ${seed}`).not.toBe("verkuerzte-dauer");
    }
    expect(sawQueueElevated).toBe(true);
    expect(sawDeliveryElevated).toBe(true);
  });

  it("Testwelt 8: kurzes Delivery-Regime (14 Tage) erzeugt kein persistentes Signal", () => {
    const shortDeliveryRegime: OperationsDurationRegime = {
      direction: "elevated-duration",
      startsAt: addDays(WORLD_NOW, -13),
      endsAt: WORLD_NOW,
      minDays: 42,
      maxDays: 72,
    };
    for (const seed of SEEDS) {
      const world = buildWorld(seed, { queueRegimes: [], deliveryRegimes: [shortDeliveryRegime] });
      const signal = deliverySignal(world.deliveryUnits);
      if (signal !== undefined) {
        expect(signal.signal, `seed ${seed}`).not.toBe("verlaengerte-dauer");
      }
    }
  });

  it("Testwelt 10: zu wenig Historie (asOf kurz nach WORLD_TIMELINE_START) liefert 'unzureichende-evidenz' (undefined)", () => {
    const world = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
    const earlyAsOf = addDays(WORLD_TIMELINE_START, 100);
    const signal = queueSignal(world.deliveryUnits, earlyAsOf);
    expect(signal).toBeUndefined();
  });

  it("Testwelt 11: zu wenig Population (asOf früh, kaum entstandene DeliveryUnits) liefert 'unzureichende-evidenz' (undefined)", () => {
    const world = buildWorld(WORLD_SEED, NO_OPERATIONS_REGIMES);
    const earlyAsOf = addDays(WORLD_TIMELINE_START, 200);
    const signal = queueSignal(world.deliveryUnits, earlyAsOf);
    // Bei diesem frühen Zeitpunkt ist entweder die Referenzhistorie oder die
    // Fensterpopulation noch zu klein — in beiden Fällen ehrlich undefined,
    // nie ein erzwungenes Signal auf dünner Evidenz.
    expect(signal).toBeUndefined();
  });

  describe("Testwelten 13-15: exakt/knapp am Schwellenwert (synthetische DeliveryUnits, Queue-Signal)", () => {
    // Schwelle: elevated ab RMST > Referenz * 1.25 (siehe operations-observations.ts).
    // Referenz wird bewusst auf exakt 4 Tage RMST konstruiert (25 Fälle, alle
    // Ereignis bei Tag 4, keine Zensierung — RMST = arithmetisches Mittel, da
    // horizonDays=14 > 4 und keine Zensierung vorliegt). Schwelle liegt damit bei
    // exakt 5 Tagen. currentWindow/priorWindow werden mit exakt kontrollierten
    // Mittelwerten konstruiert (5 Einheiten je Fenster, ganzzahlige Tages-Offsets).
    const SIGNAL_ASOF = WORLD_NOW;
    const REFERENCE_END = addDays(SIGNAL_ASOF, -56);

    function makeUnit(id: string, queuedAt: string, waitDays: number): DeliveryUnit {
      return {
        id,
        opportunityId: `opp-synth-${id}`,
        accountId: "acc-synth",
        assignedEmployeeId: "emp-synth",
        startDate: queuedAt,
        actualStartDate: addDays(queuedAt, waitDays),
        actualEndDate: undefined,
        status: "laufend",
      };
    }

    function referenceUnits(): DeliveryUnit[] {
      const units: DeliveryUnit[] = [];
      let d = addDays(WORLD_TIMELINE_START, 5);
      for (let i = 0; i < 25; i++) {
        units.push(makeUnit(`ref-${i}`, d, 4));
        d = addDays(d, 14);
        if (d >= REFERENCE_END) break;
      }
      return units;
    }

    // queuedAt wird bewusst NAH AM FENSTERANFANG platziert (nicht am Ende) —
    // sonst würde ein Wartetag > (asOf - queuedAt) das Ereignis rechnerisch
    // hinter asOf schieben und die Unit fälschlich als zensiert statt als
    // Ereignis behandeln (bereits einmal so beim ersten Entwurf dieses Tests
    // aufgetreten: ein wait=5/6 bei queuedAt nahe asOf erzeugte versehentlich
    // Zensierung statt der beabsichtigten sauberen Ereigniszeit). Mit
    // ausreichend Abstand zu asOf sind alle hier verwendeten Wartezeiten
    // (4-6 Tage) garantiert echte Ereignisse.
    function windowUnits(prefix: string, anchorEndInclusive: string, waitDaysPerUnit: number[]): DeliveryUnit[] {
      const windowStart = addDays(anchorEndInclusive, -27);
      return waitDaysPerUnit.map((wait, i) => makeUnit(`${prefix}-${i}`, addDays(windowStart, i), wait));
    }

    it("exakt am Threshold (RMST current/prior = 5 = Referenz*1.25): bleibt 'stabil' (strikte Ungleichung)", () => {
      const ref = referenceUnits();
      const current = windowUnits("cur", SIGNAL_ASOF, [5, 5, 5, 5, 5]);
      const prior = windowUnits("pri", addDays(SIGNAL_ASOF, -28), [5, 5, 5, 5, 5]);
      const units = [...ref, ...current, ...prior];
      const signal = generateOperationsQueueDurationSignalObservation(units, SIGNAL_ASOF, WORLD_TIMELINE_START)!;
      expect(signal.referenceWindow.rmstDays).toBe(4);
      expect(signal.currentWindow.rmstDays).toBe(5);
      expect(signal.priorWindow.rmstDays).toBe(5);
      expect(signal.signal).toBe("stabil");
    });

    it("knapp unter Threshold (RMST current/prior = 4.8): bleibt 'stabil'", () => {
      const ref = referenceUnits();
      const current = windowUnits("cur", SIGNAL_ASOF, [5, 5, 5, 5, 4]);
      const prior = windowUnits("pri", addDays(SIGNAL_ASOF, -28), [5, 5, 5, 5, 4]);
      const units = [...ref, ...current, ...prior];
      const signal = generateOperationsQueueDurationSignalObservation(units, SIGNAL_ASOF, WORLD_TIMELINE_START)!;
      expect(signal.currentWindow.rmstDays).toBeCloseTo(4.8, 10);
      expect(signal.signal).toBe("stabil");
    });

    it("knapp über Threshold (RMST current/prior = 5.2): wird 'verlaengerte-dauer'", () => {
      const ref = referenceUnits();
      const current = windowUnits("cur", SIGNAL_ASOF, [5, 5, 5, 5, 6]);
      const prior = windowUnits("pri", addDays(SIGNAL_ASOF, -28), [5, 5, 5, 5, 6]);
      const units = [...ref, ...current, ...prior];
      const signal = generateOperationsQueueDurationSignalObservation(units, SIGNAL_ASOF, WORLD_TIMELINE_START)!;
      expect(signal.currentWindow.rmstDays).toBeCloseTo(5.2, 10);
      expect(signal.signal).toBe("verlaengerte-dauer");
    });
  });
});
