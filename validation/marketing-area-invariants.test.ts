import { describe, expect, it } from "vitest";
import { generateFullCompanyContext } from "../company/full-company-context";
import { generateGroundTruthSnapshot } from "../ground-truth/ground-truth";
import { generateMarketingDemandGenerationObservation } from "../observations/marketing-observations";
import { generateMarketingAreaSummary } from "../company/company-area-summaries";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { SCENARIO_WORLDS } from "../engine/generator";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { WORLD_NOW, WORLD_TIMELINE_START } from "../timeline/world-clock";

// "Marketing as First-Class Company Area" — Invarianten für die neue
// Observation-/Area-Ebene (company-state-invariants.test.ts deckt bereits die
// Aggregations-/Regressionsseite ab, siehe dort für Strukturinvarianten,
// affectedAreas/insufficientEvidenceAreas, Backward Explainability). Diese Datei
// fokussiert auf asOf-Sicherheit, Determinismus und den Negativ-Contract-Audit
// (Phase 18/19).
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

function marketingSummary(asOf: string) {
  const context = generateFullCompanyContext(undefined, undefined, asOf);
  return context.executiveContext.areaSummaries.find((a) => a.key === "marketing")!;
}

describe("Marketing Area — asOf / Future Knowledge", () => {
  it("1. bei historischem asOf (2024-09-01) referenziert die Marketing-Evidenz ausschließlich zu diesem Zeitpunkt bereits existierende Leads/Opportunities", () => {
    const asOf = "2024-09-01";
    const summary = marketingSummary(asOf);
    for (const id of summary.evidenceIds) {
      const lead = world.leads.find((l) => l.id === id);
      const opportunity = world.opportunities.find((o) => o.id === id);
      if (lead) {
        expect(lead.createdAt <= asOf).toBe(true);
      } else if (opportunity) {
        expect(opportunity.createdAt <= asOf).toBe(true);
      } else {
        throw new Error(`evidenceId ${id} referenziert weder einen Lead noch eine Opportunity`);
      }
    }
  });

  it("2. vor WORLD_TIMELINE_START existieren keine Leads — Marketing bleibt ehrlich ohne aktive Evidenz, kein erfundener Nullwert", () => {
    const summary = marketingSummary(WORLD_TIMELINE_START);
    expect(summary.evidenceIds).toEqual([]);
    expect(summary.topObservations).toEqual([]);
    expect(summary.statement).toBeNull();
    expect(summary.state).toBeNull();
    expect(summary.evaluationStatus).toBe("unzureichende-evidenz");
  });

  it("3. historisches asOf enthält strikt weniger Marketing-Evidenz als WORLD_NOW", () => {
    const early = marketingSummary("2024-09-01");
    const baseline = marketingSummary(WORLD_NOW);
    expect(early.evidenceIds.length).toBeGreaterThan(0);
    expect(early.evidenceIds.length).toBeLessThan(baseline.evidenceIds.length);
  });

  it("4. keine Future Knowledge über den WorldSnapshot: marketingObservation referenziert nur zu asOf bereits existierende Leads/Opportunities", () => {
    for (const asOf of ["2024-09-01", "2025-01-01", WORLD_NOW]) {
      const snapshot = generateWorldSnapshot(toSource(), asOf);
      const observation = snapshot.marketingObservation;
      if (!observation) continue;
      expect(observation.leadsTotal).toBe(snapshot.leads.length);
      for (const id of observation.derivedFrom) {
        const lead = snapshot.leads.find((l) => l.id === id);
        const opportunity = snapshot.opportunities.find((entry) => entry.opportunity.id === id);
        expect(lead !== undefined || opportunity !== undefined).toBe(true);
      }
    }
  });
});

describe("Marketing Area — Determinismus", () => {
  it("5. gleiche Inputs → identische Marketing-Observation", () => {
    const a = generateMarketingDemandGenerationObservation(world.leads, world.opportunities, WORLD_NOW);
    const b = generateMarketingDemandGenerationObservation(world.leads, world.opportunities, WORLD_NOW);
    expect(a).toEqual(b);
  });

  it("6. gleiche Inputs → identische Marketing Area Summary", () => {
    const observation = generateMarketingDemandGenerationObservation(world.leads, world.opportunities, WORLD_NOW);
    const groundTruth = generateGroundTruthSnapshot(observation ? [observation] : [], WORLD_NOW);
    const a = generateMarketingAreaSummary(observation, groundTruth);
    const b = generateMarketingAreaSummary(observation, groundTruth);
    expect(a).toEqual(b);
  });

  it("7. gleicher Full Company Context → identische Marketing Area Summary (End-to-End-Determinismus)", () => {
    const a = generateFullCompanyContext();
    const b = generateFullCompanyContext();
    expect(a.executiveContext.areaSummaries.find((s) => s.key === "marketing")).toEqual(
      b.executiveContext.areaSummaries.find((s) => s.key === "marketing"),
    );
  });
});

describe("Marketing Area — keine erfundene Bewertung (Negativ-Contract, Phase 19)", () => {
  it("8. state ist bei jedem getesteten asOf ausschließlich null, niemals ein erfundener Wert", () => {
    for (const asOf of [WORLD_TIMELINE_START, "2024-09-01", "2025-01-01", WORLD_NOW]) {
      expect(marketingSummary(asOf).state).toBeNull();
    }
  });

  it("9. evaluationStatus ist bei jedem getesteten asOf ausschließlich 'unzureichende-evidenz'", () => {
    for (const asOf of [WORLD_TIMELINE_START, "2024-09-01", "2025-01-01", WORLD_NOW]) {
      expect(marketingSummary(asOf).evaluationStatus).toBe("unzureichende-evidenz");
    }
  });

  it("10./11./12./13./14. keine CAC/Spend/ROAS/ROMI/Attribution/Campaign-ROI/Cost-per-Lead im Marketing Area Summary", () => {
    const summary = marketingSummary(WORLD_NOW);
    const serialized = JSON.stringify(summary);
    for (const forbidden of [
      /\bcac\b/i,
      /spend/i,
      /marketingspend/i,
      /\broas\b/i,
      /\bromi\b/i,
      /attribution/i,
      /campaignroi/i,
      /costperlead/i,
      /qualified/i,
      /\bmql\b/i,
      /\bsql\b/i,
    ]) {
      expect(forbidden.test(serialized), `"${serialized}" matched ${forbidden}`).toBe(false);
    }
  });

  it("15. keine Bewertungssprache (gesund/kritisch/performt/effizient) im Marketing-Statement", () => {
    const summary = marketingSummary(WORLD_NOW);
    const text = summary.statement ?? "";
    for (const forbidden of [/\bgesund\b/i, /kritisch/i, /performt/i, /effizient/i, /ineffizient/i]) {
      expect(forbidden.test(text)).toBe(false);
    }
  });

  it("16. relevantMetrics bleibt leer — keine Duplikation der bereits über executiveKpis.marketing öffentlichen Leads-/Handoff-Zahlen", () => {
    const summary = marketingSummary(WORLD_NOW);
    expect(summary.relevantMetrics).toEqual({});
  });
});

describe("Marketing Area — Ownership-Grenze (Phase 17: Marketing ist nicht Sales unter anderem Namen)", () => {
  it("17. Marketing Area Summary enthält keine Opportunity-Stage-/Value-/Won-Rate-Sprache — nur Leads-/Handoff-Volumen", () => {
    const summary = marketingSummary(WORLD_NOW);
    const serialized = JSON.stringify(summary);
    for (const forbidden of [/wonrate/i, /win.?rate/i, /stagnation/i, /pipeline/i, /abschlussquote/i]) {
      expect(forbidden.test(serialized), `"${serialized}" matched ${forbidden}`).toBe(false);
    }
  });
});
