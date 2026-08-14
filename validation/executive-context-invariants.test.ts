import { describe, expect, it } from "vitest";
import { generateExecutiveContextSnapshot } from "../executive-context/executive-context";
import { generateBusinessStateSnapshot, type BusinessStateSnapshot } from "../business-state/business-state";
import { SCENARIO_WORLDS } from "../engine/generator";
import { SCENARIO_PROFILES } from "../engine/scenario-profiles";
import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";
import { WORLD_NOW } from "../timeline/world-clock";

// Sprachliche Guardrail — strenger als Business State (§9 des Auftrags): zusätzliche
// Muster (priorisieren/handeln/eingreifen/entscheiden/fokussieren/Maßnahme/nächster
// Schritt), zusätzlich zu den bereits bei Business State geprüften.
const NORMATIVE_LANGUAGE_PATTERNS: RegExp[] = [
  /\bsollte\b/i,
  /\bsolltest\b/i,
  /\bmusst\b/i,
  /\bmuss\b/i,
  /\bpriorisier/i,
  /\bhandeln\b/i,
  /\bhandle\b/i,
  /\beingreifen\b/i,
  /\bgreif(e|en) ein\b/i,
  /\bunterstütz/i,
  /\bentscheide/i,
  /\bentscheidung/i,
  /\bfokussier/i,
  /\bempfehl/i,
  /\bmaßnahme/i,
  /\bnächster schritt/i,
  /\bhandlungsempfehlung/i,
];

describe("Executive Context: Feldmodell-Invarianten (§12)", () => {
  for (const profile of SCENARIO_PROFILES) {
    describe(profile.id, () => {
      const world = SCENARIO_WORLDS[profile.id];
      const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
      const executiveContext = generateExecutiveContextSnapshot(businessState, world.groundTruth);

      it("businessStateId verweist auf den tatsächlichen BusinessStateSnapshot", () => {
        expect(executiveContext.businessStateId).toBe(businessState.id);
      });

      it("timestamp entspricht exakt dem BusinessStateSnapshot", () => {
        expect(executiveContext.timestamp).toBe(businessState.timestamp);
      });

      it("affectedDimensions stammen ausschließlich aus bestehenden Ground-Truth-Gruppen", () => {
        const knownLabels = new Set(world.groundTruth.observationGroups.map((g) => g.label));
        for (const dimension of executiveContext.affectedDimensions) {
          expect(knownLabels.has(dimension)).toBe(true);
        }
      });

      it("relevanceStatement ist nicht leer", () => {
        expect(executiveContext.relevanceStatement.trim().length).toBeGreaterThan(0);
      });

      it("supportingObservationIds ist nicht leer", () => {
        expect(executiveContext.supportingObservationIds.length).toBeGreaterThan(0);
      });

      it("supportingObservationIds ist eine Teilmenge von BusinessState.supportingObservationIds", () => {
        const businessStateIds = new Set(businessState.supportingObservationIds);
        for (const id of executiveContext.supportingObservationIds) {
          expect(businessStateIds.has(id)).toBe(true);
        }
      });

      it("supportingObservationIds fügt KEINE zusätzliche Observation gegenüber Business State hinzu", () => {
        expect(executiveContext.supportingObservationIds.length).toBeLessThanOrEqual(
          businessState.supportingObservationIds.length,
        );
      });

      it("alle supportingObservationIds lösen zu real existierenden Observations auf", () => {
        for (const id of executiveContext.supportingObservationIds) {
          expect(world.observations.some((o) => o.id === id)).toBe(true);
        }
      });

      it("relevanceStatement enthält keine normative/imperative Sprache", () => {
        for (const pattern of NORMATIVE_LANGUAGE_PATTERNS) {
          expect(executiveContext.relevanceStatement).not.toMatch(pattern);
        }
      });

      it("tensionStatement (falls vorhanden) enthält keine normative/imperative Sprache", () => {
        if (executiveContext.tensionStatement) {
          for (const pattern of NORMATIVE_LANGUAGE_PATTERNS) {
            expect(executiveContext.tensionStatement).not.toMatch(pattern);
          }
        }
      });

      it("tensionStatement existiert genau dann, wenn mindestens zwei unabhängige Dimensionen betroffen sind", () => {
        if (executiveContext.affectedDimensions.length >= 2) {
          expect(executiveContext.tensionStatement).toBeDefined();
        } else {
          expect(executiveContext.tensionStatement).toBeUndefined();
        }
      });
    });
  }

  it("genau ein ExecutiveContextSnapshot pro BusinessStateSnapshot (über alle sechs Szenarien)", () => {
    const results = SCENARIO_PROFILES.map((p) => {
      const world = SCENARIO_WORLDS[p.id];
      const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
      return generateExecutiveContextSnapshot(businessState, world.groundTruth);
    });
    expect(results.length).toBe(SCENARIO_PROFILES.length);
    for (const r of results) expect(r.id.length).toBeGreaterThan(0);
  });
});

describe("Executive Context: Scenario-Blindheit", () => {
  it("die Funktionssignatur kann kein ScenarioProfile entgegennehmen (typsystemisch erzwungen)", () => {
    expect(generateExecutiveContextSnapshot.length).toBe(2);
  });

  it("wachstumsdruck erklärt die vorhandene 'ausgeglichen'-Wahrheit ehrlich, statt den Scenario-Namen zu simulieren", () => {
    const world = SCENARIO_WORLDS.wachstumsdruck;
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const executiveContext = generateExecutiveContextSnapshot(businessState, world.groundTruth);
    expect(businessState.type).toBe("ausgeglichen");
    expect(executiveContext.relevanceStatement).toBe(
      "Die aktuelle Lage weist keine dominante operative Belastung auf.",
    );
    // Identisch zu baseline, weil Business State hier identische Evidenz zitiert —
    // Executive Context darf diese bereits dokumentierte Grenze nicht kaschieren.
    const baselineWorld = SCENARIO_WORLDS.baseline;
    const baselineBusinessState = generateBusinessStateSnapshot(baselineWorld.groundTruth, baselineWorld.observations);
    const baselineExecutiveContext = generateExecutiveContextSnapshot(baselineBusinessState, baselineWorld.groundTruth);
    expect(executiveContext.relevanceStatement).toBe(baselineExecutiveContext.relevanceStatement);
  });

  // Marketing Demand Model — World Generation First: pipeline-risiko belegte vor
  // dieser Änderung zufällig zwei Dimensionen gleichzeitig (Pipeline + Team) —
  // eine Koinzidenz des alten Lead-Timing-Zufallsstroms, keine garantierte
  // Domain-Eigenschaft dieses Profils. Mit dem neuen, unabhängigen
  // `demandRng`-Strom (siehe engine/marketing-demand.ts) belegt dieses Profil nur
  // noch die Pipeline-Dimension — Sales' Kernklassifikation (businessState.type
  // === "operative-anspannung") bleibt dabei unverändert (siehe
  // validation/operations-invariants.test.ts für die vollständige Kausalkette-
  // Begründung). Damit exerciert derzeit KEIN generiertes Scenario-Profil mehr
  // den Zwei-Dimensionen-Pfad zufällig — dieselbe, bereits reine
  // generateExecutiveContextSnapshot-Logik wird deshalb hier direkt mit
  // synthetischen Daten geprüft (identisches Fixture-Muster wie im
  // nachfolgenden describe-Block "keine positionsbasierte
  // Observation-ID-Semantik"), statt von einer zufälligen Koinzidenz in einer
  // generierten Welt abzuhängen — robuster und unabhängig vom RNG-Stream.
  it("zwei gleichzeitig betroffene Dimensionen erzeugen ein tensionStatement (synthetisch, RNG-unabhängig)", () => {
    const groundTruth: GroundTruthSnapshot = {
      id: "gts-tension-test",
      timestamp: WORLD_NOW,
      activeObservationIds: ["obs-00001", "obs-00002"],
      priorities: [
        { observationId: "obs-00001", tier: "unterstuetzend" },
        { observationId: "obs-00002", tier: "unterstuetzend" },
      ],
      observationGroups: [
        { id: "group-0", label: "Pipeline", observationIds: ["obs-00001"] },
        { id: "group-1", label: "Team", observationIds: ["obs-00002"] },
      ],
    };
    const businessState: BusinessStateSnapshot = {
      id: "bstate-tension-test",
      timestamp: WORLD_NOW,
      groundTruthSnapshotId: "gts-tension-test",
      type: "operative-anspannung",
      statement: "Testaussage.",
      supportingObservationIds: ["obs-00001", "obs-00002"],
    };
    const executiveContext = generateExecutiveContextSnapshot(businessState, groundTruth);
    expect(executiveContext.affectedDimensions).toEqual(["Pipeline", "Team"]);
    expect(executiveContext.tensionStatement).toBeDefined();
  });

  it("team-engpass (konzentrierte-last) erhält KEIN tensionStatement — nur eine Dimension ist betroffen", () => {
    const world = SCENARIO_WORLDS["team-engpass"];
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const executiveContext = generateExecutiveContextSnapshot(businessState, world.groundTruth);
    expect(businessState.type).toBe("konzentrierte-last");
    expect(executiveContext.affectedDimensions).toEqual(["Team"]);
    expect(executiveContext.tensionStatement).toBeUndefined();
  });
});

describe("Executive Context: keine positionsbasierte Observation-ID-Semantik", () => {
  function makeGroundTruth(
    groups: { label: string; observationIds: string[] }[],
  ): GroundTruthSnapshot {
    const allIds = groups.flatMap((g) => g.observationIds);
    return {
      id: "gts-test",
      timestamp: WORLD_NOW,
      activeObservationIds: allIds,
      priorities: allIds.map((id) => ({ observationId: id, tier: "unterstuetzend" as const })),
      observationGroups: groups.map((g, i) => ({ id: `group-${i}`, label: g.label, observationIds: g.observationIds })),
    };
  }

  function makeBusinessState(supportingObservationIds: string[]): BusinessStateSnapshot {
    return {
      id: "bstate-test",
      timestamp: WORLD_NOW,
      groundTruthSnapshotId: "gts-test",
      type: "verlangsamte-pipeline",
      statement: "Testaussage.",
      supportingObservationIds,
    };
  }

  it("veränderte Reihenfolge der supportingObservationIds führt zu identischem affectedDimensions-Ergebnis", () => {
    const groundTruth = makeGroundTruth([
      { label: "Pipeline", observationIds: ["obs-00001", "obs-00002"] },
      { label: "Team", observationIds: ["obs-00003"] },
    ]);
    const forward = generateExecutiveContextSnapshot(makeBusinessState(["obs-00001", "obs-00002", "obs-00003"]), groundTruth);
    const reversed = generateExecutiveContextSnapshot(makeBusinessState(["obs-00003", "obs-00002", "obs-00001"]), groundTruth);
    expect(reversed.affectedDimensions).toEqual(forward.affectedDimensions);
    expect(reversed.tensionStatement).toBe(forward.tensionStatement);
  });

  it("IDs, die in einem anderen Kontext eine andere Gruppe hätten (z. B. 'obs-00012'), tragen keine feste Bedeutung — nur die tatsächliche Gruppenzuordnung im übergebenen GroundTruthSnapshot zählt", () => {
    const groundTruthA = makeGroundTruth([{ label: "Pipeline", observationIds: ["obs-00012"] }]);
    const groundTruthB = makeGroundTruth([{ label: "Accounts", observationIds: ["obs-00012"] }]);
    const resultA = generateExecutiveContextSnapshot(makeBusinessState(["obs-00012"]), groundTruthA);
    const resultB = generateExecutiveContextSnapshot(makeBusinessState(["obs-00012"]), groundTruthB);
    expect(resultA.affectedDimensions).toEqual(["Pipeline"]);
    expect(resultB.affectedDimensions).toEqual(["Accounts"]);
  });
});

describe("Executive Context: Determinismus", () => {
  it("gleiche Inputs erzeugen einen deep-identischen Executive Context", () => {
    const world = SCENARIO_WORLDS.baseline;
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const a = generateExecutiveContextSnapshot(businessState, world.groundTruth);
    const b = generateExecutiveContextSnapshot(businessState, world.groundTruth);
    expect(a).toEqual(b);
  });
});

describe("Executive Context: keine neue Wahrheit", () => {
  it("führt kein Feld ein, das Risiko/Chance/Score/Confidence/Priority neu bewertet", () => {
    const world = SCENARIO_WORLDS.baseline;
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const executiveContext = generateExecutiveContextSnapshot(businessState, world.groundTruth);
    const keys = Object.keys(executiveContext).sort();
    expect(keys).toEqual(
      ["affectedDimensions", "businessStateId", "id", "relevanceStatement", "supportingObservationIds", "tensionStatement", "timestamp"].sort(),
    );
  });
});
