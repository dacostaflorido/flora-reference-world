import { WORLD_SEED } from "./seed";
import { BASELINE_PROFILE, SCENARIO_PROFILES, scenarioSeedOffset, type ScenarioProfile } from "./scenario-profiles";
import { EMPLOYEES } from "../world/employees";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { generateAccountOwnerships, type AccountOwnership } from "../world/account-ownership";
import { generateSalesPipeline } from "../events/generate-sales-pipeline";
import type { Lead } from "../events/leads";
import type { Opportunity } from "../events/opportunities";
import type { OpportunityStageHistory } from "../events/opportunity-stage-history";
import { generateInteractions } from "../events/generate-interactions";
import type { Call } from "../events/calls";
import type { Email } from "../events/emails";
import type { Meeting } from "../events/meetings";
import type { MeetingTranscript } from "../events/meeting-transcripts";
import type { CrmActivity } from "../events/crm-activities";
import { generateKnowledgeObjects, type KnowledgeObject } from "../world/knowledge-objects";
import { generateObservations, type Observation } from "../observations/observations";
import { generateGroundTruthSnapshot, type GroundTruthSnapshot } from "../ground-truth/ground-truth";
import { WORLD_NOW } from "../timeline/world-clock";

// Orchestriert die bereits im Architekturentwurf vorgesehene Reihenfolge
// World → Timeline → Events → Knowledge Objects → Observations → Ground Truth für ein
// gegebenes (WORLD_SEED, ScenarioProfile)-Paar. Company/Departments/Roles/Employees/
// CustomerAccounts/Contacts sind bewusst NICHT Teil dieser Funktion — sie bleiben über
// alle Scenario Profiles identisch (gleiche Firma, gleiche Mitarbeiter, gleiche
// Kundenstruktur), wie vom Scenario-Profiles-Auftrag gefordert. Nur AccountOwnership
// und alles darüber ist scenario-abhängig.
//
// Diese Datei enthält ausschließlich Orchestrierung — Aufrufreihenfolge, Seed-
// Aufteilung, Zusammenbau des Ergebnisses. Keine Wahrscheinlichkeiten, keine
// Geschäftsregeln, keine Constraints: die liegen in den jeweiligen Generatoren
// (world/account-ownership.ts, events/generate-sales-pipeline.ts,
// events/generate-interactions.ts) und bleiben dort — Architektur-Review-Folgeauftrag
// "Generator-Architektur" hat das geprüft und explizit so belassen (siehe Abschluss-
// bericht: eine Verlagerung dieser Logik hierher würde Events fachlich verändern, was
// für diesen Auftrag ausdrücklich ausgeschlossen war).

// Rein deskriptive, szenarioabhängige Wahrheit der generierten Welt — das, was jede
// spätere Ebene (Snapshot, künftige Situation/Decision) tatsächlich konsumieren darf.
// Bewusst getrennt von `profile` (siehe ScenarioWorld unten): eine Funktion, die ihren
// Parameter als ScenarioWorldTruth statt als ScenarioWorld typisiert, kann per
// Typsystem gar nicht auf das erzeugende Scenario Profile zugreifen — das macht die im
// Architektur-Review benannte Grenzverletzungsgefahr ("world.profile.id" als
// Abkürzung für eine eigentlich aus den Daten abzuleitende Aussage) strukturell statt
// nur durch Disziplin verhindert.
export interface ScenarioWorldTruth {
  accountOwnerships: AccountOwnership[];
  leads: Lead[];
  opportunities: Opportunity[];
  stageHistory: OpportunityStageHistory[];
  calls: Call[];
  emails: Email[];
  meetings: Meeting[];
  meetingTranscripts: MeetingTranscript[];
  crmActivities: CrmActivity[];
  knowledgeObjects: KnowledgeObject[];
  observations: Observation[];
  groundTruth: GroundTruthSnapshot;
}

// Das vollständige Orchestrierungsergebnis inklusive Generierungs-Metadaten (`profile`)
// — für Tests, Vergleichsberichte und Debugging, wo "welches Profil hat das erzeugt"
// eine legitime, nötige Frage ist. Kein Layer der Wahrheits-Kette selbst (Observations,
// Ground Truth, künftig Snapshot/Situation/Decision) darf ScenarioWorld als
// Eingabetyp verwenden — nur ScenarioWorldTruth.
export interface ScenarioWorld extends ScenarioWorldTruth {
  profile: ScenarioProfile;
}

// Seed-Offsets je Generierungsschritt — benannt statt inline, damit die
// Aufrufreihenfolge unten ohne Rückgriff auf magische Zahlen lesbar ist. Die
// tatsächlichen Werte sind unverändert (WORLD_SEED+3/+4/+5/+6, wie seit der
// ursprünglichen World/Events-Architektur), nur die Benennung ist neu.
const SEED_STEP = {
  accountOwnerships: 3,
  salesPipeline: 4,
  interactions: 5,
  knowledgeObjects: 6,
} as const;

export function generateScenarioWorld(worldSeed: number, profile: ScenarioProfile = BASELINE_PROFILE): ScenarioWorld {
  const offset = scenarioSeedOffset(profile);

  // --- Events (World → Events, Prinzip 6) ---------------------------------------
  const accountOwnerships = generateAccountOwnerships(
    worldSeed + SEED_STEP.accountOwnerships + offset,
    EMPLOYEES,
    CUSTOMER_ACCOUNTS,
    profile,
  );

  const { leads, opportunities, stageHistory } = generateSalesPipeline(
    worldSeed + SEED_STEP.salesPipeline + offset,
    CUSTOMER_ACCOUNTS,
    CONTACTS,
    EMPLOYEES,
    accountOwnerships,
    profile,
  );

  const { calls, emails, meetings, meetingTranscripts, crmActivities } = generateInteractions(
    worldSeed + SEED_STEP.interactions + offset,
    leads,
    opportunities,
    stageHistory,
    EMPLOYEES,
    CUSTOMER_ACCOUNTS,
    CONTACTS,
    profile,
  );

  // KnowledgeObjects benötigen keinen eigenen Scenario-Parameter: die
  // unternehmensweiten Dokumente sind handkuratiert und scenario-unabhängig, die
  // Angebotsdokumente leiten sich bereits vollständig aus den (scenario-abhängigen)
  // Opportunities ab, die hier übergeben werden.
  const knowledgeObjects = generateKnowledgeObjects(
    worldSeed + SEED_STEP.knowledgeObjects + offset,
    EMPLOYEES,
    CUSTOMER_ACCOUNTS,
    CONTACTS,
    opportunities,
    stageHistory,
  );

  // --- Events → Observations → Ground Truth (Prinzip 7/17) ----------------------
  // Observations sind ein reiner Analyse-Schritt ohne eigenen Zufallsstrom (keine
  // Rule Engine) — derselbe, unveränderte Code läuft gegen die tatsächlich erzeugte
  // Scenario-Welt.
  const observations = generateObservations(
    EMPLOYEES,
    CUSTOMER_ACCOUNTS,
    leads,
    opportunities,
    stageHistory,
    calls,
    emails,
    crmActivities,
  );

  const groundTruth = generateGroundTruthSnapshot(observations, WORLD_NOW);

  // --- Zusammenbau (reine Bündelung, keine weitere Berechnung) -------------------
  return {
    profile,
    accountOwnerships,
    leads,
    opportunities,
    stageHistory,
    calls,
    emails,
    meetings,
    meetingTranscripts,
    crmActivities,
    knowledgeObjects,
    observations,
    groundTruth,
  };
}

// Alle sechs Scenario-Welten, einmal mit demselben WORLD_SEED erzeugt — für
// Vergleiche, Audits und die Invariantenprüfung. baseline bleibt hier bewusst dieselbe
// Berechnung, die auch die einzelnen Singleton-Exporte (LEADS, OPPORTUNITIES, ...)
// bereits an anderer Stelle durchführen; siehe Determinismus-Tests.
export const SCENARIO_WORLDS: Record<ScenarioProfile["id"], ScenarioWorld> = Object.fromEntries(
  SCENARIO_PROFILES.map((profile) => [profile.id, generateScenarioWorld(WORLD_SEED, profile)]),
) as Record<ScenarioProfile["id"], ScenarioWorld>;
