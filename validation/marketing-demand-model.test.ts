import { describe, expect, it } from "vitest";
import { generateSalesPipeline } from "../events/generate-sales-pipeline";
import { generateFullCompanyContext } from "../company/full-company-context";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { SCENARIO_WORLDS, generateScenarioWorld } from "../engine/generator";
import { SCENARIO_PROFILES, BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { WORLD_SEED } from "../engine/seed";
import { generateBusinessStateSnapshot } from "../business-state/business-state";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { ACCOUNT_OWNERSHIPS } from "../world/account-ownership";
import { WORLD_NOW } from "../timeline/world-clock";

// Marketing Demand Model — World Generation First: Welt-Ebenen-Invarianten für
// das neue, zeitvariable Nachfrage-Modell (engine/marketing-demand.ts prüft die
// reine Sampling-/Lookup-Logik isoliert; diese Datei prüft ihre Integration in
// die tatsächliche Pipeline — asOf-Sicherheit, Determinismus, referenzielle
// Integrität, Regression). Noch KEINE Bewertung: Marketing bleibt
// state=null/evaluationStatus="unzureichende-evidenz" (siehe unten).

function toSource(world: ReturnType<typeof generateScenarioWorld>): WorldSnapshotSource {
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
    metaAdSpendRecords: world.metaAdSpendRecords,
    metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
    marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
    marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
  };
}

describe("Marketing Demand Model — asOf / Future Knowledge (Phase 8, kritisch)", () => {
  // Wichtige architektonische Klarstellung, bewusst dokumentiert statt
  // stillschweigend übergangen: "asOf-Sicherheit" bedeutet in dieser gesamten
  // Reference World (nicht nur für Marketing), dass ein SNAPSHOT einer bereits
  // vollständig (mit vollem WORLD_NOW-Wissen) generierten, FESTEN Welt bei einem
  // gegebenen asOf ausschließlich Daten mit timestamp<=asOf zeigt (siehe
  // snapshot.ts) — NICHT, dass zwei Welten mit UNTERSCHIEDLICHEN
  // Scenario-Parametern für denselben Zeitraum vor einem beliebigen Cutoff
  // identische Werte liefern müssten. Diese zweite, striktere Eigenschaft gilt
  // an keiner Stelle der bestehenden Architektur (z. B. ändert
  // SalesScenarioConfig.leadCountMultiplier ebenfalls die Gesamtzahl der
  // rng()-Aufrufe der gesamten Lead-Schleife und damit JEDEN Lead, unabhängig
  // vom Zeitpunkt) und wurde bei einem ersten Testentwurf fälschlich als
  // Anforderung angenommen — hier korrigiert. Die eigentlich relevante,
  // produktseitige Garantie (ein Consumer, der bei asOf=T snapshotted, sieht
  // niemals Hinweise auf ein Regime, das erst nach T beginnt) wird durch die
  // folgenden Tests direkt bewiesen.
  it("Snapshot vor Regime-Beginn enthält keine Leads, die auf das künftige Regime zurückgeführt werden können", () => {
    const world = SCENARIO_WORLDS.baseline;
    const beforeRegime = "2025-05-31"; // ein Tag vor DEFAULT_MARKETING_DEMAND_MODEL's "suppressed"-Fenster
    const snapshot = generateWorldSnapshot(toSource(world), beforeRegime);
    for (const lead of snapshot.leads) {
      expect(lead.createdAt <= beforeRegime).toBe(true);
    }
  });

  it("keine Future Leads: jeder Lead im Snapshot hat createdAt <= asOf", () => {
    const world = SCENARIO_WORLDS.baseline;
    for (const asOf of ["2024-08-01", "2025-01-01", "2025-06-15", WORLD_NOW]) {
      const snapshot = generateWorldSnapshot(toSource(world), asOf);
      for (const lead of snapshot.leads) {
        expect(lead.createdAt <= asOf).toBe(true);
      }
    }
  });

  it("keine Future Handoffs: jede Opportunity im Snapshot hat createdAt <= asOf", () => {
    const world = SCENARIO_WORLDS.baseline;
    for (const asOf of ["2024-08-01", "2025-01-01", "2025-06-15", WORLD_NOW]) {
      const snapshot = generateWorldSnapshot(toSource(world), asOf);
      // snapshot.opportunities ist OpportunityAtSnapshot[] ({ opportunity, stageAsOf }).
      for (const entry of snapshot.opportunities) {
        expect(entry.opportunity.createdAt <= asOf).toBe(true);
      }
    }
  });
});

describe("Marketing Demand Model — Referential Integrity", () => {
  const world = SCENARIO_WORLDS.baseline;

  it("jede Opportunity referenziert einen existierenden Lead", () => {
    const leadIds = new Set(world.leads.map((l) => l.id));
    for (const opportunity of world.opportunities) {
      expect(leadIds.has(opportunity.leadId)).toBe(true);
    }
  });

  it("handedOffAt (Opportunity.createdAt) liegt niemals vor lead.createdAt", () => {
    const leadById = new Map(world.leads.map((l) => [l.id, l]));
    for (const opportunity of world.opportunities) {
      const lead = leadById.get(opportunity.leadId)!;
      expect(opportunity.createdAt >= lead.createdAt).toBe(true);
    }
  });

  it("jeder Lead mit status='konvertiert' hat eine zugehörige, existierende Opportunity", () => {
    const opportunityIds = new Set(world.opportunities.map((o) => o.id));
    const converted = world.leads.filter((l) => l.status === "konvertiert");
    expect(converted.length).toBeGreaterThan(0);
    for (const lead of converted) {
      expect(lead.convertedToOpportunityId).toBeDefined();
      expect(opportunityIds.has(lead.convertedToOpportunityId!)).toBe(true);
    }
  });
});

describe("Marketing Demand Model — Determinismus", () => {
  it("gleicher WORLD_SEED + gleiches Profil erzeugt identische Leads/Opportunities", () => {
    const a = generateSalesPipeline(WORLD_SEED + 4, CUSTOMER_ACCOUNTS, CONTACTS, EMPLOYEES, ACCOUNT_OWNERSHIPS, BASELINE_PROFILE);
    const b = generateSalesPipeline(WORLD_SEED + 4, CUSTOMER_ACCOUNTS, CONTACTS, EMPLOYEES, ACCOUNT_OWNERSHIPS, BASELINE_PROFILE);
    expect(a.leads).toEqual(b.leads);
    expect(a.opportunities).toEqual(b.opportunities);
  });

  it("MarketingObservation ist deterministisch (gleicher Kontext, zweimal aufgerufen)", () => {
    const a = generateFullCompanyContext();
    const b = generateFullCompanyContext();
    const marketingA = a.executiveContext.areaSummaries.find((x) => x.key === "marketing");
    const marketingB = b.executiveContext.areaSummaries.find((x) => x.key === "marketing");
    expect(marketingA).toEqual(marketingB);
  });
});

describe("Marketing Demand Model — Marketing state bei WORLD_NOW (AKTUALISIERT durch Marketing Leadership State)", () => {
  // Historischer Kontext: dieser Block hielt ursprünglich fest, dass Marketing
  // bei WORLD_NOW trotz des neuen Demand Models "unzureichende-evidenz" bleibt —
  // eine bewusste, hart vorgegebene Grenze GENAU DIESES Auftrags ("Diesen
  // Auftrag NICHT als Grundlage für einen State verwenden"). Der Folgeauftrag
  // "Marketing Leadership State" hat diese Grenze mit ausdrücklicher Freigabe
  // aufgehoben, nachdem das Demand Model selbst (Regime-Dauer/Kalibrierung,
  // unverändert seit diesem Auftrag) genug historische Evidenz für eine
  // belastbare Referenzdichte liefert (siehe business-state/marketing-business-
  // state.ts). Die eigentlich geprüfte Kerninvariante — keine erfundene
  // Bewertung ohne Evidenz, vollständige Rückverfolgbarkeit — gilt weiterhin,
  // nur mit einem jetzt zulässigen "bewertet"-Zweig.
  const context = generateFullCompanyContext();
  const marketing = context.executiveContext.areaSummaries.find((a) => a.key === "marketing")!;

  it("evaluationStatus ist 'bewertet' (genug historische Evidenz seit 2024-10-25)", () => {
    expect(marketing.evaluationStatus).toBe("bewertet");
  });

  it("state ist einer der drei definierten, bewertungsfreien Werte — kein erfundener Wert", () => {
    expect(["stabile-nachfrage", "erhoehte-nachfrage", "unterdrueckte-nachfrage"]).toContain(marketing.state);
  });

  it("relevantMetrics enthält ausschließlich die abgeleiteten Regime-Signal-Vergleichszahlen, keine Rohzahlen-Duplikation", () => {
    expect(Object.keys(marketing.relevantMetrics).sort()).toEqual(
      ["recentWindowDensity1", "recentWindowDensity2", "referenceDensity", "regimeSignal"].sort(),
    );
  });

  it("Company State bleibt semantisch korrekt: evaluatedAreas/insufficientEvidenceAreas/affectedAreas", () => {
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["marketing", "people", "sales"]);
    expect(context.businessState.insufficientEvidenceAreas).toEqual(["operations"]);
    expect(context.executiveContext.affectedAreas).toEqual(["marketing", "operations"]);
  });

  it("Marketing Evidence bleibt vollständig rückverfolgbar (jede evidenceId referenziert eine tatsächlich aktive Observation)", () => {
    // evidenceIds referenziert seit der Business-State-Einführung Observation-IDs
    // (dieselbe Granularität wie Sales/People, siehe company-area-summaries.ts),
    // nicht mehr direkt Lead-/Opportunity-IDs — die vollständige Kette bis zu den
    // Leads bleibt über die referenzierte Observation selbst nachvollziehbar
    // (derivedFrom, siehe observations/marketing-observations.ts).
    for (const id of marketing.evidenceIds) {
      expect(id.startsWith("marketing-obs-")).toBe(true);
    }
    expect(marketing.evidenceIds.length).toBeGreaterThan(0);
  });
});

describe("Marketing Demand Model — Consumer Contract unverändert (Phase 15)", () => {
  it("MarketingLeadFact-Shape bleibt exakt { leadId, createdAt }", () => {
    const context = generateFullCompanyContext();
    const lead = context.executiveKpis.marketing.leads[0]!;
    expect(Object.keys(lead).sort()).toEqual(["createdAt", "leadId"]);
  });

  it("MarketingSalesHandoffFact-Shape bleibt exakt { leadId, opportunityId, handedOffAt }", () => {
    const context = generateFullCompanyContext();
    const handoff = context.executiveKpis.marketing.salesHandoffs[0]!;
    expect(Object.keys(handoff).sort()).toEqual(["handedOffAt", "leadId", "opportunityId"]);
  });

  it("keine Qualified Leads, kein CAC, kein Spend, keine Attribution im Contract", () => {
    const context = generateFullCompanyContext();
    const keys = JSON.stringify(Object.keys(context.executiveKpis.marketing));
    expect(/qualified/i.test(keys)).toBe(false);
    expect(/cac/i.test(keys)).toBe(false);
    expect(/spend/i.test(keys)).toBe(false);
    expect(/attribution/i.test(keys)).toBe(false);
  });
});

describe("Marketing Demand Model — Regression Sales/People/Operations (Phase 14)", () => {
  it("Sales: businessState.type bleibt über alle 6 Scenario-Profile qualitativ unverändert", () => {
    // Referenzwerte, unabhängig vor diesem Auftrag gemessen (siehe Abschlussbericht).
    const expected: Record<string, string> = {
      baseline: "ausgeglichen",
      "operativer-fokus": "verlangsamte-pipeline",
      "strategischer-tag": "strategischer-freiraum",
      wachstumsdruck: "ausgeglichen",
      "team-engpass": "konzentrierte-last",
      "pipeline-risiko": "operative-anspannung",
    };
    for (const profile of SCENARIO_PROFILES) {
      const world = SCENARIO_WORLDS[profile.id];
      const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
      expect(businessState.type, `profile ${profile.id}`).toBe(expected[profile.id]);
    }
  });

  it("People: bleibt vollständig unberührt (People-Generierung hängt nicht von Lead-Timing ab)", () => {
    const context = generateFullCompanyContext();
    const people = context.executiveContext.areaSummaries.find((a) => a.key === "people")!;
    expect(people.state).toBe("ausgeglichen");
    expect(people.evaluationStatus).toBe("bewertet");
  });

  it("Operations: bleibt strukturell bewertbar (state=null, evaluationStatus=unzureichende-evidenz, relevantMetrics vorhanden)", () => {
    const context = generateFullCompanyContext();
    const operations = context.executiveContext.areaSummaries.find((a) => a.key === "operations")!;
    expect(operations.state).toBeNull();
    expect(operations.evaluationStatus).toBe("unzureichende-evidenz");
    expect(operations.relevantMetrics).toHaveProperty("activeDeliveryUnits");
    expect((operations.relevantMetrics as { activeDeliveryUnits: number }).activeDeliveryUnits).toBeGreaterThan(0);
  });

  it("Ground Truth Stability: alle 6 Scenario-Welten erzeugen weiterhin ein gültiges GroundTruthSnapshot", () => {
    for (const profile of SCENARIO_PROFILES) {
      const world = SCENARIO_WORLDS[profile.id];
      expect(world.groundTruth.activeObservationIds.length).toBeGreaterThan(0);
      expect(world.groundTruth.timestamp).toBe(WORLD_NOW);
    }
  });
});
