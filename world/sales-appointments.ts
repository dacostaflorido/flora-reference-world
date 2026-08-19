import { createRng, type Rng } from "../engine/seed";
import { addDays, randomInt } from "../engine/random";
import { WORLD_NOW } from "../timeline/world-clock";
import type { Lead } from "../events/leads";
import type { Opportunity } from "../events/opportunities";
import type { OpportunityStageHistory } from "../events/opportunity-stage-history";
import type { Employee } from "./employees";

// Sales Appointment Lifecycle Foundation (Auftrag "Operations Signal Checkpoint
// + Sales Appointment Lifecycle Foundation", Phase B) — kanonische Termin-
// grundlage für zwei Terminarten (Erstgespräch, Strategiegespräch), noch OHNE
// KPIs/Raten/Observations/Capability (siehe Auftrag, harte Scope-Grenze).
//
// Forensik-Ergebnis (vollständige Begründung im Abschlussbericht, hier nur die
// für den Code relevante Kurzfassung): `Call.callType==="erstgespraech"` und
// `Meeting.meetingType==="kundentermin"` (events/generate-interactions.ts)
// benennen thematisch verwandte Interaktionstypen, sind aber KEINE Terminwahrheit
// im hier geforderten Sinn — sie sind reine, bereits-geschehene Kommunikations-
// Protokolleinträge OHNE jede Buchungs-/Planungs-/Verschiebungs-/No-Show-/
// Storno-Semantik, generiert NACH und AUS der bereits vollständig feststehenden
// Lead-/Opportunity-Welt (eigener, später laufender Seed-Offset, reine
// Konsument-Rolle, keine Rückwirkung). Ein neuer, additiver Appointment Layer
// erzeugt deshalb KEINE zweite Wahrheit über denselben Fakt — er beantwortet
// eine strukturell andere, in Call/Meeting nicht abbildbare Frage (Zukunfts-
// Zustand "gebucht, aber noch nicht stattgefunden", vollständige Reschedule-
// Historie, No-Show, Storno). generate-interactions.ts bleibt vollständig
// unangetastet (Prinzip 2, Architecture Frozen) — keine Verknüpfung, keine
// gemeinsame Quelle, aus den oben genannten Gründen bewusst NICHT eine der drei
// im Auftrag vorgeschlagenen Source-of-Truth-Varianten, sondern eine vierte,
// eigenständige, aber additive Domäne (vollständige Begründung im
// Abschlussbericht, Punkt 12).
//
// Architektur: Option C aus dem Auftrag (Appointment Entity + append-only Event
// History) — exakt dasselbe, bereits etablierte und bewährte Muster wie
// DeliveryUnit/events/delivery-lifecycle.ts: SalesAppointment ist die generierte
// Wahrheit (inklusive vollständiger Reschedule-Historie als Feld), Events
// (sales-appointment-lifecycle.ts) sind eine reine, beweisbar widerspruchsfreie
// Projektion davon (Variante A) — nicht umgekehrt (Prinzip 6, World Before
// Events).
//
// Kausalrichtung (B12/B13): Lead-/Opportunity-/Employee-Welt → Appointment
// Lifecycle, niemals umgekehrt. Der Appointment-Ausgang (held/no-show/
// cancelled) ist rein deskriptive Begleiterzählung — er verändert niemals
// Lead.status, Opportunity.currentStage, Won/Lost oder irgendeine bestehende
// Sales-Klassifikation (harte Scope-Grenze). Eine Opportunity kann ohne je ein
// gehaltenes Erstgespräch entstehen (Lead-Konversion ist bereits unabhängig
// fixiert), ein Won Deal kann ohne je ein gehaltenes Strategiegespräch
// existieren — keine künstliche Pflichtkette (B12, ausdrücklich verboten).
//
// Zeitauflösung (B10): ausschließlich ISO-Kalendertag (YYYY-MM-DD), identisch
// zum Rest des Repositories — an keiner einzigen Stelle im gesamten Repository
// existiert heute eine Uhrzeit- oder Zeitzonen-Auflösung (geprüft: engine/
// random.ts, timeline/calendar.ts, alle Event-Zeitstempel). Eine echte
// Terminlogik bräuchte fachlich eine Uhrzeit — eine zusätzliche, nur für diesen
// neuen Layer eingeführte ISO-DateTime-Auflösung hätte jedoch entweder (a)
// weiterhin nur Kalendertag-Präzision vorgetäuscht (eine erfundene Uhrzeit ohne
// jede reale Grundlage) oder (b) einen inkonsistenten Mischbetrieb mit allen
// bestehenden, ausschließlich datumsbasierten Hilfsfunktionen
// (addDays/daysBetween/isBusinessDay) erzwungen. Da die einzigen heute
// beauftragten späteren Konsumenten (gestern/WTD/MTD-KPIs, siehe Executive
// Capability Audit) ohnehin ausschließlich Kalendertag-Granularität benötigen,
// bleibt dieser Layer bewusst bei ISO-Date — keine stillschweigend vorgetäuschte
// Präzision (B10, Punkt 1), sondern eine geprüfte und explizit dokumentierte
// Entscheidung gegen eine verfrühte, hier nicht beauftragte Zeit-Migration
// (B10, Punkt 3). Eine Company-Timezone existiert im Repository nicht und wird
// hiermit als fehlende, für echte Uhrzeit-Terminlogik notwendige künftige
// Produktvoraussetzung dokumentiert (B10, Punkt 4).

export type SalesAppointmentType = "first-call" | "strategy-call";
export type SalesAppointmentStatus = "scheduled" | "held" | "no-show" | "cancelled";
export type SalesAppointmentNoShowParty = "prospect" | "employee" | "unknown";

export interface SalesAppointmentReschedule {
  rescheduledAt: string;
  previousScheduledFor: string;
  newScheduledFor: string;
  reasonCode?: string;
}

// id ist der stabile fachliche Anker (Prinzip 18, Backward Explainability) —
// niemals aus Array-Position abgeleitet (id wird direkt aus der bereits
// eindeutigen Lead-/Opportunity-ID abgeleitet, siehe generateSalesAppointments
// unten — exakt
// dasselbe Zählmuster wie nextId() in world/delivery-units.ts). `rescheduled`
// ist bewusst KEIN eigener Statuswert (Auftrag B8): eine Verschiebung ist ein
// Ereignis, nach dem der Termin weiterhin "scheduled" bleibt — die vollständige
// Verschiebungs-Historie steht in `reschedules`.
export interface SalesAppointment {
  id: string;
  appointmentType: SalesAppointmentType;
  leadId?: string;
  contactId: string;
  accountId: string;
  opportunityId?: string;
  // Rebooking (B9): ein neuer Termin nach No-Show/Storno erhält eine NEUE id,
  // referenziert aber denselben bookingSeriesId wie sein Vorgänger sowie
  // explizit dessen id — der terminale Vorgänger-Appointment wird NIE
  // rückwirkend wieder geöffnet (kein Widerspruch zu Prinzip 5, Temporal
  // Consistency: ein einmal eingetretener No-Show/Storno bleibt für immer wahr).
  bookingSeriesId: string;
  rebookedFromAppointmentId?: string;
  bookedByEmployeeId?: string;
  assignedEmployeeId: string;
  bookedAt: string;
  initialScheduledFor: string;
  // Chronologisch, bereits auf WORLD_NOW zensiert (Future-Knowledge-Schutz,
  // siehe generateSalesAppointments) — eine Verschiebung, die erst nach
  // WORLD_NOW "bekannt" würde, erscheint hier nicht.
  reschedules: SalesAppointmentReschedule[];
  currentScheduledFor: string;
  currentStatus: SalesAppointmentStatus;
  heldAt?: string;
  conductedByEmployeeId?: string;
  noShowRecordedAt?: string;
  noShowParty?: SalesAppointmentNoShowParty;
  cancelledAt?: string;
  cancelledReasonCode?: string;
  cancelledByEmployeeId?: string;
}

// Kalibrierung (Auftrag B15) — synthetische Reference-World-Kalibrierung, KEINE
// Branchenbenchmark-Behauptung. Kandidaten empirisch geprüft (siehe
// Abschlussbericht, Kalibrierungs-Abschnitt): je zwei plausible Kandidaten pro
// Quote gemessen, gewählte Werte liefern über mehrere Seeds ausreichend Fälle
// für jede der sechs Lifecycle-Kategorien (Held/No-Show/Cancelled/Reschedule/
// Rebooking/zukünftig geplant), ohne unrealistische Perfektionsrate (100 %
// Show-Rate) oder künstlich schlechte Welt (>50 % No-Show).
const FIRST_CALL_COVERAGE = 0.62; // Anteil (nicht "neu") Leads mit gebuchtem Erstgespräch
const FIRST_CALL_RESCHEDULE_PROB = 0.22;
const FIRST_CALL_SECOND_RESCHEDULE_PROB = 0.08; // bedingt: nur wenn bereits einmal verschoben
const FIRST_CALL_OUTCOME_THRESHOLDS = { held: 0.68, noShow: 0.15 }; // Rest = cancelled
const FIRST_CALL_REBOOKING_PROB = 0.45; // nach No-Show/Storno

const STRATEGY_CALL_COVERAGE = 0.58; // Anteil Opportunities mit "angebot"-Eintrag, die ein Strategiegespräch erhalten
const STRATEGY_CALL_RESCHEDULE_PROB = 0.18;
const STRATEGY_CALL_SECOND_RESCHEDULE_PROB = 0.06;
const STRATEGY_CALL_OUTCOME_THRESHOLDS = { held: 0.74, noShow: 0.1 }; // Rest = cancelled
const STRATEGY_CALL_REBOOKING_PROB = 0.5;

const BOOKING_LEAD_TIME_MIN_DAYS = 2;
const BOOKING_LEAD_TIME_MAX_DAYS = 12;
const RESCHEDULE_PUSH_MIN_DAYS = 2;
const RESCHEDULE_PUSH_MAX_DAYS = 10;
const OUTCOME_OFFSET_DAYS = 0; // Held/No-Show/Storno fallen fachlich auf den (zuletzt) geplanten Termin selbst
const REBOOKING_DELAY_MIN_DAYS = 1;
const REBOOKING_DELAY_MAX_DAYS = 14;

// Entity-stabiler Seed-Offset (dasselbe, bereits etablierte Präzedenzmuster wie
// DELIVERY_LIFECYCLE_SEED_OFFSET/MARKETING_DEMAND_SEED_OFFSET): ein fester
// additiver Offset plus eine aus der Lead-/Opportunity-id abgeleitete,
// garantiert stabile Zahl — NICHT die Position in irgendeinem Array. Getrennte
// Substreams je Belangsphase (Booking/Scheduling/Reschedule/Outcome/Rebooking/
// Assignment) innerhalb desselben Appointments, damit eine Änderung einer
// Phase (z. B. mehr Reschedules) keine andere Phase (z. B. den Outcome-Wurf)
// verschiebt.
const FIRST_CALL_SEED_OFFSET = 30_000_000;
const STRATEGY_CALL_SEED_OFFSET = 40_000_000;
const REBOOKING_SEED_OFFSET = 50_000_000;

function leadNumericKey(leadId: string): number {
  const match = /^lead-(\d+)$/.exec(leadId);
  if (!match) {
    throw new Error(`generateSalesAppointments: unerwartetes Lead-ID-Format "${leadId}"`);
  }
  return parseInt(match[1]!, 10);
}

function opportunityNumericKey(opportunityId: string): number {
  const match = /^opp-(\d+)$/.exec(opportunityId);
  if (!match) {
    throw new Error(`generateSalesAppointments: unerwartetes Opportunity-ID-Format "${opportunityId}"`);
  }
  return parseInt(match[1]!, 10);
}

function isEmployeeActiveAt(employee: Employee | undefined, isoDate: string): boolean {
  if (!employee) return false;
  return employee.hiredAt <= isoDate && (employee.terminatedAt === undefined || isoDate <= employee.terminatedAt);
}

// Rollenzuordnung (B5/B11): folgt der bereits bestehenden, freigegebenen
// Ownership-Semantik — SDRs (role-sales-development-rep) besitzen Leads und
// führen den Erstkontakt (Lead.ownerEmployeeId, exakt wie bereits in
// generate-interactions.ts für "erstgespraech"-Calls verwendet). AEs
// (role-account-executive) verantworten Opportunities
// (Opportunity.responsibleEmployeeId, exakt dieselbe, bereits an anderer
// Stelle geprüfte Ownership-Resolution-Regel: "responsibleEmployeeId stammt
// ausschließlich aus ae/owner-Rollen, nie von SDRs"). Keine neue, erfundene
// Rolle nur für dieses Feature (B11, ausdrücklich verboten).
function firstCallAssignee(lead: Lead): string {
  return lead.ownerEmployeeId;
}
function strategyCallAssignee(opportunity: Opportunity): string {
  return opportunity.responsibleEmployeeId;
}

interface OutcomeDraw {
  outcome: "held" | "no-show" | "cancelled" | undefined;
  heldAt?: string;
  noShowRecordedAt?: string;
  noShowParty?: SalesAppointmentNoShowParty;
  cancelledAt?: string;
  cancelledReasonCode?: string;
}

function drawOutcome(
  rng: Rng,
  scheduledFor: string,
  thresholds: { held: number; noShow: number },
): OutcomeDraw {
  const roll = rng();
  const eventDate = addDays(scheduledFor, OUTCOME_OFFSET_DAYS);
  if (roll < thresholds.held) {
    return { outcome: "held", heldAt: eventDate };
  }
  if (roll < thresholds.held + thresholds.noShow) {
    // Keine erfundene Schuldzuweisung (B7, "No-Show-Partei nur, wenn fachlich
    // eindeutig"): das Domänenmodell besitzt keine Kalender-/Bestätigungsdaten,
    // die zwischen "Interessent erschien nicht" und "Mitarbeiter verpasste den
    // Termin" unterscheiden könnten — bewusst durchgehend "unknown".
    return { outcome: "no-show", noShowRecordedAt: eventDate, noShowParty: "unknown" };
  }
  return { outcome: "cancelled", cancelledAt: eventDate, cancelledReasonCode: "nicht-spezifiziert" };
}

interface ReschedulePlan {
  reschedules: SalesAppointmentReschedule[];
  finalScheduledFor: string;
}

function drawReschedules(
  rng: Rng,
  bookedAt: string,
  initialScheduledFor: string,
  firstProb: number,
  secondProb: number,
): ReschedulePlan {
  const reschedules: SalesAppointmentReschedule[] = [];
  let currentScheduledFor = initialScheduledFor;

  if (rng() < firstProb) {
    // Eine Verschiebung wird deterministisch VOR dem bisherigen geplanten
    // Termin angekündigt (fachlich zwingend: man verschiebt einen Termin,
    // bevor er stattfindet, nie danach) — mindestens 1 Tag nach bookedAt,
    // spätestens am Vortag des bisherigen Termins.
    const earliestAnnounce = addDays(bookedAt, 1);
    const latestAnnounce = addDays(currentScheduledFor, -1);
    const rescheduledAt = latestAnnounce > earliestAnnounce ? addDays(earliestAnnounce, randomInt(rng, 0, Math.max(0, (new Date(latestAnnounce).getTime() - new Date(earliestAnnounce).getTime()) / 86400000))) : earliestAnnounce;
    const newScheduledFor = addDays(currentScheduledFor, randomInt(rng, RESCHEDULE_PUSH_MIN_DAYS, RESCHEDULE_PUSH_MAX_DAYS));
    reschedules.push({ rescheduledAt, previousScheduledFor: currentScheduledFor, newScheduledFor });
    currentScheduledFor = newScheduledFor;

    if (rng() < secondProb) {
      const earliestAnnounce2 = addDays(reschedules[0]!.rescheduledAt, 1);
      const rescheduledAt2 = earliestAnnounce2 < currentScheduledFor ? earliestAnnounce2 : addDays(currentScheduledFor, -1);
      const newScheduledFor2 = addDays(currentScheduledFor, randomInt(rng, RESCHEDULE_PUSH_MIN_DAYS, RESCHEDULE_PUSH_MAX_DAYS));
      reschedules.push({ rescheduledAt: rescheduledAt2, previousScheduledFor: currentScheduledFor, newScheduledFor: newScheduledFor2 });
      currentScheduledFor = newScheduledFor2;
    }
  }

  return { reschedules, finalScheduledFor: currentScheduledFor };
}

// Zensiert eine vollständig deterministisch gezogene "beabsichtigte" Lebenslauf-
// Historie auf WORLD_NOW (Future-Knowledge-Schutz, B16 — dasselbe Muster wie
// hasStarted/hasCompleted in world/delivery-units.ts, hier auf eine Sequenz von
// Zwischenereignissen statt nur zwei Zeitpunkten verallgemeinert): jedes
// Reschedule- und das Outcome-Ereignis, dessen Zeitpunkt NACH WORLD_NOW liegt,
// wird verworfen — der zensierte "aktuelle" Zustand entspricht dann exakt dem
// letzten noch sichtbaren Ereignis. Kein zukünftiges Ereignis wird als bereits
// eingetreten ausgegeben.
function censorToWorldNow(
  bookedAt: string,
  initialScheduledFor: string,
  reschedulePlan: ReschedulePlan,
  outcomeDraw: OutcomeDraw,
): {
  reschedules: SalesAppointmentReschedule[];
  currentScheduledFor: string;
  currentStatus: SalesAppointmentStatus;
  heldAt?: string;
  noShowRecordedAt?: string;
  noShowParty?: SalesAppointmentNoShowParty;
  cancelledAt?: string;
  cancelledReasonCode?: string;
} {
  const visibleReschedules = reschedulePlan.reschedules.filter((r) => r.rescheduledAt <= WORLD_NOW);
  const currentScheduledFor =
    visibleReschedules.length > 0 ? visibleReschedules[visibleReschedules.length - 1]!.newScheduledFor : initialScheduledFor;

  // Das Outcome-Ereignis ist nur sichtbar, wenn (a) es überhaupt gezogen wurde,
  // (b) sein Zeitpunkt <= WORLD_NOW liegt, UND (c) es an das TATSÄCHLICH
  // sichtbare currentScheduledFor anschließt (bei zensierten Reschedules würde
  // ein an den ursprünglichen, nicht mehr sichtbaren Termin gebundenes Outcome
  // sonst eine widersprüchliche Historie erzeugen — in diesem Fall bleibt der
  // Termin ehrlich "scheduled" statt ein nicht mehr passendes Outcome zu zeigen).
  const allReschedulesVisible = visibleReschedules.length === reschedulePlan.reschedules.length;
  const outcomeVisible =
    allReschedulesVisible &&
    outcomeDraw.outcome !== undefined &&
    (outcomeDraw.heldAt ?? outcomeDraw.noShowRecordedAt ?? outcomeDraw.cancelledAt)! <= WORLD_NOW;

  if (!outcomeVisible) {
    return { reschedules: visibleReschedules, currentScheduledFor, currentStatus: "scheduled" };
  }

  return {
    reschedules: visibleReschedules,
    currentScheduledFor,
    currentStatus: outcomeDraw.outcome!,
    heldAt: outcomeDraw.heldAt,
    noShowRecordedAt: outcomeDraw.noShowRecordedAt,
    noShowParty: outcomeDraw.noShowParty,
    cancelledAt: outcomeDraw.cancelledAt,
    cancelledReasonCode: outcomeDraw.cancelledReasonCode,
  };
}

interface GenerateAppointmentParams {
  id: string;
  appointmentType: SalesAppointmentType;
  leadId?: string;
  contactId: string;
  accountId: string;
  opportunityId?: string;
  bookingSeriesId: string;
  rebookedFromAppointmentId?: string;
  assignedEmployeeId: string;
  bookedByEmployeeId?: string;
  bookedAt: string;
  lifecycleRng: Rng;
  rescheduleFirstProb: number;
  rescheduleSecondProb: number;
  outcomeThresholds: { held: number; noShow: number };
}

function buildAppointment(params: GenerateAppointmentParams): SalesAppointment {
  const initialScheduledFor = addDays(params.bookedAt, randomInt(params.lifecycleRng, BOOKING_LEAD_TIME_MIN_DAYS, BOOKING_LEAD_TIME_MAX_DAYS));
  const reschedulePlan = drawReschedules(
    params.lifecycleRng,
    params.bookedAt,
    initialScheduledFor,
    params.rescheduleFirstProb,
    params.rescheduleSecondProb,
  );
  const outcomeDraw = drawOutcome(params.lifecycleRng, reschedulePlan.finalScheduledFor, params.outcomeThresholds);
  const censored = censorToWorldNow(params.bookedAt, initialScheduledFor, reschedulePlan, outcomeDraw);

  return {
    id: params.id,
    appointmentType: params.appointmentType,
    leadId: params.leadId,
    contactId: params.contactId,
    accountId: params.accountId,
    opportunityId: params.opportunityId,
    bookingSeriesId: params.bookingSeriesId,
    rebookedFromAppointmentId: params.rebookedFromAppointmentId,
    bookedByEmployeeId: params.bookedByEmployeeId,
    assignedEmployeeId: params.assignedEmployeeId,
    bookedAt: params.bookedAt,
    initialScheduledFor,
    reschedules: censored.reschedules,
    currentScheduledFor: censored.currentScheduledFor,
    currentStatus: censored.currentStatus,
    heldAt: censored.heldAt,
    conductedByEmployeeId: censored.heldAt ? params.assignedEmployeeId : undefined,
    noShowRecordedAt: censored.noShowRecordedAt,
    noShowParty: censored.noShowParty,
    cancelledAt: censored.cancelledAt,
    cancelledReasonCode: censored.cancelledReasonCode,
    cancelledByEmployeeId: censored.cancelledAt ? params.assignedEmployeeId : undefined,
  };
}

export function generateSalesAppointments(
  seed: number,
  leads: readonly Lead[],
  opportunities: readonly Opportunity[],
  stageHistory: readonly OpportunityStageHistory[],
  employees: readonly Employee[],
): SalesAppointment[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const appointments: SalesAppointment[] = [];

  // --- Erstgespräch: ein Kandidat je Lead mit status !== "neu" ------------
  // "neu" (noch nicht kontaktiert) besitzt laut bestehendem Modell noch keinen
  // belastbaren Erstkontakt-Anker (siehe generate-interactions.ts, derselbe
  // Ausschluss dort) — kein künstlich erfundener Termin ohne fachliche Basis.
  for (const lead of leads) {
    if (lead.status === "neu") continue;
    const owner = employeeById.get(lead.ownerEmployeeId);
    if (owner === undefined) continue;

    const coverageRng = createRng(seed + FIRST_CALL_SEED_OFFSET + leadNumericKey(lead.id));
    if (coverageRng() >= FIRST_CALL_COVERAGE) continue;

    const bookedAt = lead.createdAt;
    if (!isEmployeeActiveAt(owner, bookedAt)) continue;

    const lifecycleRng = createRng(seed + FIRST_CALL_SEED_OFFSET + leadNumericKey(lead.id) + 1);
    const assignedEmployeeId = firstCallAssignee(lead);
    // Entity-stabile id (B6, ausdrücklich verboten: Ableitung aus Array-
    // Position) — direkt aus der bereits eindeutigen Lead-ID abgeleitet, exakt
    // dasselbe Präzedenzmuster wie der entity-stabile RNG-Offset oben.
    const appointmentId = `sappt-fc-${String(leadNumericKey(lead.id)).padStart(5, "0")}`;
    const appointment = buildAppointment({
      id: appointmentId,
      appointmentType: "first-call",
      leadId: lead.id,
      contactId: lead.contactId,
      accountId: lead.accountId,
      bookingSeriesId: appointmentId,
      assignedEmployeeId,
      bookedByEmployeeId: assignedEmployeeId,
      bookedAt,
      lifecycleRng,
      rescheduleFirstProb: FIRST_CALL_RESCHEDULE_PROB,
      rescheduleSecondProb: FIRST_CALL_SECOND_RESCHEDULE_PROB,
      outcomeThresholds: FIRST_CALL_OUTCOME_THRESHOLDS,
    });
    appointments.push(appointment);

    // Rebooking (B9): nur, wenn der ursprüngliche Termin bereits sichtbar
    // terminal (no-show/cancelled) ist — ein zu WORLD_NOW noch "scheduled"
    // oder "held" Termin erzeugt kein Rebooking.
    if (appointment.currentStatus === "no-show" || appointment.currentStatus === "cancelled") {
      const rebookingRng = createRng(seed + REBOOKING_SEED_OFFSET + leadNumericKey(lead.id));
      const terminalAt = appointment.noShowRecordedAt ?? appointment.cancelledAt!;
      if (rebookingRng() < FIRST_CALL_REBOOKING_PROB) {
        const rebookedAt = addDays(terminalAt, randomInt(rebookingRng, REBOOKING_DELAY_MIN_DAYS, REBOOKING_DELAY_MAX_DAYS));
        if (rebookedAt <= WORLD_NOW && isEmployeeActiveAt(owner, rebookedAt)) {
          const rebookLifecycleRng = createRng(seed + FIRST_CALL_SEED_OFFSET + leadNumericKey(lead.id) + 2);
          const rebookedId = `${appointment.id}-rebook-1`;
          appointments.push(
            buildAppointment({
              id: rebookedId,
              appointmentType: "first-call",
              leadId: lead.id,
              contactId: lead.contactId,
              accountId: lead.accountId,
              bookingSeriesId: appointment.bookingSeriesId,
              rebookedFromAppointmentId: appointment.id,
              assignedEmployeeId,
              bookedByEmployeeId: assignedEmployeeId,
              bookedAt: rebookedAt,
              lifecycleRng: rebookLifecycleRng,
              rescheduleFirstProb: FIRST_CALL_RESCHEDULE_PROB,
              rescheduleSecondProb: FIRST_CALL_SECOND_RESCHEDULE_PROB,
              outcomeThresholds: FIRST_CALL_OUTCOME_THRESHOLDS,
            }),
          );
        }
      }
    }
  }

  // --- Strategiegespräch: ein Kandidat je Opportunity, die "angebot" erreicht --
  // Nachgelagertes, vertiefendes Gespräch "in dem eine Opportunity bzw. ein
  // konkretes Angebot behandelt wird" (Auftrag B5) — fachlich erst sinnvoll,
  // sobald die Opportunity tatsächlich die Stage "angebot" erreicht hat. Exakt
  // dieselbe Stage-Voraussetzung wie das bereits bestehende "kundentermin"-
  // Meeting in generate-interactions.ts (dort: `entry.stage === "angebot"`) —
  // keine neue, hier erfundene Pipeline-Regel.
  const angebotEntryByOpportunity = new Map<string, OpportunityStageHistory>();
  for (const entry of stageHistory) {
    if (entry.stage === "angebot" && !angebotEntryByOpportunity.has(entry.opportunityId)) {
      angebotEntryByOpportunity.set(entry.opportunityId, entry);
    }
  }

  for (const opportunity of opportunities) {
    const angebotEntry = angebotEntryByOpportunity.get(opportunity.id);
    if (angebotEntry === undefined) continue;
    const responsible = employeeById.get(opportunity.responsibleEmployeeId);
    if (responsible === undefined) continue;

    const coverageRng = createRng(seed + STRATEGY_CALL_SEED_OFFSET + opportunityNumericKey(opportunity.id));
    if (coverageRng() >= STRATEGY_CALL_COVERAGE) continue;

    const bookedAt = angebotEntry.enteredAt;
    // Der zum Zeitpunkt des Stage-Eintritts fachlich Verantwortliche
    // (angebotEntry.responsibleEmployeeId) kann vom heutigen
    // opportunity.responsibleEmployeeId abweichen (Besitzerwechsel im Verlauf,
    // siehe OpportunityStageHistory-Dokumentation) — für die Buchung selbst
    // zählt der zum Buchungszeitpunkt tatsächlich verantwortliche Mitarbeiter.
    const bookingResponsible = employeeById.get(angebotEntry.responsibleEmployeeId) ?? responsible;
    if (!isEmployeeActiveAt(bookingResponsible, bookedAt)) continue;

    const lifecycleRng = createRng(seed + STRATEGY_CALL_SEED_OFFSET + opportunityNumericKey(opportunity.id) + 1);
    // Entity-stabile id, direkt aus der bereits eindeutigen Opportunity-ID
    // abgeleitet (siehe B6-Begründung oben bei Erstgespräch).
    const appointmentId = `sappt-sc-${String(opportunityNumericKey(opportunity.id)).padStart(5, "0")}`;
    const appointment = buildAppointment({
      id: appointmentId,
      appointmentType: "strategy-call",
      leadId: opportunity.leadId,
      contactId: leads.find((l) => l.id === opportunity.leadId)?.contactId ?? "",
      accountId: opportunity.accountId,
      opportunityId: opportunity.id,
      bookingSeriesId: appointmentId,
      assignedEmployeeId: bookingResponsible.id,
      bookedByEmployeeId: bookingResponsible.id,
      bookedAt,
      lifecycleRng,
      rescheduleFirstProb: STRATEGY_CALL_RESCHEDULE_PROB,
      rescheduleSecondProb: STRATEGY_CALL_SECOND_RESCHEDULE_PROB,
      outcomeThresholds: STRATEGY_CALL_OUTCOME_THRESHOLDS,
    });
    if (appointment.contactId === "") continue; // referenzielle Integrität: kein Contact auffindbar, keine erfundene ID
    appointments.push(appointment);

    if (appointment.currentStatus === "no-show" || appointment.currentStatus === "cancelled") {
      const rebookingRng = createRng(seed + REBOOKING_SEED_OFFSET + opportunityNumericKey(opportunity.id));
      const terminalAt = appointment.noShowRecordedAt ?? appointment.cancelledAt!;
      if (rebookingRng() < STRATEGY_CALL_REBOOKING_PROB) {
        const rebookedAt = addDays(terminalAt, randomInt(rebookingRng, REBOOKING_DELAY_MIN_DAYS, REBOOKING_DELAY_MAX_DAYS));
        if (rebookedAt <= WORLD_NOW && isEmployeeActiveAt(bookingResponsible, rebookedAt)) {
          const rebookLifecycleRng = createRng(seed + STRATEGY_CALL_SEED_OFFSET + opportunityNumericKey(opportunity.id) + 2);
          const rebookedId = `${appointment.id}-rebook-1`;
          appointments.push(
            buildAppointment({
              id: rebookedId,
              appointmentType: "strategy-call",
              leadId: appointment.leadId,
              contactId: appointment.contactId,
              accountId: appointment.accountId,
              opportunityId: opportunity.id,
              bookingSeriesId: appointment.bookingSeriesId,
              rebookedFromAppointmentId: appointment.id,
              assignedEmployeeId: bookingResponsible.id,
              bookedByEmployeeId: bookingResponsible.id,
              bookedAt: rebookedAt,
              lifecycleRng: rebookLifecycleRng,
              rescheduleFirstProb: STRATEGY_CALL_RESCHEDULE_PROB,
              rescheduleSecondProb: STRATEGY_CALL_SECOND_RESCHEDULE_PROB,
              outcomeThresholds: STRATEGY_CALL_OUTCOME_THRESHOLDS,
            }),
          );
        }
      }
    }
  }

  return appointments;
}

// As-of-Ableitung (B17): rekonstruiert den Zustand eines Appointments zu einem
// beliebigen historischen asOf ausschließlich aus bereits vorhandenen,
// eventbasierten Zeitstempeln — keine zweite Berechnung, kein neuer Zufall.
// Gibt undefined zurück, wenn das Appointment zu asOf noch nicht gebucht war.
export interface SalesAppointmentStateAt {
  scheduledFor: string;
  status: SalesAppointmentStatus;
  visibleReschedules: SalesAppointmentReschedule[];
}

export function appointmentStatusAt(appointment: SalesAppointment, asOf: string): SalesAppointmentStateAt | undefined {
  if (appointment.bookedAt > asOf) {
    return undefined;
  }
  const visibleReschedules = appointment.reschedules.filter((r) => r.rescheduledAt <= asOf);
  const scheduledFor =
    visibleReschedules.length > 0 ? visibleReschedules[visibleReschedules.length - 1]!.newScheduledFor : appointment.initialScheduledFor;

  const allReschedulesVisible = visibleReschedules.length === appointment.reschedules.length;
  const terminalAt = appointment.heldAt ?? appointment.noShowRecordedAt ?? appointment.cancelledAt;
  const terminalVisible = allReschedulesVisible && terminalAt !== undefined && terminalAt <= asOf;

  return {
    scheduledFor,
    status: terminalVisible ? appointment.currentStatus : "scheduled",
    visibleReschedules,
  };
}
