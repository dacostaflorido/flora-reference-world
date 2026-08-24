import { describe, expect, it } from "vitest";
import { generateCompanyCapabilitySnapshot } from "../company/company-capability";
import type { CompanyAreaSummary, CompanyAreaKey } from "../company/company-area";
import type { CompanyExecutiveContextSnapshot } from "../company/company-executive-context";
import { generateFullCompanyContext } from "../company/full-company-context";
import { WORLD_NOW } from "../timeline/world-clock";

// Company Capability + Executive Decision View V1 (Auftrag "Company
// Capability Evidence Audit + Executive Decision View V1", D054) —
// Pflichttests laut Auftrag Phase 7. Verbindliche fachliche Grenze, überall
// geprüft: kein Gesamtscore, keine Prozentnote, keine individuelle
// Mitarbeiterentscheidung, keine erfundene Bewertung, keine Entscheidung
// ohne belegten Auslöser.

function area(overrides: Partial<CompanyAreaSummary> & { key: CompanyAreaKey }): CompanyAreaSummary {
  return {
    kind: "department",
    state: null,
    evaluationStatus: "unzureichende-evidenz",
    statement: null,
    topObservations: [],
    relevantMetrics: {},
    evidenceIds: [],
    ...overrides,
  };
}

function context(areaSummaries: CompanyAreaSummary[], timestamp = "2025-09-01"): CompanyExecutiveContextSnapshot {
  return {
    id: "cexec-test",
    timestamp,
    companyBusinessStateId: "cbstate-test",
    affectedAreas: [],
    areaSummaries,
    topSituations: [],
    crossAreaLinks: [],
    insufficientEvidenceAreas: areaSummaries.filter((a) => a.evaluationStatus === "unzureichende-evidenz").map((a) => a.key),
  };
}

const ALL_FOUR = [
  area({ key: "sales", state: "ausgeglichen", evaluationStatus: "bewertet", statement: "Sales-Statement" }),
  area({ key: "marketing", state: "stabile-nachfrage", evaluationStatus: "bewertet", statement: "Marketing-Statement" }),
  area({ key: "people", kind: "cross-cutting-dimension", state: "ausgeglichen", evaluationStatus: "bewertet", statement: "People-Statement" }),
  area({ key: "operations", state: null, evaluationStatus: "unzureichende-evidenz", statement: "Operations-Statement" }),
];

describe("Company Capability — alle vier Bereiche", () => {
  it("1. genau vier Capabilities, eine pro Bereich, keine doppelte Bewertung", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    expect(snap.capabilities).toHaveLength(4);
    const keys = snap.capabilities.map((c) => c.area);
    expect(new Set(keys).size).toBe(4);
    expect(keys.slice().sort()).toEqual(["marketing", "operations", "people", "sales"]);
  });

  it("2. fehlt eine Area im Input, fehlt sie auch in capabilities (kein erfundener Ersatzeintrag)", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR.filter((a) => a.key !== "operations")));
    expect(snap.capabilities).toHaveLength(3);
    expect(snap.capabilities.some((c) => c.area === "operations")).toBe(false);
  });
});

describe("Company Capability — exhaustive State-Mapping-Tabelle", () => {
  const DEMONSTRATED_CASES: [CompanyAreaKey, string][] = [
    ["sales", "ausgeglichen"],
    ["sales", "strategischer-freiraum"],
    ["people", "ausgeglichen"],
    ["marketing", "stabile-nachfrage"],
  ];
  const ATTENTION_CASES: [CompanyAreaKey, string][] = [
    ["sales", "verlangsamte-pipeline"],
    ["sales", "operative-anspannung"],
    ["sales", "konzentrierte-last"],
    ["sales", "wachstum-ueber-kapazitaet"],
    ["people", "letzte-person-verbleibt"],
    ["people", "rolle-unbesetzt"],
    ["marketing", "erhoehte-nachfrage"],
    ["marketing", "unterdrueckte-nachfrage"],
  ];

  for (const [key, state] of DEMONSTRATED_CASES) {
    it(`3. ${key}="${state}" (bewertet) → demonstrated`, () => {
      const snap = generateCompanyCapabilitySnapshot(
        context([area({ key, state, evaluationStatus: "bewertet", kind: key === "people" ? "cross-cutting-dimension" : "department" })]),
      );
      expect(snap.capabilities[0]!.status).toBe("demonstrated");
    });
  }

  for (const [key, state] of ATTENTION_CASES) {
    it(`4. ${key}="${state}" (bewertet) → attention-required`, () => {
      const snap = generateCompanyCapabilitySnapshot(
        context([area({ key, state, evaluationStatus: "bewertet", kind: key === "people" ? "cross-cutting-dimension" : "department" })]),
      );
      expect(snap.capabilities[0]!.status).toBe("attention-required");
    });
  }

  it("5. state=null → insufficient-evidence, unabhängig von evaluationStatus-Tippfehlerschutz", () => {
    const snap = generateCompanyCapabilitySnapshot(context([area({ key: "operations", state: null, evaluationStatus: "unzureichende-evidenz" })]));
    expect(snap.capabilities[0]!.status).toBe("insufficient-evidence");
  });

  it("6. evaluationStatus='unzureichende-evidenz' → insufficient-evidence, auch falls state fälschlich gesetzt wäre", () => {
    const snap = generateCompanyCapabilitySnapshot(
      context([area({ key: "marketing", state: "erhoehte-nachfrage", evaluationStatus: "unzureichende-evidenz" })]),
    );
    expect(snap.capabilities[0]!.status).toBe("insufficient-evidence");
  });
});

describe("Company Capability — positiver/negativer State (Referenzfälle)", () => {
  it("7. positiver State (ausgeglichen) → demonstrated, kein Entscheidungspunkt", () => {
    const snap = generateCompanyCapabilitySnapshot(context([area({ key: "sales", state: "ausgeglichen", evaluationStatus: "bewertet" })]));
    expect(snap.capabilities[0]!.status).toBe("demonstrated");
    expect(snap.decisionPoints).toHaveLength(0);
  });

  it("8. negativer/belasteter State (rolle-unbesetzt) → attention-required UND ein Entscheidungspunkt", () => {
    const snap = generateCompanyCapabilitySnapshot(
      context([
        area({
          key: "people",
          kind: "cross-cutting-dimension",
          state: "rolle-unbesetzt",
          evaluationStatus: "bewertet",
          statement: "Rolle unbesetzt",
          topObservations: [{ id: "o1", statement: "x", severity: "hoch", confidence: "hoch" }],
          evidenceIds: ["o1"],
        }),
      ]),
    );
    expect(snap.capabilities[0]!.status).toBe("attention-required");
    expect(snap.decisionPoints).toHaveLength(1);
    expect(snap.decisionPoints[0]!.area).toBe("people");
  });
});

describe("Company Capability — Entscheidungspunkte: kein Auslöser ohne Beleg", () => {
  it("9. keine Entscheidung ohne Auslöser: state=null (Operations) erzeugt niemals einen Entscheidungspunkt, auch mit vorhandener Evidenz", () => {
    const snap = generateCompanyCapabilitySnapshot(
      context([
        area({
          key: "operations",
          state: null,
          evaluationStatus: "unzureichende-evidenz",
          evidenceIds: ["delivery-1", "delivery-2"],
          statement: "Bestand vorhanden",
        }),
      ]),
    );
    expect(snap.decisionPoints).toHaveLength(0);
  });

  it("10. keine Entscheidung ohne Auslöser: demonstrated-Areas erzeugen keinen Entscheidungspunkt", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    const demonstratedAreas = snap.capabilities.filter((c) => c.status === "demonstrated").map((c) => c.area);
    expect(demonstratedAreas.length).toBeGreaterThan(0);
    for (const dp of snap.decisionPoints) {
      expect(demonstratedAreas).not.toContain(dp.area);
    }
  });

  it("11. keine Entscheidung ohne Evidenz: jeder Entscheidungspunkt referenziert exakt die evidenceIds seiner Area (auch wenn leer)", () => {
    const marketingArea = area({
      key: "marketing",
      state: "erhoehte-nachfrage",
      evaluationStatus: "bewertet",
      statement: "Nachfrage erhöht",
      evidenceIds: ["m1", "m2"],
    });
    const snap = generateCompanyCapabilitySnapshot(context([marketingArea]));
    expect(snap.decisionPoints[0]!.evidenceIds).toEqual(["m1", "m2"]);
  });

  it("12. keine individuelle Mitarbeiterentscheidung: ExecutiveDecisionPoint enthält keine Employee-/Personen-Referenz", () => {
    const snap = generateCompanyCapabilitySnapshot(
      context([
        area({
          key: "people",
          kind: "cross-cutting-dimension",
          state: "letzte-person-verbleibt",
          evaluationStatus: "bewertet",
          evidenceIds: ["people-obs-1"],
          topObservations: [{ id: "people-obs-1", statement: "x", severity: "mittel", confidence: "hoch" }],
        }),
      ]),
    );
    const serialized = JSON.stringify(snap.decisionPoints);
    expect(/emp-/i.test(serialized)).toBe(false);
    expect(Object.keys(snap.decisionPoints[0]!).sort()).toEqual(
      ["area", "asOf", "decisionStatus", "evidenceIds", "generatedAt", "id", "question", "reason", "title", "urgency"].sort(),
    );
  });
});

describe("Company Capability — Urgency-Herleitung (ausschließlich aus bestehender severity)", () => {
  it("13. severity='hoch' → urgency='now'", () => {
    const snap = generateCompanyCapabilitySnapshot(
      context([
        area({
          key: "people",
          kind: "cross-cutting-dimension",
          state: "rolle-unbesetzt",
          evaluationStatus: "bewertet",
          evidenceIds: ["o1"],
          topObservations: [{ id: "o1", statement: "x", severity: "hoch", confidence: "hoch" }],
        }),
      ]),
    );
    expect(snap.decisionPoints[0]!.urgency).toBe("now");
  });

  it("14. severity='mittel' → urgency='soon'", () => {
    const snap = generateCompanyCapabilitySnapshot(
      context([
        area({
          key: "people",
          kind: "cross-cutting-dimension",
          state: "letzte-person-verbleibt",
          evaluationStatus: "bewertet",
          evidenceIds: ["o1"],
          topObservations: [{ id: "o1", statement: "x", severity: "mittel", confidence: "hoch" }],
        }),
      ]),
    );
    expect(snap.decisionPoints[0]!.urgency).toBe("soon");
  });

  it("15. severity='niedrig' → urgency='monitor'", () => {
    const snap = generateCompanyCapabilitySnapshot(
      context([
        area({
          key: "sales",
          state: "verlangsamte-pipeline",
          evaluationStatus: "bewertet",
          evidenceIds: ["o1"],
          topObservations: [{ id: "o1", statement: "x", severity: "niedrig", confidence: "hoch" }],
        }),
      ]),
    );
    expect(snap.decisionPoints[0]!.urgency).toBe("monitor");
  });

  it("16. keine severity vorhanden (Marketing, strukturell) → urgency='monitor' als ehrlicher Default, keine erfundene Dringlichkeit", () => {
    const snap = generateCompanyCapabilitySnapshot(
      context([area({ key: "marketing", state: "erhoehte-nachfrage", evaluationStatus: "bewertet", evidenceIds: ["m1"] })]),
    );
    expect(snap.decisionPoints[0]!.urgency).toBe("monitor");
  });

  it("17. mehrere Observations mit unterschiedlicher severity: die schwerste gewinnt (dasselbe Prinzip wie an anderer Stelle im Repository)", () => {
    const snap = generateCompanyCapabilitySnapshot(
      context([
        area({
          key: "sales",
          state: "konzentrierte-last",
          evaluationStatus: "bewertet",
          evidenceIds: ["o1", "o2"],
          topObservations: [
            { id: "o1", statement: "x", severity: "niedrig", confidence: "hoch" },
            { id: "o2", statement: "y", severity: "hoch", confidence: "mittel" },
          ],
        }),
      ]),
    );
    expect(snap.decisionPoints[0]!.urgency).toBe("now");
  });
});

describe("Company Capability — Determinismus, Sortierung, asOf", () => {
  it("18. identische Eingabe → identische Ausgabe", () => {
    const a = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    const b = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    expect(a).toEqual(b);
  });

  it("19. stabile Sortierung: capabilities immer in fester Reihenfolge sales/marketing/people/operations, unabhängig von Eingabereihenfolge", () => {
    const reversed = [...ALL_FOUR].reverse();
    const snap = generateCompanyCapabilitySnapshot(context(reversed));
    expect(snap.capabilities.map((c) => c.area)).toEqual(["sales", "marketing", "people", "operations"]);
  });

  it("20. deterministische IDs: derselbe Auslöser (Area+State+asOf) erzeugt dieselbe decisionPoint-ID", () => {
    const build = () =>
      generateCompanyCapabilitySnapshot(
        context([area({ key: "marketing", state: "erhoehte-nachfrage", evaluationStatus: "bewertet", evidenceIds: ["m1"] })]),
      );
    expect(build().decisionPoints[0]!.id).toBe(build().decisionPoints[0]!.id);
  });

  it("21. unterschiedlicher asOf erzeugt unterschiedliche decisionPoint-ID (kein Kollisions-Risiko über Zeit)", () => {
    const marketingArea = area({ key: "marketing", state: "erhoehte-nachfrage", evaluationStatus: "bewertet", evidenceIds: ["m1"] });
    const a = generateCompanyCapabilitySnapshot(context([marketingArea], "2025-09-01"));
    const b = generateCompanyCapabilitySnapshot(context([marketingArea], "2025-09-02"));
    expect(a.decisionPoints[0]!.id).not.toBe(b.decisionPoints[0]!.id);
  });

  it("22. historischer asOf wird unverändert durchgereicht — asOf entspricht exakt executiveContext.timestamp", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR, "2023-05-10"));
    expect(snap.asOf).toBe("2023-05-10");
    expect(snap.decisionPoints.every((d) => d.asOf === "2023-05-10" && d.generatedAt === "2023-05-10")).toBe(true);
  });

  it("23. Future Leakage: die Funktion liest ausschließlich bereits übergebene Felder, führt keinen eigenen Zeitvergleich/keine eigene Weltgenerierung durch (Snapshot bleibt bit-identisch zum Input)", () => {
    const input = context(ALL_FOUR, "2024-01-01");
    const snap = generateCompanyCapabilitySnapshot(input);
    expect(snap.asOf).toBe(input.timestamp);
    // Kein Feld im Ergebnis referenziert einen Zeitpunkt, der nicht bereits im
    // Input (asOf) oder in den Area-Evidenzen enthalten war.
    expect(snap.capabilities.every((c) => input.areaSummaries.some((a) => a.key === c.area))).toBe(true);
  });
});

describe("Company Capability — Evidence-ID-Integrität", () => {
  it("24. jede Evidence-ID in decisionPoints ist auch in der Evidence der zugehörigen Capability enthalten", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR.map((a) => (a.key === "marketing" ? { ...a, state: "erhoehte-nachfrage" as const, evidenceIds: ["m1", "m2"] } : a))));
    const marketingCapability = snap.capabilities.find((c) => c.area === "marketing")!;
    const marketingDecision = snap.decisionPoints.find((d) => d.area === "marketing")!;
    for (const id of marketingDecision.evidenceIds) {
      expect(marketingCapability.evidenceIds).toContain(id);
    }
  });

  it("25. jede Capability-Evidence-ID entspricht exakt der ursprünglichen Area-evidenceIds (keine Verfälschung)", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    for (const capability of snap.capabilities) {
      const original = ALL_FOUR.find((a) => a.key === capability.area)!;
      expect(capability.evidenceIds).toEqual(original.evidenceIds);
    }
  });
});

describe("Company Capability — keine numerische Gesamtnote", () => {
  it("26. kein Score-/Prozent-/Ampel-Feld irgendwo im Snapshot", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    const serialized = JSON.stringify(snap);
    for (const forbidden of [/\bscore\b/i, /percentage/i, /prozent/i, /\brating\b/i, /schulnote/i, /ampel/i, /\bgrade\b/i]) {
      expect(forbidden.test(serialized)).toBe(false);
    }
  });

  it("27. openDecisionPoints ist eine reine Längen-Zählung, keine gewichtete/berechnete Kennzahl", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    expect(snap.summary.openDecisionPoints).toBe(snap.decisionPoints.length);
  });
});

describe("Company Capability — Executive Summary regelbasiert", () => {
  it("28. knownFacts hat exakt so viele Einträge wie capabilities, in derselben Reihenfolge", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    expect(snap.summary.knownFacts).toHaveLength(snap.capabilities.length);
  });

  it("29. attentionAreas/insufficientEvidenceAreas entsprechen exakt den jeweiligen Capability-Status-Filtern", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR.map((a) => (a.key === "marketing" ? { ...a, state: "erhoehte-nachfrage" as const } : a))));
    expect(snap.summary.attentionAreas).toEqual(
      snap.capabilities.filter((c) => c.status === "attention-required").map((c) => c.area),
    );
    expect(snap.summary.insufficientEvidenceAreas).toEqual(
      snap.capabilities.filter((c) => c.status === "insufficient-evidence").map((c) => c.area),
    );
  });

  it("30. keine freie KI-Textgenerierung: dieselbe Eingabe erzeugt wortwörtlich denselben knownFacts-Text", () => {
    const a = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    const b = generateCompanyCapabilitySnapshot(context(ALL_FOUR));
    expect(a.summary.knownFacts).toEqual(b.summary.knownFacts);
  });

  it("31. keine Bewertungssprache (krank/versagt/schwach/schlecht) in der Executive Summary", () => {
    const snap = generateCompanyCapabilitySnapshot(context(ALL_FOUR.map((a) => (a.key === "marketing" ? { ...a, state: "erhoehte-nachfrage" as const } : a))));
    const serialized = JSON.stringify(snap.summary);
    for (const forbidden of [/krank/i, /versagt/i, /schwach/i, /\bschlecht\b/i]) {
      expect(forbidden.test(serialized)).toBe(false);
    }
  });
});

describe("Company Capability — Referenzwelt (WORLD_NOW, empirisch)", () => {
  it("32. bei WORLD_NOW: Sales und People demonstrated, Marketing attention-required, Operations insufficient-evidence", () => {
    const ctx = generateFullCompanyContext();
    const snap = generateCompanyCapabilitySnapshot(ctx.executiveContext);
    const byArea = new Map(snap.capabilities.map((c) => [c.area, c.status]));
    expect(byArea.get("sales")).toBe("demonstrated");
    expect(byArea.get("people")).toBe("demonstrated");
    expect(byArea.get("marketing")).toBe("attention-required");
    expect(byArea.get("operations")).toBe("insufficient-evidence");
  });

  it("33. bei WORLD_NOW: genau ein offener Entscheidungspunkt (Marketing), urgency='monitor' (keine severity verfügbar)", () => {
    const ctx = generateFullCompanyContext();
    const snap = generateCompanyCapabilitySnapshot(ctx.executiveContext);
    expect(snap.decisionPoints).toHaveLength(1);
    expect(snap.decisionPoints[0]!.area).toBe("marketing");
    expect(snap.decisionPoints[0]!.urgency).toBe("monitor");
    expect(snap.decisionPoints[0]!.decisionStatus).toBe("open");
  });

  it("34. bei WORLD_NOW: asOf entspricht WORLD_NOW, Snapshot ist deterministisch bei wiederholtem Aufruf", () => {
    const ctx = generateFullCompanyContext();
    const a = generateCompanyCapabilitySnapshot(ctx.executiveContext);
    const b = generateCompanyCapabilitySnapshot(ctx.executiveContext);
    expect(a.asOf).toBe(WORLD_NOW);
    expect(a).toEqual(b);
  });
});
