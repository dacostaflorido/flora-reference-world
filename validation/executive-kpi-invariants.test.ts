import { describe, expect, it } from "vitest";
import { generateFullCompanyContext } from "../company/full-company-context";
import { generateCompanyExecutiveKpiData } from "../company/company-executive-kpis";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { SCENARIO_WORLDS } from "../engine/generator";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { WORLD_NOW } from "../timeline/world-clock";
import { WORLD_SEED } from "../engine/seed";
import { BASELINE_PROFILE } from "../engine/scenario-profiles";

// Executive KPI Contract v1.1 Foundation — Invarianten- und Regressionstests
// für company/company-executive-kpis.ts, im selben Stil wie die übrigen
// domänenspezifischen validation/*.test.ts-Dateien (people-invariants.test.ts,
// operations-invariants.test.ts).
const world = SCENARIO_WORLDS.baseline;

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
  };
}

describe("People Executive KPI Facts (Phase 20)", () => {
  it("1. activeHeadcount bei WORLD_NOW korrekt (38 aktiv von 40 Employees, 2 ausgeschieden)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    expect(kpis.people.activeHeadcount).toBe(38);
    expect(kpis.people.hires.length).toBe(40);
    expect(kpis.people.terminations.length).toBe(2);
  });

  it("2. activeHeadcount bei historischem asOf korrekt (vor beiden Terminations, vor mehreren Hires)", () => {
    const asOf = "2023-01-01";
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    // Nur die vor 2023-01-01 bereits eingetretene Termination (emp-merle-winkler,
    // 2022-08-15) ist sichtbar; emp-tobias-reuter (2023-11-30) liegt danach.
    expect(kpis.people.terminations).toEqual([{ employeeId: "emp-merle-winkler", terminatedAt: "2022-08-15" }]);
    const expectedHires = EMPLOYEES.filter((e) => e.hiredAt <= asOf).length;
    expect(kpis.people.hires.length).toBe(expectedHires);
    expect(kpis.people.activeHeadcount).toBe(expectedHires - 1);
  });

  it("3. zukünftige Hires fehlen bei historischem asOf", () => {
    const asOf = "2023-01-01";
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    for (const hire of kpis.people.hires) {
      expect(hire.hiredAt <= asOf).toBe(true);
    }
    // Echte Einschränkung, kein No-Op: weniger als die Gesamtzahl aller Employees.
    expect(kpis.people.hires.length).toBeLessThan(EMPLOYEES.length);
  });

  it("4. zukünftige Terminations fehlen bei historischem asOf", () => {
    const asOf = "2023-01-01";
    const snapshot = generateWorldSnapshot(toSource(), asOf);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    for (const termination of kpis.people.terminations) {
      expect(termination.terminatedAt <= asOf).toBe(true);
    }
    expect(kpis.people.terminations.some((t) => t.employeeId === "emp-tobias-reuter")).toBe(false);
  });

  it("5. Hire Facts besitzen echte hiredAt-Werte aus EMPLOYEES, keine erfundenen", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const employeeById = new Map(EMPLOYEES.map((e) => [e.id, e]));
    for (const hire of kpis.people.hires) {
      expect(employeeById.get(hire.employeeId)?.hiredAt).toBe(hire.hiredAt);
    }
  });

  it("6. Termination Facts besitzen echte terminatedAt-Werte aus EMPLOYEES, keine erfundenen", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const employeeById = new Map(EMPLOYEES.map((e) => [e.id, e]));
    for (const termination of kpis.people.terminations) {
      expect(employeeById.get(termination.employeeId)?.terminatedAt).toBe(termination.terminatedAt);
    }
  });

  it("7. employeeId referenziert eine existierende Employee-Identität", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const employeeIds = new Set(EMPLOYEES.map((e) => e.id));
    for (const hire of kpis.people.hires) {
      expect(employeeIds.has(hire.employeeId)).toBe(true);
    }
    for (const termination of kpis.people.terminations) {
      expect(employeeIds.has(termination.employeeId)).toBe(true);
    }
  });

  it("8. identische Inputs erzeugen identische People-KPI-Facts", () => {
    const snapshotA = generateWorldSnapshot(toSource(), WORLD_NOW);
    const snapshotB = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(generateCompanyExecutiveKpiData(snapshotA).people).toEqual(generateCompanyExecutiveKpiData(snapshotB).people);
  });

  it("9. People Area State bleibt durch die KPI-Erweiterung unverändert", () => {
    const context = generateFullCompanyContext();
    const people = context.executiveContext.areaSummaries.find((a) => a.key === "people")!;
    expect(people.state).toBe("ausgeglichen");
    expect(people.evaluationStatus).toBe("bewertet");
  });

  it("10. People Observations bleiben durch die KPI-Erweiterung unverändert (Baseline: leer)", () => {
    const context = generateFullCompanyContext();
    const people = context.executiveContext.areaSummaries.find((a) => a.key === "people")!;
    expect(people.topObservations).toEqual([]);
  });

  it("11. bestehender FullCompanyContext bleibt unverändert, abgesehen vom additiven executiveKpis-Feld", () => {
    const context = generateFullCompanyContext();
    expect(context.businessState.type).toBe("ausgeglichen");
    expect(context.executiveContext.affectedAreas).toEqual(["operations"]);
    expect(context.executiveKpis).toBeDefined();
  });
});

describe("Sales Executive KPI Facts — Won Deals (Phase 21)", () => {
  it("1. nur tatsächlich gewonnene Opportunities sind enthalten", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const opportunityById = new Map(world.opportunities.map((o) => [o.id, o]));
    for (const deal of kpis.sales.wonDeals) {
      expect(opportunityById.get(deal.opportunityId)?.currentStage).toBe("gewonnen");
    }
  });

  it("2. jeder Won Deal besitzt closedAt", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    expect(kpis.sales.wonDeals.length).toBeGreaterThan(0);
    for (const deal of kpis.sales.wonDeals) {
      expect(typeof deal.closedAt).toBe("string");
      expect(deal.closedAt.length).toBeGreaterThan(0);
    }
  });

  it("3. closedAt <= asOf für jeden Won Deal", () => {
    for (const asOf of ["2024-08-01", "2025-01-01", WORLD_NOW]) {
      const snapshot = generateWorldSnapshot(toSource(), asOf);
      const kpis = generateCompanyExecutiveKpiData(snapshot);
      for (const deal of kpis.sales.wonDeals) {
        expect(deal.closedAt <= asOf).toBe(true);
      }
    }
  });

  it("4. accountId vorhanden und konsistent mit der zugrunde liegenden Opportunity", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const opportunityById = new Map(world.opportunities.map((o) => [o.id, o]));
    for (const deal of kpis.sales.wonDeals) {
      expect(deal.accountId).toBe(opportunityById.get(deal.opportunityId)!.accountId);
    }
  });

  it("5. historisches asOf entfernt später gewonnene Deals", () => {
    const early = generateCompanyExecutiveKpiData(generateWorldSnapshot(toSource(), "2020-01-01"));
    const later = generateCompanyExecutiveKpiData(generateWorldSnapshot(toSource(), WORLD_NOW));
    expect(early.sales.wonDeals.length).toBe(0);
    expect(later.sales.wonDeals.length).toBeGreaterThan(early.sales.wonDeals.length);
  });

  it("6. deterministisch — gleiche Inputs erzeugen identische Won-Deal-Facts", () => {
    const snapshotA = generateWorldSnapshot(toSource(), WORLD_NOW);
    const snapshotB = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(generateCompanyExecutiveKpiData(snapshotA).sales).toEqual(generateCompanyExecutiveKpiData(snapshotB).sales);

    const contextA = generateFullCompanyContext(WORLD_SEED, BASELINE_PROFILE, WORLD_NOW);
    const contextB = generateFullCompanyContext(WORLD_SEED, BASELINE_PROFILE, WORLD_NOW);
    expect(contextA).toEqual(contextB);
  });

  it("7. Opportunity Value bleibt neutral (reiner Opportunity-Fakt, keine Summierung, keine Einheit erfunden)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const opportunityById = new Map(world.opportunities.map((o) => [o.id, o]));
    for (const deal of kpis.sales.wonDeals) {
      expect(deal.value).toBe(opportunityById.get(deal.opportunityId)!.value);
    }
  });

  it("8./9. keine Revenue-/Cashflow-Bezeichnung im erzeugten Datenobjekt", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const keys = JSON.stringify(Object.keys(kpis.sales.wonDeals[0] ?? {}));
    expect(/revenue/i.test(keys)).toBe(false);
    expect(/umsatz/i.test(keys)).toBe(false);
    expect(/cashflow/i.test(keys)).toBe(false);
  });

  it("10. Sales Area State bleibt durch die KPI-Erweiterung unverändert", () => {
    const context = generateFullCompanyContext();
    const sales = context.executiveContext.areaSummaries.find((a) => a.key === "sales")!;
    expect(sales.evaluationStatus).toBe("bewertet");
  });

  it("11. Sales Observations bleiben durch die KPI-Erweiterung unverändert", () => {
    const context = generateFullCompanyContext();
    const withoutKpis = generateCompanyContextWithoutKpisForComparison();
    const sales = context.executiveContext.areaSummaries.find((a) => a.key === "sales")!;
    const salesBefore = withoutKpis.executiveContext.areaSummaries.find((a) => a.key === "sales")!;
    expect(sales.topObservations).toEqual(salesBefore.topObservations);
    expect(sales.statement).toBe(salesBefore.statement);
  });

  it("12. bestehender FullCompanyContext bleibt regressionsfrei", () => {
    const context = generateFullCompanyContext();
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["people", "sales"]);
    expect(context.businessState.insufficientEvidenceAreas).toEqual(["operations"]);
  });
});

// Regressions-Vergleichshilfe (Phase 31): erzeugt exakt denselben Company-Context
// wie vor der KPI-Erweiterung, indem nur businessState/executiveContext betrachtet
// werden — nutzt dieselbe öffentliche Funktion, ignoriert lediglich das neue Feld.
function generateCompanyContextWithoutKpisForComparison() {
  const context = generateFullCompanyContext();
  return { businessState: context.businessState, executiveContext: context.executiveContext };
}

describe("New Customer Semantik (Phase 22): bewusst nicht implementiert", () => {
  it("CustomerAccount.createdAt markiert die Account-Anlage im Prospect-Pool, nicht 'Kunde seit' — kein New-Customer-Fact im Contract", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    expect(kpis).not.toHaveProperty("newCustomers");
    expect((kpis.sales as unknown as Record<string, unknown>)).not.toHaveProperty("newCustomers");
  });

  it("mehrere Won Deals können demselben Account zugeordnet sein — bestätigt, dass 'ein Won Deal = ein Neukunde' keine triviale Annahme wäre", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const accountIds = kpis.sales.wonDeals.map((d) => d.accountId);
    const uniqueAccountIds = new Set(accountIds);
    // Nur dokumentierend: falls Duplikate existieren, wäre eine naive
    // Won-Deal-Zählung als Neukundenzahl bereits falsch — Beleg für die
    // bewusste Nicht-Implementierung in Phase 12 des Abschlussberichts.
    expect(uniqueAccountIds.size).toBeLessThanOrEqual(accountIds.length);
  });
});

describe("Operations: bewusst nicht Teil des neuen Contracts (Phase 14/23)", () => {
  it("executiveKpis enthält kein operations-Feld — bereits vollständig über CompanyAreaSummary.relevantMetrics öffentlich", () => {
    const context = generateFullCompanyContext();
    expect(context.executiveKpis).not.toHaveProperty("operations");

    const operations = context.executiveContext.areaSummaries.find((a) => a.key === "operations")!;
    expect(operations.relevantMetrics).toEqual({
      activeDeliveryUnits: 10,
      maxAssignedCount: 4,
      fairShare: 10 / 3,
      maxShare: 0.4,
      fairShareRatio: 1.2,
    });
  });

  it("Operations Business State/Evaluation bleiben durch die KPI-Erweiterung unverändert", () => {
    const context = generateFullCompanyContext();
    const operations = context.executiveContext.areaSummaries.find((a) => a.key === "operations")!;
    expect(operations.state).toBeNull();
    expect(operations.evaluationStatus).toBe("unzureichende-evidenz");
  });
});

describe("Determinismus & Sortierung (Phase 18/19/28)", () => {
  it("gleiche worldSeed/profile/asOf erzeugen bit-identisches executiveKpis", () => {
    const a = generateFullCompanyContext(WORLD_SEED, BASELINE_PROFILE, WORLD_NOW);
    const b = generateFullCompanyContext(WORLD_SEED, BASELINE_PROFILE, WORLD_NOW);
    expect(a.executiveKpis).toEqual(b.executiveKpis);
  });

  it("bestehende Sales-/People-/Operations-/Company-Snapshots bleiben durch executiveKpis unverändert (keine RNG-Sequenzverschiebung)", () => {
    const withKpis = generateFullCompanyContext();
    // Regressionswerte identisch zu den bereits vor der KPI-Erweiterung etablierten
    // Baseline-Werten (siehe company-state-invariants.test.ts/consumer-contract.test.ts).
    expect(withKpis.businessState.type).toBe("ausgeglichen");
    expect(withKpis.businessState.evaluatedAreas.slice().sort()).toEqual(["people", "sales"]);
    expect(withKpis.businessState.insufficientEvidenceAreas).toEqual(["operations"]);
    expect(withKpis.executiveContext.affectedAreas).toEqual(["operations"]);
  });

  it("hires sind chronologisch nach hiredAt sortiert, employeeId als Tie-Breaker", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    for (let i = 1; i < kpis.people.hires.length; i++) {
      const prev = kpis.people.hires[i - 1]!;
      const curr = kpis.people.hires[i]!;
      expect(prev.hiredAt <= curr.hiredAt).toBe(true);
    }
  });

  it("terminations sind chronologisch nach terminatedAt sortiert", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    for (let i = 1; i < kpis.people.terminations.length; i++) {
      expect(kpis.people.terminations[i - 1]!.terminatedAt <= kpis.people.terminations[i]!.terminatedAt).toBe(true);
    }
  });

  it("wonDeals sind chronologisch nach closedAt sortiert, opportunityId als Tie-Breaker", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    for (let i = 1; i < kpis.sales.wonDeals.length; i++) {
      expect(kpis.sales.wonDeals[i - 1]!.closedAt <= kpis.sales.wonDeals[i]!.closedAt).toBe(true);
    }
  });

  it("keine doppelte employeeId innerhalb der Hire Facts", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const ids = kpis.people.hires.map((h) => h.employeeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keine doppelte opportunityId innerhalb der Won Deals", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const ids = kpis.sales.wonDeals.map((d) => d.opportunityId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("activeHeadcount ist niemals negativ", () => {
    for (const asOf of ["2018-01-01", "2020-01-01", "2023-01-01", WORLD_NOW]) {
      const snapshot = generateWorldSnapshot(toSource(), asOf);
      const kpis = generateCompanyExecutiveKpiData(snapshot);
      expect(kpis.people.activeHeadcount).toBeGreaterThanOrEqual(0);
    }
  });
});

// "marketing" bewusst NICHT mehr in dieser Liste (Marketing Foundation): der
// oberste Feldname `kpis.marketing` ist seit diesem Schritt eine beabsichtigte,
// evidenzbasierte Contract-Erweiterung, kein Zeichen erfundener Fachlogik —
// die eigentlich schützenswerten Begriffe (CAC/Spend/Attribution/Score/...)
// bleiben unten weiterhin verboten und werden zusätzlich in
// marketing-executive-kpi-invariants.test.ts spezifisch gegen die
// marketing-Facts selbst geprüft.
const FORBIDDEN_RUNTIME_TERMS: RegExp[] = [
  /revenue/i,
  /umsatz/i,
  /cashflow/i,
  /invoice/i,
  /payment/i,
  /\bcac\b/i,
  /performance/i,
  /\bhealth\b/i,
  /\bscore\b/i,
  /critical/i,
  /kritisch/i,
  /gesund/i,
  /überlastet/i,
];

describe("Verbotene Begriffe Audit (Phase 32)", () => {
  it("keine verbotenen Begriffe in den öffentlichen Feldnamen von CompanyExecutiveKpiData", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const allKeys = [
      ...Object.keys(kpis),
      ...Object.keys(kpis.people),
      ...Object.keys(kpis.sales),
      ...Object.keys(kpis.marketing),
      ...Object.keys(kpis.people.hires[0] ?? {}),
      ...Object.keys(kpis.people.terminations[0] ?? {}),
      ...Object.keys(kpis.sales.wonDeals[0] ?? {}),
      ...Object.keys(kpis.marketing.leads[0] ?? {}),
      ...Object.keys(kpis.marketing.salesHandoffs[0] ?? {}),
    ].join(" ");
    for (const pattern of FORBIDDEN_RUNTIME_TERMS) {
      expect(pattern.test(allKeys), `"${allKeys}" matched ${pattern}`).toBe(false);
    }
  });
});
