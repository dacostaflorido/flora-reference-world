import { describe, expect, it } from "vitest";
import { EMPLOYEES } from "../world/employees";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY } from "../events/generate-sales-pipeline";
import {
  CALLS,
  EMAILS,
  MEETINGS,
  MEETING_TRANSCRIPTS,
  CRM_ACTIVITIES,
  generateInteractions,
} from "../events/generate-interactions";
import { WORLD_SEED } from "../engine/seed";
import {
  checkCallDuration,
  checkCallTimingWithinOpportunity,
  checkCrmActivityEmployeeValid,
  checkCrmActivityExactlyOneReference,
  checkCrmActivityTimingWithinEntity,
  checkEmailContentNotEmpty,
  checkEmailParticipantsValid,
  checkInteractionAssignment,
  checkInteractionEmployeeValid,
  checkInteractionReferences,
  checkInteractionsWithinWorldNow,
  checkInternalMeetingsHaveParticipants,
  checkKundenterminHasCustomerReference,
  checkLeadInteractionsBeforeConversion,
  checkMeetingDuration,
  checkMeetingParticipantsValid,
  checkTranscriptMeetingReferences,
  checkTranscriptUniquePerMeeting,
} from "./invariants";

describe("InteractionBase (Call/Email/Meeting)", () => {
  it("employeeId existiert und ist zum Zeitpunkt gültig", () => {
    expect(checkInteractionEmployeeValid(CALLS, EMPLOYEES, "Call")).toEqual([]);
    expect(checkInteractionEmployeeValid(EMAILS, EMPLOYEES, "Email")).toEqual([]);
    expect(checkInteractionEmployeeValid(MEETINGS, EMPLOYEES, "Meeting")).toEqual([]);
  });

  it("referenzierte IDs existieren und passen zum Account", () => {
    expect(checkInteractionReferences(CALLS, CUSTOMER_ACCOUNTS, CONTACTS, LEADS, OPPORTUNITIES, "Call")).toEqual([]);
    expect(checkInteractionReferences(EMAILS, CUSTOMER_ACCOUNTS, CONTACTS, LEADS, OPPORTUNITIES, "Email")).toEqual([]);
    expect(checkInteractionReferences(MEETINGS, CUSTOMER_ACCOUNTS, CONTACTS, LEADS, OPPORTUNITIES, "Meeting")).toEqual([]);
  });

  it("externe Interactions besitzen einen Kundenbezug", () => {
    expect(checkInteractionAssignment(CALLS, "Call")).toEqual([]);
    expect(checkInteractionAssignment(EMAILS, "Email")).toEqual([]);
    expect(checkInteractionAssignment(MEETINGS, "Meeting")).toEqual([]);
  });

  it("keine Interaction entsteht nach WORLD_NOW", () => {
    expect(checkInteractionsWithinWorldNow(CALLS, "Call")).toEqual([]);
    expect(checkInteractionsWithinWorldNow(EMAILS, "Email")).toEqual([]);
    expect(checkInteractionsWithinWorldNow(MEETINGS, "Meeting")).toEqual([]);
  });

  it("Lead-seitige Interactions liegen nie nach der Opportunity-Konversion (Cross-Source-Konsistenz)", () => {
    expect(checkLeadInteractionsBeforeConversion(CALLS, LEADS, OPPORTUNITIES, "Call")).toEqual([]);
    expect(checkLeadInteractionsBeforeConversion(EMAILS, LEADS, OPPORTUNITIES, "Email")).toEqual([]);
    expect(checkLeadInteractionsBeforeConversion(CRM_ACTIVITIES, LEADS, OPPORTUNITIES, "CrmActivity")).toEqual([]);
  });
});

describe("Call", () => {
  it("durationMinutes > 0", () => {
    expect(checkCallDuration(CALLS)).toEqual([]);
  });

  it("Zeitpunkt liegt innerhalb der Opportunity-Laufzeit (keine aktiven Calls nach closedAt)", () => {
    expect(checkCallTimingWithinOpportunity(CALLS, OPPORTUNITIES)).toEqual([]);
  });

  it("liegt in der erwarteten Größenordnung (800–1.500)", () => {
    expect(CALLS.length).toBeGreaterThanOrEqual(800);
    expect(CALLS.length).toBeLessThanOrEqual(1500);
  });
});

describe("Email", () => {
  it("subject und bodySummary sind nicht leer", () => {
    expect(checkEmailContentNotEmpty(EMAILS)).toEqual([]);
  });

  it("participantEmployeeIds zeigen auf existierende, aktive Employees", () => {
    expect(checkEmailParticipantsValid(EMAILS, EMPLOYEES)).toEqual([]);
  });

  it("liegt in der erwarteten Größenordnung (1.500–3.000)", () => {
    expect(EMAILS.length).toBeGreaterThanOrEqual(1500);
    expect(EMAILS.length).toBeLessThanOrEqual(3000);
  });
});

describe("Meeting", () => {
  it("durationMinutes > 0", () => {
    expect(checkMeetingDuration(MEETINGS)).toEqual([]);
  });

  it("interne Meetings besitzen participantEmployeeIds", () => {
    expect(checkInternalMeetingsHaveParticipants(MEETINGS)).toEqual([]);
  });

  it("alle Teilnehmer sind zum Zeitpunkt aktiv", () => {
    expect(checkMeetingParticipantsValid(MEETINGS, EMPLOYEES)).toEqual([]);
  });

  it("Kundentermine besitzen einen Kundenbezug", () => {
    expect(checkKundenterminHasCustomerReference(MEETINGS)).toEqual([]);
  });

  it("liegt in der erwarteten Größenordnung (300–700)", () => {
    expect(MEETINGS.length).toBeGreaterThanOrEqual(300);
    expect(MEETINGS.length).toBeLessThanOrEqual(700);
  });
});

describe("MeetingTranscript", () => {
  it("meetingId existiert", () => {
    expect(checkTranscriptMeetingReferences(MEETING_TRANSCRIPTS, MEETINGS)).toEqual([]);
  });

  it("maximal ein Transcript pro Meeting", () => {
    expect(checkTranscriptUniquePerMeeting(MEETING_TRANSCRIPTS)).toEqual([]);
  });
});

describe("CrmActivity", () => {
  it("genau eines von leadId/opportunityId ist gesetzt", () => {
    expect(checkCrmActivityExactlyOneReference(CRM_ACTIVITIES)).toEqual([]);
  });

  it("employee ist zum Zeitpunkt gültig", () => {
    expect(checkCrmActivityEmployeeValid(CRM_ACTIVITIES, EMPLOYEES)).toEqual([]);
  });

  it("timestamp liegt innerhalb der Entitätslaufzeit", () => {
    expect(checkCrmActivityTimingWithinEntity(CRM_ACTIVITIES, LEADS, OPPORTUNITIES)).toEqual([]);
  });

  it("liegt in der erwarteten Größenordnung (2.000–4.000)", () => {
    expect(CRM_ACTIVITIES.length).toBeGreaterThanOrEqual(2000);
    expect(CRM_ACTIVITIES.length).toBeLessThanOrEqual(4000);
  });
});

describe("Determinismus", () => {
  it("gleicher Seed erzeugt ein deep-identisches Interaction-Bundle", () => {
    const a = generateInteractions(WORLD_SEED + 5, LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY, EMPLOYEES, CUSTOMER_ACCOUNTS, CONTACTS);
    const b = generateInteractions(WORLD_SEED + 5, LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY, EMPLOYEES, CUSTOMER_ACCOUNTS, CONTACTS);
    expect(a).toEqual(b);
  });

  it("anderer Seed erzeugt ein abweichendes Interaction-Bundle", () => {
    const a = generateInteractions(WORLD_SEED + 5, LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY, EMPLOYEES, CUSTOMER_ACCOUNTS, CONTACTS);
    const b = generateInteractions(WORLD_SEED + 6, LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY, EMPLOYEES, CUSTOMER_ACCOUNTS, CONTACTS);
    expect(a).not.toEqual(b);
  });
});
