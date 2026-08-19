import { describe, expect, it } from "vitest";
import { SCENARIO_WORLDS } from "../engine/generator";
import { generateBusinessStateSnapshot } from "../business-state/business-state";
import { generateExecutiveContextSnapshot } from "../executive-context/executive-context";
import { generatePeopleBusinessStateSnapshot } from "../business-state/people-business-state";
import { PEOPLE_OBSERVATIONS, generatePeopleObservations } from "../observations/people-observations";
import { generateGroundTruthSnapshot, PEOPLE_GROUND_TRUTH_SNAPSHOTS } from "../ground-truth/ground-truth";
import { generateOperationsDeliveryFairShareObservation } from "../observations/operations-observations";
import { EMPLOYEES, type Employee } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS, generateEmployeeTerminatedEvents } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { WORLD_NOW, WORLD_TIMELINE_START } from "../timeline/world-clock";
import {
  generateSalesAreaSummary,
  generateMarketingAreaSummary,
  generatePeopleAreaSummary,
  generateOperationsAreaSummary,
} from "../company/company-area-summaries";
import { generateMarketingDemandGenerationObservation, generateMarketingDemandRegimeSignalObservation } from "../observations/marketing-observations";
import { generateMarketingBusinessStateSnapshot } from "../business-state/marketing-business-state";
import type { CompanyAreaSummary } from "../company/company-area";
import { generateCompanyBusinessStateSnapshot } from "../company/company-business-state";
import { generateCompanyExecutiveContextSnapshot } from "../company/company-executive-context";
import { generateCompanyContextFromSnapshot } from "../company/company-context";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";

const world = SCENARIO_WORLDS.baseline;

function realAreaSummaries(): CompanyAreaSummary[] {
  const salesBusinessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
  const salesExecutiveContext = generateExecutiveContextSnapshot(salesBusinessState, world.groundTruth);
  const salesSummary = generateSalesAreaSummary(salesBusinessState, salesExecutiveContext, world.groundTruth, world.observations);

  const peopleGroundTruth = PEOPLE_GROUND_TRUTH_SNAPSHOTS[0]!;
  const peopleBusinessState = generatePeopleBusinessStateSnapshot(peopleGroundTruth, PEOPLE_OBSERVATIONS);
  const peopleSummary = generatePeopleAreaSummary(peopleBusinessState, peopleGroundTruth, PEOPLE_OBSERVATIONS);

  const operationsObservation = generateOperationsDeliveryFairShareObservation(world.deliveryUnits, EMPLOYEES, WORLD_NOW);
  const operationsGroundTruth = generateGroundTruthSnapshot(operationsObservation ? [operationsObservation] : [], WORLD_NOW);
  // Completed Delivery Duration Observation V1 / Queue Duration Observation V1 /
  // Current Delivery Queue Snapshot V1 bewusst nicht verdrahtet: dieser Helfer
  // prüft Company-weite Divergenzlogik, nicht die neuen Observations selbst
  // (dediziert getestet in validation/completed-delivery-duration.test.ts,
  // validation/queue-duration.test.ts und
  // validation/current-delivery-queue-snapshot.test.ts) — undefined hält das
  // bestehende, bereits validierte Verhalten dieser Datei unverändert.
  const operationsSummary = generateOperationsAreaSummary(operationsObservation, undefined, undefined, undefined, undefined, undefined, operationsGroundTruth);

  const marketingObservation = generateMarketingDemandGenerationObservation(world.leads, world.opportunities, WORLD_NOW);
  const marketingDemandSignal = generateMarketingDemandRegimeSignalObservation(world.leads, WORLD_NOW, WORLD_TIMELINE_START);
  const marketingGroundTruth = generateGroundTruthSnapshot(
    [...(marketingObservation ? [marketingObservation] : []), ...(marketingDemandSignal ? [marketingDemandSignal] : [])],
    WORLD_NOW,
  );
  const marketingBusinessState = marketingDemandSignal
    ? generateMarketingBusinessStateSnapshot(marketingGroundTruth, marketingDemandSignal)
    : undefined;
  const marketingSummary = generateMarketingAreaSummary(marketingObservation, marketingDemandSignal, marketingBusinessState, marketingGroundTruth);

  return [salesSummary, marketingSummary, peopleSummary, operationsSummary];
}

// Isolierte Fixtures (Phase 18/19) — konstruieren CompanyAreaSummary direkt, ohne
// produktive World-Daten zu verändern. Testet die Divergenzregel (Phase 10) in
// Isolation von der tatsächlichen Sales-/People-Generierung.
function fixtureArea(overrides: Partial<CompanyAreaSummary> & Pick<CompanyAreaSummary, "key">): CompanyAreaSummary {
  const base: CompanyAreaSummary = {
    key: overrides.key,
    kind: overrides.key === "people" ? "cross-cutting-dimension" : "department",
    state: "ausgeglichen",
    evaluationStatus: "bewertet",
    statement: "fixture statement",
    topObservations: [],
    relevantMetrics: {},
    evidenceIds: [`fixture-evidence-${overrides.key}`],
  };
  return { ...base, ...overrides };
}

const FORBIDDEN_NORMATIVE_PATTERNS: RegExp[] = [
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

describe("Company Area Summary: Strukturinvarianten", () => {
  it("1. exakt vier Areas: sales, marketing, operations, people", () => {
    const summaries = realAreaSummaries();
    expect(summaries.map((s) => s.key).sort()).toEqual(["marketing", "operations", "people", "sales"]);
  });

  it("2. Sales kind = department", () => {
    expect(realAreaSummaries().find((s) => s.key === "sales")!.kind).toBe("department");
  });

  it("3. Operations kind = department", () => {
    expect(realAreaSummaries().find((s) => s.key === "operations")!.kind).toBe("department");
  });

  it("3b. Marketing kind = department, bei WORLD_NOW bewertet (First-Class Company Area, seit Marketing Leadership State state-fähig)", () => {
    const marketing = realAreaSummaries().find((s) => s.key === "marketing")!;
    expect(marketing.kind).toBe("department");
    expect(marketing.departmentId).toBe("dept-marketing");
    expect(["stabile-nachfrage", "erhoehte-nachfrage", "unterdrueckte-nachfrage"]).toContain(marketing.state);
    expect(marketing.evaluationStatus).toBe("bewertet");
    expect(marketing.relevantMetrics).not.toEqual({});
  });

  it("4. People kind = cross-cutting-dimension", () => {
    const people = realAreaSummaries().find((s) => s.key === "people")!;
    expect(people.kind).toBe("cross-cutting-dimension");
    expect(people.departmentId).toBeUndefined();
  });

  it("5. Operations state = null, evaluationStatus = unzureichende-evidenz", () => {
    const operations = realAreaSummaries().find((s) => s.key === "operations")!;
    expect(operations.state).toBeNull();
    expect(operations.evaluationStatus).toBe("unzureichende-evidenz");
  });

  it("6. People Baseline = ausgeglichen (ehrlich, keine aktive Observation)", () => {
    const people = realAreaSummaries().find((s) => s.key === "people")!;
    expect(people.state).toBe("ausgeglichen");
    expect(people.topObservations).toEqual([]);
    expect(people.evidenceIds).toEqual([]);
  });

  it("7. Area Summary Generierung ist deterministisch (gleiche Eingaben → gleiches Ergebnis)", () => {
    expect(realAreaSummaries()).toEqual(realAreaSummaries());
  });
});

describe("Company Business State: department-divergenz-Regel (Phase 10/18/19)", () => {
  it("8. Divergenz: Sales positiv + People belastet", () => {
    const areas = [
      fixtureArea({ key: "sales", state: "strategischer-freiraum" }),
      fixtureArea({ key: "people", state: "letzte-person-verbleibt" }),
      fixtureArea({ key: "operations", kind: "department", state: null, evaluationStatus: "unzureichende-evidenz", evidenceIds: [] }),
    ];
    const result = generateCompanyBusinessStateSnapshot(areas, WORLD_NOW);
    expect(result.type).toBe("department-divergenz");
  });

  it("9. Divergenz: Sales belastet + People ausgeglichen (Fall D)", () => {
    const areas = [
      fixtureArea({ key: "sales", state: "operative-anspannung" }),
      fixtureArea({ key: "people", state: "ausgeglichen" }),
      fixtureArea({ key: "operations", kind: "department", state: null, evaluationStatus: "unzureichende-evidenz", evidenceIds: [] }),
    ];
    const result = generateCompanyBusinessStateSnapshot(areas, WORLD_NOW);
    expect(result.type).toBe("department-divergenz");
  });

  it("10. Fall A: Sales ausgeglichen + People ausgeglichen → keine Divergenz", () => {
    const areas = [
      fixtureArea({ key: "sales", state: "ausgeglichen" }),
      fixtureArea({ key: "people", state: "ausgeglichen" }),
      fixtureArea({ key: "operations", kind: "department", state: null, evaluationStatus: "unzureichende-evidenz", evidenceIds: [] }),
    ];
    expect(generateCompanyBusinessStateSnapshot(areas, WORLD_NOW).type).toBe("ausgeglichen");
  });

  it("11. Fall B: Sales belastet + People belastet → keine Divergenz (kein Widerspruch)", () => {
    const areas = [
      fixtureArea({ key: "sales", state: "verlangsamte-pipeline" }),
      fixtureArea({ key: "people", state: "rolle-unbesetzt" }),
      fixtureArea({ key: "operations", kind: "department", state: null, evaluationStatus: "unzureichende-evidenz", evidenceIds: [] }),
    ];
    expect(generateCompanyBusinessStateSnapshot(areas, WORLD_NOW).type).toBe("ausgeglichen");
  });

  it("12. Fall C / keine Divergenz allein durch Operations-Konzentration", () => {
    const areas = [
      fixtureArea({ key: "sales", state: "strategischer-freiraum" }),
      fixtureArea({ key: "people", state: "ausgeglichen" }),
      fixtureArea({
        key: "operations",
        kind: "department",
        state: null,
        evaluationStatus: "unzureichende-evidenz",
        statement: "stark konzentriert (Fakt, keine Bewertung)",
        evidenceIds: ["delivery-fixture-1", "delivery-fixture-2"],
      }),
    ];
    const result = generateCompanyBusinessStateSnapshot(areas, WORLD_NOW);
    expect(result.type).toBe("ausgeglichen");
    expect(result.evaluatedAreas).not.toContain("operations");
  });

  it("13. reale Baseline bei WORLD_NOW: ausgeglichen (Sales+People beide ausgeglichen, Marketing trägt bewusst nicht zur Divergenzprüfung bei)", () => {
    // Seit Marketing Leadership State ist Marketing bei WORLD_NOW ebenfalls
    // bewertet, aber bewusst NICHT in POSITIVE_STATES/BELASTET_STATES eingetragen
    // (siehe business-state/marketing-business-state.ts) — company.type bleibt
    // deshalb unverändert ausschließlich von Sales+People abhängig.
    const summaries = realAreaSummaries();
    const result = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    expect(result.type).toBe("ausgeglichen");
    expect(result.evaluatedAreas.sort()).toEqual(["marketing", "people", "sales"]);
    expect(result.insufficientEvidenceAreas).toEqual(["operations"]);
  });
});

describe("Company Business State: Strukturinvarianten", () => {
  it("14. evaluatedAreas enthält Operations nie", () => {
    for (const summaries of [
      realAreaSummaries(),
      [
        fixtureArea({ key: "sales", state: "operative-anspannung" }),
        fixtureArea({ key: "people", state: "letzte-person-verbleibt" }),
        fixtureArea({ key: "operations", kind: "department", state: null, evaluationStatus: "unzureichende-evidenz", evidenceIds: [] }),
      ],
    ]) {
      const result = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
      expect(result.evaluatedAreas).not.toContain("operations");
    }
  });

  it("15. insufficientEvidenceAreas korrekt (enthält Operations weiterhin dauerhaft; Marketing nur, solange nicht genug historische Evidenz vorliegt)", () => {
    // Bei WORLD_NOW liegt für Marketing inzwischen genug historische Evidenz vor
    // (seit Marketing Leadership State) — Operations bleibt strukturell dauerhaft
    // unbewertet (Domain Decision 3, unverändert).
    const result = generateCompanyBusinessStateSnapshot(realAreaSummaries(), WORLD_NOW);
    expect(result.insufficientEvidenceAreas).toEqual(["operations"]);
  });

  it("16. supportingEvidenceIds sind Teilmenge existierender Area-Evidence", () => {
    const summaries = realAreaSummaries();
    const allEvidenceIds = new Set(summaries.flatMap((s) => s.evidenceIds));
    const result = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    for (const id of result.supportingEvidenceIds) {
      expect(allEvidenceIds.has(id)).toBe(true);
    }
  });

  it("17. gleiche Eingaben → exakt gleicher Company Business State Snapshot (Determinismus)", () => {
    const summaries = realAreaSummaries();
    expect(generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW)).toEqual(
      generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW),
    );
  });

  it("18. timestamp entspricht dem übergebenen Snapshot-Zeitpunkt", () => {
    const result = generateCompanyBusinessStateSnapshot(realAreaSummaries(), "2025-01-01");
    expect(result.timestamp).toBe("2025-01-01");
  });

  it("19. Company Statements enthalten keine normative/empfehlende Sprache", () => {
    const results = [
      generateCompanyBusinessStateSnapshot(realAreaSummaries(), WORLD_NOW),
      generateCompanyBusinessStateSnapshot(
        [
          fixtureArea({ key: "sales", state: "strategischer-freiraum" }),
          fixtureArea({ key: "people", state: "letzte-person-verbleibt" }),
          fixtureArea({ key: "operations", kind: "department", state: null, evaluationStatus: "unzureichende-evidenz", evidenceIds: [] }),
        ],
        WORLD_NOW,
      ),
    ];
    for (const result of results) {
      for (const pattern of FORBIDDEN_NORMATIVE_PATTERNS) {
        expect(pattern.test(result.statement), `"${result.statement}" matched ${pattern}`).toBe(false);
      }
    }
  });
});

describe("Company Executive Context: affectedAreas, topSituations, Cross-Area-Link", () => {
  it("20. Operations kann affected sein, ohne bewertet zu sein", () => {
    const summaries = realAreaSummaries();
    const businessState = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    const context = generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW);
    expect(context.affectedAreas).toContain("operations");
    expect(businessState.evaluatedAreas).not.toContain("operations");
  });

  it("20b. state===null-Areas mit aktiver Evidenz gelten weiterhin generisch als affected, ohne bewertet zu sein (synthetisch, unabhängig vom heutigen Marketing-Evidenzstand)", () => {
    // AKTUALISIERT (Marketing Leadership State): bei WORLD_NOW liegt für Marketing
    // inzwischen genug historische Evidenz vor, wodurch die reale Welt diese Regel
    // für Marketing nicht mehr exerciert (Marketing hat jetzt state!==null, siehe
    // Test 3b). Die zugrunde liegende, weiterhin geltende generische Regel
    // (isAreaAffected in company-executive-context.ts: state===null UND
    // evidenceIds nicht leer → affected, ohne evaluatedAreas beizutreten) wird
    // deshalb hier synthetisch, RNG-unabhängig bewiesen — exakt dasselbe Muster
    // wie Test 20 für Operations, nur mit einer state===null-Marketing-Fixture.
    const summaries = [
      fixtureArea({ key: "sales", state: "ausgeglichen" }),
      fixtureArea({ key: "people", state: "ausgeglichen" }),
      fixtureArea({ key: "marketing", kind: "department", state: null, evaluationStatus: "unzureichende-evidenz", evidenceIds: ["marketing-obs-demand-generation-test"] }),
      fixtureArea({ key: "operations", kind: "department", state: null, evaluationStatus: "unzureichende-evidenz", evidenceIds: [] }),
    ];
    const businessState = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    const context = generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW);
    expect(context.affectedAreas).toContain("marketing");
    expect(businessState.evaluatedAreas).not.toContain("marketing");
  });

  it("21. topSituations.length <= 3", () => {
    const summaries = realAreaSummaries();
    const businessState = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    const context = generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW);
    expect(context.topSituations.length).toBeLessThanOrEqual(3);
  });

  it("22. Cross-Area-Link sales→operations ist gültig (kausal, referenziert reale DeliveryUnit-IDs)", () => {
    const summaries = realAreaSummaries();
    const businessState = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    const context = generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW);
    expect(context.crossAreaLinks).toHaveLength(1);
    const link = context.crossAreaLinks[0]!;
    expect(link.from).toBe("sales");
    expect(link.to).toBe("operations");
    expect(link.kind).toBe("kausal");
    expect(link.evidenceIds.length).toBeGreaterThan(0);
    for (const id of link.evidenceIds) {
      expect(world.deliveryUnits.some((u) => u.id === id)).toBe(true);
    }
  });

  it("23. keine zweite Cross-Area-Kette (People→Sales, People→Operations, Operations→Sales o. Ä.)", () => {
    const summaries = realAreaSummaries();
    const businessState = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    const context = generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW);
    expect(context.crossAreaLinks.every((l) => l.from === "sales" && l.to === "operations")).toBe(true);
  });

  it("24. Executive Context Statements (topSituations) enthalten keine normative Sprache", () => {
    const summaries = realAreaSummaries();
    const businessState = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    const context = generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW);
    for (const situation of context.topSituations) {
      for (const pattern of FORBIDDEN_NORMATIVE_PATTERNS) {
        expect(pattern.test(situation), `"${situation}" matched ${pattern}`).toBe(false);
      }
    }
  });

  it("25. insufficientEvidenceAreas im Executive Context identisch zu Business State", () => {
    const summaries = realAreaSummaries();
    const businessState = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    const context = generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW);
    expect(context.insufficientEvidenceAreas).toEqual(businessState.insufficientEvidenceAreas);
  });

  it("26. gleiche Eingaben → exakt gleicher Executive Context Snapshot (Determinismus)", () => {
    const summaries = realAreaSummaries();
    const businessState = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    expect(generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW)).toEqual(
      generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW),
    );
  });
});

describe("Backward Explainability (Phase 20)", () => {
  it("27. Sales: Company Summary → Sales Executive Context → Sales Business State → Sales Ground Truth → Observation", () => {
    const salesBusinessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const salesExecutiveContext = generateExecutiveContextSnapshot(salesBusinessState, world.groundTruth);
    const salesSummary = generateSalesAreaSummary(salesBusinessState, salesExecutiveContext, world.groundTruth, world.observations);

    expect(salesSummary.statement).toBe(salesExecutiveContext.relevanceStatement);
    expect(salesSummary.state).toBe(salesBusinessState.type);
    for (const id of salesSummary.evidenceIds) {
      expect(salesBusinessState.supportingObservationIds).toContain(id);
      expect(world.groundTruth.activeObservationIds).toContain(id);
      expect(world.observations.some((o) => o.id === id)).toBe(true);
    }
  });

  it("28. People Baseline (keine aktive Observation): keine künstliche Event-Kette", () => {
    const peopleGroundTruth = PEOPLE_GROUND_TRUTH_SNAPSHOTS[0]!;
    const peopleBusinessState = generatePeopleBusinessStateSnapshot(peopleGroundTruth, PEOPLE_OBSERVATIONS);
    const peopleSummary = generatePeopleAreaSummary(peopleBusinessState, peopleGroundTruth, PEOPLE_OBSERVATIONS);
    expect(peopleSummary.evidenceIds).toEqual([]);
    expect(peopleBusinessState.supportingObservationIds).toEqual([]);
  });

  it("29. People positive Testfixture: Company Summary → People Business State → People Ground Truth → People Observation → EmployeeTerminated", () => {
    // Isolierte Fixture (reales, hypothetisches Austrittsevent auf einem der bereits
    // in Step 1/Phase 8 identifizierten realen 2-Personen-Teams) — keine produktiven
    // Daten verändert.
    const fixtureEmployees: Employee[] = EMPLOYEES.map((e) =>
      e.id === "emp-dennis-wulff" ? { ...e, terminatedAt: "2025-06-01" } : e,
    );
    const terminatedEvents = generateEmployeeTerminatedEvents(fixtureEmployees);
    const observations = generatePeopleObservations(terminatedEvents, fixtureEmployees);
    expect(observations.length).toBeGreaterThan(0);

    const groundTruth = generateGroundTruthSnapshot(observations, "2025-06-01");
    const businessState = generatePeopleBusinessStateSnapshot(groundTruth, observations);
    const summary = generatePeopleAreaSummary(businessState, groundTruth, observations);

    expect(summary.state).toBe("letzte-person-verbleibt");
    expect(summary.evidenceIds.length).toBeGreaterThan(0);
    for (const id of summary.evidenceIds) {
      expect(businessState.supportingObservationIds).toContain(id);
      const observation = observations.find((o) => o.id === id)!;
      expect(observation).toBeDefined();
      const referencesTermination = observation.derivedFrom.some((refId) =>
        terminatedEvents.some((e) => e.id === refId),
      );
      expect(referencesTermination).toBe(true);
    }
  });

  it("30. Operations: Company Summary → Operations Ground Truth → Operations Observation → DeliveryUnit → Opportunity", () => {
    const operationsObservation = generateOperationsDeliveryFairShareObservation(world.deliveryUnits, EMPLOYEES, WORLD_NOW)!;
    const operationsGroundTruth = generateGroundTruthSnapshot([operationsObservation], WORLD_NOW);
    const summary = generateOperationsAreaSummary(operationsObservation, undefined, undefined, undefined, undefined, undefined, operationsGroundTruth);

    expect(operationsGroundTruth.activeObservationIds).toContain(operationsObservation.id);
    for (const id of summary.evidenceIds) {
      const unit = world.deliveryUnits.find((u) => u.id === id);
      expect(unit).toBeDefined();
      const opportunity = world.opportunities.find((o) => o.id === unit!.opportunityId);
      expect(opportunity).toBeDefined();
      expect(opportunity!.currentStage).toBe("gewonnen");
    }
  });

  it("30b. Marketing: Company Summary → Marketing Ground Truth → Marketing Observation → Lead/Opportunity", () => {
    const marketingObservation = generateMarketingDemandGenerationObservation(world.leads, world.opportunities, WORLD_NOW)!;
    const marketingGroundTruth = generateGroundTruthSnapshot([marketingObservation], WORLD_NOW);
    const summary = generateMarketingAreaSummary(marketingObservation, undefined, undefined, marketingGroundTruth);

    expect(marketingGroundTruth.activeObservationIds).toContain(marketingObservation.id);
    expect(summary.evidenceIds.length).toBeGreaterThan(0);
    for (const id of summary.evidenceIds) {
      const isLead = world.leads.some((l) => l.id === id);
      const isOpportunity = world.opportunities.some((o) => o.id === id);
      expect(isLead || isOpportunity).toBe(true);
    }
  });

  it("31. Cross-Area: Sales→Operations Link → Operations Observation → DeliveryUnit → Opportunity begründet die Unit tatsächlich", () => {
    const summaries = realAreaSummaries();
    const businessState = generateCompanyBusinessStateSnapshot(summaries, WORLD_NOW);
    const context = generateCompanyExecutiveContextSnapshot(businessState.id, summaries, WORLD_NOW);
    const link = context.crossAreaLinks[0]!;
    for (const id of link.evidenceIds) {
      const unit = world.deliveryUnits.find((u) => u.id === id)!;
      expect(unit).toBeDefined();
      const opportunity = world.opportunities.find((o) => o.id === unit.opportunityId)!;
      expect(opportunity).toBeDefined();
      expect(opportunity.currentStage).toBe("gewonnen");
      expect(opportunity.closedAt).toBe(unit.startDate);
      expect(opportunity.accountId).toBe(unit.accountId);
    }
  });
});

describe("Snapshot-Integration (Phase 21): generateCompanyContextFromSnapshot, keine Zukunftskenntnis", () => {
  function toSource(): WorldSnapshotSource {
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

  it("32. generateCompanyContextFromSnapshot bei WORLD_NOW entspricht der direkt komponierten Baseline", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const salesBusinessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const salesExecutiveContext = generateExecutiveContextSnapshot(salesBusinessState, world.groundTruth);
    const { businessState, executiveContext } = generateCompanyContextFromSnapshot(
      snapshot,
      salesBusinessState,
      salesExecutiveContext,
      world.groundTruth,
      world.observations,
    );
    expect(businessState.type).toBe("ausgeglichen");
    expect(businessState.insufficientEvidenceAreas).toEqual(["operations"]);
    expect(executiveContext.affectedAreas).toEqual(["marketing", "operations"]);
  });

  it("33. keine Zukunftskenntnis: Snapshot lange vor jedem Won-Datum/jedem Lead liefert Marketing/Operations ohne aktive Evidenz", () => {
    const snapshot = generateWorldSnapshot(toSource(), "2020-01-01");
    const salesBusinessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const salesExecutiveContext = generateExecutiveContextSnapshot(salesBusinessState, world.groundTruth);
    const { businessState } = generateCompanyContextFromSnapshot(
      snapshot,
      salesBusinessState,
      salesExecutiveContext,
      world.groundTruth,
      world.observations,
    );
    expect(businessState.insufficientEvidenceAreas).toEqual(["marketing", "operations"]);
    expect(snapshot.operationsObservation?.activeDeliveryUnitsTotal ?? 0).toBe(0);
    // 2020-01-01 liegt vor WORLD_TIMELINE_START (2024-06-01) — es existieren noch
    // keine Leads, marketingObservation ist daher ehrlich undefined statt einer
    // erfundenen Nullwert-Observation.
    expect(snapshot.marketingObservation).toBeUndefined();
  });

  it("34. keine Zukunftskenntnis: Snapshot vor Merle Winklers terminatedAt kennt dieses Event nicht", () => {
    const snapshot = generateWorldSnapshot(toSource(), "2022-08-14");
    expect(snapshot.employeeTerminatedEvents.some((e) => e.employeeId === "emp-merle-winkler")).toBe(false);
  });

  it("35. gleicher Snapshot → exakt gleicher Company Context (Determinismus)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const salesBusinessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
    const salesExecutiveContext = generateExecutiveContextSnapshot(salesBusinessState, world.groundTruth);
    const a = generateCompanyContextFromSnapshot(snapshot, salesBusinessState, salesExecutiveContext, world.groundTruth, world.observations);
    const b = generateCompanyContextFromSnapshot(snapshot, salesBusinessState, salesExecutiveContext, world.groundTruth, world.observations);
    expect(a).toEqual(b);
  });
});

describe("Regressionsschutz: Sales-/People-/Operations-Eingänge unverändert", () => {
  it("36. Sales-Eingänge (world.observations/groundTruth) werden durch Area-Summary-Erzeugung nicht verändert", () => {
    const before = JSON.parse(JSON.stringify({ observations: world.observations, groundTruth: world.groundTruth }));
    realAreaSummaries();
    expect(world.observations).toEqual(before.observations);
    expect(world.groundTruth).toEqual(before.groundTruth);
  });

  it("37. People-Eingänge (PEOPLE_OBSERVATIONS/EMPLOYEES) werden durch Area-Summary-Erzeugung nicht verändert", () => {
    const before = JSON.parse(JSON.stringify({ observations: PEOPLE_OBSERVATIONS, employees: EMPLOYEES }));
    realAreaSummaries();
    expect(PEOPLE_OBSERVATIONS).toEqual(before.observations);
    expect(EMPLOYEES).toEqual(before.employees);
  });

  it("38. Operations-Eingänge (world.deliveryUnits) werden durch Area-Summary-Erzeugung nicht verändert", () => {
    const before = JSON.parse(JSON.stringify(world.deliveryUnits));
    realAreaSummaries();
    expect(world.deliveryUnits).toEqual(before);
  });

  it("39. Marketing-Eingänge (world.leads/world.opportunities) werden durch Area-Summary-Erzeugung nicht verändert", () => {
    const before = JSON.parse(JSON.stringify({ leads: world.leads, opportunities: world.opportunities }));
    realAreaSummaries();
    expect(world.leads).toEqual(before.leads);
    expect(world.opportunities).toEqual(before.opportunities);
  });
});
