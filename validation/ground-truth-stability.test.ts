import { describe, expect, it } from "vitest";
import type { Observation, ObservationKind } from "../observations/observations";
import { generateGroundTruthSnapshot } from "../ground-truth/ground-truth";
import { SCENARIO_WORLDS } from "../engine/generator";
import { SCENARIO_PROFILES } from "../engine/scenario-profiles";
import { WORLD_NOW } from "../timeline/world-clock";

// Diese Suite prüft ausschließlich die Behebung des Architekturfehlers "Ground Truth
// Priorität/Gruppe hing an der positionellen Observation-ID statt an einer stabilen
// fachlichen Identität (Observation.kind)". Kein neuer Layer, keine neue
// Funktionalität — reine Stabilitätsprüfung der bestehenden Zuordnungstabellen in
// ground-truth.ts gegen Reihenfolge, Anzahl und Scenario Profile.

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

describe("Ground Truth: Priorität/Gruppe sind unabhängig von Reihenfolge", () => {
  it("dieselbe Menge an Observations liefert dieselbe Priorität/Gruppe je Kind, unabhängig von der Array-Reihenfolge", () => {
    const kinds: ObservationKind[] = [
      "pipeline-stagnation-summary",
      "biggest-stagnant-opportunity",
      "stagnation-concentration-by-ae",
      "chance-account-repeat-business",
      "chance-account-repeat-business",
      "touchpoint-richness-won-vs-lost",
      "pipeline-synthesis",
    ];
    const forward = kinds.map((kind, i) => makeObservation(kind, `obs-${String(i + 1).padStart(5, "0")}`));
    const shuffled = [...forward].reverse();

    const snapshotForward = generateGroundTruthSnapshot(forward, WORLD_NOW);
    const snapshotShuffled = generateGroundTruthSnapshot(shuffled, WORLD_NOW);

    const tierByKindForward = new Map(
      snapshotForward.priorities.map((p) => [forward.find((o) => o.id === p.observationId)!.kind, p.tier]),
    );
    const tierByKindShuffled = new Map(
      snapshotShuffled.priorities.map((p) => [shuffled.find((o) => o.id === p.observationId)!.kind, p.tier]),
    );
    for (const kind of new Set(kinds)) {
      expect(tierByKindShuffled.get(kind)).toBe(tierByKindForward.get(kind));
    }

    const groupLabelsByKindForward = new Map<ObservationKind, string>();
    for (const group of snapshotForward.observationGroups) {
      for (const obsId of group.observationIds) {
        groupLabelsByKindForward.set(forward.find((o) => o.id === obsId)!.kind, group.label);
      }
    }
    const groupLabelsByKindShuffled = new Map<ObservationKind, string>();
    for (const group of snapshotShuffled.observationGroups) {
      for (const obsId of group.observationIds) {
        groupLabelsByKindShuffled.set(shuffled.find((o) => o.id === obsId)!.kind, group.label);
      }
    }
    for (const kind of new Set(kinds)) {
      expect(groupLabelsByKindShuffled.get(kind)).toBe(groupLabelsByKindForward.get(kind));
    }
  });

  it("Priorität/Gruppe eines Kinds bleiben gleich, unabhängig davon, wie viele Instanzen eines anderen (variabel-kardinalen) Kinds vorangehen", () => {
    // Simuliert exakt das Muster, das den ursprünglichen Fehler verursacht hat:
    // "chance-account-repeat-business" kommt vor "touchpoint-richness-won-vs-lost" und
    // "pipeline-synthesis" und variiert in der Anzahl je Szenario.
    const build = (chanceAccountCount: number): Observation[] => {
      const obs: Observation[] = [];
      let n = 1;
      const push = (kind: ObservationKind) => obs.push(makeObservation(kind, `obs-${String(n++).padStart(5, "0")}`));
      push("pipeline-stagnation-summary");
      push("biggest-stagnant-opportunity");
      for (let i = 0; i < chanceAccountCount; i++) push("chance-account-repeat-business");
      push("touchpoint-richness-won-vs-lost");
      push("pipeline-synthesis");
      return obs;
    };

    for (const count of [0, 1, 2, 8]) {
      const observations = build(count);
      const snapshot = generateGroundTruthSnapshot(observations, WORLD_NOW);
      const touchpoint = observations.find((o) => o.kind === "touchpoint-richness-won-vs-lost")!;
      const synthesis = observations.find((o) => o.kind === "pipeline-synthesis")!;
      const touchpointTier = snapshot.priorities.find((p) => p.observationId === touchpoint.id)?.tier;
      const synthesisTier = snapshot.priorities.find((p) => p.observationId === synthesis.id)?.tier;

      expect(touchpointTier).toBe("sekundaer");
      expect(synthesisTier).toBe("unterstuetzend");

      const touchpointGroup = snapshot.observationGroups.find((g) => g.observationIds.includes(touchpoint.id));
      expect(touchpointGroup?.label).toBe("Accounts");
    }
  });
});

describe("Ground Truth: Priorität/Gruppe sind stabil über alle Scenario Profiles hinweg", () => {
  it("jeder Observation-Kind erhält in jedem der sechs Scenario Profiles dieselbe Priorität", () => {
    for (const profile of SCENARIO_PROFILES) {
      const world = SCENARIO_WORLDS[profile.id];
      const tierByKind = new Map<ObservationKind, string>();
      for (const obs of world.observations) {
        const tier = world.groundTruth.priorities.find((p) => p.observationId === obs.id)?.tier;
        expect(tier).toBeDefined();
        if (tierByKind.has(obs.kind)) {
          expect(tier).toBe(tierByKind.get(obs.kind));
        } else {
          tierByKind.set(obs.kind, tier!);
        }
      }
    }

    // Kind → erwartete Priorität, unabhängig vom Szenario (die redaktionelle
    // Zuordnung selbst, siehe GROUND_TRUTH_PRIORITIES in ground-truth.ts).
    const expectedTierByKind: Record<ObservationKind, string> = {
      "biggest-stagnant-opportunity": "primaer",
      "pipeline-stagnation-summary": "sekundaer",
      "stagnation-concentration-by-ae": "sekundaer",
      "touchpoint-richness-won-vs-lost": "sekundaer",
      "sales-cycle-duration": "sekundaer",
      "stage-regression-rate": "sekundaer",
      "lead-volume-trend": "sekundaer",
      "low-stagnation-counterexample": "unterstuetzend",
      "team-win-rate-parity": "unterstuetzend",
      "follow-up-consistency-across-sdrs": "unterstuetzend",
      "fastest-sdr-response-time": "unterstuetzend",
      "sdr-load-distribution-healthy": "unterstuetzend",
      "ae-workload-distribution": "unterstuetzend",
      "objection-mix-top-category": "unterstuetzend",
      "loss-reason-concentration": "unterstuetzend",
      "chance-account-repeat-business": "unterstuetzend",
      "pipeline-synthesis": "unterstuetzend",
      // People Foundation: additiv, s. GROUND_TRUTH_PRIORITIES in ground-truth.ts.
      // world.observations (SCENARIO_WORLDS) enthält nie People-Kinds — diese
      // Einträge werden in diesem Test nie tatsächlich abgefragt, sind aber für die
      // Record<ObservationKind, ...>-Vollständigkeit erforderlich.
      "people-critical-role-unstaffed": "primaer",
      "people-critical-role-last-person": "sekundaer",
      // Operations Foundation: additiv, s. GROUND_TRUTH_PRIORITIES in ground-truth.ts.
      "operations-delivery-fair-share": "unterstuetzend",
      // Completed Delivery Duration Observation V1: additiv, s.
      // GROUND_TRUTH_PRIORITIES in ground-truth.ts.
      "operations-completed-delivery-duration": "unterstuetzend",
      // Queue Duration Observation V1: additiv, s. GROUND_TRUTH_PRIORITIES in
      // ground-truth.ts.
      "operations-completed-queue-duration": "unterstuetzend",
      // Current Delivery Queue Snapshot V1: additiv, s. GROUND_TRUTH_PRIORITIES
      // in ground-truth.ts.
      "operations-current-delivery-queue": "unterstuetzend",
      // Marketing as First-Class Company Area: additiv, s. GROUND_TRUTH_PRIORITIES
      // in ground-truth.ts. world.observations (SCENARIO_WORLDS) enthält nie
      // Marketing-Kinds — nur für Record-Vollständigkeit erforderlich.
      "marketing-demand-generation-volume": "unterstuetzend",
      // Marketing Leadership State: additiv, s. GROUND_TRUTH_PRIORITIES in
      // ground-truth.ts. Nur für Record-Vollständigkeit erforderlich.
      "marketing-demand-regime-signal": "sekundaer",
    };

    for (const profile of SCENARIO_PROFILES) {
      const world = SCENARIO_WORLDS[profile.id];
      for (const obs of world.observations) {
        const tier = world.groundTruth.priorities.find((p) => p.observationId === obs.id)?.tier;
        expect(tier, `${profile.id}: ${obs.id} (${obs.kind})`).toBe(expectedTierByKind[obs.kind]);
      }
    }
  });

  it("jeder Observation-Kind erhält in jedem der sechs Scenario Profiles dieselbe Gruppen-Beschriftung", () => {
    const expectedLabelByKind: Record<ObservationKind, string> = {
      "pipeline-stagnation-summary": "Pipeline",
      "biggest-stagnant-opportunity": "Pipeline",
      "stagnation-concentration-by-ae": "Pipeline",
      "low-stagnation-counterexample": "Pipeline",
      "pipeline-synthesis": "Pipeline",
      "sales-cycle-duration": "Pipeline",
      "stage-regression-rate": "Pipeline",
      "loss-reason-concentration": "Pipeline",
      "objection-mix-top-category": "Preis",
      "team-win-rate-parity": "Team",
      "follow-up-consistency-across-sdrs": "Team",
      "fastest-sdr-response-time": "Team",
      "sdr-load-distribution-healthy": "Team",
      "ae-workload-distribution": "Team",
      "chance-account-repeat-business": "Accounts",
      "touchpoint-richness-won-vs-lost": "Accounts",
      "lead-volume-trend": "Volumen",
      // People Foundation: additiv, s. OBSERVATION_GROUP_LABELS in ground-truth.ts.
      "people-critical-role-unstaffed": "Team-Kontinuität",
      "people-critical-role-last-person": "Team-Kontinuität",
      // Operations Foundation: additiv, s. OBSERVATION_GROUP_LABELS in ground-truth.ts.
      "operations-delivery-fair-share": "Delivery",
      // Completed Delivery Duration Observation V1: additiv, s.
      // OBSERVATION_GROUP_LABELS in ground-truth.ts.
      "operations-completed-delivery-duration": "Delivery",
      // Queue Duration Observation V1: additiv, s. OBSERVATION_GROUP_LABELS in
      // ground-truth.ts.
      "operations-completed-queue-duration": "Delivery",
      // Current Delivery Queue Snapshot V1: additiv, s. OBSERVATION_GROUP_LABELS
      // in ground-truth.ts.
      "operations-current-delivery-queue": "Delivery",
      // Marketing as First-Class Company Area: additiv, s. OBSERVATION_GROUP_LABELS
      // in ground-truth.ts.
      "marketing-demand-generation-volume": "Nachfrage",
      // Marketing Leadership State: additiv, s. OBSERVATION_GROUP_LABELS in
      // ground-truth.ts.
      "marketing-demand-regime-signal": "Nachfrage",
    };

    for (const profile of SCENARIO_PROFILES) {
      const world = SCENARIO_WORLDS[profile.id];
      for (const obs of world.observations) {
        const group = world.groundTruth.observationGroups.find((g) => g.observationIds.includes(obs.id));
        expect(group?.label, `${profile.id}: ${obs.id} (${obs.kind})`).toBe(expectedLabelByKind[obs.kind]);
      }
    }
  });
});

describe("Regressionstest: der ursprünglich gefundene Fehler", () => {
  it("strategischer-tag (8 Chance-Account-Instanzen statt 2 wie in baseline) ordnet 'sekundär' weiterhin korrekt der Touchpoint-Reichhaltigkeits-Observation zu, nicht einem Chance-Account", () => {
    const world = SCENARIO_WORLDS["strategischer-tag"];
    const chanceAccounts = world.observations.filter((o) => o.kind === "chance-account-repeat-business");
    // Bestätigt, dass dieses Szenario tatsächlich die variable Kardinalität zeigt, die
    // den Fehler ursprünglich ausgelöst hat (baseline hat 2, hier deutlich mehr).
    expect(chanceAccounts.length).toBeGreaterThan(2);

    const touchpoint = world.observations.find((o) => o.kind === "touchpoint-richness-won-vs-lost")!;
    const touchpointTier = world.groundTruth.priorities.find((p) => p.observationId === touchpoint.id)?.tier;
    expect(touchpointTier).toBe("sekundaer");

    for (const chanceAccount of chanceAccounts) {
      const tier = world.groundTruth.priorities.find((p) => p.observationId === chanceAccount.id)?.tier;
      expect(tier).toBe("unterstuetzend");
    }
  });

  it("operativer-fokus (nur 1 Chance-Account-Instanz statt 2 wie in baseline) lässt die Touchpoint-Reichhaltigkeits-Observation nicht auf den Default-Tier zurückfallen", () => {
    const world = SCENARIO_WORLDS["operativer-fokus"];
    const chanceAccounts = world.observations.filter((o) => o.kind === "chance-account-repeat-business");
    expect(chanceAccounts.length).toBeLessThan(2);

    const touchpoint = world.observations.find((o) => o.kind === "touchpoint-richness-won-vs-lost");
    if (touchpoint) {
      const tier = world.groundTruth.priorities.find((p) => p.observationId === touchpoint.id)?.tier;
      expect(tier).toBe("sekundaer");
    }
  });
});
