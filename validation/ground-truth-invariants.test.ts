import { describe, expect, it } from "vitest";
import { OBSERVATIONS } from "../observations/observations";
import { GROUND_TRUTH_SNAPSHOTS, generateGroundTruthSnapshot } from "../ground-truth/ground-truth";
import { WORLD_NOW } from "../timeline/world-clock";
import {
  checkGroundTruthGroupsNoCycles,
  checkGroundTruthNoDuplicates,
  checkGroundTruthObservationsExist,
  checkGroundTruthPrioritiesUnique,
  checkGroundTruthReferencesBelongToSnapshot,
  checkGroundTruthTimestampValid,
} from "./invariants";

describe("GroundTruthSnapshot", () => {
  it("referenziert nur existierende Observations", () => {
    expect(checkGroundTruthObservationsExist(GROUND_TRUTH_SNAPSHOTS, OBSERVATIONS)).toEqual([]);
  });

  it("priorities/observationGroups referenzieren nur Observations aus activeObservationIds", () => {
    expect(checkGroundTruthReferencesBelongToSnapshot(GROUND_TRUTH_SNAPSHOTS)).toEqual([]);
  });

  it("hat keine Duplikate (Observations, Gruppen-IDs, Gruppen-Mitglieder)", () => {
    expect(checkGroundTruthNoDuplicates(GROUND_TRUTH_SNAPSHOTS)).toEqual([]);
  });

  it("Gruppen enthalten keine Gruppen-Zyklen", () => {
    expect(checkGroundTruthGroupsNoCycles(GROUND_TRUTH_SNAPSHOTS)).toEqual([]);
  });

  it("jede aktive Observation hat genau eine Priorität", () => {
    expect(checkGroundTruthPrioritiesUnique(GROUND_TRUTH_SNAPSHOTS)).toEqual([]);
  });

  it("timestamp ist gültig (<= WORLD_NOW, >= alle Observation.generatedAt)", () => {
    expect(checkGroundTruthTimestampValid(GROUND_TRUTH_SNAPSHOTS, OBSERVATIONS)).toEqual([]);
  });

  it("enthält alle bestehenden Observations", () => {
    const snapshot = GROUND_TRUTH_SNAPSHOTS[0]!;
    expect(snapshot.activeObservationIds.length).toBe(OBSERVATIONS.length);
  });

  it("Priorität ist NICHT mechanisch aus severity abgeleitet", () => {
    // Beweist die Entkopplung an einem konkreten Gegenbeispiel in beide Richtungen,
    // statt nur zu behaupten, dass keine Ableitungsfunktion mehr existiert:
    // obs-00001 hat severity "niedrig", aber Priorität "sekundaer" (höher als die
    // severity-gespiegelte Zuordnung nahelegen würde); obs-00010 hat severity
    // "mittel", aber Priorität "unterstuetzend" (niedriger).
    const snapshot = GROUND_TRUTH_SNAPSHOTS[0]!;
    const priorityById = new Map(snapshot.priorities.map((p) => [p.observationId, p.tier]));
    const observationById = new Map(OBSERVATIONS.map((o) => [o.id, o]));

    expect(observationById.get("obs-00001")?.severity).toBe("niedrig");
    expect(priorityById.get("obs-00001")).toBe("sekundaer");

    expect(observationById.get("obs-00010")?.severity).toBe("mittel");
    expect(priorityById.get("obs-00010")).toBe("unterstuetzend");

    // Über den gesamten Snapshot: mindestens eine Observation weicht von der alten,
    // rein severity-gespiegelten Zuordnung ab.
    const mirroredSeverity = (severity: string) =>
      severity === "hoch" ? "primaer" : severity === "mittel" ? "sekundaer" : "unterstuetzend";
    const deviations = snapshot.priorities.filter((p) => {
      const observation = observationById.get(p.observationId)!;
      return p.tier !== mirroredSeverity(observation.severity);
    });
    expect(deviations.length).toBeGreaterThan(0);
  });

  it("verändert niemals severity oder confidence der zugrunde liegenden Observation", () => {
    // Ground Truth besitzt gar kein Feld, um severity/confidence zu tragen — dieser
    // Test dokumentiert die Invariante trotzdem explizit: die Observations selbst
    // sind nach Snapshot-Erzeugung unverändert.
    const before = OBSERVATIONS.map((o) => ({ id: o.id, severity: o.severity, confidence: o.confidence }));
    generateGroundTruthSnapshot(OBSERVATIONS, WORLD_NOW);
    const after = OBSERVATIONS.map((o) => ({ id: o.id, severity: o.severity, confidence: o.confidence }));
    expect(after).toEqual(before);
  });
});

describe("Determinismus", () => {
  it("gleicher Weltzustand erzeugt einen deep-identischen Snapshot", () => {
    const a = generateGroundTruthSnapshot(OBSERVATIONS, WORLD_NOW);
    const b = generateGroundTruthSnapshot(OBSERVATIONS, WORLD_NOW);
    // id ist eine reine Funktion des Snapshot-Inhalts (kein modulweiter Zähler mehr) —
    // muss für denselben Weltzustand daher inklusive id deep-identisch sein.
    expect(a).toEqual(b);
  });
});
