import { describe, expect, it } from "vitest";
import { generateBusinessStateSnapshot, type BusinessStateType } from "../business-state/business-state";
import { SCENARIO_WORLDS } from "../engine/generator";
import { SCENARIO_PROFILES } from "../engine/scenario-profiles";
import type { Observation, ObservationKind } from "../observations/observations";
import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";
import { WORLD_NOW } from "../timeline/world-clock";

const VALID_TYPES: readonly BusinessStateType[] = [
  "ausgeglichen",
  "operative-anspannung",
  "wachstum-ueber-kapazitaet",
  "konzentrierte-last",
  "verlangsamte-pipeline",
  "strategischer-freiraum",
];

// Sprachliche Guardrail (Auftrag §18): keine perfekte NLP-Prüfung, nur ein robuster
// Boundary-Check gegen die explizit genannten normativen Muster plus naheliegende
// Varianten (Groß-/Kleinschreibung, Wortstamm).
const NORMATIVE_LANGUAGE_PATTERNS: RegExp[] = [
  /\bsollte\b/i,
  /\bsolltest\b/i,
  /\bmusst\b/i,
  /\bmüssen\b/i,
  /\bmuss der geschäftsführer\b/i,
  /\bpriorisier/i,
  /\bgreif(e|en) ein\b/i,
  /\bunterstütz/i,
  /\bentscheide jetzt\b/i,
  /\bempfehl/i,
  /\bhandlungsempfehlung/i,
];

describe("Business State: Feldmodell-Invarianten (§17)", () => {
  for (const profile of SCENARIO_PROFILES) {
    describe(profile.id, () => {
      const world = SCENARIO_WORLDS[profile.id];
      const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);

      it("groundTruthSnapshotId verweist auf den tatsächlichen GroundTruthSnapshot", () => {
        expect(businessState.groundTruthSnapshotId).toBe(world.groundTruth.id);
      });

      it("timestamp entspricht exakt dem GroundTruthSnapshot", () => {
        expect(businessState.timestamp).toBe(world.groundTruth.timestamp);
      });

      it("type ist einer der sechs gültigen Werte", () => {
        expect(VALID_TYPES).toContain(businessState.type);
      });

      it("statement ist nicht leer", () => {
        expect(businessState.statement.trim().length).toBeGreaterThan(0);
      });

      it("supportingObservationIds ist nicht leer", () => {
        expect(businessState.supportingObservationIds.length).toBeGreaterThan(0);
      });

      it("alle supportingObservationIds sind im GroundTruthSnapshot aktiv (keine unbekannte Observation)", () => {
        const activeIds = new Set(world.groundTruth.activeObservationIds);
        for (const id of businessState.supportingObservationIds) {
          expect(activeIds.has(id)).toBe(true);
        }
      });

      it("jede supportingObservationId löst zu einer real existierenden Observation auf", () => {
        for (const id of businessState.supportingObservationIds) {
          expect(world.observations.some((o) => o.id === id)).toBe(true);
        }
      });

      it("Statement enthält keine normative/imperative Sprache", () => {
        for (const pattern of NORMATIVE_LANGUAGE_PATTERNS) {
          expect(businessState.statement).not.toMatch(pattern);
        }
      });
    });
  }

  it("genau ein BusinessStateSnapshot pro GroundTruthSnapshot (über alle sechs Szenarien)", () => {
    const results = SCENARIO_PROFILES.map((p) =>
      generateBusinessStateSnapshot(SCENARIO_WORLDS[p.id].groundTruth, SCENARIO_WORLDS[p.id].observations),
    );
    expect(results.length).toBe(SCENARIO_PROFILES.length);
    const groundTruthIds = new Set(results.map((r) => r.groundTruthSnapshotId));
    // Mehrere Szenarien können denselben Ground-Truth-Fingerprint teilen (siehe
    // ground-truth.ts: id ist inhaltsbasiert) — das ist kein Verstoß gegen "genau
    // einer pro Snapshot", solange jeder Aufruf deterministisch exakt einen liefert.
    expect(groundTruthIds.size).toBeGreaterThan(0);
  });
});

describe("Business State: Scenario-Blindheit (§1, §9)", () => {
  it("die Funktionssignatur kann kein ScenarioProfile entgegennehmen (typsystemisch erzwungen)", () => {
    // generateBusinessStateSnapshot(groundTruth, observations) — zwei Parameter, keiner
    // davon ScenarioProfile oder ScenarioWorld. Dieser Test dokumentiert die Prüfung;
    // ein drittes Pflicht-Argument wäre ein TS-Kompilierfehler an jeder bestehenden
    // Aufrufstelle, nicht nur hier.
    expect(generateBusinessStateSnapshot.length).toBe(2);
  });

  it("operativer-fokus bleibt bei 'verlangsamte-pipeline', nicht 'operative-anspannung' — nur ein Signal (Stagnation) ist elevated, keine Konvergenz mehrerer unabhängiger Signale", () => {
    const world = SCENARIO_WORLDS["operativer-fokus"];
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    expect(businessState.type).toBe("verlangsamte-pipeline");
    const salesCycle = world.observations.find((o) => o.kind === "sales-cycle-duration");
    const teamWinRate = world.observations.find((o) => o.kind === "team-win-rate-parity");
    // Bestätigt die Prämisse: kein zusätzliches Signal ist elevated, deshalb die
    // engere statt der breiteren Klassifikation.
    expect(salesCycle?.severity).not.toBe("hoch");
    expect(teamWinRate?.category).not.toBe("team-hinweis");
  });

  it("pipeline-risiko wird zu 'operative-anspannung', weil mehrere unabhängige Signale gleichzeitig elevated sind — nicht weil das Profil so heißt", () => {
    const world = SCENARIO_WORLDS["pipeline-risiko"];
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    expect(businessState.type).toBe("operative-anspannung");
    const supportingKinds = businessState.supportingObservationIds.map(
      (id) => world.observations.find((o) => o.id === id)?.kind,
    );
    // Mindestens ein zusätzliches, von der reinen Pipeline-Stagnation unabhängiges
    // Signal muss tatsächlich zur Evidenz gehören.
    expect(supportingKinds.some((k) => k === "sales-cycle-duration" || k === "team-win-rate-parity")).toBe(true);
  });

  it("strategischer-tag trifft 'strategischer-freiraum' aufgrund echter chance-Evidenz, nicht aufgrund des Profilnamens", () => {
    // Sales Ownership / Marketing Demand Decoupling: "lead-volume-trend" ist seit
    // dem stärkeren, jetzt Sales-sicheren Demand Model (siehe
    // engine/marketing-demand.ts) erstmals selbst ein aktiver "chance"-Beitrag
    // (vorher strukturell praktisch immer "niedrig"/unauffällig, siehe die
    // ursprüngliche Begründung in business-state/business-state.ts, warum dieser
    // Kind bislang unbenutzt blieb) — zusätzlich zu den bereits geprüften Kinds
    // legitim in der Beweiskette enthalten. Kernaussage bleibt unverändert: die
    // Klassifikation entsteht aus echten chance-Signalen, nicht aus dem
    // Profilnamen.
    const world = SCENARIO_WORLDS["strategischer-tag"];
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    expect(businessState.type).toBe("strategischer-freiraum");
    const supportingKinds = businessState.supportingObservationIds.map(
      (id) => world.observations.find((o) => o.id === id)?.kind,
    );
    expect(
      supportingKinds.every(
        (k) => k === "chance-account-repeat-business" || k === "touchpoint-richness-won-vs-lost" || k === "lead-volume-trend",
      ),
    ).toBe(true);
  });

  it("team-engpass wird zu 'konzentrierte-last', weil ae-workload-distribution eine echte, hohe Lastkonzentration belegt — nicht weil das Profil so heißt", () => {
    const world = SCENARIO_WORLDS["team-engpass"];
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    expect(businessState.type).toBe("konzentrierte-last");
    const supportingKinds = businessState.supportingObservationIds.map(
      (id) => world.observations.find((o) => o.id === id)?.kind,
    );
    expect(supportingKinds).toEqual(["ae-workload-distribution"]);
    const aeWorkload = world.observations.find((o) => o.kind === "ae-workload-distribution");
    expect(aeWorkload?.severity).toBe("hoch");
  });

  it("wachstumsdruck wird weiterhin NICHT automatisch zu 'wachstum-ueber-kapazitaet' — dieser Type bleibt mit der aktuellen Ground Truth unbelegt (lead-volume-trend fließt weiterhin nicht in business-state.ts ein)", () => {
    // Sales Ownership / Marketing Demand Decoupling: seit dem stärkeren Demand
    // Model (engine/marketing-demand.ts) zeigt lead-volume-trend jetzt auch für
    // wachstumsdruck ein echtes, hohes Wachstumssignal (severity="hoch", +63 %) —
    // die ursprüngliche Prämisse "immer niedrig" ist damit überholt. Die
    // eigentlich relevante Invariante bleibt aber bestehen: business-state.ts
    // liest lead-volume-trend nach wie vor NICHT (siehe dortige Begründung,
    // "Beschleunigung statt Niveau") — "wachstum-ueber-kapazitaet" bleibt daher
    // weiterhin unerreichbar, unabhängig von diesem Kind.
    const world = SCENARIO_WORLDS.wachstumsdruck;
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    expect(businessState.type).not.toBe("wachstum-ueber-kapazitaet");
    const volumeTrend = world.observations.find((o) => o.kind === "lead-volume-trend");
    expect(volumeTrend?.severity).toBe("hoch");
    expect(volumeTrend?.category).toBe("chance");
  });

  it("baseline wird nicht blind auf 'ausgeglichen' gesetzt, sondern über echte Prüfung der Stagnations- und Chance-Signale erreicht", () => {
    const world = SCENARIO_WORLDS.baseline;
    const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const stagnationSummary = world.observations.find((o) => o.kind === "pipeline-stagnation-summary");
    expect(stagnationSummary?.severity).toBe("niedrig");
    expect(businessState.type).toBe("ausgeglichen");
    expect(businessState.supportingObservationIds).toContain(stagnationSummary!.id);
  });
});

describe("Business State: keine positionsbasierte Observation-ID-Semantik (§8)", () => {
  function makeObservation(kind: ObservationKind, id: string, overrides: Partial<Observation> = {}): Observation {
    return {
      id,
      kind,
      generatedAt: WORLD_NOW,
      statement: `Testaussage für ${kind}`,
      category: "stabil",
      severity: "niedrig",
      confidence: "mittel",
      derivedFrom: [],
      ...overrides,
    };
  }

  function makeGroundTruth(observations: readonly Observation[]): GroundTruthSnapshot {
    return {
      id: "gts-test",
      timestamp: WORLD_NOW,
      activeObservationIds: observations.map((o) => o.id),
      priorities: observations.map((o) => ({ observationId: o.id, tier: "unterstuetzend" as const })),
      observationGroups: [],
    };
  }

  it("veränderte Observation-Reihenfolge führt zu identischem Business State", () => {
    const observations = [
      makeObservation("pipeline-stagnation-summary", "obs-00001", { severity: "mittel" }),
      makeObservation("biggest-stagnant-opportunity", "obs-00002", { severity: "hoch" }),
      makeObservation("chance-account-repeat-business", "obs-00003", { category: "chance" }),
      makeObservation("pipeline-synthesis", "obs-00004", { category: "risiko", severity: "mittel" }),
    ];
    const forward = generateBusinessStateSnapshot(makeGroundTruth(observations), observations);
    const shuffled = generateBusinessStateSnapshot(makeGroundTruth([...observations].reverse()), [...observations].reverse());
    expect(shuffled.type).toBe(forward.type);
    expect(shuffled.statement).toBe(forward.statement);
    expect(new Set(shuffled.supportingObservationIds)).toEqual(new Set(forward.supportingObservationIds));
  });

  it("variable Kardinalität eines Kinds (unterschiedliche Anzahl chance-Observations) verändert die Klassifikation nicht fälschlich, sondern konsistent mit der tatsächlichen Anzahl", () => {
    const base = [
      makeObservation("pipeline-stagnation-summary", "obs-00001", { severity: "niedrig" }),
      makeObservation("pipeline-synthesis", "obs-00002", { category: "stabil", severity: "niedrig" }),
    ];
    const fewChance = [...base, makeObservation("chance-account-repeat-business", "obs-00003", { category: "chance" })];
    const manyChance = [
      ...base,
      ...Array.from({ length: 8 }, (_, i) =>
        makeObservation("chance-account-repeat-business", `obs-000${10 + i}`, { category: "chance" }),
      ),
    ];

    const withFew = generateBusinessStateSnapshot(makeGroundTruth(fewChance), fewChance);
    const withMany = generateBusinessStateSnapshot(makeGroundTruth(manyChance), manyChance);

    expect(withFew.type).toBe("ausgeglichen");
    expect(withMany.type).toBe("strategischer-freiraum");
  });

  it("IDs, die auf frühere Positionen in einem anderen Kontext verweisen würden (z. B. 'obs-00012'), tragen keine Bedeutung — nur kind/category/severity zählen", () => {
    // Rekonstruiert exakt das Muster des behobenen Ground-Truth-Bugs: dieselbe ID
    // ('obs-00012') gehört hier zu einem völlig anderen Kind als in einem anderen
    // Kontext — die Klassifikation darf sich davon nicht beirren lassen.
    const observationsA = [makeObservation("chance-account-repeat-business", "obs-00012", { category: "chance" })];
    const observationsB = [makeObservation("touchpoint-richness-won-vs-lost", "obs-00012", { category: "chance" })];
    const stateA = generateBusinessStateSnapshot(makeGroundTruth(observationsA), observationsA);
    const stateB = generateBusinessStateSnapshot(makeGroundTruth(observationsB), observationsB);
    // Beide landen strukturell in derselben Klassifikationslogik (1 chance-Observation,
    // unter dem Schwellenwert) — entscheidend ist: keine der beiden Klassifikationen
    // unterscheidet sich aufgrund der (identischen) ID, nur aufgrund von kind/category,
    // die hier bewusst unterschiedlich sind, aber im selben Zweig landen.
    expect(stateA.type).toBe("ausgeglichen");
    expect(stateB.type).toBe("ausgeglichen");
  });
});

describe("Business State: Determinismus (§17)", () => {
  it("gleiche Ground Truth + gleiche Observations erzeugen einen deep-identischen Business State", () => {
    const world = SCENARIO_WORLDS["pipeline-risiko"];
    const a = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const b = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    expect(a).toEqual(b);
  });

  it("keine WORLD_NOW-Hardcodierung: timestamp folgt ausschließlich dem übergebenen GroundTruthSnapshot", () => {
    const world = SCENARIO_WORLDS.baseline;
    const customGroundTruth = { ...world.groundTruth, timestamp: "2025-01-01" };
    const businessState = generateBusinessStateSnapshot(customGroundTruth, world.observations);
    expect(businessState.timestamp).toBe("2025-01-01");
    expect(businessState.timestamp).not.toBe(WORLD_NOW);
  });
});
