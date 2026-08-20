import { describe, expect, it } from "vitest";
import { generateWorldSnapshot, type WorldSnapshotSource, type WorldSnapshot } from "../snapshot/snapshot";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { WORLD_NOW, WORLD_TIMELINE_START } from "../timeline/world-clock";
import { addDays, daysBetween } from "../engine/random";
import { SCENARIO_WORLDS } from "../engine/generator";
import { SCENARIO_PROFILES } from "../engine/scenario-profiles";

// Diese Suite gehört ausschließlich zum neu gebauten Snapshot-Layer. Sie ändert nichts
// an validation/invariants.ts oder an den dort geprüften, eingefrorenen Layern — reine
// Ergänzung für eine neue Entität, exakt wie bei jeder vorherigen Layer-Einführung
// (siehe z. B. ground-truth-invariants.test.ts, scenario-profiles.test.ts).

function toSource(worldId: (typeof SCENARIO_PROFILES)[number]["id"]): WorldSnapshotSource {
  const world = SCENARIO_WORLDS[worldId];
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

describe("Snapshot: Existenz-Filterung", () => {
  const source = toSource("baseline");

  it("enthält keine Entität mit createdAt/hiredAt/timestamp nach asOf", () => {
    const asOf = addDays(WORLD_TIMELINE_START, 200);
    const snapshot = generateWorldSnapshot(source, asOf);

    for (const e of snapshot.employees) expect(e.hiredAt <= asOf).toBe(true);
    for (const a of snapshot.customerAccounts) expect(a.createdAt <= asOf).toBe(true);
    for (const c of snapshot.contacts) expect(c.createdAt <= asOf).toBe(true);
    for (const l of snapshot.leads) expect(l.createdAt <= asOf).toBe(true);
    for (const k of snapshot.knowledgeObjects) expect(k.createdAt <= asOf).toBe(true);
    for (const c of snapshot.calls) expect(c.timestamp <= asOf).toBe(true);
    for (const e of snapshot.emails) expect(e.timestamp <= asOf).toBe(true);
    for (const m of snapshot.meetings) expect(m.timestamp <= asOf).toBe(true);
    for (const a of snapshot.crmActivities) expect(a.timestamp <= asOf).toBe(true);
    for (const { opportunity } of snapshot.opportunities) expect(opportunity.createdAt <= asOf).toBe(true);
  });

  it("Snapshot zu WORLD_TIMELINE_START enthält (fast) keine dynamischen Entitäten, aber die vollständigen, zu diesem Datum bereits existierenden Stammdaten", () => {
    const snapshot = generateWorldSnapshot(source, WORLD_TIMELINE_START);
    // Statische Stammdaten reichen historisch weit vor die 15-monatige
    // Simulationshistorie zurück (Employees seit 2013, Accounts teils seit 2018) —
    // die meisten existieren bereits zu WORLD_TIMELINE_START.
    expect(snapshot.employees.length).toBeGreaterThan(0);
    expect(snapshot.customerAccounts.length).toBeGreaterThan(0);
    // Dynamische Entitäten dürfen zu WORLD_TIMELINE_START nur in Ausnahmefällen
    // existieren (createdAt === WORLD_TIMELINE_START exakt).
    expect(snapshot.leads.length).toBeLessThan(source.leads.length);
    expect(snapshot.opportunities.length).toBeLessThan(source.opportunities.length);
  });

  it("Snapshot zu einem Datum vor jeder Account-Erstellung ist für dynamische Entitäten vollständig leer", () => {
    const snapshot = generateWorldSnapshot(source, "2000-01-01");
    expect(snapshot.leads).toEqual([]);
    expect(snapshot.opportunities).toEqual([]);
    expect(snapshot.calls).toEqual([]);
    expect(snapshot.emails).toEqual([]);
    expect(snapshot.meetings).toEqual([]);
    expect(snapshot.crmActivities).toEqual([]);
    expect(snapshot.knowledgeObjects).toEqual([]);
  });
});

describe("Snapshot: Zustandsprojektion (Opportunity, AccountOwnership)", () => {
  const source = toSource("pipeline-risiko"); // höchste Stagnation, viele Stage-Wechsel im Verlauf

  it("stageAsOf ist für jede enthaltene Opportunity zu asOf tatsächlich offen (enteredAt<=asOf<exitedAt, oder exitedAt undefined)", () => {
    const asOf = addDays(WORLD_TIMELINE_START, 300);
    const snapshot = generateWorldSnapshot(source, asOf);
    expect(snapshot.opportunities.length).toBeGreaterThan(0);
    for (const { opportunity, stageAsOf } of snapshot.opportunities) {
      expect(stageAsOf.opportunityId).toBe(opportunity.id);
      expect(stageAsOf.enteredAt <= asOf).toBe(true);
      if (stageAsOf.exitedAt !== undefined) {
        expect(asOf < stageAsOf.exitedAt).toBe(true);
      }
    }
  });

  it("eine Opportunity kann zu einem früheren asOf in einer anderen Stage stehen als zu WORLD_NOW", () => {
    // Sucht eine Opportunity mit mindestens zwei Stage-History-Einträgen (also
    // mindestens einem echten Stage-Wechsel) und bestätigt, dass die frühe Projektion
    // von der finalen Stage abweicht.
    const stageCountByOpportunity = new Map<string, number>();
    for (const entry of source.stageHistory) {
      stageCountByOpportunity.set(entry.opportunityId, (stageCountByOpportunity.get(entry.opportunityId) ?? 0) + 1);
    }
    const candidateId = [...stageCountByOpportunity.entries()].find(([, count]) => count >= 2)?.[0];
    expect(candidateId).toBeDefined();
    const opportunity = source.opportunities.find((o) => o.id === candidateId)!;
    const firstEntry = source.stageHistory
      .filter((e) => e.opportunityId === candidateId)
      .sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : 1))[0]!;

    const earlySnapshot = generateWorldSnapshot(source, firstEntry.enteredAt);
    const earlyProjection = earlySnapshot.opportunities.find((entry) => entry.opportunity.id === candidateId);
    expect(earlyProjection?.stageAsOf.stage).toBe(firstEntry.stage);

    const nowSnapshot = generateWorldSnapshot(source, WORLD_NOW);
    const nowProjection = nowSnapshot.opportunities.find((entry) => entry.opportunity.id === candidateId);
    expect(nowProjection?.stageAsOf.stage).toBe(opportunity.currentStage);
  });

  it("accountOwnerships enthält für jeden zurückgegebenen Eintrag nur zu asOf gültige Zuweisungen", () => {
    const asOf = addDays(WORLD_TIMELINE_START, 400);
    const snapshot = generateWorldSnapshot(source, asOf);
    for (const ownership of snapshot.accountOwnerships) {
      expect(ownership.validFrom <= asOf).toBe(true);
      if (ownership.validTo !== undefined) {
        expect(asOf <= ownership.validTo).toBe(true);
      }
    }
  });
});

describe("Snapshot: Referenzielle Integrität innerhalb des Snapshots", () => {
  const source = toSource("wachstumsdruck");

  it("Lead.convertedToOpportunityId verweist nie auf eine Opportunity, die im selben Snapshot nicht enthalten ist", () => {
    for (const asOf of [addDays(WORLD_TIMELINE_START, 100), addDays(WORLD_TIMELINE_START, 250), WORLD_NOW]) {
      const snapshot = generateWorldSnapshot(source, asOf);
      const includedOpportunityIds = new Set(snapshot.opportunities.map((entry) => entry.opportunity.id));
      for (const lead of snapshot.leads) {
        if (lead.convertedToOpportunityId) {
          expect(includedOpportunityIds.has(lead.convertedToOpportunityId)).toBe(true);
        }
      }
    }
  });

  it("MeetingTranscript.meetingId verweist immer auf ein im selben Snapshot enthaltenes Meeting", () => {
    const asOf = addDays(WORLD_TIMELINE_START, 250);
    const snapshot = generateWorldSnapshot(source, asOf);
    const includedMeetingIds = new Set(snapshot.meetings.map((m) => m.id));
    for (const transcript of snapshot.meetingTranscripts) {
      expect(includedMeetingIds.has(transcript.meetingId)).toBe(true);
    }
  });

  it("ein Lead, dessen Opportunity erst nach asOf entstand, zeigt convertedToOpportunityId nicht (Temporal Consistency)", () => {
    // Konstruiert gezielt einen Zeitpunkt zwischen Lead.createdAt und der zugehörigen
    // Opportunity.createdAt (Konversion erfolgt laut Generator 1-25 Tage nach dem Lead).
    const convertedLead = source.leads.find((l) => l.convertedToOpportunityId);
    expect(convertedLead).toBeDefined();
    const opportunity = source.opportunities.find((o) => o.id === convertedLead!.convertedToOpportunityId)!;
    expect(daysBetween(convertedLead!.createdAt, opportunity.createdAt)).toBeGreaterThan(0);

    const asOf = convertedLead!.createdAt; // Lead existiert, Opportunity (später) noch nicht
    const snapshot = generateWorldSnapshot(source, asOf);
    const projectedLead = snapshot.leads.find((l) => l.id === convertedLead!.id);
    expect(projectedLead).toBeDefined();
    expect(projectedLead!.convertedToOpportunityId).toBeUndefined();
  });
});

describe("Snapshot: Monotonie über die Zeit", () => {
  const source = toSource("strategischer-tag");

  it("die Anzahl enthaltener dynamischer Entitäten sinkt nie, wenn asOf später liegt", () => {
    const checkpoints = [0, 100, 200, 300, 400, 460].map((days) => addDays(WORLD_TIMELINE_START, days));
    let previous: WorldSnapshot | undefined;
    for (const asOf of checkpoints) {
      const snapshot = generateWorldSnapshot(source, asOf > WORLD_NOW ? WORLD_NOW : asOf);
      if (previous) {
        expect(snapshot.leads.length).toBeGreaterThanOrEqual(previous.leads.length);
        expect(snapshot.opportunities.length).toBeGreaterThanOrEqual(previous.opportunities.length);
        expect(snapshot.calls.length).toBeGreaterThanOrEqual(previous.calls.length);
        expect(snapshot.emails.length).toBeGreaterThanOrEqual(previous.emails.length);
        expect(snapshot.knowledgeObjects.length).toBeGreaterThanOrEqual(previous.knowledgeObjects.length);
      }
      previous = snapshot;
    }
  });
});

describe("Snapshot: Grenzfall WORLD_NOW entspricht dem vollständigen, finalen Weltzustand", () => {
  for (const profile of SCENARIO_PROFILES) {
    it(`${profile.id}: Snapshot(WORLD_NOW) enthält exakt alle Entitäten mit ihrem finalen Zustand`, () => {
      const source = toSource(profile.id);
      const snapshot = generateWorldSnapshot(source, WORLD_NOW);

      expect(snapshot.employees.length).toBe(source.employees.length);
      expect(snapshot.customerAccounts.length).toBe(source.customerAccounts.length);
      expect(snapshot.contacts.length).toBe(source.contacts.length);
      expect(snapshot.leads.length).toBe(source.leads.length);
      expect(snapshot.opportunities.length).toBe(source.opportunities.length);
      expect(snapshot.knowledgeObjects.length).toBe(source.knowledgeObjects.length);
      expect(snapshot.calls.length).toBe(source.calls.length);
      expect(snapshot.emails.length).toBe(source.emails.length);
      expect(snapshot.meetings.length).toBe(source.meetings.length);
      expect(snapshot.crmActivities.length).toBe(source.crmActivities.length);

      // Für jede offene Opportunity muss stageAsOf(WORLD_NOW) exakt der finalen
      // currentStage entsprechen; für geschlossene ebenso (gewonnen/verloren sind
      // ebenfalls Stage-Werte im Modell).
      for (const { opportunity, stageAsOf } of snapshot.opportunities) {
        expect(stageAsOf.stage).toBe(opportunity.currentStage);
      }
    });
  }
});

describe("Snapshot: Determinismus", () => {
  it("derselbe Weltzustand und derselbe asOf erzeugen einen deep-identischen Snapshot", () => {
    const source = toSource("team-engpass");
    const asOf = addDays(WORLD_TIMELINE_START, 250);
    const a = generateWorldSnapshot(source, asOf);
    const b = generateWorldSnapshot(source, asOf);
    expect(a).toEqual(b);
  });
});
