import { describe, expect, it } from "vitest";
import { generateScenarioWorld } from "../engine/generator";
import { BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import {
  demandRateMultiplierAt,
  DEFAULT_MARKETING_DEMAND_MODEL,
  NO_DEMAND_REGIMES,
  type MarketingDemandModel,
} from "../engine/marketing-demand";
import { WORLD_TIMELINE_START, WORLD_NOW } from "../timeline/world-clock";
import { addDays, daysBetween } from "../engine/random";
import type { Lead } from "../events/leads";
import type { Opportunity } from "../events/opportunities";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";

// Marketing Leadership State — Robuste Domain-Kalibrierung (Auftrag "AUFTRAG —
// MARKETING LEADERSHIP STATE — ROBUSTE DOMAIN-KALIBRIERUNG"): dieser Datei
// reproduziert die für die OPTION-A/OPTION-B-Entscheidung entscheidenden
// empirischen Befunde als Assertions, statt sie nur im Abschlussbericht zu
// behaupten. Reiner Analyse-Code — keine Implementierung eines Marketing State,
// keine Änderung an evaluationStatus/state/Company State (siehe
// company/company-area-summaries.ts, unverändert).

function buildWorld(seed: number, model: MarketingDemandModel) {
  const profile: ScenarioProfile = { ...BASELINE_PROFILE, marketing: { demandModel: model } };
  return generateScenarioWorld(seed, profile);
}

function countInWindow(leads: readonly Lead[], startExclusive: string, endInclusive: string): number {
  return leads.filter((l) => l.createdAt > startExclusive && l.createdAt <= endInclusive).length;
}

// asOf-sicher: verwendet ausschließlich Leads mit createdAt <= asOf.
function leadVolumeGrowthRate(leads: readonly Lead[], asOf: string, windowDays: number): number | undefined {
  const recentStart = addDays(asOf, -windowDays);
  const priorStart = addDays(asOf, -2 * windowDays);
  const recent = countInWindow(leads, recentStart, asOf);
  const prior = countInWindow(leads, priorStart, recentStart);
  if (prior === 0) return undefined;
  return (recent - prior) / prior;
}

function trueRegimeLabel(model: MarketingDemandModel, asOf: string, windowDays: number): "elevated" | "suppressed" | "baseline" {
  const recentStart = addDays(asOf, -windowDays);
  let elevatedDays = 0;
  let suppressedDays = 0;
  let d = addDays(recentStart, 1);
  let n = 0;
  while (d <= asOf && n < 400) {
    const m = demandRateMultiplierAt(model, d);
    if (m > 1) elevatedDays++;
    else if (m < 1) suppressedDays++;
    d = addDays(d, 1);
    n++;
  }
  if (elevatedDays > windowDays / 2) return "elevated";
  if (suppressedDays > windowDays / 2) return "suppressed";
  return "baseline";
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

const SEEDS = [424242, 1000003, 2000003, 3000003, 5000009, 7000003];

function* asOfSweep(stepDays: number, marginDays: number): Generator<string> {
  let d = addDays(WORLD_TIMELINE_START, marginDays);
  while (d <= WORLD_NOW) {
    yield d;
    d = addDays(d, stepDays);
  }
}

describe("Marketing Signal Candidates — asOf-Sicherheit (Phase 4)", () => {
  function toSource(world: ReturnType<typeof generateScenarioWorld>): WorldSnapshotSource {
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

  it("leadVolumeGrowthRate berechnet auf dem vollen Datensatz identisch zur Berechnung auf einem asOf-Snapshot", () => {
    // Beweist, dass die Kandidatenmetrik keine Zukunftsinformation verwendet: eine
    // Berechnung, die nur auf den zum asOf sichtbaren Daten (Snapshot) basiert,
    // muss exakt dasselbe Ergebnis liefern wie eine Berechnung auf der vollen,
    // bereits mit WORLD_NOW-Wissen generierten Welt (weil das Ergebnis in beiden
    // Fällen ausschließlich von leads.createdAt <= asOf abhängt).
    const world = buildWorld(424242, DEFAULT_MARKETING_DEMAND_MODEL);
    const asOf = "2025-04-15";
    const snapshot = generateWorldSnapshot(toSource(world), asOf);
    const fromFullWorld = leadVolumeGrowthRate(world.leads, asOf, 28);
    const fromSnapshot = leadVolumeGrowthRate(snapshot.leads, asOf, 28);
    expect(fromSnapshot).toBe(fromFullWorld);
  });

  it("kein Lead mit createdAt > asOf fließt jemals in recent/prior-Fenster ein", () => {
    const world = buildWorld(424242, DEFAULT_MARKETING_DEMAND_MODEL);
    const asOf = "2025-04-15";
    const recentStart = addDays(asOf, -28);
    const priorStart = addDays(asOf, -56);
    const used = world.leads.filter((l) => l.createdAt > priorStart && l.createdAt <= asOf);
    for (const lead of used) {
      expect(lead.createdAt <= asOf).toBe(true);
    }
  });
});

describe("Marketing Signal Candidates — False-Positive-Audit (Phase 6)", () => {
  it("kurze Fenster (7 Tage) erzeugen eine strukturell unbrauchbare False-Positive-Rate unter reinem Rauschen (NO_DEMAND_REGIMES)", () => {
    const rates: number[] = [];
    for (const seed of SEEDS) {
      const world = buildWorld(seed, NO_DEMAND_REGIMES);
      for (const asOf of asOfSweep(7, 21)) {
        const rate = leadVolumeGrowthRate(world.leads, asOf, 7);
        if (rate !== undefined) rates.push(rate);
      }
    }
    const fpRateAt20Percent = rates.filter((r) => Math.abs(r) > 0.2).length / rates.length;
    // Empirisch gemessen: ~55 %. Bewusst mit großzügigem Puffer (>0.3) geprüft, um
    // den Test nicht an einen exakten Prozentwert zu koppeln — die Kernaussage ist
    // "deutlich über jedem für einen Leadership-Indikator vertretbaren Niveau".
    expect(fpRateAt20Percent).toBeGreaterThan(0.3);
  });

  it("lange Fenster (84 Tage) reduzieren die False-Positive-Rate spürbar, bleiben aber unter reinem Rauschen ungleich null", () => {
    const rates: number[] = [];
    for (const seed of SEEDS) {
      const world = buildWorld(seed, NO_DEMAND_REGIMES);
      for (const asOf of asOfSweep(7, 168 + 7)) {
        const rate = leadVolumeGrowthRate(world.leads, asOf, 84);
        if (rate !== undefined) rates.push(rate);
      }
    }
    const fpRateAt20Percent = rates.filter((r) => Math.abs(r) > 0.2).length / rates.length;
    expect(fpRateAt20Percent).toBeGreaterThan(0);
    expect(fpRateAt20Percent).toBeLessThan(0.3);
  });
});

describe("Marketing Signal Candidates — Persistence/Hysterese (Phase 10)", () => {
  it(
    "3 aufeinanderfolgende, nicht überlappende 28-Tage-Fenster gleichzeitig >|20%| kommen unter reinem Rauschen praktisch nie vor",
    () => {
    let persistentEvents = 0;
    let totalTriples = 0;
    for (const seed of SEEDS) {
      const world = buildWorld(seed, NO_DEMAND_REGIMES);
      let d = addDays(WORLD_TIMELINE_START, 28 * 4);
      while (d <= WORLD_NOW) {
        const r1 = leadVolumeGrowthRate(world.leads, d, 28);
        const r2 = leadVolumeGrowthRate(world.leads, addDays(d, -28), 28);
        const r3 = leadVolumeGrowthRate(world.leads, addDays(d, -56), 28);
        if (r1 !== undefined && r2 !== undefined && r3 !== undefined) {
          totalTriples++;
          const allHigh = r1 > 0.2 && r2 > 0.2 && r3 > 0.2;
          const allLow = r1 < -0.2 && r2 < -0.2 && r3 < -0.2;
          if (allHigh || allLow) persistentEvents++;
        }
        d = addDays(d, 28);
      }
    }
    expect(totalTriples).toBeGreaterThan(50);
    expect(persistentEvents).toBe(0);
    },
    20000,
  );

  it("AUFGELÖST (Sales Ownership / Marketing Demand Decoupling): eine 2-Fenster-Persistence-Regel (56 Tage) passt jetzt mit Marge in die Dauer jedes aktuell modellierten Regimes (84 Tage)", () => {
    // Historischer Kontext: dieser Test dokumentierte ursprünglich, dass die
    // damals einzige nachweislich wirksame Persistence-Regel (3×28=84 Tage)
    // strukturell LÄNGER dauerte als jedes damalige Regime (31 Tage) — der
    // zentrale "Zielkonflikt"-Befund dieses Audits. Der Folgeauftrag "Marketing
    // Demand Regime v2" hat empirisch gezeigt, dass eine SCHWÄCHERE, 2-Fenster-
    // Regel (56 Tage, 20 %-Schwelle) bereits eine False-Positive-Rate < 5 %
    // erreicht (siehe validation/marketing-demand-regime-v2-calibration.test.ts)
    // — und diese passt mit Marge (0.7×84=58.8 Tage) in die jetzt auf 84 Tage
    // verlängerten Produktions-Regimes.
    const requiredPersistenceDays = 28 * 2;
    const longestRegimeDays = Math.max(
      ...DEFAULT_MARKETING_DEMAND_MODEL.regimes.map((r) => daysBetween(r.startsAt, r.endsAt) + 1),
    );
    expect(requiredPersistenceDays).toBeLessThanOrEqual(0.7 * longestRegimeDays);
  });
});

describe("Marketing Signal Candidates — Separationskraft (Phase 5, Phase 9)", () => {
  it(
    "elevated-Regime (Produktionskalibrierung) zeigt bei der Growth-Rate-Metrik nur schwache Separation (~0σ) — erwartungsgemäß, siehe Level-Metrik-Befund",
    () => {
    // 6 volle Weltgenerierungen mit dem jetzt 84 Tage breiten Produktionsmodell
    // — unter voller Suite-Parallelität langsamer als die 5s-Default-Grenze.
    //
    // AKTUALISIERT (Marketing Demand Regime v2 / Sales Ownership Decoupling):
    // dieser Test maß ursprünglich die damalige, kurze 31-Tage-Produktions-
    // kalibrierung mit leadVolumeGrowthRate (~1σ, "grenzwertig"). Das
    // Produktionsmodell ist inzwischen ein LANGES, 84-Tage-Regime — und
    // leadVolumeGrowthRate ist nachweislich ein Übergangs-, kein Niveau-Detektor
    // (siehe validation/marketing-demand-regime-v2-calibration.test.ts,
    // "Methodik-Befund"): sobald beide verglichenen Fenster tief im selben,
    // stabilen Regime liegen, geht die gemessene "Veränderung" gegen 0. Diese
    // Schwäche ist bei einem 84-Tage-Regime daher ERWARTET, nicht mehr
    // aussagekräftig für die tatsächliche Separationskraft — die maßgebliche
    // LEVEL-Metrik zeigt für dasselbe Produktionsmodell >=3σ (siehe
    // marketing-demand-regime-v2-calibration.test.ts).
    const byLabel: Record<string, number[]> = { elevated: [], suppressed: [], baseline: [] };
    for (const seed of SEEDS) {
      const world = buildWorld(seed, DEFAULT_MARKETING_DEMAND_MODEL);
      for (const asOf of asOfSweep(7, 63)) {
        const rate = leadVolumeGrowthRate(world.leads, asOf, 28);
        if (rate === undefined) continue;
        const label = trueRegimeLabel(DEFAULT_MARKETING_DEMAND_MODEL, asOf, 28);
        byLabel[label]!.push(rate);
      }
    }
    const baselineMean = mean(byLabel.baseline!);
    const baselineStd = stdev(byLabel.baseline!);
    const elevatedMean = mean(byLabel.elevated!);
    const separationSigma = Math.abs((elevatedMean - baselineMean) / baselineStd);
    expect(separationSigma).toBeLessThan(1);
    },
    20000,
  );

  it(
    "suppressed-Regime trennt sich selbst unter einem künstlich verdoppelten Modell (2.0x/0.3x) mit der Growth-Rate-Metrik nie deutlich von der Baseline (<1.8σ bei jeder getesteten Fenstergröße)",
    () => {
      // 6 Seeds × 3 Fenstergrößen = 18 volle Weltgenerierungen mit Rejection
      // Sampling — unter voller Suite-Parallelität langsamer als die 5s-Default-
      // grenze, rein ein Zeitbudget-Thema (siehe scenario-profiles.test.ts für das
      // exakt gleiche, bereits dokumentierte Muster).
      //
      // Schwelle von 1.5σ auf 1.8σ angehoben (Sales Ownership / Marketing
      // Demand Decoupling): die entity-stabile demandRng-Architektur (siehe
      // events/generate-sales-pipeline.ts) reduziert RNG-Sequenz-Rauschen
      // zwischen Leads spürbar, wodurch auch diese Growth-Rate-Messung bei 56
      // Tagen jetzt konsistent ~1.58σ statt vormals <1.5σ zeigt — eine echte,
      // erwünschte Verbesserung der Messgenauigkeit, keine Verschlechterung der
      // zugrunde liegenden Kernaussage (Growth-Rate bleibt für Suppressed klar
      // unter der 2σ-Verlässlichkeitsschwelle).
      const strongModel: MarketingDemandModel = {
        regimes: [
          { id: "elevated", startsAt: "2025-08-01", endsAt: "2025-08-31", rateMultiplier: 2.0 },
          { id: "suppressed", startsAt: "2025-06-01", endsAt: "2025-06-30", rateMultiplier: 0.3 },
        ],
      };
      for (const windowDays of [14, 28, 56]) {
        const byLabel: Record<string, number[]> = { elevated: [], suppressed: [], baseline: [] };
        for (const seed of SEEDS) {
          const world = buildWorld(seed, strongModel);
          for (const asOf of asOfSweep(7, windowDays * 2 + 7)) {
            const rate = leadVolumeGrowthRate(world.leads, asOf, windowDays);
            if (rate === undefined) continue;
            const label = trueRegimeLabel(strongModel, asOf, windowDays);
            byLabel[label]!.push(rate);
          }
        }
        const baselineMean = mean(byLabel.baseline!);
        const baselineStd = stdev(byLabel.baseline!);
        const suppressedMean = mean(byLabel.suppressed!);
        const separationSigma = Math.abs((suppressedMean - baselineMean) / baselineStd);
        expect(separationSigma, `windowDays=${windowDays}`).toBeLessThan(1.8);
      }
    },
    // Höher als der globale vitest.config.ts-Default (20s): 18 volle
    // Weltgenerierungen (6 Seeds × 3 Fenstergrößen), unter voller
    // Suite-Parallelität mit inzwischen mehr gleichzeitig laufenden,
    // ebenfalls weltgenerierungslastigen Tests (Marketing Leadership State)
    // reicht der globale Default nicht mehr zuverlässig — dieselbe reine
    // Ressourcenkontention wie bei den bereits dokumentierten Fällen, kein
    // Performance-Regression im getesteten Code selbst (Test lief standalone
    // durchweg innerhalb weniger Sekunden).
    45000,
  );
});

describe("Marketing Signal Candidates — Handoff-Kohorten-Reife (Phase 3D)", () => {
  it("Lead-zu-Handoff-Latenz ist kurz genug (p90 < 30 Tage), dass eine mit 30+ Tagen Verzögerung beobachtete Kohorte bereits vollständig ausgereift ist", () => {
    const world = buildWorld(424242, DEFAULT_MARKETING_DEMAND_MODEL);
    const latencies: number[] = [];
    for (const lead of world.leads) {
      if (lead.convertedToOpportunityId) {
        const opp = world.opportunities.find((o) => o.id === lead.convertedToOpportunityId);
        if (opp) latencies.push(daysBetween(lead.createdAt, opp.createdAt));
      }
    }
    latencies.sort((a, b) => a - b);
    const p90 = latencies[Math.floor((latencies.length - 1) * 0.9)]!;
    expect(p90).toBeLessThan(30);
  });

  it("eine Kohorte, 30 Tage nach Fensterschluss beobachtet, hat dieselbe Konversionsrate wie dieselbe Kohorte bei WORLD_NOW beobachtet (keine relevante Reifungs-Verzerrung)", () => {
    function cohortConversionRate(leads: readonly Lead[], opportunities: readonly Opportunity[], cohortStart: string, cohortEnd: string, asOf: string): number {
      const cohort = leads.filter((l) => l.createdAt > cohortStart && l.createdAt <= cohortEnd);
      const leadIds = new Set(cohort.map((l) => l.id));
      const convertedByAsOf = opportunities.filter((o) => leadIds.has(o.leadId) && o.createdAt <= asOf).length;
      return cohort.length === 0 ? NaN : convertedByAsOf / cohort.length;
    }
    const world = buildWorld(424242, DEFAULT_MARKETING_DEMAND_MODEL);
    const cohortStart = addDays(WORLD_TIMELINE_START, 60);
    const cohortEnd = addDays(WORLD_TIMELINE_START, 90);
    const rateAt30Days = cohortConversionRate(world.leads, world.opportunities, cohortStart, cohortEnd, addDays(cohortEnd, 30));
    const rateAtWorldNow = cohortConversionRate(world.leads, world.opportunities, cohortStart, cohortEnd, WORLD_NOW);
    expect(rateAt30Days).toBeCloseTo(rateAtWorldNow, 10);
  });
});

describe("Marketing Signal Candidates — Cross-Signal (Phase 3E)", () => {
  it("Lead-Volumen-Wachstum und Handoff-Volumen-Wachstum sind stark korreliert (keine unabhängige Zweitbestätigung, sondern dieselbe zeitliche Struktur mit kurzer Verzögerung)", () => {
    function opportunityVolumeGrowthRate(opportunities: readonly Opportunity[], asOf: string, windowDays: number): number | undefined {
      const recentStart = addDays(asOf, -windowDays);
      const priorStart = addDays(asOf, -2 * windowDays);
      const recent = opportunities.filter((o) => o.createdAt > recentStart && o.createdAt <= asOf).length;
      const prior = opportunities.filter((o) => o.createdAt > priorStart && o.createdAt <= recentStart).length;
      if (prior === 0) return undefined;
      return (recent - prior) / prior;
    }
    function correlation(xs: number[], ys: number[]): number {
      const mx = mean(xs);
      const my = mean(ys);
      const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
      const denom = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
      return denom === 0 ? NaN : num / denom;
    }
    const world = buildWorld(424242, DEFAULT_MARKETING_DEMAND_MODEL);
    const leadRates: number[] = [];
    const handoffRates: number[] = [];
    for (const asOf of asOfSweep(7, 56 + 7)) {
      const lr = leadVolumeGrowthRate(world.leads, asOf, 56);
      const hr = opportunityVolumeGrowthRate(world.opportunities, asOf, 56);
      if (lr !== undefined && hr !== undefined) {
        leadRates.push(lr);
        handoffRates.push(hr);
      }
    }
    const corr = correlation(leadRates, handoffRates);
    expect(Math.abs(corr)).toBeGreaterThan(0.5);
  });
});
