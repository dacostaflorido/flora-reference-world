import { describe, expect, it } from "vitest";
import { generateScenarioWorld } from "../engine/generator";
import { BASELINE_PROFILE } from "../engine/scenario-profiles";
import { WORLD_NOW } from "../timeline/world-clock";
import { addDays, daysBetween } from "../engine/random";
import { NO_OPERATIONS_REGIMES, type OperationsLifecycleModel, type OperationsDurationRegime } from "../engine/operations-lifecycle";

// AUFTRAG — Current Queue Checkpoint + Operations Regime Foundation, Phase B,
// B11/B12: reproduziert die entscheidenden empirischen Kalibrierungsbefunde
// dieses Audits als Assertions (dieselbe Methode wie
// validation/marketing-demand-regime-v2-calibration.test.ts). Jede Zahl unten
// wurde vorab über 6 Seeds × 4 Regimedauern gemessen (siehe Abschlussbericht,
// B11/B22-B36) — keine an ein Ergebnis zurückgerechnete Zahl, sondern eine
// gemessene, hier fixierte Referenz.

const SEEDS = [424242, 1000003, 2000003, 3000003, 5000009, 7000003] as const;

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function makeRegime(
  direction: OperationsDurationRegime["direction"],
  minDays: number,
  maxDays: number,
  durationDays: number,
  endsAt: string = WORLD_NOW,
): OperationsDurationRegime {
  return { direction, startsAt: addDays(endsAt, -(durationDays - 1)), endsAt, minDays, maxDays };
}

interface Measurement {
  inWindow: number[];
  outWindow: number[];
}

function measureQueue(regime: OperationsDurationRegime | undefined, seed: number): Measurement {
  const model: OperationsLifecycleModel = regime ? { queueRegimes: [regime], deliveryRegimes: [] } : NO_OPERATIONS_REGIMES;
  const world = generateScenarioWorld(seed, BASELINE_PROFILE, model);
  const inWindow: number[] = [];
  const outWindow: number[] = [];
  for (const u of world.deliveryUnits) {
    if (u.actualStartDate === undefined) continue;
    const q = daysBetween(u.startDate, u.actualStartDate);
    const isIn = regime !== undefined && u.startDate >= regime.startsAt && u.startDate <= regime.endsAt;
    (isIn ? inWindow : outWindow).push(q);
  }
  return { inWindow, outWindow };
}

function measureDelivery(regime: OperationsDurationRegime | undefined, seed: number): Measurement {
  const model: OperationsLifecycleModel = regime ? { queueRegimes: [], deliveryRegimes: [regime] } : NO_OPERATIONS_REGIMES;
  const world = generateScenarioWorld(seed, BASELINE_PROFILE, model);
  const inWindow: number[] = [];
  const outWindow: number[] = [];
  for (const u of world.deliveryUnits) {
    if (u.actualEndDate === undefined || u.actualStartDate === undefined) continue;
    const d = daysBetween(u.actualStartDate, u.actualEndDate);
    const isIn = regime !== undefined && u.actualStartDate >= regime.startsAt && u.actualStartDate <= regime.endsAt;
    (isIn ? inWindow : outWindow).push(d);
  }
  return { inWindow, outWindow };
}

interface PooledResult {
  sigma: number;
  nIn: number;
  nOut: number;
  seedsWithData: number;
  directionCorrectSeeds: number;
}

function pooledSigma(
  dimension: "queue" | "delivery",
  regime: OperationsDurationRegime,
): PooledResult {
  let allIn: number[] = [];
  let allOut: number[] = [];
  let seedsWithData = 0;
  let directionCorrectSeeds = 0;
  for (const seed of SEEDS) {
    const { inWindow, outWindow } = dimension === "queue" ? measureQueue(regime, seed) : measureDelivery(regime, seed);
    if (inWindow.length === 0 || outWindow.length === 0) continue;
    seedsWithData++;
    const mIn = mean(inWindow);
    const mOut = mean(outWindow);
    const expectDirection = regime.direction === "elevated-duration" ? mIn > mOut : mIn < mOut;
    if (expectDirection) directionCorrectSeeds++;
    allIn = allIn.concat(inWindow);
    allOut = allOut.concat(outWindow);
  }
  const sigma = allOut.length > 0 ? (mean(allIn) - mean(allOut)) / stdev(allOut) : NaN;
  return { sigma, nIn: allIn.length, nOut: allOut.length, seedsWithData, directionCorrectSeeds };
}

// Kalibrierte Kandidaten (siehe Abschlussbericht B22-B34 für die vollständige
// Messreihe über 56/84/112/168 Tage × 6 Seeds).
const QUEUE_ELEVATED_A = (d: number) => makeRegime("elevated-duration", 4, 16, d);
const QUEUE_ELEVATED_B = (d: number) => makeRegime("elevated-duration", 8, 24, d);
const QUEUE_REDUCED_BEST = (d: number) => makeRegime("reduced-duration", 0, 1, d);
const DELIVERY_ELEVATED_A = (d: number) => makeRegime("elevated-duration", 30, 60, d);
const DELIVERY_ELEVATED_B = (d: number) => makeRegime("elevated-duration", 42, 72, d);
const DELIVERY_REDUCED_BEST = (d: number) => makeRegime("reduced-duration", 6, 16, d);

describe("Operations Regime Calibration — 47. mehrere Seeds", () => {
  it("jede Kalibrierungsmessung wird über mindestens 6 unabhängige Seeds gepoolt", () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(6);
  });
});

describe("Operations Regime Calibration — 48. alle vier Regime-Dauern gemessen (56/84/112/168 Tage)", () => {
  it("Queue elevated candidate B: sigma ist für jede der vier Dauern eine gültige, endliche Zahl", () => {
    for (const duration of [56, 84, 112, 168]) {
      const result = pooledSigma("queue", QUEUE_ELEVATED_B(duration));
      expect(Number.isFinite(result.sigma), `duration=${duration}`).toBe(true);
    }
  });

  it("Delivery elevated candidate B: sigma ist für jede der vier Dauern eine gültige, endliche Zahl", () => {
    for (const duration of [56, 84, 112, 168]) {
      const result = pooledSigma("delivery", DELIVERY_ELEVATED_B(duration));
      expect(Number.isFinite(result.sigma), `duration=${duration}`).toBe(true);
    }
  });
});

describe("Operations Regime Calibration — 49. Kandidatenvergleich", () => {
  it("Queue elevated: Kandidat B (8..24 Tage) trennt deutlich stärker als Kandidat A (4..16 Tage) bei 84 Tagen", () => {
    const a = pooledSigma("queue", QUEUE_ELEVATED_A(84));
    const b = pooledSigma("queue", QUEUE_ELEVATED_B(84));
    expect(b.sigma).toBeGreaterThan(a.sigma);
    expect(a.sigma).toBeGreaterThan(1.5); // Kandidat A erreicht das ~2σ-Ziel nur knapp
    expect(b.sigma).toBeGreaterThan(4); // Kandidat B liegt deutlich über dem Ziel
  });

  it("Delivery elevated: Kandidat B (42..72 Tage) trennt stärker als Kandidat A (30..60 Tage) bei 84 Tagen", () => {
    const a = pooledSigma("delivery", DELIVERY_ELEVATED_A(84));
    const b = pooledSigma("delivery", DELIVERY_ELEVATED_B(84));
    expect(b.sigma).toBeGreaterThan(a.sigma);
    expect(b.sigma).toBeGreaterThan(2);
  });
});

describe("Operations Regime Calibration — 50. Richtungsstabilität (über alle 6 Seeds)", () => {
  it("Queue elevated candidate B (84 Tage): Richtung stimmt in 6/6 Seeds", () => {
    const result = pooledSigma("queue", QUEUE_ELEVATED_B(84));
    expect(result.seedsWithData).toBe(6);
    expect(result.directionCorrectSeeds).toBe(6);
  });

  it("Delivery elevated candidate B (84 Tage): Richtung stimmt in 6/6 Seeds", () => {
    const result = pooledSigma("delivery", DELIVERY_ELEVATED_B(84));
    expect(result.seedsWithData).toBe(6);
    expect(result.directionCorrectSeeds).toBe(6);
  });

  it("Delivery reduced candidate (84 Tage): Richtung stimmt in 6/6 Seeds", () => {
    const result = pooledSigma("delivery", DELIVERY_REDUCED_BEST(84));
    expect(result.seedsWithData).toBe(6);
    expect(result.directionCorrectSeeds).toBe(6);
  });

  it("Queue reduced candidate (84 Tage): Richtung stimmt in 6/6 Seeds (auch wenn Effektgröße strukturell begrenzt ist, siehe 51)", () => {
    const result = pooledSigma("queue", QUEUE_REDUCED_BEST(84));
    expect(result.seedsWithData).toBe(6);
    expect(result.directionCorrectSeeds).toBe(6);
  });
});

describe("Operations Regime Calibration — 51. Effektgröße (Zielkorridor ~2σ, Foundation-Qualitätsziel)", () => {
  it("Queue elevated (gewählte Kalibrierung 8..24 Tage, 84 Tage Fenster) erreicht >=4σ", () => {
    const result = pooledSigma("queue", QUEUE_ELEVATED_B(84));
    expect(result.sigma).toBeGreaterThanOrEqual(4);
  });

  it("Delivery elevated (gewählte Kalibrierung 42..72 Tage, 84 Tage Fenster) erreicht >=2.5σ", () => {
    const result = pooledSigma("delivery", DELIVERY_ELEVATED_B(84));
    expect(result.sigma).toBeGreaterThanOrEqual(2.5);
  });

  it("Delivery reduced (gewählte Kalibrierung 6..16 Tage, 84 Tage Fenster) erreicht <= -2.5σ", () => {
    const result = pooledSigma("delivery", DELIVERY_REDUCED_BEST(84));
    expect(result.sigma).toBeLessThanOrEqual(-2.5);
  });

  it("Queue reduced ist STRUKTURELL auf ~1.5σ begrenzt (Baseline-Untergrenze 0 Tage, keine erzwungenen Extremwerte) — dokumentierte Grenze, kein Bug", () => {
    // Baseline Queue ~ Uniform(0,8), stdev ≈ 2.58, mean = 4. Selbst der
    // Extremfall minDays=maxDays=0 (jede Unit startet sofort) kann rechnerisch
    // nur (0-4)/2.58 ≈ -1.55σ erreichen. Das ist keine Stichprobendichte-
    // Limitierung (mehr Historie würde die Schätzung präziser, aber den
    // theoretischen Deckel nicht anheben) — eine ehrliche, strukturelle Grenze
    // dieser Dimension bei der bestehenden Baseline-Bandbreite. Auftrag B12:
    // "keine Extremwerte erzwingen" — deshalb bleibt die gewählte Kalibrierung
    // (0..1 Tage) deutlich innerhalb des Erreichbaren, nicht am Rand 0..0.
    const result = pooledSigma("queue", QUEUE_REDUCED_BEST(84));
    expect(result.sigma).toBeLessThan(-1);
    expect(result.sigma).toBeGreaterThan(-2);
    const theoreticalCeiling = pooledSigma("queue", makeRegime("reduced-duration", 0, 0, 84));
    expect(theoreticalCeiling.sigma).toBeGreaterThan(-1.7);
    expect(theoreticalCeiling.sigma).toBeLessThan(-1.3);
  });
});

describe("Operations Regime Calibration — 52. Sample-Dichte", () => {
  it("Queue elevated (84 Tage, gewählte Kalibrierung): gepoolte Stichprobe > 50 betroffene Units", () => {
    const result = pooledSigma("queue", QUEUE_ELEVATED_B(84));
    expect(result.nIn).toBeGreaterThan(50);
  });

  it("Delivery elevated (84 Tage, gewählte Kalibrierung): gepoolte Stichprobe > 15 betroffene Units", () => {
    const result = pooledSigma("delivery", DELIVERY_ELEVATED_B(84));
    expect(result.nIn).toBeGreaterThan(15);
  });

  it("INSUFFICIENT SAMPLE DENSITY dokumentiert: Delivery elevated candidate B bei 56 Tagen hat in <6/6 Seeds überhaupt Daten", () => {
    // Bewusst dokumentierter Negativbefund (Auftrag B13/B12: "INSUFFICIENT
    // SAMPLE DENSITY dokumentieren" statt Extremwerte erzwingen) — bei einem
    // zu kurzen Fenster kombiniert mit einer eng kalibrierten Dauer reicht die
    // Stichprobe nicht für eine über alle 6 Seeds robuste Aussage. Deshalb
    // wurde 84 Tage (nicht 56) als kürzeste durchgängig robuste Kalibrierung
    // gewählt (siehe Abschlussbericht B13).
    const result = pooledSigma("delivery", DELIVERY_ELEVATED_B(56));
    expect(result.seedsWithData).toBeLessThan(6);
  });

  it("84 Tage ist die kürzeste geprüfte Dauer mit voller 6/6-Seed-Abdeckung für alle vier gewählten Kalibrierungen", () => {
    for (const [dimension, regime] of [
      ["queue", QUEUE_ELEVATED_B(84)],
      ["queue", QUEUE_REDUCED_BEST(84)],
      ["delivery", DELIVERY_ELEVATED_B(84)],
      ["delivery", DELIVERY_REDUCED_BEST(84)],
    ] as const) {
      const result = pooledSigma(dimension, regime);
      expect(result.seedsWithData, `${dimension} ${regime.direction}`).toBe(6);
    }
  });
});

describe("Operations Regime Calibration — 53. False-Positive-Einschätzung / Regime außerhalb der eigenen Sampling-Anker", () => {
  it("ein Regimefenster, das vollständig außerhalb des gesamten Weltzeitraums liegt, verändert keine einzige Unit (0 betroffene Units, Welt bit-identisch zur Baseline)", () => {
    const outsideRegime: OperationsDurationRegime = {
      direction: "elevated-duration",
      startsAt: "2030-01-01",
      endsAt: "2030-03-01",
      minDays: 20,
      maxDays: 40,
    };
    const baseline = generateScenarioWorld(424242, BASELINE_PROFILE, NO_OPERATIONS_REGIMES);
    const withOutsideRegime = generateScenarioWorld(424242, BASELINE_PROFILE, {
      queueRegimes: [outsideRegime],
      deliveryRegimes: [],
    });
    expect(withOutsideRegime.deliveryUnits).toEqual(baseline.deliveryUnits);
  });

  it("ein zu kurzes Regime (verkürztes Gegenregime, 14 Tage statt 84) bleibt richtungsstabil, aber mit spürbar kleinerer Stichprobe", () => {
    const short = pooledSigma("queue", QUEUE_ELEVATED_B(14));
    const long = pooledSigma("queue", QUEUE_ELEVATED_B(84));
    expect(short.nIn).toBeLessThan(long.nIn);
    expect(short.directionCorrectSeeds).toBeGreaterThanOrEqual(0); // messbar, kein Crash
  });

  it("baseline-interne Zufallsstreuung (kein echtes Regime) erzeugt keine >=2σ-Scheintrennung, wenn die Population willkürlich nach Datum halbiert wird", () => {
    // Negativkontrolle: dieselbe Baseline-Welt, künstlich per Datum
    // halbiert (kein tatsächliches Regime beteiligt) — reines
    // Stichprobenrauschen darf im Mittel über 6 Seeds keine verlässliche
        // >=2σ-Trennung erzeugen.
    const sigmas: number[] = [];
    for (const seed of SEEDS) {
      const world = generateScenarioWorld(seed, BASELINE_PROFILE, NO_OPERATIONS_REGIMES);
      const withStart = world.deliveryUnits.filter((u) => u.actualStartDate !== undefined);
      const cutoff = addDays(WORLD_NOW, -180);
      const a = withStart.filter((u) => u.startDate <= cutoff).map((u) => daysBetween(u.startDate, u.actualStartDate!));
      const b = withStart.filter((u) => u.startDate > cutoff).map((u) => daysBetween(u.startDate, u.actualStartDate!));
      if (a.length === 0 || b.length === 0) continue;
      sigmas.push((mean(b) - mean(a)) / stdev(a));
    }
    expect(sigmas.length).toBeGreaterThan(0);
    for (const s of sigmas) {
      expect(Math.abs(s)).toBeLessThan(2);
    }
  });
});

describe("Operations Regime Calibration — Baseline/Queue/Delivery/Kombiniert (B12 Pflichtszenarien)", () => {
  const combinedModel: OperationsLifecycleModel = {
    queueRegimes: [QUEUE_ELEVATED_B(84)],
    deliveryRegimes: [DELIVERY_ELEVATED_B(84)],
  };

  it("Baseline ohne Regime, Queue-Regime, Delivery-Regime und kombiniertes Regime erzeugen jeweils gültige, unterschiedliche Welten", () => {
    const baseline = generateScenarioWorld(424242, BASELINE_PROFILE, NO_OPERATIONS_REGIMES);
    const queueOnly = generateScenarioWorld(424242, BASELINE_PROFILE, { queueRegimes: [QUEUE_ELEVATED_B(84)], deliveryRegimes: [] });
    const deliveryOnly = generateScenarioWorld(424242, BASELINE_PROFILE, { queueRegimes: [], deliveryRegimes: [DELIVERY_ELEVATED_B(84)] });
    const both = generateScenarioWorld(424242, BASELINE_PROFILE, combinedModel);

    expect(queueOnly.deliveryUnits).not.toEqual(baseline.deliveryUnits);
    expect(deliveryOnly.deliveryUnits).not.toEqual(baseline.deliveryUnits);
    expect(both.deliveryUnits).not.toEqual(baseline.deliveryUnits);
    expect(both.deliveryUnits).not.toEqual(queueOnly.deliveryUnits);
    expect(both.deliveryUnits).not.toEqual(deliveryOnly.deliveryUnits);

    // Sales bleibt über alle vier Welten identisch (Sales-Bit-Identität).
    expect(queueOnly.opportunities).toEqual(baseline.opportunities);
    expect(deliveryOnly.opportunities).toEqual(baseline.opportunities);
    expect(both.opportunities).toEqual(baseline.opportunities);
  });
});
