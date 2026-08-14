import { describe, expect, it } from "vitest";
import { createRng } from "./seed";
import {
  demandRateMultiplierAt,
  sampleDemandDrivenDate,
  NO_DEMAND_REGIMES,
  DEFAULT_MARKETING_DEMAND_MODEL,
  type MarketingDemandModel,
} from "./marketing-demand";

const MODEL: MarketingDemandModel = {
  regimes: [
    { id: "elevated", startsAt: "2025-08-01", endsAt: "2025-08-31", rateMultiplier: 2 },
    { id: "suppressed", startsAt: "2025-06-01", endsAt: "2025-06-30", rateMultiplier: 0.5 },
  ],
};

describe("demandRateMultiplierAt", () => {
  it("gibt 1 (Baseline) zurück, wenn kein Regime konfiguriert ist", () => {
    expect(demandRateMultiplierAt(NO_DEMAND_REGIMES, "2025-08-15")).toBe(1);
  });

  it("gibt 1 (Baseline) außerhalb jedes konfigurierten Regimes zurück", () => {
    expect(demandRateMultiplierAt(MODEL, "2025-05-01")).toBe(1);
    expect(demandRateMultiplierAt(MODEL, "2025-09-01")).toBe(1);
  });

  it("gibt den korrekten Multiplikator innerhalb eines Regimes zurück", () => {
    expect(demandRateMultiplierAt(MODEL, "2025-08-15")).toBe(2);
    expect(demandRateMultiplierAt(MODEL, "2025-06-15")).toBe(0.5);
  });

  // 5. Regime-Grenzen zeitlich korrekt (inklusive beide Enden).
  it("Regime-Grenzen sind inklusiv (startsAt und endsAt selbst gehören zum Regime)", () => {
    expect(demandRateMultiplierAt(MODEL, "2025-08-01")).toBe(2); // startsAt selbst
    expect(demandRateMultiplierAt(MODEL, "2025-08-31")).toBe(2); // endsAt selbst
    expect(demandRateMultiplierAt(MODEL, "2025-07-31")).toBe(1); // Tag vor startsAt
    expect(demandRateMultiplierAt(MODEL, "2025-09-01")).toBe(1); // Tag nach endsAt
  });
});

describe("sampleDemandDrivenDate", () => {
  // 1./2. Demand Model deterministisch, baseline demand reproduzierbar.
  it("ist deterministisch: gleicher Rng-Zustand erzeugt dasselbe Ergebnis", () => {
    const a = sampleDemandDrivenDate(createRng(42), MODEL, "2025-01-01", "2025-12-31");
    const b = sampleDemandDrivenDate(createRng(42), MODEL, "2025-01-01", "2025-12-31");
    expect(a).toBe(b);
  });

  it("liegt immer innerhalb von [earliestDate, latestDate]", () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      const date = sampleDemandDrivenDate(rng, MODEL, "2025-01-01", "2025-12-31");
      expect(date >= "2025-01-01").toBe(true);
      expect(date <= "2025-12-31").toBe(true);
    }
  });

  it("gibt earliestDate zurück, wenn earliestDate === latestDate (kein Spielraum)", () => {
    const rng = createRng(1);
    expect(sampleDemandDrivenDate(rng, MODEL, "2025-08-15", "2025-08-15")).toBe("2025-08-15");
  });

  it("terminiert garantiert auch bei extremen Multiplikatoren (kein unbegrenzter Loop)", () => {
    const extreme: MarketingDemandModel = {
      regimes: [{ id: "elevated", startsAt: "2025-08-01", endsAt: "2025-08-02", rateMultiplier: 1000 }],
    };
    const rng = createRng(3);
    const date = sampleDemandDrivenDate(rng, extreme, "2024-06-01", "2025-09-01");
    expect(typeof date).toBe("string");
  });

  // 3./4./23. Statistische Validierung über mehrere Seeds: elevated > baseline > suppressed.
  it("elevated > baseline > suppressed — Dichte-Ordnung ist über mehrere unabhängige Seeds hinweg stabil", () => {
    const seeds = [1, 424242, 999983, 123456789, 55];
    for (const seed of seeds) {
      const rng = createRng(seed);
      const samples = Array.from({ length: 2000 }, () =>
        sampleDemandDrivenDate(rng, MODEL, "2025-01-01", "2025-12-31"),
      );
      const inWindow = (start: string, end: string) =>
        samples.filter((d) => d >= start && d <= end).length;
      const elevatedDays = 31;
      const suppressedDays = 30;
      const baselineDays = 365 - elevatedDays - suppressedDays;
      const elevatedDensity = inWindow("2025-08-01", "2025-08-31") / elevatedDays;
      const suppressedDensity = inWindow("2025-06-01", "2025-06-30") / suppressedDays;
      const baselineCount = samples.length - inWindow("2025-08-01", "2025-08-31") - inWindow("2025-06-01", "2025-06-30");
      const baselineDensity = baselineCount / baselineDays;

      expect(elevatedDensity, `seed ${seed}: elevated > baseline`).toBeGreaterThan(baselineDensity);
      expect(baselineDensity, `seed ${seed}: baseline > suppressed`).toBeGreaterThan(suppressedDensity);
    }
  });
});

describe("DEFAULT_MARKETING_DEMAND_MODEL", () => {
  it("beide Regime-Fenster liegen vollständig innerhalb [WORLD_TIMELINE_START, WORLD_NOW]", () => {
    for (const regime of DEFAULT_MARKETING_DEMAND_MODEL.regimes) {
      expect(regime.startsAt >= "2024-06-01").toBe(true);
      expect(regime.endsAt <= "2025-09-01").toBe(true);
      expect(regime.startsAt <= regime.endsAt).toBe(true);
    }
  });

  it("Regime-Fenster überlappen sich nicht", () => {
    const regimes = [...DEFAULT_MARKETING_DEMAND_MODEL.regimes].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (let i = 1; i < regimes.length; i++) {
      expect(regimes[i]!.startsAt > regimes[i - 1]!.endsAt).toBe(true);
    }
  });
});
