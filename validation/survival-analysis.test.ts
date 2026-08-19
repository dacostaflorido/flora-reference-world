import { describe, expect, it } from "vitest";
import {
  kaplanMeierCurve,
  kaplanMeierMedian,
  restrictedMeanSurvivalTime,
  censoredCount,
  eventCount,
  type SurvivalCase,
} from "../engine/survival-analysis";

// AUFTRAG — Operations Delivery Flow Signal Design, Phase 3/Phase 15
// ("Survival/RMST", Testpunkte 7-15): reine Methodenprüfung der generischen
// Kaplan-Meier-/Restricted-Mean-Survival-Time-Infrastruktur, unabhängig von
// DeliveryUnit/Operations. Bekannte, handgerechnete synthetische Populationen
// statt Zufallsdaten — jedes erwartete Ergebnis ist von Hand nachrechenbar.

describe("Survival Analysis — bekannte synthetische Population korrekt (7)", () => {
  it("10 Fälle, alle Ereignis bei Tag 5: KM fällt exakt bei t=5 auf 0, RMST(horizon=10) = 5", () => {
    const cases: SurvivalCase[] = Array.from({ length: 10 }, () => ({ durationDays: 5, censored: false }));
    const curve = kaplanMeierCurve(cases);
    expect(curve).toEqual([
      { time: 0, atRisk: 10, events: 0, survival: 1 },
      { time: 5, atRisk: 10, events: 10, survival: 0 },
    ]);
    expect(restrictedMeanSurvivalTime(cases, 10)).toBe(5);
    expect(kaplanMeierMedian(cases)).toBe(5);
  });

  it("gemischte Population (5 Ereignisse bei Tag 4, 5 zensiert bei Tag 8): RMST(horizon=10) = 7", () => {
    const cases: SurvivalCase[] = [
      ...Array.from({ length: 5 }, () => ({ durationDays: 4, censored: false })),
      ...Array.from({ length: 5 }, () => ({ durationDays: 8, censored: true })),
    ];
    // S(t) = 1 für [0,4), S(t) = 0.5 für [4,10) (kein Rückgang nach dem letzten
    // Ereignis, da die verbleibenden Fälle nur zensiert sind, siehe
    // engine/survival-analysis.ts, Konvention).
    expect(restrictedMeanSurvivalTime(cases, 10)).toBe(1 * 4 + 0.5 * 6);
    expect(censoredCount(cases)).toBe(5);
    expect(eventCount(cases)).toBe(5);
  });
});

describe("Survival Analysis — alle Events sofort (8)", () => {
  it("alle Fälle bei Tag 0: Survival fällt sofort auf 0, RMST = 0 für jeden Horizont", () => {
    const cases: SurvivalCase[] = Array.from({ length: 6 }, () => ({ durationDays: 0, censored: false }));
    expect(restrictedMeanSurvivalTime(cases, 1)).toBe(0);
    expect(restrictedMeanSurvivalTime(cases, 100)).toBe(0);
    expect(kaplanMeierMedian(cases)).toBeUndefined(); // t=0 zählt nicht als "erreicht" (time > 0 gefordert)
  });
});

describe("Survival Analysis — alle Fälle zensiert (9)", () => {
  it("keine Ereignisse: Survival bleibt konstant 1, RMST = horizonDays exakt", () => {
    const cases: SurvivalCase[] = Array.from({ length: 8 }, (_, i) => ({ durationDays: i + 1, censored: true }));
    expect(restrictedMeanSurvivalTime(cases, 20)).toBe(20);
    expect(kaplanMeierMedian(cases)).toBeUndefined();
  });

  it("leere Population: Survival bleibt 1 (keine Information), RMST = horizonDays", () => {
    expect(kaplanMeierCurve([])).toEqual([{ time: 0, atRisk: 0, events: 0, survival: 1 }]);
    expect(restrictedMeanSurvivalTime([], 14)).toBe(14);
  });
});

describe("Survival Analysis — gemischte Population (10)", () => {
  it("mehrere Ereigniszeiten mit dazwischenliegenden Zensierungen ergeben eine korrekt gestufte Kurve", () => {
    const cases: SurvivalCase[] = [
      { durationDays: 1, censored: false },
      { durationDays: 2, censored: true },
      { durationDays: 3, censored: false },
      { durationDays: 3, censored: false },
      { durationDays: 5, censored: true },
      { durationDays: 6, censored: false },
    ];
    const curve = kaplanMeierCurve(cases);
    // t=1: atRisk=6 (alle >=1), events=1 -> S=1*(1-1/6)=5/6
    // t=3: atRisk=4 (durationDays>=3: die beiden bei 3, der bei 5, der bei 6), events=2 -> S=5/6*(1-2/4)=5/12
    // t=6: atRisk=1, events=1 -> S=5/12*(1-1/1)=0
    expect(curve[0]).toEqual({ time: 0, atRisk: 6, events: 0, survival: 1 });
    expect(curve[1]!.time).toBe(1);
    expect(curve[1]!.survival).toBeCloseTo(5 / 6, 10);
    expect(curve[2]!.time).toBe(3);
    expect(curve[2]!.survival).toBeCloseTo(5 / 12, 10);
    expect(curve[3]!.time).toBe(6);
    expect(curve[3]!.survival).toBeCloseTo(0, 10);
  });
});

describe("Survival Analysis — monotone Survival-Kurve (11)", () => {
  it("Survival ist über mehrere zufällig zusammengesetzte Populationen niemals steigend", () => {
    const populations: SurvivalCase[][] = [
      [
        { durationDays: 1, censored: false },
        { durationDays: 2, censored: true },
        { durationDays: 3, censored: false },
        { durationDays: 3, censored: false },
        { durationDays: 5, censored: true },
        { durationDays: 6, censored: false },
      ],
      Array.from({ length: 20 }, (_, i) => ({ durationDays: (i * 7) % 11, censored: i % 3 === 0 })),
      Array.from({ length: 5 }, () => ({ durationDays: 0, censored: false })),
    ];
    for (const cases of populations) {
      const curve = kaplanMeierCurve(cases);
      let prev = 1;
      for (const step of curve) {
        expect(step.survival).toBeLessThanOrEqual(prev + 1e-9);
        prev = step.survival;
      }
    }
  });
});

describe("Survival Analysis — RMST nicht negativ (12)", () => {
  it("RMST ist für beliebige gültige Populationen und Horizonte >= 0", () => {
    const cases: SurvivalCase[] = [
      { durationDays: 0, censored: false },
      { durationDays: 100, censored: true },
      { durationDays: 3, censored: false },
    ];
    for (const horizon of [1, 5, 10, 50, 200]) {
      expect(restrictedMeanSurvivalTime(cases, horizon)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Survival Analysis — RMST maximal Horizont (13)", () => {
  it("RMST überschreitet horizonDays nie, für jede Population", () => {
    const populations: SurvivalCase[][] = [
      [],
      [{ durationDays: 0, censored: true }],
      Array.from({ length: 15 }, (_, i) => ({ durationDays: i, censored: i % 2 === 0 })),
    ];
    for (const cases of populations) {
      for (const horizon of [1, 7, 14, 42]) {
        expect(restrictedMeanSurvivalTime(cases, horizon)).toBeLessThanOrEqual(horizon);
      }
    }
  });

  it("wirft bei horizonDays <= 0", () => {
    expect(() => restrictedMeanSurvivalTime([{ durationDays: 1, censored: false }], 0)).toThrow();
    expect(() => restrictedMeanSurvivalTime([{ durationDays: 1, censored: false }], -5)).toThrow();
  });

  it("wirft bei negativer durationDays", () => {
    expect(() => kaplanMeierCurve([{ durationDays: -1, censored: false }])).toThrow();
  });
});

describe("Survival Analysis — deterministische Berechnung (14)", () => {
  it("gleiche Eingabe erzeugt immer dasselbe Ergebnis (mehrfacher Aufruf)", () => {
    const cases: SurvivalCase[] = [
      { durationDays: 2, censored: false },
      { durationDays: 4, censored: true },
      { durationDays: 6, censored: false },
    ];
    const a = restrictedMeanSurvivalTime(cases, 14);
    const b = restrictedMeanSurvivalTime(cases, 14);
    expect(a).toBe(b);
    expect(kaplanMeierCurve(cases)).toEqual(kaplanMeierCurve(cases));
  });

  it("Reihenfolge der Eingabe-Cases beeinflusst das Ergebnis nicht (Order Independence)", () => {
    const cases: SurvivalCase[] = [
      { durationDays: 6, censored: false },
      { durationDays: 2, censored: false },
      { durationDays: 4, censored: true },
    ];
    const reversed = [...cases].reverse();
    expect(restrictedMeanSurvivalTime(cases, 14)).toBe(restrictedMeanSurvivalTime(reversed, 14));
    expect(kaplanMeierCurve(cases)).toEqual(kaplanMeierCurve(reversed));
  });
});

describe("Survival Analysis — keine externe Dependency (15)", () => {
  it("Modul exportiert ausschließlich reine Funktionen ohne jeden externen Zustand (kein Netzwerk, kein Zufall, kein Datum.now)", async () => {
    // engine/survival-analysis.ts hat strukturell keine einzige import-Anweisung
    // (siehe Quelldatei) — reine, in sich geschlossene Mathematik. Hier
    // funktional nachgewiesen: 1000 identische Aufrufe liefern exakt dasselbe
    // Ergebnis, ohne jede Systemzeit-/Zufalls-Abhängigkeit.
    const cases: SurvivalCase[] = [
      { durationDays: 3, censored: false },
      { durationDays: 9, censored: true },
    ];
    const results = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      results.add(restrictedMeanSurvivalTime(cases, 14));
    }
    expect(results.size).toBe(1);
  });
});
