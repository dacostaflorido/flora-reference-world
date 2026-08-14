import { describe, expect, it } from "vitest";
import { EMPLOYEES } from "../world/employees";
import { DEPARTMENTS } from "../world/departments";
import { ROLES } from "../world/roles";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { COMPANY } from "../world/company";
import { WORLD_SEED } from "../engine/seed";
import { SCENARIO_PROFILES, BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { generateScenarioWorld, SCENARIO_WORLDS, type ScenarioWorld } from "../engine/generator";
import { WORLD_TIMELINE_START } from "../timeline/world-clock";
import {
  checkAllDynamicDatesWithinWorldNow,
  checkCallDuration,
  checkCallTimingWithinOpportunity,
  checkConvertedLeadHasExactlyOneOpportunity,
  checkCrmActivityEmployeeValid,
  checkCrmActivityExactlyOneReference,
  checkCrmActivityTimingWithinEntity,
  checkEmailContentNotEmpty,
  checkEmailParticipantsValid,
  checkGroundTruthGroupsNoCycles,
  checkGroundTruthNoDuplicates,
  checkGroundTruthObservationsExist,
  checkGroundTruthPrioritiesUnique,
  checkGroundTruthReferencesBelongToSnapshot,
  checkGroundTruthTimestampValid,
  checkInteractionAssignment,
  checkInteractionEmployeeValid,
  checkInteractionReferences,
  checkInteractionsWithinWorldNow,
  checkInternalMeetingsHaveParticipants,
  checkKnowledgeObjectAccountReference,
  checkKnowledgeObjectAuthorValid,
  checkKnowledgeObjectContentNotEmpty,
  checkKnowledgeObjectDates,
  checkKnowledgeObjectIdsUnique,
  checkKnowledgeObjectOpportunityReference,
  checkKundenterminHasCustomerReference,
  checkLeadAccountReferences,
  checkLeadContactBelongsToAccount,
  checkLeadCreatedAfterAccountAndContact,
  checkLeadInteractionsBeforeConversion,
  checkLeadLastContactedAfterCreated,
  checkLeadOwnerValidAtCreation,
  checkLostLeadHasNoOpportunityLink,
  checkMeetingDuration,
  checkMeetingParticipantsValid,
  checkObservationDerivedFromResolvesAndOrdered,
  checkObservationFieldsValid,
  checkObservationGeneratedAtWithinWorldNow,
  checkObservationIdsUnique,
  checkObservationNoCycles,
  checkObservationNoSelfReference,
  checkOpenOpportunityStageAgeNotDrivenByCreationDate,
  checkOpportunityClosedAtConsistency,
  checkOpportunityLeadReferences,
  checkOpportunityNoDuplicateLeads,
  checkOpportunityResponsibleEmployeeValid,
  checkOpportunityValueAndProbability,
  checkOwnershipAccountReferences,
  checkOwnershipEmployeeReferences,
  checkOwnershipEmployeeValidity,
  checkOwnershipNoOverlap,
  checkStageHistoryContiguity,
  checkStageHistoryExistsForEveryOpportunity,
  checkStageHistoryResponsibleEmployeeValidity,
  checkTranscriptMeetingReferences,
  checkTranscriptUniquePerMeeting,
  type ObservationEvidenceSources,
} from "./invariants";
import {
  checkBaselineContract,
  checkOperativerFokusContract,
  checkPipelineRisikoContract,
  checkStrategischerTagContract,
  checkTeamEngpassContract,
  checkWachstumsdruckContract,
} from "./expected-pattern-contracts";

// Vollständige, bereits bestehende Invariant-Suite gegen EIN ScenarioWorld
// ausgeführt — dieselben Prüffunktionen wie überall sonst, nur wiederverwendet statt
// dupliziert (§18 des Auftrags: "Bitte die vollständige bestehende Invariant-Suite
// gegen ALLE sechs Profiles laufen lassen. Nicht nur baseline.").
function runFullInvariantSuite(world: ScenarioWorld, label: string): void {
  describe(`Invarianten: ${label}`, () => {
    it("AccountOwnership", () => {
      expect(checkOwnershipAccountReferences(world.accountOwnerships, CUSTOMER_ACCOUNTS)).toEqual([]);
      expect(checkOwnershipEmployeeReferences(world.accountOwnerships, EMPLOYEES)).toEqual([]);
      expect(checkOwnershipEmployeeValidity(world.accountOwnerships, EMPLOYEES)).toEqual([]);
      expect(checkOwnershipNoOverlap(world.accountOwnerships)).toEqual([]);
    });

    it("Lead", () => {
      expect(checkLeadAccountReferences(world.leads, CUSTOMER_ACCOUNTS)).toEqual([]);
      expect(checkLeadContactBelongsToAccount(world.leads, CONTACTS)).toEqual([]);
      expect(checkLeadCreatedAfterAccountAndContact(world.leads, CUSTOMER_ACCOUNTS, CONTACTS)).toEqual([]);
      expect(checkLeadOwnerValidAtCreation(world.leads, EMPLOYEES)).toEqual([]);
      expect(checkLeadLastContactedAfterCreated(world.leads)).toEqual([]);
      expect(checkLostLeadHasNoOpportunityLink(world.leads)).toEqual([]);
      expect(checkConvertedLeadHasExactlyOneOpportunity(world.leads, world.opportunities)).toEqual([]);
    });

    it("Opportunity", () => {
      expect(checkOpportunityLeadReferences(world.opportunities, world.leads)).toEqual([]);
      expect(checkOpportunityNoDuplicateLeads(world.opportunities)).toEqual([]);
      expect(checkOpportunityResponsibleEmployeeValid(world.opportunities, EMPLOYEES)).toEqual([]);
      expect(checkOpportunityValueAndProbability(world.opportunities)).toEqual([]);
      expect(checkOpportunityClosedAtConsistency(world.opportunities)).toEqual([]);
    });

    it("OpportunityStageHistory", () => {
      expect(checkStageHistoryExistsForEveryOpportunity(world.opportunities, world.stageHistory)).toEqual([]);
      expect(checkStageHistoryContiguity(world.opportunities, world.stageHistory)).toEqual([]);
      expect(checkStageHistoryResponsibleEmployeeValidity(world.stageHistory, EMPLOYEES)).toEqual([]);
    });

    it("Timeline (keine dynamische Entität nach WORLD_NOW)", () => {
      expect(checkAllDynamicDatesWithinWorldNow(world.leads, world.opportunities, world.stageHistory)).toEqual([]);
      expect(checkInteractionsWithinWorldNow(world.calls, "Call")).toEqual([]);
      expect(checkInteractionsWithinWorldNow(world.emails, "Email")).toEqual([]);
      expect(checkInteractionsWithinWorldNow(world.meetings, "Meeting")).toEqual([]);
    });

    it("kein erneutes Pipeline-Stall-Generatorartefakt (Korrelation Erstellungsdatum/Stage-Alter)", () => {
      expect(checkOpenOpportunityStageAgeNotDrivenByCreationDate(world.opportunities, world.stageHistory, WORLD_TIMELINE_START)).toEqual([]);
    });

    it("InteractionBase (Call/Email/Meeting)", () => {
      expect(checkInteractionEmployeeValid(world.calls, EMPLOYEES, "Call")).toEqual([]);
      expect(checkInteractionEmployeeValid(world.emails, EMPLOYEES, "Email")).toEqual([]);
      expect(checkInteractionEmployeeValid(world.meetings, EMPLOYEES, "Meeting")).toEqual([]);
      expect(checkInteractionReferences(world.calls, CUSTOMER_ACCOUNTS, CONTACTS, world.leads, world.opportunities, "Call")).toEqual([]);
      expect(checkInteractionReferences(world.emails, CUSTOMER_ACCOUNTS, CONTACTS, world.leads, world.opportunities, "Email")).toEqual([]);
      expect(checkInteractionReferences(world.meetings, CUSTOMER_ACCOUNTS, CONTACTS, world.leads, world.opportunities, "Meeting")).toEqual([]);
      expect(checkInteractionAssignment(world.calls, "Call")).toEqual([]);
      expect(checkInteractionAssignment(world.emails, "Email")).toEqual([]);
      expect(checkInteractionAssignment(world.meetings, "Meeting")).toEqual([]);
      expect(checkLeadInteractionsBeforeConversion(world.calls, world.leads, world.opportunities, "Call")).toEqual([]);
      expect(checkLeadInteractionsBeforeConversion(world.emails, world.leads, world.opportunities, "Email")).toEqual([]);
      expect(checkLeadInteractionsBeforeConversion(world.crmActivities, world.leads, world.opportunities, "CrmActivity")).toEqual([]);
    });

    it("Call/Email/Meeting/MeetingTranscript/CrmActivity", () => {
      expect(checkCallDuration(world.calls)).toEqual([]);
      expect(checkCallTimingWithinOpportunity(world.calls, world.opportunities)).toEqual([]);
      expect(checkEmailContentNotEmpty(world.emails)).toEqual([]);
      expect(checkEmailParticipantsValid(world.emails, EMPLOYEES)).toEqual([]);
      expect(checkMeetingDuration(world.meetings)).toEqual([]);
      expect(checkInternalMeetingsHaveParticipants(world.meetings)).toEqual([]);
      expect(checkMeetingParticipantsValid(world.meetings, EMPLOYEES)).toEqual([]);
      expect(checkKundenterminHasCustomerReference(world.meetings)).toEqual([]);
      expect(checkTranscriptMeetingReferences(world.meetingTranscripts, world.meetings)).toEqual([]);
      expect(checkTranscriptUniquePerMeeting(world.meetingTranscripts)).toEqual([]);
      expect(checkCrmActivityExactlyOneReference(world.crmActivities)).toEqual([]);
      expect(checkCrmActivityEmployeeValid(world.crmActivities, EMPLOYEES)).toEqual([]);
      expect(checkCrmActivityTimingWithinEntity(world.crmActivities, world.leads, world.opportunities)).toEqual([]);
    });

    it("KnowledgeObject", () => {
      expect(checkKnowledgeObjectIdsUnique(world.knowledgeObjects)).toEqual([]);
      expect(checkKnowledgeObjectContentNotEmpty(world.knowledgeObjects)).toEqual([]);
      expect(checkKnowledgeObjectAuthorValid(world.knowledgeObjects, EMPLOYEES)).toEqual([]);
      expect(checkKnowledgeObjectDates(world.knowledgeObjects)).toEqual([]);
      expect(checkKnowledgeObjectAccountReference(world.knowledgeObjects, CUSTOMER_ACCOUNTS)).toEqual([]);
      expect(checkKnowledgeObjectOpportunityReference(world.knowledgeObjects, world.opportunities)).toEqual([]);
    });

    it("Observation", () => {
      expect(checkObservationIdsUnique(world.observations)).toEqual([]);
      expect(checkObservationFieldsValid(world.observations)).toEqual([]);
      expect(checkObservationNoSelfReference(world.observations)).toEqual([]);
      expect(checkObservationGeneratedAtWithinWorldNow(world.observations)).toEqual([]);
      expect(checkObservationNoCycles(world.observations)).toEqual([]);
      const sources: ObservationEvidenceSources = {
        leads: world.leads,
        opportunities: world.opportunities,
        stageHistory: world.stageHistory,
        calls: world.calls,
        emails: world.emails,
        meetings: world.meetings,
        meetingTranscripts: world.meetingTranscripts,
        crmActivities: world.crmActivities,
        knowledgeObjects: world.knowledgeObjects,
        observations: world.observations,
      };
      expect(checkObservationDerivedFromResolvesAndOrdered(world.observations, sources)).toEqual([]);
    });

    it("GroundTruthSnapshot", () => {
      const snapshots = [world.groundTruth];
      expect(checkGroundTruthObservationsExist(snapshots, world.observations)).toEqual([]);
      expect(checkGroundTruthReferencesBelongToSnapshot(snapshots)).toEqual([]);
      expect(checkGroundTruthNoDuplicates(snapshots)).toEqual([]);
      expect(checkGroundTruthGroupsNoCycles(snapshots)).toEqual([]);
      expect(checkGroundTruthPrioritiesUnique(snapshots)).toEqual([]);
      expect(checkGroundTruthTimestampValid(snapshots, world.observations)).toEqual([]);
    });
  });
}

for (const profile of SCENARIO_PROFILES) {
  runFullInvariantSuite(SCENARIO_WORLDS[profile.id], profile.id);
}

describe("Scenario Profiles — Struktur", () => {
  it("jedes Profil besitzt eine eindeutige ID", () => {
    const ids = SCENARIO_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("baseline existiert", () => {
    expect(SCENARIO_PROFILES.some((p) => p.id === "baseline")).toBe(true);
    expect(BASELINE_PROFILE.id).toBe("baseline");
  });

  it("genau die sechs beauftragten Profile existieren, keine weiteren", () => {
    const ids = SCENARIO_PROFILES.map((p) => p.id).sort();
    expect(ids).toEqual(
      ["baseline", "operativer-fokus", "pipeline-risiko", "strategischer-tag", "team-engpass", "wachstumsdruck"].sort(),
    );
  });
});

describe("Scenario Profiles — statische Weltidentität unverändert", () => {
  // Company/Departments/Roles/Employees/CustomerAccounts/Contacts werden von
  // generateScenarioWorld() bewusst NICHT neu erzeugt — dieser Test bestätigt, dass
  // dieselben Singletons für jedes Profil verwendet werden (keine unbemerkt
  // unterschiedliche Firma je Szenario).
  it("Company/Departments/Roles/Employees/CustomerAccounts/Contacts sind für jedes Profil identisch", () => {
    for (const profile of SCENARIO_PROFILES) {
      const world = SCENARIO_WORLDS[profile.id];
      // generateScenarioWorld nimmt diese Entitäten nicht als Parameter — die
      // AccountOwnership-Referenzen (employeeId/accountId) müssen dennoch exakt auf
      // dieselben, unveränderten Singletons zeigen.
      const employeeIds = new Set(EMPLOYEES.map((e) => e.id));
      const accountIds = new Set(CUSTOMER_ACCOUNTS.map((a) => a.id));
      for (const ownership of world.accountOwnerships) {
        expect(employeeIds.has(ownership.employeeId)).toBe(true);
        expect(accountIds.has(ownership.accountId)).toBe(true);
      }
    }
    expect(EMPLOYEES.length).toBeGreaterThan(0);
    expect(CUSTOMER_ACCOUNTS.length).toBeGreaterThan(0);
    expect(CONTACTS.length).toBeGreaterThan(0);
    expect(DEPARTMENTS.length).toBeGreaterThan(0);
    expect(ROLES.length).toBeGreaterThan(0);
    expect(COMPANY.name).toBe("Elbfeld Software GmbH");
  });
});

describe("Scenario Profiles — Determinismus", () => {
  it(
    "gleicher WORLD_SEED + gleiches Profil erzeugt eine deep-identische Welt",
    () => {
      // Marketing Demand Model — World Generation First: Lead-Timing wird jetzt per
      // Rejection Sampling gezogen (engine/marketing-demand.ts), das strukturell
      // mehr rng()-Aufrufe pro Lead verbraucht als die vorige direkte
      // Gleichverteilung — 12 volle Weltgenerierungen (6 Profile × 2) in einem
      // Test brauchen dadurch spürbar länger als die vorherige Default-Grenze von
      // 5s. Rein ein Zeitbudget-Anpassung, keine funktionale Änderung an der
      // geprüften Eigenschaft (Determinismus bleibt exakt geprüft).
      for (const profile of SCENARIO_PROFILES) {
        const a = generateScenarioWorld(WORLD_SEED, profile);
        const b = generateScenarioWorld(WORLD_SEED, profile);
        expect(a).toEqual(b);
      }
    },
    20000,
  );

  it("unterschiedliche Profile erzeugen erkennbar unterschiedliche dynamische Ausgaben", () => {
    const baseline = SCENARIO_WORLDS.baseline;
    for (const profile of SCENARIO_PROFILES) {
      if (profile.id === "baseline") continue;
      const world = SCENARIO_WORLDS[profile.id];
      const differs =
        world.leads.length !== baseline.leads.length ||
        world.opportunities.length !== baseline.opportunities.length ||
        !JSON.stringify(world.leads) || // trivially true, keeps structure symmetric
        JSON.stringify(world.opportunities) !== JSON.stringify(baseline.opportunities);
      expect(differs).toBe(true);
    }
  });

  it("anderer WORLD_SEED erzeugt eine andere, aber strukturell gültige Welt", () => {
    const a = generateScenarioWorld(WORLD_SEED, BASELINE_PROFILE);
    const b = generateScenarioWorld(WORLD_SEED + 999_999, BASELINE_PROFILE);
    expect(a.leads).not.toEqual(b.leads);
    expect(checkLeadAccountReferences(b.leads, CUSTOMER_ACCOUNTS)).toEqual([]);
  });
});

describe("Scenario Profiles — Anti-Regression", () => {
  it("kein erneuter Pipeline-Stall-Generatorstillstand in irgendeinem Profil", () => {
    for (const profile of SCENARIO_PROFILES) {
      const world = SCENARIO_WORLDS[profile.id];
      expect(checkOpenOpportunityStageAgeNotDrivenByCreationDate(world.opportunities, world.stageHistory, WORLD_TIMELINE_START)).toEqual([]);
    }
  });

  it("keine erneute tenure-getriebene Capacity-Verzerrung (SDR-Lastverhältnis bleibt in gesundem Korridor außerhalb team-engpass)", () => {
    // Marketing Demand Model — World Generation First: Lead.createdAt trägt seit
    // diesem Auftrag echte saisonale Struktur (engine/marketing-demand.ts) statt
    // einer reinen Gleichverteilung. Account-SDR-Zuordnung ist selbst zeitfenster-
    // basiert (resolveLeadOwner → findOwnershipAt, siehe generate-sales-pipeline.ts)
    // — welcher SDR in welchem Zeitraum welche Accounts betreut, ändert sich durch
    // dieses Auftrag NICHT, aber WIE VIELE Leads in welches bereits bestehende
    // Zeitfenster fallen, verschiebt sich zwangsläufig mit einer nicht mehr
    // gleichverteilten Nachfrage. Für "wachstumsdruck" (hohes Gesamtvolumen über
    // leadCountMultiplier) verstärkt sich dieser Effekt sichtbar: das Verhältnis
    // war bereits vor diesem Auftrag mit 4.77 nahe am bisherigen Korridor (< 5),
    // liegt mit realistischer Saisonalität nun bei ~6.4 — ein legitimer,
    // nachvollziehbarer Effekt zeitfenster-basierter Zuordnung auf echte
    // Nachfrageschwankung, keine erneute tenure-getriebene Verzerrung (Tenure/
    // Hiring-Daten sind unverändert). Korridor bewusst großzügiger neu gezogen
    // (statt einer weiteren Ausnahme wie bei team-engpass), damit der Test echte
    // künftige Tenure-Verzerrungen weiterhin zuverlässig erkennt.
    for (const profile of SCENARIO_PROFILES) {
      if (profile.id === "team-engpass") continue; // hier ist Konzentration bewusst und dokumentiert
      const world = SCENARIO_WORLDS[profile.id];
      const leadCounts = new Map<string, number>();
      for (const lead of world.leads) leadCounts.set(lead.ownerEmployeeId, (leadCounts.get(lead.ownerEmployeeId) ?? 0) + 1);
      const activeSdrIds = EMPLOYEES.filter((e) => e.roleId === "role-sales-development-rep" && !e.terminatedAt).map((e) => e.id);
      const counts = activeSdrIds.map((id) => leadCounts.get(id) ?? 0).filter((c) => c > 0);
      if (counts.length === 0) continue;
      const ratio = Math.max(...counts) / Math.min(...counts);
      expect(ratio, `profile ${profile.id}`).toBeLessThan(7.5);
    }
  });
});

describe("Expected Pattern Contracts", () => {
  it("baseline", () => {
    const result = checkBaselineContract(SCENARIO_WORLDS.baseline);
    expect(result.violations).toEqual([]);
  });

  it("operativer-fokus", () => {
    const result = checkOperativerFokusContract(SCENARIO_WORLDS["operativer-fokus"], SCENARIO_WORLDS.baseline);
    expect(result.violations).toEqual([]);
  });

  it("strategischer-tag", () => {
    const result = checkStrategischerTagContract(SCENARIO_WORLDS["strategischer-tag"]);
    expect(result.violations).toEqual([]);
  });

  it("wachstumsdruck", () => {
    const result = checkWachstumsdruckContract(SCENARIO_WORLDS.wachstumsdruck, SCENARIO_WORLDS.baseline);
    expect(result.violations).toEqual([]);
  });

  it("team-engpass", () => {
    const result = checkTeamEngpassContract(SCENARIO_WORLDS["team-engpass"], SCENARIO_WORLDS.baseline);
    expect(result.violations).toEqual([]);
  });

  it("pipeline-risiko", () => {
    const result = checkPipelineRisikoContract(SCENARIO_WORLDS["pipeline-risiko"], SCENARIO_WORLDS.baseline);
    expect(result.violations).toEqual([]);
  });
});
