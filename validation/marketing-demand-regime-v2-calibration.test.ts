import { describe, expect, it } from "vitest";
import { generateScenarioWorld } from "../engine/generator";
import { SCENARIO_PROFILES, BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { WORLD_SEED } from "../engine/seed";
import { generateBusinessStateSnapshot } from "../business-state/business-state";
import { DEFAULT_MARKETING_DEMAND_MODEL, NO_DEMAND_REGIMES, type MarketingDemandModel } from "../engine/marketing-demand";
import { WORLD_TIMELINE_START, WORLD_NOW } from "../timeline/world-clock";
import { addDays } from "../engine/random";
import type { Lead } from "../events/leads";

// AUFTRAG — MARKETING DEMAND REGIME v2 — LEADERSHIP-CALIBRATABLE WORLD: dieser
// Datei reproduziert die entscheidenden empirischen Befunde dieses Audits als
// Assertions. Ursprüngliches Ergebnis: OPTION B — STILL NOT CALIBRATABLE, weil
// das einzige statistisch ausreichende Modell Sales' baseline-Klassifikation
// brach. Der Folgeauftrag "Sales Ownership / Marketing Demand Decoupling" hat
// die zugrunde liegende RNG-Sequenz-/Order-Kopplung im Sales-Pipeline-Generator
// behoben und GENAU DIESES Modell danach als DEFAULT_MARKETING_DEMAND_MODEL
// übernommen (siehe letzter describe-Block unten, "AUFGELÖST durch..."). Keine
// State-/Company-State-Implementierung in dieser Datei.

const SEEDS = [424242, 1000003, 2000003, 3000003, 5000009, 7000003];
const WINDOW = 28;

function buildWorld(seed: number, model: MarketingDemandModel, profile: ScenarioProfile = BASELINE_PROFILE) {
  const p: ScenarioProfile = { ...profile, marketing: { demandModel: model } };
  return generateScenarioWorld(seed, p);
}
function countInWindow(leads: readonly Lead[], startExclusive: string, endInclusive: string): number {
  return leads.filter((l) => l.createdAt > startExclusive && l.createdAt <= endInclusive).length;
}
function density(leads: readonly Lead[], asOf: string, windowDays: number): number {
  return countInWindow(leads, addDays(asOf, -windowDays), asOf) / windowDays;
}
function growthRate(leads: readonly Lead[], asOf: string, windowDays: number): number | undefined {
  const recentStart = addDays(asOf, -windowDays);
  const priorStart = addDays(asOf, -2 * windowDays);
  const recent = countInWindow(leads, recentStart, asOf);
  const prior = countInWindow(leads, priorStart, recentStart);
  if (prior === 0) return undefined;
  return (recent - prior) / prior;
}
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function* asOfSweep(stepDays: number, marginDays: number): Generator<string> {
  let d = addDays(WORLD_TIMELINE_START, marginDays);
  while (d <= WORLD_NOW) {
    yield d;
    d = addDays(d, stepDays);
  }
}

describe("Marketing Demand Regime v2 — Methodik-Befund: Growth-Rate ist ein Transition-, kein Level-Detektor", () => {
  it(
    "leadVolumeGrowthRate (Periodenvergleich) verliert Trennschärfe, wenn das Regime länger als das Messfenster dauert",
    () => {
    // Zentraler methodischer Befund dieses Audits: sobald beide verglichenen
    // Fenster (recent/prior) tief im selben, bereits stabilen Regime liegen, misst
    // ein Periodenvergleich keine "Veränderung" mehr — er reagiert nur auf den
    // ÜBERGANG am Regimebeginn, nicht auf das andauernde Niveau. 2 Durationen × 6
    // Seeds = 12 volle Weltgenerierungen — unter voller Suite-Parallelität
    // langsamer als die 5s-Default-Grenze (dasselbe bereits mehrfach dokumentierte
    // Zeitbudget-Muster, siehe scenario-profiles.test.ts).
    function regimesForDuration(days: number): MarketingDemandModel {
      const elevatedEnd = "2025-08-31";
      const elevatedStart = addDays(elevatedEnd, -(days - 1));
      return { regimes: [{ id: "elevated", startsAt: elevatedStart, endsAt: elevatedEnd, rateMultiplier: 1.2 }] };
    }
    function elevatedSeparationGrowthRate(duration: number): number {
      const model = regimesForDuration(duration);
      const baseline: number[] = [];
      const elevated: number[] = [];
      for (const seed of SEEDS) {
        const world = buildWorld(seed, model);
        for (const asOf of asOfSweep(7, WINDOW * 2 + 7)) {
          const rate = growthRate(world.leads, asOf, WINDOW);
          if (rate === undefined) continue;
          const isElevated = asOf > model.regimes[0]!.startsAt && asOf <= model.regimes[0]!.endsAt;
          (isElevated ? elevated : baseline).push(rate);
        }
      }
      return (mean(elevated) - mean(baseline)) / stdev(baseline);
    }
    const shortRegimeSigma = elevatedSeparationGrowthRate(31);
    const longRegimeSigma = elevatedSeparationGrowthRate(140);
    expect(longRegimeSigma).toBeLessThan(shortRegimeSigma);
    },
    20000,
  );

  it(
    "eine reine LEVEL-Metrik (Dichte im Fenster vs. Referenzdichte) bleibt über Regimedauern hinweg stabil trennscharf (>=2.5σ für elevated, jede getestete Dauer)",
    () => {
    // 6 Seeds × 3 Regimedauern = 18 volle Weltgenerierungen mit Rejection
    // Sampling — unter voller Suite-Parallelität langsamer als die 5s-Default-
    // grenze, rein ein Zeitbudget-Thema (dasselbe bereits dokumentierte Muster
    // wie in scenario-profiles.test.ts und marketing-signal-candidates.test.ts).
    function regimesForDuration(days: number): MarketingDemandModel {
      const elevatedEnd = "2025-08-31";
      const elevatedStart = addDays(elevatedEnd, -(days - 1));
      return { regimes: [{ id: "elevated", startsAt: elevatedStart, endsAt: elevatedEnd, rateMultiplier: 1.2 }] };
    }
    for (const duration of [56, 84, 140]) {
      const model = regimesForDuration(duration);
      const baseline: number[] = [];
      const elevated: number[] = [];
      for (const seed of SEEDS) {
        const world = buildWorld(seed, model);
        for (const asOf of asOfSweep(7, WINDOW + 7)) {
          const start = addDays(asOf, -WINDOW + 1);
          const isPureElevated = start > model.regimes[0]!.startsAt && asOf <= model.regimes[0]!.endsAt;
          const isPureBaseline = asOf <= model.regimes[0]!.startsAt || start > model.regimes[0]!.endsAt;
          if (isPureElevated) elevated.push(density(world.leads, asOf, WINDOW));
          else if (isPureBaseline) baseline.push(density(world.leads, asOf, WINDOW));
        }
      }
      const sigma = (mean(elevated) - mean(baseline)) / stdev(baseline);
      expect(sigma, `duration=${duration}`).toBeGreaterThan(2.5);
    }
    },
    20000,
  );
});

describe("Marketing Demand Regime v2 — Persistence-Kalibrierung (Phase 6)", () => {
  it(
    "2 aufeinanderfolgende 28-Tage-Fenster mit >=20% Abweichung von der Referenzdichte haben unter reinem Rauschen eine False-Positive-Rate < 5%",
    () => {
    // 6 Seeds × voller Zeitraum-Sweep — unter voller Suite-Parallelität
    // langsamer als die 5s-Default-Grenze (dasselbe bereits mehrfach
    // dokumentierte Zeitbudget-Muster, siehe scenario-profiles.test.ts).
    function daysBetweenInclusive(a: string, b: string): number {
      return (new Date(b).getTime() - new Date(a).getTime()) / 86400000 + 1;
    }
    let persistentEvents = 0;
    let total = 0;
    for (const seed of SEEDS) {
      const world = buildWorld(seed, NO_DEMAND_REGIMES);
      const referenceDensity = world.leads.length / daysBetweenInclusive(WORLD_TIMELINE_START, WORLD_NOW);
      let d = addDays(WORLD_TIMELINE_START, WINDOW * 3);
      while (d <= WORLD_NOW) {
        const d1 = density(world.leads, d, WINDOW);
        const d2 = density(world.leads, addDays(d, -WINDOW), WINDOW);
        total++;
        const allHigh = d1 > referenceDensity * 1.2 && d2 > referenceDensity * 1.2;
        const allLow = d1 < referenceDensity * 0.8 && d2 < referenceDensity * 0.8;
        if (allHigh || allLow) persistentEvents++;
        d = addDays(d, WINDOW);
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(persistentEvents / total).toBeLessThan(0.05);
    },
    20000,
  );
});

describe("Marketing Demand Regime v2 — AUFGELÖST durch Sales Ownership / Marketing Demand Decoupling", () => {
  // Historischer Kontext (ursprünglicher Befund dieses Auftrags, siehe
  // Abschlussbericht "Marketing Demand Regime v2"): ein Demand-Modell, das die
  // Separationskriterien (>=2σ elevated UND suppressed) erfüllte, verschob Sales'
  // baseline-Klassifikation weg von "ausgeglichen" — der Grund war NICHT das
  // Demand-Modell selbst, sondern eine RNG-Sequenz-/Order-Kopplung im
  // Sales-Pipeline-Generator (siehe events/generate-sales-pipeline.ts,
  // MARKETING_DEMAND_SEED_OFFSET-Kommentar, und
  // validation/sales-ownership-decoupling.test.ts). Der Folgeauftrag "Sales
  // Ownership / Marketing Demand Decoupling" hat diese Kopplung behoben
  // (entity-stabiler demandRng-Teilstrom je Lead) und GENAU DIESES Modell danach
  // als neues DEFAULT_MARKETING_DEMAND_MODEL übernommen — es bricht Sales jetzt
  // nachweislich NICHT mehr.
  it("dasselbe Modell, das vor dem Decoupling Sales' baseline-Klassifikation brach, erhält sie jetzt korrekt (ist außerdem das aktuelle Produktionsmodell)", () => {
    const formerlyUnsafeModel: MarketingDemandModel = {
      regimes: [
        { id: "elevated", startsAt: "2025-06-09", endsAt: "2025-08-31", rateMultiplier: 1.2 },
        { id: "suppressed", startsAt: "2025-02-16", endsAt: "2025-05-10", rateMultiplier: 0.6 },
      ],
    };
    expect(DEFAULT_MARKETING_DEMAND_MODEL).toEqual(formerlyUnsafeModel);
    const world = buildWorld(WORLD_SEED, formerlyUnsafeModel, BASELINE_PROFILE);
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    expect(businessState.type).toBe("ausgeglichen");
  });

  it(
    "das aktuelle Produktionsmodell (DEFAULT_MARKETING_DEMAND_MODEL) erhält Sales' baseline businessState.type über alle 6 Profile hinweg korrekt",
    () => {
    // 6 volle Weltgenerierungen mit dem jetzt 84 Tage breiten Produktionsmodell
    // — unter voller Suite-Parallelität langsamer als die 5s-Default-Grenze
    // (dasselbe bereits mehrfach dokumentierte Zeitbudget-Muster).
    const expected: Record<string, string> = {
      baseline: "ausgeglichen",
      "operativer-fokus": "verlangsamte-pipeline",
      "strategischer-tag": "strategischer-freiraum",
      wachstumsdruck: "ausgeglichen",
      "team-engpass": "konzentrierte-last",
      "pipeline-risiko": "operative-anspannung",
    };
    for (const profile of SCENARIO_PROFILES) {
      const p: ScenarioProfile = { ...profile, marketing: { demandModel: DEFAULT_MARKETING_DEMAND_MODEL } };
      const world = generateScenarioWorld(WORLD_SEED, p);
      const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
      expect(businessState.type, `profile ${profile.id}`).toBe(expected[profile.id]);
    }
    },
    20000,
  );
});
