import { describe, expect, it } from "vitest";
// Bewusst AUSSCHLIESSLICH aus dem Public Entry Point importiert — kein einziger
// interner Modulpfad (engine/, world/, company/, snapshot/ usw.) in dieser Datei.
// Simuliert exakt, was ein externer Consumer (sales-platform, künftig via Git
// Dependency) nach diesem Schritt tun können muss (Integrationsentscheidung,
// Step A, Phase 6).
import {
  generateFullCompanyContext,
  type FullCompanyContext,
  type CompanyAreaKey,
  type CompanyAreaKind,
  type CompanyAreaObservationSummary,
  type CompanyAreaSummary,
  type CompanyBusinessStateType,
  type CompanyBusinessStateSnapshot,
  type CompanyExecutiveContextSnapshot,
  type CompanyCrossAreaLink,
  type WorldSnapshot,
  type ScenarioProfile,
  BASELINE_PROFILE,
  SCENARIO_PROFILES,
  WORLD_NOW,
} from "../index";

describe("Public Consumer Contract (Step A, Phase 6): Konsum ausschließlich über index.ts", () => {
  it("Public Types sind importierbar (Typprüfung allein durch erfolgreichen Compile-Lauf erbracht)", () => {
    const _typeCheck: {
      areaKey: CompanyAreaKey;
      areaKind: CompanyAreaKind;
      observationSummary: CompanyAreaObservationSummary;
      areaSummary: CompanyAreaSummary;
      businessStateType: CompanyBusinessStateType;
      businessState: CompanyBusinessStateSnapshot;
      executiveContext: CompanyExecutiveContextSnapshot;
      crossAreaLink: CompanyCrossAreaLink;
      worldSnapshot: WorldSnapshot;
      scenarioProfile: ScenarioProfile;
      fullContext: FullCompanyContext;
    } | undefined = undefined;
    expect(_typeCheck).toBeUndefined();
  });

  it("generateFullCompanyContext ist importierbar und ohne Argumente aufrufbar (volle Default-Baseline)", () => {
    const context = generateFullCompanyContext();
    expect(context.businessState).toBeDefined();
    expect(context.executiveContext).toBeDefined();
  });

  it("Baseline Full Company Context erzeugbar und inhaltlich korrekt", () => {
    const context = generateFullCompanyContext();
    expect(context.businessState.type).toBe("ausgeglichen");
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["people", "sales"]);
    expect(context.businessState.insufficientEvidenceAreas).toEqual(["operations"]);
    expect(context.executiveContext.affectedAreas).toEqual(["operations"]);
  });

  it("BASELINE_PROFILE/SCENARIO_PROFILES/WORLD_NOW sind importierbar und nutzbar, um ein Szenario/einen Zeitpunkt zu wählen", () => {
    expect(BASELINE_PROFILE.id).toBe("baseline");
    expect(SCENARIO_PROFILES.length).toBeGreaterThan(0);
    expect(typeof WORLD_NOW).toBe("string");

    const explicit = generateFullCompanyContext(424242, BASELINE_PROFILE, WORLD_NOW);
    const implicit = generateFullCompanyContext();
    expect(explicit).toEqual(implicit);
  });

  it("keine tiefen internen Imports erforderlich — dieser gesamte Test kommt mit genau einem Import-Statement aus dem Public Entry Point aus", () => {
    // Strukturelle Selbstprüfung: bewusst kein zweites Import-Statement in dieser
    // Datei (siehe Datei-Header) — die einzige echte Prüfung ist, dass die Tests
    // oben ohne jeden internen Pfad kompilieren und laufen.
    expect(true).toBe(true);
  });

  it("Ergebnis ist deterministisch (gleiche Default-Parameter → exakt gleicher Full Company Context)", () => {
    expect(generateFullCompanyContext()).toEqual(generateFullCompanyContext());
  });

  it("semantische Regression (Integrationsentscheidung, Phase 7): Sales/People/Operations/Company-Baseline unverändert", () => {
    const context = generateFullCompanyContext();
    const areas = new Map(context.executiveContext.areaSummaries.map((a) => [a.key, a]));

    const sales = areas.get("sales")!;
    expect(sales.evaluationStatus).toBe("bewertet");

    const people = areas.get("people")!;
    expect(people.state).toBe("ausgeglichen");
    expect(people.evaluationStatus).toBe("bewertet");

    const operations = areas.get("operations")!;
    expect(operations.state).toBeNull();
    expect(operations.evaluationStatus).toBe("unzureichende-evidenz");

    expect(context.businessState.type).toBe("ausgeglichen");
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["people", "sales"]);
    expect(context.businessState.insufficientEvidenceAreas).toEqual(["operations"]);
    expect(context.executiveContext.affectedAreas).toEqual(["operations"]);

    // Operations trägt nie zur Divergenzklassifikation bei.
    expect(context.businessState.evaluatedAreas).not.toContain("operations");
  });
});
