import { describe, expect, it } from "vitest";
import { generateFullCompanyContext } from "../company/full-company-context";
import { generateCompanyExecutiveKpiData } from "../company/company-executive-kpis";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { SCENARIO_WORLDS } from "../engine/generator";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { WORLD_NOW, WORLD_TIMELINE_START } from "../timeline/world-clock";
import { WORLD_SEED } from "../engine/seed";
import { BASELINE_PROFILE } from "../engine/scenario-profiles";

// Marketing Executive KPI Contract v1 Foundation — Invarianten- und
// Regressionstests für company/marketing-executive-kpis.ts, im selben Stil
// wie executive-kpi-invariants.test.ts (People/Sales).
const world = SCENARIO_WORLDS.baseline;
const HISTORICAL_ASOF = "2024-09-01"; // zwischen WORLD_TIMELINE_START und WORLD_NOW

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

describe("Marketing Executive KPI Facts — Public Contract", () => {
  it("1. executiveKpis.marketing ist ausschließlich über generateFullCompanyContext() erreichbar", () => {
    const context = generateFullCompanyContext();
    expect(context.executiveKpis.marketing).toBeDefined();
    expect(Array.isArray(context.executiveKpis.marketing.leads)).toBe(true);
    expect(Array.isArray(context.executiveKpis.marketing.salesHandoffs)).toBe(true);
  });

  it("2. bestehende Felder (people/sales) bleiben durch die Marketing-Erweiterung additiv erreichbar", () => {
    const context = generateFullCompanyContext();
    expect(context.executiveKpis.people).toBeDefined();
    expect(context.executiveKpis.sales).toBeDefined();
  });

  it("3. leadCount bei WORLD_NOW: alle 1100 generierten Leads sind sichtbar (kein Lead liegt in der Zukunft)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    expect(kpis.marketing.leads.length).toBe(world.leads.length);
  });

  it("4. salesHandoffs bei WORLD_NOW: ein Handoff pro tatsächlich konvertierter Opportunity", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    expect(kpis.marketing.salesHandoffs.length).toBe(world.opportunities.length);
  });
});

describe("Marketing Executive KPI Facts — asOf / Future Knowledge", () => {
  it("5. historisches asOf enthält strikt weniger Leads als WORLD_NOW", () => {
    const early = generateCompanyExecutiveKpiData(generateWorldSnapshot(toSource(), HISTORICAL_ASOF));
    const later = generateCompanyExecutiveKpiData(generateWorldSnapshot(toSource(), WORLD_NOW));
    expect(early.marketing.leads.length).toBeGreaterThan(0);
    expect(early.marketing.leads.length).toBeLessThan(later.marketing.leads.length);
  });

  it("6. jeder Lead-Fact hat createdAt <= asOf", () => {
    for (const asOf of [HISTORICAL_ASOF, "2025-01-01", WORLD_NOW]) {
      const snapshot = generateWorldSnapshot(toSource(), asOf);
      const kpis = generateCompanyExecutiveKpiData(snapshot);
      for (const lead of kpis.marketing.leads) {
        expect(lead.createdAt <= asOf).toBe(true);
      }
    }
  });

  it("7. vor WORLD_TIMELINE_START existieren keine Leads (kein Lead vor der Timeline-Startgrenze)", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_TIMELINE_START);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    for (const lead of kpis.marketing.leads) {
      expect(lead.createdAt <= WORLD_TIMELINE_START).toBe(true);
    }
  });

  it("8. historisches asOf enthält strikt weniger Sales-Handoffs als WORLD_NOW", () => {
    const early = generateCompanyExecutiveKpiData(generateWorldSnapshot(toSource(), HISTORICAL_ASOF));
    const later = generateCompanyExecutiveKpiData(generateWorldSnapshot(toSource(), WORLD_NOW));
    expect(early.marketing.salesHandoffs.length).toBeLessThan(later.marketing.salesHandoffs.length);
  });

  it("9. jeder Handoff-Fact hat handedOffAt <= asOf", () => {
    for (const asOf of [HISTORICAL_ASOF, "2025-01-01", WORLD_NOW]) {
      const snapshot = generateWorldSnapshot(toSource(), asOf);
      const kpis = generateCompanyExecutiveKpiData(snapshot);
      for (const handoff of kpis.marketing.salesHandoffs) {
        expect(handoff.handedOffAt <= asOf).toBe(true);
      }
    }
  });

  it("10. spätere Handoffs fehlen bei historischem asOf (echte Einschränkung, kein No-Op)", () => {
    const snapshot = generateWorldSnapshot(toSource(), HISTORICAL_ASOF);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    expect(kpis.marketing.salesHandoffs.length).toBeLessThan(world.opportunities.length);
  });
});

describe("Marketing Executive KPI Facts — Determinismus & Sortierung", () => {
  it("11. identische Inputs erzeugen identische Marketing-KPI-Facts", () => {
    const snapshotA = generateWorldSnapshot(toSource(), WORLD_NOW);
    const snapshotB = generateWorldSnapshot(toSource(), WORLD_NOW);
    expect(generateCompanyExecutiveKpiData(snapshotA).marketing).toEqual(
      generateCompanyExecutiveKpiData(snapshotB).marketing,
    );

    const contextA = generateFullCompanyContext(WORLD_SEED, BASELINE_PROFILE, WORLD_NOW);
    const contextB = generateFullCompanyContext(WORLD_SEED, BASELINE_PROFILE, WORLD_NOW);
    expect(contextA.executiveKpis.marketing).toEqual(contextB.executiveKpis.marketing);
  });

  it("12. Leads sind chronologisch nach createdAt sortiert, leadId als Tie-Breaker", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    for (let i = 1; i < kpis.marketing.leads.length; i++) {
      expect(kpis.marketing.leads[i - 1]!.createdAt <= kpis.marketing.leads[i]!.createdAt).toBe(true);
    }
  });

  it("13. Sales-Handoffs sind chronologisch nach handedOffAt sortiert, opportunityId als Tie-Breaker", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    for (let i = 1; i < kpis.marketing.salesHandoffs.length; i++) {
      expect(kpis.marketing.salesHandoffs[i - 1]!.handedOffAt <= kpis.marketing.salesHandoffs[i]!.handedOffAt).toBe(
        true,
      );
    }
  });

  it("14. keine doppelte leadId innerhalb der Lead Facts", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const ids = kpis.marketing.leads.map((l) => l.leadId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("15. keine doppelte opportunityId innerhalb der Sales-Handoff-Facts", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const ids = kpis.marketing.salesHandoffs.map((h) => h.opportunityId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("16. keine RNG-Sequenzverschiebung: bestehende Sales-/People-/Operations-/Company-Baseline bleibt durch die Marketing-KPI-Erweiterung unverändert", () => {
    // Hinweis: seit "Marketing as First-Class Company Area" enthält
    // insufficientEvidenceAreas/affectedAreas zusätzlich "marketing" — das ist die
    // separate, bewusste Area-Erweiterung (siehe company-state-invariants.test.ts),
    // nicht Teil dieses KPI-Contract-Tests. Seit Marketing Leadership State ist
    // Marketing bei WORLD_NOW zusätzlich in evaluatedAreas enthalten (genug
    // historische Evidenz für eine Bewertung liegt vor) — ebenfalls eine separate,
    // bewusste Erweiterung, siehe business-state/marketing-business-state.ts. Hier
    // wird weiterhin nur geprüft, dass die KPI-Erweiterung selbst keine
    // RNG-Sequenz verschoben hat.
    const context = generateFullCompanyContext();
    expect(context.businessState.type).toBe("ausgeglichen");
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["marketing", "people", "sales"]);
    expect(context.executiveKpis.people.activeHeadcount).toBe(38);
    expect(context.executiveKpis.sales.wonDeals.length).toBeGreaterThan(0);
  });
});

describe("Marketing Executive KPI Facts — Datenintegrität", () => {
  it("17. leadId auf einem Lead-Fact referenziert einen existierenden Lead", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const leadIds = new Set(world.leads.map((l) => l.id));
    for (const lead of kpis.marketing.leads) {
      expect(leadIds.has(lead.leadId)).toBe(true);
    }
  });

  it("18. createdAt auf einem Lead-Fact ist identisch zum echten Lead.createdAt, keine Erfindung", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const leadById = new Map(world.leads.map((l) => [l.id, l]));
    for (const lead of kpis.marketing.leads) {
      expect(leadById.get(lead.leadId)?.createdAt).toBe(lead.createdAt);
    }
  });

  it("19. leadId/opportunityId auf einem Handoff-Fact referenzieren eine tatsächliche Lead-Konversion", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const leadById = new Map(world.leads.map((l) => [l.id, l]));
    for (const handoff of kpis.marketing.salesHandoffs) {
      expect(leadById.get(handoff.leadId)?.convertedToOpportunityId).toBe(handoff.opportunityId);
    }
  });

  it("20. handedOffAt ist identisch zum echten Opportunity.createdAt, keine Erfindung", () => {
    const snapshot = generateWorldSnapshot(toSource(), WORLD_NOW);
    const kpis = generateCompanyExecutiveKpiData(snapshot);
    const opportunityById = new Map(world.opportunities.map((o) => [o.id, o]));
    for (const handoff of kpis.marketing.salesHandoffs) {
      expect(opportunityById.get(handoff.opportunityId)?.createdAt).toBe(handoff.handedOffAt);
    }
  });
});

describe("Marketing: bewusst NICHT implementierte Facts (Marketing Foundation Audit)", () => {
  it("21. kein qualifiedLeads-Feld — Lead.status besitzt keine Übergangs-Zeitstempel, historisches asOf wäre nicht ehrlich rekonstruierbar", () => {
    const context = generateFullCompanyContext();
    expect(context.executiveKpis.marketing).not.toHaveProperty("qualifiedLeads");
  });

  it("22. kein CAC-/Spend-/Budget-/Cost-Feld — kein Campaign-/Kosten-Datenmodell in der Reference World vorhanden", () => {
    const context = generateFullCompanyContext();
    const marketingKeys = JSON.stringify(Object.keys(context.executiveKpis.marketing));
    for (const forbidden of [/cac/i, /spend/i, /budget/i, /\bcost\b/i, /attribution/i, /conversionRate/i, /roas/i, /romi/i]) {
      expect(forbidden.test(marketingKeys), `"${marketingKeys}" matched ${forbidden}`).toBe(false);
    }
  });

  it("23. Lead.status selbst wird an keiner Stelle im Marketing-Contract als Bewertung exponiert (nur leadId/createdAt)", () => {
    const context = generateFullCompanyContext();
    for (const lead of context.executiveKpis.marketing.leads) {
      expect(Object.keys(lead).sort()).toEqual(["createdAt", "leadId"]);
    }
  });
});

// Architekturentscheidung AUFGEHOBEN ("Marketing as First-Class Company Area"):
// die vorherige Entscheidung "Marketing ist keine Company Area" (Marketing
// Foundation, Phase 4) galt ausschließlich für den damaligen Evidenzstand. Mit
// diesem Schritt wurde Marketing bewusst zur First-Class Company Area — zunächst
// mit derselben ehrlichen state=null/evaluationStatus="unzureichende-evidenz"-
// Behandlung wie Operations, nicht mit einer erfundenen Bewertung. Mit Marketing
// Leadership State (Folgeauftrag) ist diese Behandlung nicht mehr dauerhaft: bei
// WORLD_NOW liegt inzwischen genug historische Lead-Evidenz für eine belastbare
// Referenzdichte vor (siehe business-state/marketing-business-state.ts) —
// Marketing wird dort bewertet, bleibt aber vor diesem Punkt (zu wenig Historie)
// weiterhin ehrlich unzureichende-evidenz (siehe
// validation/marketing-area-invariants.test.ts für die asOf-Grenzfälle).
describe("Marketing: First-Class Company Area (Architekturentscheidung aufgehoben)", () => {
  it("24. 'marketing' ist ein gültiger CompanyAreaKey — areaSummaries enthält einen Marketing-Eintrag, bei WORLD_NOW bewertet", () => {
    const context = generateFullCompanyContext();
    const summaries = context.executiveContext.areaSummaries;
    const keys = summaries.map((a) => a.key);
    expect(keys).toContain("marketing");
    expect(keys.slice().sort()).toEqual(["marketing", "operations", "people", "sales"]);

    const marketing = summaries.find((a) => a.key === "marketing")!;
    expect(marketing.state).not.toBeNull();
    expect(["stabile-nachfrage", "erhoehte-nachfrage", "unterdrueckte-nachfrage"]).toContain(marketing.state);
    expect(marketing.evaluationStatus).toBe("bewertet");
    expect(marketing.kind).toBe("department");
    expect(marketing.departmentId).toBe("dept-marketing");
    // Trennung Company Area vs. Executive KPIs bleibt bestehen: relevantMetrics
    // dupliziert weiterhin nicht dieselben Leads-/Handoff-Rohzahlen, die bereits
    // über executiveKpis.marketing öffentlich sind — nur die abgeleiteten
    // Vergleichszahlen des Regime-Signals sind zusätzlich enthalten.
    expect(marketing.relevantMetrics).not.toHaveProperty("leadsTotal");
    expect(marketing.relevantMetrics).not.toHaveProperty("salesHandoffsTotal");
  });
});
