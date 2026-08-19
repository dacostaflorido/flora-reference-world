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
import { addDays } from "../engine/random";

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
    salesAppointmentBookedEvents: world.salesAppointmentBookedEvents,
    salesAppointmentHeldEvents: world.salesAppointmentHeldEvents,
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

  // Marketing Demand Model — World Generation First: die frühere Fassung dieses
  // Tests prüfte exakt asOf=WORLD_TIMELINE_START. WORLD_TIMELINE_START ist eine
  // INKLUSIVE untere Grenze (Lead.earliestDate = maxIso(WORLD_TIMELINE_START, ...)
  // kann WORLD_TIMELINE_START selbst annehmen) — ein Lead mit createdAt exakt an
  // diesem Tag ist strukturell immer schon möglich gewesen, auch im alten
  // gleichverteilten Modell (nur zufällig nie gezogen). Mit dem neuen, von einem
  // unabhängigen `demandRng`-Strom gespeisten Sampling (siehe
  // engine/marketing-demand.ts) trat dieser strukturell immer schon mögliche Fall
  // erstmals ein (lead-00212). Das ist kein Bug und keine Future-Knowledge-
  // Verletzung — der Test prüfte einen Zufalls-Zufallstreffer des alten Seeds,
  // nicht eine echte Domain-Invariante. Die tatsächlich gemeinte Aussage ("vor
  // jeder Marketing-Aktivität existiert keine Evidenz") wird mit
  // WORLD_TIMELINE_START-1-Tag robust und beweisbar korrekt geprüft: kein Lead
  // kann jemals createdAt < WORLD_TIMELINE_START besitzen.
  it("2. vor WORLD_TIMELINE_START existieren keine Leads — Marketing bleibt ehrlich ohne aktive Evidenz, kein erfundener Nullwert", () => {
    const dayBeforeTimelineStart = addDays(WORLD_TIMELINE_START, -1);
    const summary = marketingSummary(dayBeforeTimelineStart);
    expect(summary.evidenceIds).toEqual([]);
    expect(summary.topObservations).toEqual([]);
    expect(summary.statement).toBeNull();
    expect(summary.state).toBeNull();
    expect(summary.evaluationStatus).toBe("unzureichende-evidenz");
  });

  it("3. historisches asOf kennt strikt weniger Leads als WORLD_NOW", () => {
    // Marketing Leadership State: evidenceIds.length ist seit der Einführung des
    // Business State kein verlässlicher Wachstumsindikator mehr — sobald genug
    // Evidenz für eine Bewertung vorliegt, referenziert evidenceIds nur noch die
    // (wenigen) tragenden Observation-IDs statt aller Lead-/Opportunity-IDs
    // (dieselbe Granularität wie bei Sales/People, siehe company-area-summaries.ts).
    // Die eigentlich gemeinte Aussage ("spätere Zeitpunkte kennen mehr Leads")
    // wird direkt über die Momentaufnahme-Observation geprüft, die diese
    // Granularitätsumstellung nicht betrifft.
    const early = generateMarketingDemandGenerationObservation(
      world.leads.filter((l) => l.createdAt <= "2024-09-01"),
      world.opportunities.filter((o) => o.createdAt <= "2024-09-01"),
      "2024-09-01",
    )!;
    const baseline = generateMarketingDemandGenerationObservation(world.leads, world.opportunities, WORLD_NOW)!;
    expect(early.leadsTotal).toBeGreaterThan(0);
    expect(early.leadsTotal).toBeLessThan(baseline.leadsTotal);
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
    const a = generateMarketingAreaSummary(observation, undefined, undefined, groundTruth);
    const b = generateMarketingAreaSummary(observation, undefined, undefined, groundTruth);
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

describe("Marketing Area — keine erfundene Bewertung (Negativ-Contract, Phase 19 → Marketing Leadership State, Phase B)", () => {
  // AKTUALISIERT (Marketing Leadership State): der ursprüngliche Negativ-Contract
  // ("state/evaluationStatus bleiben für IMMER null/unzureichende-evidenz")
  // wurde mit ausdrücklicher Freigabe aufgehoben — siehe Abschlussbericht "Sales
  // Ownership / Marketing Demand Decoupling" ("Domain-Readiness für Marketing
  // Leadership State: ... Ein State-Auftrag bleibt ein separater, eigener
  // nächster Schritt") und den vorliegenden Auftrag "Checkpoint Commit/Push +
  // Marketing Leadership State". Der eigentlich gemeinte, weiterhin gültige
  // Negativ-Contract ist enger: solange NICHT genug historische Evidenz für eine
  // belastbare Referenzdichte vorliegt, bleibt Marketing ehrlich unzureichende-
  // evidenz — kein erfundener State vor diesem Punkt. Sobald genug Evidenz
  // vorliegt, ist ein State aus der explizit definierten, bewertungsfreien
  // Taxonomie (siehe business-state/marketing-business-state.ts) zulässig.
  const MARKETING_STATE_VALUES = new Set(["stabile-nachfrage", "erhoehte-nachfrage", "unterdrueckte-nachfrage"]);

  it("8. state bleibt null, solange nicht genug historische Evidenz vorliegt (vor 2024-10-25)", () => {
    for (const asOf of [WORLD_TIMELINE_START, "2024-09-01", "2024-10-01"]) {
      expect(marketingSummary(asOf).state, asOf).toBeNull();
    }
  });

  it("8b. sobald genug historische Evidenz vorliegt, ist state ausschließlich einer der drei definierten, bewertungsfreien Werte — nie ein erfundener String", () => {
    for (const asOf of ["2025-01-01", WORLD_NOW]) {
      const state = marketingSummary(asOf).state;
      expect(state, asOf).not.toBeNull();
      expect(MARKETING_STATE_VALUES.has(state!), `${asOf}: unerwarteter state "${state}"`).toBe(true);
    }
  });

  it("9. evaluationStatus bleibt 'unzureichende-evidenz', solange nicht genug historische Evidenz vorliegt (vor 2024-10-25)", () => {
    for (const asOf of [WORLD_TIMELINE_START, "2024-09-01", "2024-10-01"]) {
      expect(marketingSummary(asOf).evaluationStatus, asOf).toBe("unzureichende-evidenz");
    }
  });

  it("9b. evaluationStatus ist ausschließlich 'bewertet' oder 'unzureichende-evidenz' — nie ein dritter Wert", () => {
    for (const asOf of [WORLD_TIMELINE_START, "2024-09-01", "2025-01-01", WORLD_NOW]) {
      expect(["bewertet", "unzureichende-evidenz"]).toContain(marketingSummary(asOf).evaluationStatus);
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

  it("16. relevantMetrics bleibt leer, solange Marketing unzureichende-evidenz ist — keine Duplikation der bereits über executiveKpis.marketing öffentlichen Leads-/Handoff-Zahlen", () => {
    const summary = marketingSummary("2024-09-01");
    expect(summary.evaluationStatus).toBe("unzureichende-evidenz");
    expect(summary.relevantMetrics).toEqual({});
  });

  it("16b. relevantMetrics enthält bei einer Bewertung ausschließlich die abgeleiteten Vergleichszahlen des Regime-Signals — weiterhin keine Duplikation der Rohzahlen aus executiveKpis.marketing", () => {
    const summary = marketingSummary(WORLD_NOW);
    expect(summary.evaluationStatus).toBe("bewertet");
    expect(Object.keys(summary.relevantMetrics).sort()).toEqual(
      ["recentWindowDensity1", "recentWindowDensity2", "referenceDensity", "regimeSignal"].sort(),
    );
    expect(summary.relevantMetrics).not.toHaveProperty("leadsTotal");
    expect(summary.relevantMetrics).not.toHaveProperty("salesHandoffsTotal");
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
