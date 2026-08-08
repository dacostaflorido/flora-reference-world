import { createRng, WORLD_SEED, type Rng } from "../engine/seed";
import { addDays, daysBetween, pick, randomInt } from "../engine/random";
import { isBusinessDay, nextBusinessDay } from "../timeline/calendar";
import { WORLD_NOW, WORLD_TIMELINE_START } from "../timeline/world-clock";
import { BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { EMPLOYEES, type Employee } from "../world/employees";
import { CUSTOMER_ACCOUNTS, type CustomerAccount } from "../world/customer-accounts";
import { CONTACTS, type Contact } from "../world/contacts";
import { LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY } from "./generate-sales-pipeline";
import type { Lead } from "./leads";
import type { Opportunity } from "./opportunities";
import type { OpportunityStageHistory } from "./opportunity-stage-history";
import type { Call } from "./calls";
import type { Email } from "./emails";
import type { Meeting } from "./meetings";
import type { MeetingTranscript } from "./meeting-transcripts";
import type { CrmActivity } from "./crm-activities";

// Alle fünf Interaction-/Communication-Domänen werden in einem Generator erzeugt,
// weil sie sich aus derselben Lead-/Opportunity-Reise ableiten und untereinander
// widerspruchsfrei bleiben müssen (Cross-Source-Konsistenz, Schritt-4-Auftrag §7):
// ein Call mit Einwand, eine darauf folgende E-Mail, ein Meeting-Transcript und eine
// CRM-Notiz entstehen hier als eine zusammenhängende, zeitlich konsistente Erzählung
// pro Journey statt als fünf unabhängige Zufallsströme. Keine vollständige
// Generator-Orchestrierung (die würde auch Observations/Scenario/Snapshot verbinden) —
// nur die für diese fünf gekoppelten Entitäten notwendige gemeinsame Erzeugung.

function isEmployeeValidAt(employee: Employee, isoDate: string): boolean {
  return employee.hiredAt <= isoDate && (employee.terminatedAt === undefined || isoDate <= employee.terminatedAt);
}

function randomDateInRange(rng: Rng, fromIso: string, toIso: string): string {
  const span = daysBetween(fromIso, toIso);
  if (span <= 0) return fromIso;
  return addDays(fromIso, randomInt(rng, 0, span));
}

// Wie randomDateInRange, aber zusätzlich auf maxSpanDays ab fromIso begrenzt — wichtig
// für noch offene (nicht abgeschlossene) Stages, deren windowEnd bis WORLD_NOW reicht:
// ohne diese Begrenzung könnte z. B. eine "Angebotsversand"-E-Mail plausibel Monate
// nach Eintritt in die Stage "angebot" landen, obwohl ein Angebot direkt nach
// Stage-Eintritt verschickt wird, nicht Monate später.
function boundedDateInRange(rng: Rng, fromIso: string, toIso: string, maxSpanDays: number): string {
  const cappedEnd = addDays(fromIso, maxSpanDays);
  const effectiveEnd = cappedEnd < toIso ? cappedEnd : toIso;
  return randomDateInRange(rng, fromIso, effectiveEnd);
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}
function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// --- Deterministische Mitarbeiter-Stilprofile (generatorintern, kein neues Feld) ---
// "manche dokumentieren sauberer, manche telefonieren häufiger..." — abgeleitet rein
// aus der bestehenden employeeId, unabhängig von der Iterationsreihenfolge im
// Hauptgenerator (eigener Rng-Teilstrom pro Employee).
interface EmployeeStyle {
  activityMultiplier: number;
  docQuality: number;
  followThrough: number;
}
const employeeStyleCache = new Map<string, EmployeeStyle>();
function styleFor(employeeId: string): EmployeeStyle {
  const cached = employeeStyleCache.get(employeeId);
  if (cached) return cached;
  const styleRng = createRng(WORLD_SEED + 9000 + (hashString(employeeId) % 100000));
  const style: EmployeeStyle = {
    activityMultiplier: 0.7 + styleRng() * 0.6,
    docQuality: 0.4 + styleRng() * 0.5,
    followThrough: 0.5 + styleRng() * 0.45,
  };
  employeeStyleCache.set(employeeId, style);
  return style;
}

// --- Textbausteine (deterministisch kombinierbar, keine LLM-Abhängigkeit) ---------

const DEADLINE_PHRASES = ["Freitag", "Ende der Woche", "Anfang nächster Woche", "Ende des Monats", "kommenden Montag"] as const;

const CALL_OUTCOMES_ERSTGESPRAECH = [
  "Bedarf grundsätzlich bestätigt, nächster Schritt vereinbart.",
  "Interesse vorhanden, weitere Abstimmung intern nötig.",
  "Erstkontakt erfolgreich, Ansprechpartner verifiziert.",
  "Guter erster Eindruck, Demo-Termin vereinbart.",
] as const;
const CALL_OUTCOMES_FOLLOWUP = [
  "Rückfragen geklärt, kein neuer Termin vereinbart.",
  "Kunde prüft weiterhin intern.",
  "Nächster Schritt bestätigt.",
  "Kunde meldet sich nach interner Abstimmung zurück.",
] as const;
const CALL_OUTCOMES_CLOSING_WON = [
  "Deal mündlich bestätigt, Vertrag folgt.",
  "Zusage erhalten.",
  "Entscheidung positiv, Unterlagen werden vorbereitet.",
] as const;
const CALL_OUTCOMES_CLOSING_LOST = [
  "Kunde entscheidet sich gegen das Angebot.",
  "Absage erhalten.",
  "Kein weiteres Interesse signalisiert.",
] as const;

const OBJECTION_POOL_BY_STAGE: Record<"qualifizierung" | "angebot" | "verhandlung", readonly string[]> = {
  qualifizierung: ["budget", "timing"],
  angebot: ["preis", "budget", "interne-freigabe"],
  verhandlung: ["preis", "wettbewerber", "interne-freigabe"],
};

const EMAIL_SUBJECT_TEMPLATES: Record<string, readonly string[]> = {
  terminvereinbarung: ["Terminvorschlag für {account}", "Kurzer Austausch diese Woche?", "Terminfindung {account}"],
  followup: ["Follow-up nach unserem Gespräch", "Kurzes Follow-up", "Rückmeldung zu unserem Call"],
  unterlagenversand: ["Unterlagen wie besprochen", "Material zu unserem Gespräch", "Anbei die gewünschten Informationen"],
  angebotsversand: ["Ihr Angebot von Elbfeld", "Angebot zur Durchsicht", "Angebot {account}"],
  angebotsnachfrage: ["Rückfrage zum Angebot", "Kurzes Update zum Angebotsstatus?", "Wie ist der Stand beim Angebot?"],
  reminder: ["Kurze Erinnerung", "Nur zur Sicherheit: Reminder", "Reminder zu unserem Termin"],
  handoff: ["Übergabe {account}", "Neuer Ansprechpartner bei Elbfeld", "Kurzes Handover zu {account}"],
  interne_rueckfrage: ["Frage zur Opportunity {account}", "Kurze Rückfrage zum Deal-Status", "Einschätzung zu {account} gesucht"],
};

const BODY_REQUEST_FRAGMENTS = [
  "Der Kunde bittet um eine konkrete ROI-Rechnung für die interne Freigabe",
  "Der Kunde möchte zusätzliche Referenzen aus der eigenen Branche sehen",
  "Es wurde um eine Anpassung der Vertragslaufzeit gebeten",
  "Der Kunde wünscht ein aktualisiertes Angebot mit gestaffelten Paketen",
  "Es besteht Interesse an einem technischen Deep-Dive vor der Entscheidung",
  "Der Kunde möchte das Angebot zunächst intern mit dem Einkauf abstimmen",
] as const;
const BODY_CONSTRAINT_FRAGMENTS = [
  "und möchte das Angebot bis {deadline} prüfen.",
  "die Entscheidung soll bis {deadline} fallen.",
  "eine Rückmeldung wird für {deadline} erwartet.",
  "der nächste Schritt ist für {deadline} angesetzt.",
] as const;

function buildExternalEmail(
  rng: Rng,
  type: keyof typeof EMAIL_SUBJECT_TEMPLATES,
  accountName: string,
): { subject: string; bodySummary: string } {
  const subject = (pick(rng, EMAIL_SUBJECT_TEMPLATES[type] ?? EMAIL_SUBJECT_TEMPLATES.followup!)).replace("{account}", accountName);
  const request = pick(rng, BODY_REQUEST_FRAGMENTS);
  const constraint = pick(rng, BODY_CONSTRAINT_FRAGMENTS).replace("{deadline}", pick(rng, DEADLINE_PHRASES));
  return { subject, bodySummary: `${request} ${constraint}` };
}

function buildHandoffEmail(rng: Rng, accountName: string, sourceLabel: string): { subject: string; bodySummary: string } {
  const subject = pick(rng, EMAIL_SUBJECT_TEMPLATES.handoff!).replace("{account}", accountName);
  return {
    subject,
    bodySummary: `Lead kam über ${sourceLabel} und wurde qualifiziert übergeben. Bitte kurz Kontakt aufnehmen und nächsten Schritt vereinbaren.`,
  };
}

function buildInternalOpportunityEmail(rng: Rng, accountName: string, stageLabel: string): { subject: string; bodySummary: string } {
  const subject = pick(rng, EMAIL_SUBJECT_TEMPLATES.interne_rueckfrage!).replace("{account}", accountName);
  return {
    subject,
    bodySummary: `Kurze Einschätzung zum aktuellen Stand bei ${accountName} gewünscht — Deal befindet sich aktuell in ${stageLabel}.`,
  };
}

const CRM_NOTE_TEMPLATES: Record<string, readonly string[]> = {
  notiz: [
    "Erstkontakt dokumentiert.",
    "Bedarf grob erfasst.",
    "Gespräch zusammengefasst, nächster Schritt notiert.",
    "Kunde hat Interesse an weiterem Austausch signalisiert.",
  ],
  "aufgabe-erstellt": ["Follow-up eingeplant.", "Nächster Schritt terminiert.", "Wiedervorlage gesetzt."],
  "aufgabe-erledigt": ["Follow-up wie geplant durchgeführt.", "Angebot intern geprüft.", "Vereinbarter Schritt umgesetzt."],
  "status-erinnerung": ["Kein nächster Schritt dokumentiert.", "Seit längerem ohne Fortschritt.", "Wiedervorlage überfällig."],
};

const STAGE_LABEL: Record<string, string> = {
  qualifizierung: "Qualifizierung",
  angebot: "Angebot",
  verhandlung: "Verhandlung",
  gewonnen: "Gewonnen",
  verloren: "Verloren",
};

export interface InteractionBundle {
  calls: Call[];
  emails: Email[];
  meetings: Meeting[];
  meetingTranscripts: MeetingTranscript[];
  crmActivities: CrmActivity[];
}

export function generateInteractions(
  seed: number,
  leads: readonly Lead[],
  opportunities: readonly Opportunity[],
  stageHistory: readonly OpportunityStageHistory[],
  employees: readonly Employee[],
  accounts: readonly CustomerAccount[],
  contacts: readonly Contact[],
  scenarioProfile: ScenarioProfile = BASELINE_PROFILE,
): InteractionBundle {
  const rng = createRng(seed);
  // scenarioProfile.sales.activityDensityMultiplier skaliert dieselben, bereits
  // bestehenden mitarbeiterindividuellen Aktivitäts-Checks (style.activityMultiplier)
  // — das Mitarbeiter-Stilprofil selbst bleibt scenario-unabhängig (gleiche
  // Mitarbeiter, siehe styleFor()-Cache), nur die Gesamtdichte verschiebt sich.
  const densityMultiplier = scenarioProfile.sales.activityDensityMultiplier;

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const opportunityByLeadId = new Map(opportunities.map((o) => [o.leadId, o]));
  const stagesByOpportunity = new Map<string, OpportunityStageHistory[]>();
  for (const entry of stageHistory) {
    const list = stagesByOpportunity.get(entry.opportunityId) ?? [];
    list.push(entry);
    stagesByOpportunity.set(entry.opportunityId, list);
  }
  for (const list of stagesByOpportunity.values()) {
    list.sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : 1));
  }

  const calls: Call[] = [];
  const emails: Email[] = [];
  const meetings: Meeting[] = [];
  const meetingTranscripts: MeetingTranscript[] = [];
  const crmActivities: CrmActivity[] = [];

  let callCounter = 1;
  let emailCounter = 1;
  let meetingCounter = 1;
  let transcriptCounter = 1;
  let activityCounter = 1;
  const nextCallId = () => `call-${String(callCounter++).padStart(5, "0")}`;
  const nextEmailId = () => `email-${String(emailCounter++).padStart(5, "0")}`;
  const nextMeetingId = () => `meeting-${String(meetingCounter++).padStart(5, "0")}`;
  const nextTranscriptId = () => `transcript-${String(transcriptCounter++).padStart(5, "0")}`;
  const nextActivityId = () => `activity-${String(activityCounter++).padStart(5, "0")}`;

  // Kontext für Meeting-Transcripts — nur intern genutzt, um Transcripts an real
  // generierten Fakten zu verankern; keine neue Domänenentität.
  const meetingContext = new Map<
    string,
    { accountName?: string; contactName?: string; stageLabel?: string; objection?: string; note?: string }
  >();

  function pushCall(
    employeeId: string,
    timestamp: string,
    callType: Call["callType"],
    opts: {
      leadId?: string;
      opportunityId?: string;
      accountId?: string;
      contactId?: string;
      objectionCategory?: string;
      outcome: string;
    },
  ): Call {
    const call: Call = {
      id: nextCallId(),
      timestamp,
      employeeId,
      direction: "ausgehend",
      durationMinutes: randomInt(rng, 8, 45),
      callType,
      leadId: opts.leadId,
      opportunityId: opts.opportunityId,
      accountId: opts.accountId,
      contactId: opts.contactId,
      objectionCategory: opts.objectionCategory,
      outcome: opts.outcome,
    };
    calls.push(call);
    return call;
  }

  function pushEmail(
    employeeId: string,
    timestamp: string,
    direction: Email["direction"],
    content: { subject: string; bodySummary: string },
    opts: { leadId?: string; opportunityId?: string; accountId?: string; contactId?: string; participantEmployeeIds?: string[] },
  ): Email {
    const email: Email = {
      id: nextEmailId(),
      timestamp,
      employeeId,
      direction,
      subject: content.subject,
      bodySummary: content.bodySummary,
      leadId: opts.leadId,
      opportunityId: opts.opportunityId,
      accountId: opts.accountId,
      contactId: opts.contactId,
      participantEmployeeIds: opts.participantEmployeeIds,
    };
    emails.push(email);
    return email;
  }

  function pushCrmActivity(
    employeeId: string,
    timestamp: string,
    activityType: CrmActivity["activityType"],
    opts: { leadId?: string; opportunityId?: string },
    noteOverride?: string,
  ): void {
    const note = noteOverride ?? pick(rng, CRM_NOTE_TEMPLATES[activityType] ?? CRM_NOTE_TEMPLATES.notiz!);
    crmActivities.push({
      id: nextActivityId(),
      timestamp,
      employeeId,
      activityType,
      note,
      leadId: opts.leadId,
      opportunityId: opts.opportunityId,
    });
  }

  // --- Lead-Journeys ---------------------------------------------------------

  for (const lead of leads) {
    const owner = employeeById.get(lead.ownerEmployeeId);
    if (!owner) continue;
    const account = accountById.get(lead.accountId);
    const contact = contactById.get(lead.contactId);
    if (!account || !contact) continue;
    const style = styleFor(owner.id);

    if (lead.status === "neu") {
      if (rng() < 0.45 * style.docQuality) {
        pushCrmActivity(owner.id, lead.createdAt, "aufgabe-erstellt", { leadId: lead.id }, "Erstkontakt einplanen.");
      }
      continue;
    }

    // Bei konvertierten Leads darf keine Lead-seitige Interaktion nach dem
    // tatsächlichen Konversionszeitpunkt (Opportunity.createdAt) liegen — sonst
    // widerspricht die Lead-Historie der Opportunity-Historie (Cross-Source-
    // Konsistenz, Schritt-4-Auftrag §7). lastContactedAt und der Konversionszeitpunkt
    // wurden in Schritt 3 unabhängig voneinander gezogen und können daher in beide
    // Richtungen auseinanderfallen.
    const opportunityForWindow = lead.status === "konvertiert" ? opportunityByLeadId.get(lead.id) : undefined;
    const rawTouchWindowEnd = lead.lastContactedAt ?? lead.createdAt;
    const touchWindowEnd = opportunityForWindow
      ? maxIso(lead.createdAt, minIso(rawTouchWindowEnd, addDays(opportunityForWindow.createdAt, -1)))
      : rawTouchWindowEnd;

    // Erstkontakt (Call oder E-Mail).
    const firstTouchDate = randomDateInRange(rng, lead.createdAt, touchWindowEnd);
    if (isEmployeeValidAt(owner, firstTouchDate)) {
      if (rng() < 0.6) {
        pushCall(owner.id, firstTouchDate, "erstgespraech", {
          leadId: lead.id,
          accountId: account.id,
          contactId: contact.id,
          outcome: pick(rng, CALL_OUTCOMES_ERSTGESPRAECH),
        });
      } else {
        pushEmail(owner.id, firstTouchDate, "ausgehend", buildExternalEmail(rng, "terminvereinbarung", account.name), {
          leadId: lead.id,
          accountId: account.id,
          contactId: contact.id,
        });
      }
      if (rng() < Math.min(0.95, style.docQuality * 1.3)) {
        pushCrmActivity(owner.id, firstTouchDate, "notiz", { leadId: lead.id });
      }
    }

    // Zweiter Touch für kontaktierte/qualifizierte/konvertierte Leads.
    if (lead.status !== "verloren" && rng() < 0.75 * style.activityMultiplier * densityMultiplier) {
      const secondTouchDate = randomDateInRange(rng, firstTouchDate, touchWindowEnd);
      if (isEmployeeValidAt(owner, secondTouchDate)) {
        if (rng() < 0.45) {
          pushCall(owner.id, secondTouchDate, "follow-up", {
            leadId: lead.id,
            accountId: account.id,
            contactId: contact.id,
            outcome: pick(rng, CALL_OUTCOMES_FOLLOWUP),
          });
        } else {
          pushEmail(owner.id, secondTouchDate, "ausgehend", buildExternalEmail(rng, "unterlagenversand", account.name), {
            leadId: lead.id,
            accountId: account.id,
            contactId: contact.id,
          });
        }
        if (rng() < Math.min(0.95, style.docQuality * 1.35)) {
          pushCrmActivity(owner.id, secondTouchDate, "aufgabe-erledigt", { leadId: lead.id });
        }
      }
    }

    // Dritter Touch (nur konvertierte Leads — intensivere Vorbereitung vor Konversion).
    if (lead.status === "konvertiert" && rng() < 0.5 * style.activityMultiplier * densityMultiplier) {
      const thirdTouchDate = randomDateInRange(rng, firstTouchDate, touchWindowEnd);
      if (isEmployeeValidAt(owner, thirdTouchDate)) {
        pushEmail(owner.id, thirdTouchDate, "ausgehend", buildExternalEmail(rng, "followup", account.name), {
          leadId: lead.id,
          accountId: account.id,
          contactId: contact.id,
        });
      }
    }

    if (lead.status === "verloren") {
      if (rng() < Math.min(0.95, style.docQuality * 1.35)) {
        pushCrmActivity(owner.id, touchWindowEnd, "notiz", { leadId: lead.id }, `Lead verloren: ${lead.lostReason}.`);
      }
      continue;
    }

    if (lead.status === "konvertiert") {
      const opportunity = opportunityByLeadId.get(lead.id);
      if (!opportunity) continue;
      const firstStage = stagesByOpportunity.get(opportunity.id)?.[0];
      const initialResponsibleId = firstStage?.responsibleEmployeeId ?? opportunity.responsibleEmployeeId;
      if (initialResponsibleId !== owner.id) {
        const handoffEmployee = employeeById.get(initialResponsibleId);
        if (handoffEmployee && isEmployeeValidAt(handoffEmployee, opportunity.createdAt)) {
          pushEmail(
            owner.id,
            opportunity.createdAt,
            "intern",
            buildHandoffEmail(rng, account.name, lead.source),
            { leadId: lead.id, participantEmployeeIds: [handoffEmployee.id] },
          );
        }
      }
      buildOpportunityJourney(opportunity, account, contact);
    }
  }

  // --- Opportunity-Journeys ----------------------------------------------

  function buildOpportunityJourney(opportunity: Opportunity, account: CustomerAccount, contact: Contact): void {
    const entries = stagesByOpportunity.get(opportunity.id) ?? [];
    for (const entry of entries) {
      const responsible = employeeById.get(entry.responsibleEmployeeId);
      if (!responsible) continue;
      const style = styleFor(responsible.id);
      const windowEnd = entry.exitedAt ?? WORLD_NOW;

      if (entry.stage === "qualifizierung") {
        const date = boundedDateInRange(rng, entry.enteredAt, windowEnd, 7);
        if (rng() < 0.7 * style.activityMultiplier * densityMultiplier && isEmployeeValidAt(responsible, date)) {
          const objection = rng() < 0.25 ? pick(rng, OBJECTION_POOL_BY_STAGE.qualifizierung) : undefined;
          pushCall(responsible.id, date, "follow-up", {
            opportunityId: opportunity.id,
            accountId: account.id,
            contactId: contact.id,
            objectionCategory: objection,
            outcome: pick(rng, CALL_OUTCOMES_FOLLOWUP),
          });
          if (rng() < Math.min(0.95, style.docQuality * 1.35)) {
            pushCrmActivity(responsible.id, date, "notiz", { opportunityId: opportunity.id });
          }
          if (rng() < 0.55) {
            const emailDate = boundedDateInRange(rng, date, windowEnd, 5);
            if (isEmployeeValidAt(responsible, emailDate)) {
              pushEmail(responsible.id, emailDate, "ausgehend", buildExternalEmail(rng, "followup", account.name), {
                opportunityId: opportunity.id,
                accountId: account.id,
                contactId: contact.id,
              });
            }
          }
        }
      } else if (entry.stage === "angebot") {
        const sendDate = boundedDateInRange(rng, entry.enteredAt, windowEnd, 5);
        if (isEmployeeValidAt(responsible, sendDate)) {
          pushEmail(responsible.id, sendDate, "ausgehend", buildExternalEmail(rng, "angebotsversand", account.name), {
            opportunityId: opportunity.id,
            accountId: account.id,
            contactId: contact.id,
          });
          if (rng() < Math.min(0.95, style.docQuality * 1.35)) {
            pushCrmActivity(responsible.id, sendDate, "aufgabe-erstellt", { opportunityId: opportunity.id });
          }
          if (rng() < 0.55) {
            const followUpDate = boundedDateInRange(rng, sendDate, windowEnd, 10);
            if (isEmployeeValidAt(responsible, followUpDate)) {
              pushEmail(responsible.id, followUpDate, "eingehend", buildExternalEmail(rng, "angebotsnachfrage", account.name), {
                opportunityId: opportunity.id,
                accountId: account.id,
                contactId: contact.id,
              });
            }
          }
        }
        if (rng() < 0.5 * style.activityMultiplier * densityMultiplier) {
          const meetingDate = boundedDateInRange(rng, sendDate, windowEnd, 10);
          if (isEmployeeValidAt(responsible, meetingDate)) {
            const objection = rng() < 0.35 ? pick(rng, OBJECTION_POOL_BY_STAGE.angebot) : undefined;
            createKundentermin(responsible, meetingDate, opportunity, account, contact, "Angebotsbesprechung", objection);
            if (rng() < Math.min(0.95, style.docQuality * 1.35)) {
              pushCrmActivity(responsible.id, meetingDate, "notiz", { opportunityId: opportunity.id });
            }
          }
        }
      } else if (entry.stage === "verhandlung") {
        const date = boundedDateInRange(rng, entry.enteredAt, windowEnd, 7);
        if (isEmployeeValidAt(responsible, date)) {
          const objection = rng() < 0.45 ? pick(rng, OBJECTION_POOL_BY_STAGE.verhandlung) : undefined;
          pushCall(responsible.id, date, "follow-up", {
            opportunityId: opportunity.id,
            accountId: account.id,
            contactId: contact.id,
            objectionCategory: objection,
            outcome: pick(rng, CALL_OUTCOMES_FOLLOWUP),
          });
          if (rng() < Math.min(0.95, style.docQuality * 1.35)) {
            pushCrmActivity(responsible.id, date, "notiz", { opportunityId: opportunity.id });
          }
        }
        if (rng() < 0.75) {
          const emailDate = boundedDateInRange(rng, date, windowEnd, 7);
          if (isEmployeeValidAt(responsible, emailDate)) {
            const type = rng() < 0.5 ? "angebotsnachfrage" : "reminder";
            pushEmail(responsible.id, emailDate, "eingehend", buildExternalEmail(rng, type, account.name), {
              opportunityId: opportunity.id,
              accountId: account.id,
              contactId: contact.id,
            });
          }
        }
      } else {
        // Terminal: gewonnen / verloren — Abschluss-/Dokumentationsereignis exakt am
        // closedAt, danach entsteht für diese Opportunity nichts Weiteres mehr.
        const closedAt = entry.enteredAt;
        if (isEmployeeValidAt(responsible, closedAt)) {
          const won = entry.stage === "gewonnen";
          pushCall(responsible.id, closedAt, "closing", {
            opportunityId: opportunity.id,
            accountId: account.id,
            contactId: contact.id,
            outcome: won ? pick(rng, CALL_OUTCOMES_CLOSING_WON) : pick(rng, CALL_OUTCOMES_CLOSING_LOST),
          });
          pushCrmActivity(
            responsible.id,
            closedAt,
            won ? "aufgabe-erledigt" : "notiz",
            { opportunityId: opportunity.id },
            won ? "Deal gewonnen, Auftrag dokumentiert." : `Opportunity verloren: ${opportunity.lostReason}.`,
          );
        }
      }

      // Vereinzelte interne Rückfrage zum Deal-Status (nicht bei jeder Stage).
      if (
        (entry.stage === "angebot" || entry.stage === "verhandlung") &&
        rng() < 0.15 &&
        isEmployeeValidAt(responsible, entry.enteredAt) &&
        responsible.managerId
      ) {
        const manager = employeeById.get(responsible.managerId);
        const date = boundedDateInRange(rng, entry.enteredAt, windowEnd, 45);
        if (manager && isEmployeeValidAt(manager, date)) {
          pushEmail(
            manager.id,
            date,
            "intern",
            buildInternalOpportunityEmail(rng, account.name, STAGE_LABEL[entry.stage] ?? entry.stage),
            { opportunityId: opportunity.id, participantEmployeeIds: [responsible.id] },
          );
        }
      }
    }
  }

  function createKundentermin(
    responsible: Employee,
    date: string,
    opportunity: Opportunity,
    account: CustomerAccount,
    contact: Contact,
    label: string,
    objection: string | undefined,
  ): void {
    const meeting: Meeting = {
      id: nextMeetingId(),
      timestamp: date,
      employeeId: responsible.id,
      direction: "ausgehend",
      durationMinutes: randomInt(rng, 25, 60),
      meetingType: "kundentermin",
      opportunityId: opportunity.id,
      accountId: account.id,
      contactId: contact.id,
      outcome: label,
    };
    meetings.push(meeting);
    meetingContext.set(meeting.id, {
      accountName: account.name,
      contactName: contact.name,
      stageLabel: label,
      objection,
    });
  }

  // --- Interne Team-Kadenz (Sales Daily / Pipeline Review / Coaching) --------

  function generateTeamCadence(): void {
    const salesManagers = employees.filter((e) => e.roleId === "role-sales-manager");
    const reportsByManager = new Map<string, Employee[]>();
    for (const e of employees) {
      if (e.managerId) {
        const list = reportsByManager.get(e.managerId) ?? [];
        list.push(e);
        reportsByManager.set(e.managerId, list);
      }
    }

    for (const manager of salesManagers) {
      const reports = (reportsByManager.get(manager.id) ?? []).filter(
        (e) => e.roleId === "role-account-executive" || e.roleId === "role-sales-development-rep",
      );

      let cursor = WORLD_TIMELINE_START;
      while (cursor <= WORLD_NOW) {
        const date = isBusinessDay(cursor) ? cursor : nextBusinessDay(cursor);
        if (date <= WORLD_NOW) {
          const participants = [manager, ...reports].filter((e) => isEmployeeValidAt(e, date));
          if (participants.length >= 2) {
            createInternalMeeting(manager, date, "internes-teammeeting", participants);
          }
        }
        cursor = addDays(cursor, 14);
      }

      cursor = WORLD_TIMELINE_START;
      while (cursor <= WORLD_NOW) {
        const date = isBusinessDay(cursor) ? cursor : nextBusinessDay(cursor);
        if (date <= WORLD_NOW) {
          const participants = [manager, ...reports].filter((e) => isEmployeeValidAt(e, date));
          if (participants.length >= 2) {
            const meeting = createInternalMeeting(manager, date, "pipeline-review", participants);
            annotatePipelineReview(meeting, participants, date);
          }
        }
        cursor = addDays(cursor, 30);
      }

      for (const rep of reports) {
        const startDate = rep.hiredAt > WORLD_TIMELINE_START ? rep.hiredAt : WORLD_TIMELINE_START;
        const endDate = rep.terminatedAt && rep.terminatedAt < WORLD_NOW ? rep.terminatedAt : WORLD_NOW;
        let coachingCursor = startDate;
        while (coachingCursor <= endDate) {
          const date = isBusinessDay(coachingCursor) ? coachingCursor : nextBusinessDay(coachingCursor);
          if (date <= endDate && isEmployeeValidAt(manager, date) && isEmployeeValidAt(rep, date)) {
            createInternalMeeting(manager, date, "coaching", [manager, rep]);
          }
          coachingCursor = addDays(coachingCursor, 90);
        }
      }
    }
  }

  function createInternalMeeting(
    lead: Employee,
    date: string,
    meetingType: Meeting["meetingType"],
    participants: Employee[],
  ): Meeting {
    const meeting: Meeting = {
      id: nextMeetingId(),
      timestamp: date,
      employeeId: lead.id,
      direction: "intern",
      durationMinutes: meetingType === "coaching" ? randomInt(rng, 20, 40) : randomInt(rng, 15, 45),
      meetingType,
      participantEmployeeIds: participants.map((p) => p.id),
    };
    meetings.push(meeting);
    return meeting;
  }

  function activeStageEntryAt(opportunityId: string, date: string): OpportunityStageHistory | undefined {
    const entries = stagesByOpportunity.get(opportunityId) ?? [];
    return entries.find((e) => e.enteredAt <= date && (e.exitedAt === undefined || date < e.exitedAt));
  }

  function annotatePipelineReview(meeting: Meeting, participants: Employee[], date: string): void {
    let busiest: { employeeId: string; count: number } | undefined;
    for (const participant of participants) {
      if (participant.roleId !== "role-account-executive") continue;
      let count = 0;
      for (const opportunity of opportunities) {
        const active = activeStageEntryAt(opportunity.id, date);
        if (active && active.responsibleEmployeeId === participant.id && active.stage !== "gewonnen" && active.stage !== "verloren") {
          count++;
        }
      }
      if (!busiest || count > busiest.count) {
        busiest = { employeeId: participant.id, count };
      }
    }
    if (busiest && busiest.count >= 6) {
      const employee = employeeById.get(busiest.employeeId);
      meetingContext.set(meeting.id, {
        note: `Bei ${employee?.name ?? busiest.employeeId} liegen aktuell auffällig viele aktive Opportunities (${busiest.count}).`,
      });
    }
  }

  generateTeamCadence();

  // --- MeetingTranscripts -----------------------------------------------

  const TRANSCRIPT_PROBABILITY: Record<Meeting["meetingType"], number> = {
    kundentermin: 0.55,
    coaching: 0.45,
    "pipeline-review": 0.4,
    "internes-teammeeting": 0.15,
  };

  for (const meeting of meetings) {
    if (rng() >= (TRANSCRIPT_PROBABILITY[meeting.meetingType] ?? 0.2)) {
      continue;
    }
    const context = meetingContext.get(meeting.id);
    const sentences: string[] = [];
    const keyTopics: string[] = [];

    if (meeting.meetingType === "kundentermin" && context?.accountName) {
      sentences.push(`Gespräch mit ${context.contactName ?? "Ansprechpartner"} bei ${context.accountName}, Fokus: ${context.stageLabel ?? "Status-Update"}.`);
      keyTopics.push(context.stageLabel ?? "Status-Update");
      if (context.objection) {
        sentences.push(`Kunde äußert Bedenken im Bereich ${context.objection}.`);
        keyTopics.push(`Einwand: ${context.objection}`);
      } else {
        sentences.push("Kein größerer Einwand im Gespräch, positive Grundstimmung.");
      }
      sentences.push(rng() < 0.5 ? "Nächster Schritt wurde vereinbart." : "Wir haben seit dem Gespräch keinen nächsten Termin gesetzt.");
    } else if (meeting.meetingType === "pipeline-review") {
      sentences.push("Team bespricht offene Opportunities und Prioritäten für den kommenden Zeitraum.");
      keyTopics.push("Pipeline-Status");
      if (context?.note) {
        sentences.push(context.note);
        keyTopics.push("Kapazität");
      }
    } else if (meeting.meetingType === "coaching") {
      sentences.push("Kurzes 1:1 zu laufenden Deals und nächsten Schritten.");
      keyTopics.push("Coaching");
    } else {
      sentences.push("Kurzer Team-Sync zu laufenden Themen der Woche.");
      keyTopics.push("Team-Sync");
    }

    meetingTranscripts.push({
      id: nextTranscriptId(),
      meetingId: meeting.id,
      transcriptText: sentences.join(" "),
      keyTopics,
    });
  }

  return { calls, emails, meetings, meetingTranscripts, crmActivities };
}

const BUNDLE = generateInteractions(
  WORLD_SEED + 5,
  LEADS,
  OPPORTUNITIES,
  OPPORTUNITY_STAGE_HISTORY,
  EMPLOYEES,
  CUSTOMER_ACCOUNTS,
  CONTACTS,
);

export const CALLS: Call[] = BUNDLE.calls;
export const EMAILS: Email[] = BUNDLE.emails;
export const MEETINGS: Meeting[] = BUNDLE.meetings;
export const MEETING_TRANSCRIPTS: MeetingTranscript[] = BUNDLE.meetingTranscripts;
export const CRM_ACTIVITIES: CrmActivity[] = BUNDLE.crmActivities;
