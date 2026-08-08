import { describe, expect, it } from "vitest";
import { EMPLOYEES } from "../world/employees";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY } from "../events/generate-sales-pipeline";
import { CALLS, EMAILS, MEETINGS, MEETING_TRANSCRIPTS, CRM_ACTIVITIES } from "../events/generate-interactions";
import { KNOWLEDGE_OBJECTS } from "../world/knowledge-objects";
import { OBSERVATIONS, generateObservations, type Observation } from "../observations/observations";
import {
  checkObservationDerivedFromResolvesAndOrdered,
  checkObservationFieldsValid,
  checkObservationGeneratedAtWithinWorldNow,
  checkObservationIdsUnique,
  checkObservationNoCycles,
  checkObservationNoSelfReference,
  type ObservationEvidenceSources,
} from "./invariants";

const sources: ObservationEvidenceSources = {
  leads: LEADS,
  opportunities: OPPORTUNITIES,
  stageHistory: OPPORTUNITY_STAGE_HISTORY,
  calls: CALLS,
  emails: EMAILS,
  meetings: MEETINGS,
  meetingTranscripts: MEETING_TRANSCRIPTS,
  crmActivities: CRM_ACTIVITIES,
  knowledgeObjects: KNOWLEDGE_OBJECTS,
  observations: OBSERVATIONS,
};

describe("Observation", () => {
  it("hat eindeutige IDs", () => {
    expect(checkObservationIdsUnique(OBSERVATIONS)).toEqual([]);
  });

  it("hat gültige category/severity/confidence, nicht-leeres statement und derivedFrom", () => {
    expect(checkObservationFieldsValid(OBSERVATIONS)).toEqual([]);
  });

  it("referenziert sich nie selbst", () => {
    expect(checkObservationNoSelfReference(OBSERVATIONS)).toEqual([]);
  });

  it("generatedAt liegt nie nach WORLD_NOW", () => {
    expect(checkObservationGeneratedAtWithinWorldNow(OBSERVATIONS)).toEqual([]);
  });

  it("jede derivedFrom-ID existiert und liegt nicht nach generatedAt", () => {
    expect(checkObservationDerivedFromResolvesAndOrdered(OBSERVATIONS, sources)).toEqual([]);
  });

  it("Observation-zu-Observation-Referenzen enthalten keine Zyklen", () => {
    expect(checkObservationNoCycles(OBSERVATIONS)).toEqual([]);
  });

  it("liegt in einer plausiblen Größenordnung (nicht künstlich auf einen Zielkorridor aufgebläht)", () => {
    expect(OBSERVATIONS.length).toBeGreaterThan(0);
    expect(OBSERVATIONS.length).toBeLessThanOrEqual(30);
  });

  it("deckt mehrere Kategorien ab (nicht nur Risiko)", () => {
    const categories = new Set(OBSERVATIONS.map((o) => o.category));
    expect(categories.size).toBeGreaterThanOrEqual(3);
  });
});

describe("Determinismus", () => {
  it("erzeugt bei gleichem Weltzustand deep-identische Observations", () => {
    const args = [EMPLOYEES, CUSTOMER_ACCOUNTS, LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY, CALLS, EMAILS, CRM_ACTIVITIES] as const;
    const a: Observation[] = generateObservations(...args);
    const b: Observation[] = generateObservations(...args);
    expect(a).toEqual(b);
  });
});
