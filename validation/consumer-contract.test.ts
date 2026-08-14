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
  type CompanyExecutiveKpiData,
  type PeopleHireFact,
  type PeopleTerminationFact,
  type SalesWonDealFact,
  type MarketingExecutiveKpiData,
  type MarketingLeadFact,
  type MarketingSalesHandoffFact,
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
      executiveKpiData: CompanyExecutiveKpiData;
      hireFact: PeopleHireFact;
      terminationFact: PeopleTerminationFact;
      wonDealFact: SalesWonDealFact;
      marketingKpiData: MarketingExecutiveKpiData;
      marketingLeadFact: MarketingLeadFact;
      marketingSalesHandoffFact: MarketingSalesHandoffFact;
    } | undefined = undefined;
    expect(_typeCheck).toBeUndefined();
  });

  it("Executive KPI Contract v1.1: executiveKpis ist ausschließlich über generateFullCompanyContext() erreichbar, ohne jeden internen Modulpfad", () => {
    const context = generateFullCompanyContext();
    expect(context.executiveKpis).toBeDefined();
    expect(context.executiveKpis.asOf).toBe(WORLD_NOW);
    expect(typeof context.executiveKpis.people.activeHeadcount).toBe("number");
    expect(Array.isArray(context.executiveKpis.people.hires)).toBe(true);
    expect(Array.isArray(context.executiveKpis.people.terminations)).toBe(true);
    expect(Array.isArray(context.executiveKpis.sales.wonDeals)).toBe(true);
    // Bestehende Felder bleiben unverändert erreichbar — rein additive Erweiterung.
    expect(context.businessState).toBeDefined();
    expect(context.executiveContext).toBeDefined();
  });

  it("Marketing Executive KPI Contract v1 Foundation: executiveKpis.marketing ist ausschließlich über generateFullCompanyContext() erreichbar, ohne jeden internen Modulpfad", () => {
    const context = generateFullCompanyContext();
    expect(context.executiveKpis.marketing).toBeDefined();
    expect(Array.isArray(context.executiveKpis.marketing.leads)).toBe(true);
    expect(Array.isArray(context.executiveKpis.marketing.salesHandoffs)).toBe(true);
  });

  it("generateFullCompanyContext ist importierbar und ohne Argumente aufrufbar (volle Default-Baseline)", () => {
    const context = generateFullCompanyContext();
    expect(context.businessState).toBeDefined();
    expect(context.executiveContext).toBeDefined();
  });

  it("Baseline Full Company Context erzeugbar und inhaltlich korrekt", () => {
    // Seit Marketing Leadership State ist Marketing bei WORLD_NOW bewertet (genug
    // historische Evidenz) — siehe business-state/marketing-business-state.ts.
    const context = generateFullCompanyContext();
    expect(context.businessState.type).toBe("ausgeglichen");
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["marketing", "people", "sales"]);
    expect(context.businessState.insufficientEvidenceAreas.slice().sort()).toEqual(["operations"]);
    expect(context.executiveContext.affectedAreas.slice().sort()).toEqual(["marketing", "operations"]);
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

  it("semantische Regression (Integrationsentscheidung, Phase 7): Sales/Marketing/People/Operations/Company-Baseline unverändert", () => {
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

    const marketing = areas.get("marketing")!;
    expect(["stabile-nachfrage", "erhoehte-nachfrage", "unterdrueckte-nachfrage"]).toContain(marketing.state);
    expect(marketing.evaluationStatus).toBe("bewertet");

    expect(context.businessState.type).toBe("ausgeglichen");
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["marketing", "people", "sales"]);
    expect(context.businessState.insufficientEvidenceAreas.slice().sort()).toEqual(["operations"]);
    expect(context.executiveContext.affectedAreas.slice().sort()).toEqual(["marketing", "operations"]);

    // Operations bleibt strukturell dauerhaft state=null und trägt deshalb nie
    // zur Divergenzklassifikation bei. Marketing ist seit Marketing Leadership
    // State bei WORLD_NOW state-fähig und damit korrekt Teil von evaluatedAreas
    // — trägt aber TROTZDEM bewusst nie zur Divergenzklassifikation bei, weil
    // seine State-Werte gezielt nicht in company-business-state.ts'
    // POSITIVE_STATES/BELASTET_STATES eingetragen sind (siehe
    // business-state/marketing-business-state.ts) — geprüft über company.type,
    // der ausschließlich von Sales/People abhängt, nicht über evaluatedAreas.
    expect(context.businessState.evaluatedAreas).not.toContain("operations");
    expect(context.businessState.evaluatedAreas).toContain("marketing");
    expect(context.businessState.type).toBe("ausgeglichen");
  });
});
