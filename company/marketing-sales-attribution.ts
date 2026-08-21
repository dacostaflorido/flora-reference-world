import { daysBetween } from "../engine/random";
import type { MetaLeadGenerated, MarketingCrmLeadIngested, MarketingLeadIdentityMatched } from "../events/marketing-meta-crm-source";
import { appointmentStatusAt, type SalesAppointment } from "../world/sales-appointments";
import type { Opportunity } from "../events/opportunities";

// Marketing-to-Sales Attribution Foundation V1 (Auftrag "Marketing Coverage
// Checkpoint + Marketing-to-Sales Attribution Foundation V1", Phase B) —
// kanonische, zeitlich korrekte Verbindung von einem bei Meta generierten
// Lead bis zu den daraus entstandenen Sales-Ereignissen. Baut AUSSCHLIESSLICH
// die Grundlage — noch KEINE Kostenquote, keine Division, keine Bewertung
// (harte Scope-Grenze, B13).
//
// --- B1: Architekturforensik — Ergebnis ---------------------------------------
//
// Jede einzelne Verbindung der geforderten Kette existiert bereits als
// DIREKTES, kanonisches ID-Feld im eingefrorenen Domänenmodell — echte
// Kausalität, vom jeweiligen Generator selbst im Moment der Entstehung
// gesetzt, niemals Korrelation:
//
// 1) Meta → interner CRM-Lead: `MarketingLeadIdentityMatched.leadId`
//    (bereits vorhandenes append-only Match-Event, siehe
//    events/marketing-meta-crm-source.ts).
// 2) Lead → Erstgespräch: `SalesAppointment.leadId` (direkt gesetzt bei
//    Erzeugung, world/sales-appointments.ts — für first-call IMMER gesetzt,
//    bleibt bei Rebooking über eine neue Appointment-id mit identischem
//    leadId erhalten).
// 3) Lead → Opportunity: `Opportunity.leadId` UND bidirektional
//    `Lead.convertedToOpportunityId` (events/generate-sales-pipeline.ts,
//    `buildOpportunity(opportunityId, lead, ...)` — ein Lead konvertiert zu
//    HÖCHSTENS einer Opportunity, eine Opportunity hat GENAU einen
//    Ursprungslead — eine strikte 1:0..1-Beziehung, niemals mehrdeutig, auch
//    wenn mehrere Leads/Opportunities zum selben Account existieren).
// 4) Opportunity → Strategiegespräch: `SalesAppointment.opportunityId`
//    (direkt gesetzt, nur für appointmentType "strategy-call", bleibt bei
//    Rebooking erhalten).
// 5) Opportunity → Won: `Opportunity.currentStage === "gewonnen"` +
//    `Opportunity.closedAt` (bereits bestehende, terminale, unveränderliche
//    Won-Wahrheit).
//
// Daraus folgt: B3 verlangt AUSDRÜCKLICH KEIN neues append-only Link-Event.
// Diese Datei ist eine reine, lesende PROJEKTION bereits vorhandener,
// direkter IDs — keine zweite Wahrheit, kein neuer Zufallsstrom, keine neue
// Generator-Verdrahtung in engine/generator.ts nötig (B12: Determinismus ist
// automatisch gegeben, da die Funktion eine reine Funktion ihrer bereits
// deterministischen Eingaben ist).
//
// Nicht verwendet und bewusst NICHT Teil der Eingabe (anders als im
// Auftragsbeispiel vorgeschlagen): `appointmentEvents`,
// `opportunityStageHistory`. Beide werden für diese Attribution nicht
// benötigt — `SalesAppointment` selbst (über `appointmentStatusAt`) und
// `Opportunity.currentStage`/`closedAt` sind bereits die vollständige,
// direkt as-of-rekonstruierbare Wahrheit; ihre Herleitung aus den
// Lifecycle-Events wäre eine unbenutzte, hier nicht erforderliche zweite
// Rekonstruktion (YAGNI, siehe Auftragstext: "Die konkrete Struktur muss zur
// bestehenden Architektur passen").
//
// --- B4: Attribution-Zeitpunkte -----------------------------------------------
//
// - Meta → CRM: `MarketingLeadIdentityMatched.matchedAt` (bereits kanonisch).
// - Lead → Erstgespräch: `SalesAppointment.bookedAt` (Buchung), `.heldAt`
//   (tatsächliches Stattfinden) — beide bereits Future-Knowledge-sicher
//   gezogen (world/sales-appointments.ts).
// - Lead → Opportunity: `Opportunity.createdAt` (= Konversionszeitpunkt,
//   NICHT closedAt, NICHT WORLD_NOW).
// - Opportunity → Strategiegespräch: analog Erstgespräch.
// - Opportunity → Won: `Opportunity.closedAt`, nur wenn
//   `currentStage === "gewonnen"`.
//
// --- B10: Attribution Status als belegte Milestone-Timeline ------------------
//
// Bewusst KEIN einzelnes, überschreibbares Statusfeld — ein Lead kann
// mehrere belegte Ereignisse gleichzeitig besitzen (B10, ausdrücklich
// gefordert). `milestones` ist eine append-only, chronologisch sortierte
// Liste bereits erreichter, zu `asOf` belegter Meilensteine, jeweils mit
// eigenem Zeitpunkt und eigener Beleg-ID. Der "aktuell weiteste" Status (die
// acht im Auftrag beispielhaft genannten Werte) ist daraus jederzeit
// verlustfrei ableitbar (siehe `latestMilestone` unten), wird aber nicht
// zusätzlich als eigenes, parallel gepflegtes Feld gespeichert.

export type MarketingAttributionMilestoneKey =
  | "meta-generated"
  | "crm-matched"
  | "first-call-booked"
  | "first-call-held"
  | "opportunity-created"
  | "strategy-call-booked"
  | "strategy-call-held"
  | "won-opportunity";

// Chronologische Rangfolge der acht Meilensteine — für `latestMilestone`
// unten, NICHT als erzwungene Pflichtkette (B6: "Won ohne Strategiegespräch"
// bleibt möglich; die Rangfolge beschreibt nur den funnel-üblichen
// Normalfall für die Ableitung "was ist der am weitesten belegte Meilenstein
// dieser Attribution", niemals eine Voraussetzung für das Erreichen eines
// späteren Meilensteins).
const MILESTONE_RANK: Record<MarketingAttributionMilestoneKey, number> = {
  "meta-generated": 0,
  "crm-matched": 1,
  "first-call-booked": 2,
  "first-call-held": 3,
  "opportunity-created": 4,
  "strategy-call-booked": 5,
  "strategy-call-held": 6,
  "won-opportunity": 7,
};

export interface MarketingAttributionMilestone {
  key: MarketingAttributionMilestoneKey;
  occurredAt: string;
  evidenceId: string;
}

// B5: Activity-Sicht (jede Buchung zählt, inklusive Rebookings) UND
// Lead-Ergebnis-Sicht (ein Lead bleibt trotz Rebooking ein Lead) bleiben
// BEIDE erhalten — `firstCallAppointmentIds`/`strategyCallAppointmentIds`
// enthalten ALLE zu `asOf` sichtbaren Buchungen (Activity-Nenner), während
// `milestones` nur den frühesten erreichten Zeitpunkt je Meilenstein trägt
// (Lead-Ergebnis-Nenner). Eine spätere Kostenquote kann sich bewusst für
// einen der beiden Nenner entscheiden — diese Foundation erzwingt keine
// Wahl (siehe Abschlussbericht, B5-Diskussion).
export interface MarketingLeadAttribution {
  metaLeadGeneratedEventId: string;
  externalLeadId: string;
  campaignId: string;
  generatedAt: string;

  // undefined, solange zu `asOf` kein Match sichtbar ist (pending) —
  // niemals als "endgültig unmatched" interpretiert (siehe
  // events/marketing-meta-crm-source.ts, resolveMarketingLeadMatchStatus).
  leadId?: string;

  firstCallAppointmentIds: string[];
  strategyCallAppointmentIds: string[];

  opportunityId?: string;

  milestones: MarketingAttributionMilestone[];
}

export interface MarketingAttributionSnapshot {
  asOf: string;
  attributions: MarketingLeadAttribution[];
}

// Rein informative Ableitung aus `milestones` — KEINE zweite, gespeicherte
// Wahrheit (B10). Gibt den Meilenstein mit dem höchsten MILESTONE_RANK
// zurück, der tatsächlich in `milestones` belegt ist.
export function latestMilestone(attribution: MarketingLeadAttribution): MarketingAttributionMilestoneKey | undefined {
  if (attribution.milestones.length === 0) {
    return undefined;
  }
  return attribution.milestones.reduce((latest, m) => (MILESTONE_RANK[m.key] > MILESTONE_RANK[latest.key] ? m : latest)).key;
}

function buildLeadAttribution(
  metaLead: MetaLeadGenerated,
  asOf: string,
  crmLeadIngestedById: Map<string, MarketingCrmLeadIngested>,
  matchByMetaLeadId: Map<string, MarketingLeadIdentityMatched>,
  firstCallAppointmentsByLeadId: Map<string, SalesAppointment[]>,
  opportunityByLeadId: Map<string, Opportunity>,
  strategyCallAppointmentsByOpportunityId: Map<string, SalesAppointment[]>,
): MarketingLeadAttribution {
  const milestones: MarketingAttributionMilestone[] = [
    { key: "meta-generated", occurredAt: metaLead.generatedAt, evidenceId: metaLead.id },
  ];

  const attribution: MarketingLeadAttribution = {
    metaLeadGeneratedEventId: metaLead.id,
    externalLeadId: metaLead.externalLeadId,
    campaignId: metaLead.campaignId,
    generatedAt: metaLead.generatedAt,
    firstCallAppointmentIds: [],
    strategyCallAppointmentIds: [],
    milestones,
  };

  const match = matchByMetaLeadId.get(metaLead.id);
  if (!match || match.matchedAt > asOf) {
    return attribution; // pending — kein Future-Knowledge-Leck
  }
  const crmRecord = crmLeadIngestedById.get(match.crmLeadIngestedEventId);
  if (!crmRecord) {
    return attribution; // referenziell nicht auflösbar — defensiv, sollte nie eintreten
  }
  attribution.leadId = crmRecord.leadId;
  milestones.push({ key: "crm-matched", occurredAt: match.matchedAt, evidenceId: match.id });

  // --- Lead → Erstgespräch (Activity + Lead-Ergebnis) --------------------------
  const firstCalls = firstCallAppointmentsByLeadId.get(crmRecord.leadId) ?? [];
  let earliestBooked: { occurredAt: string; evidenceId: string } | undefined;
  let earliestHeld: { occurredAt: string; evidenceId: string } | undefined;
  for (const appointment of firstCalls) {
    const stateAt = appointmentStatusAt(appointment, asOf);
    if (!stateAt) {
      continue; // zu asOf noch nicht gebucht
    }
    attribution.firstCallAppointmentIds.push(appointment.id);
    if (!earliestBooked || appointment.bookedAt < earliestBooked.occurredAt) {
      earliestBooked = { occurredAt: appointment.bookedAt, evidenceId: appointment.id };
    }
    if (stateAt.status === "held" && appointment.heldAt) {
      if (!earliestHeld || appointment.heldAt < earliestHeld.occurredAt) {
        earliestHeld = { occurredAt: appointment.heldAt, evidenceId: appointment.id };
      }
    }
  }
  if (earliestBooked) {
    milestones.push({ key: "first-call-booked", occurredAt: earliestBooked.occurredAt, evidenceId: earliestBooked.evidenceId });
  }
  if (earliestHeld) {
    milestones.push({ key: "first-call-held", occurredAt: earliestHeld.occurredAt, evidenceId: earliestHeld.evidenceId });
  }

  // --- Lead → Opportunity -------------------------------------------------------
  const opportunity = opportunityByLeadId.get(crmRecord.leadId);
  if (!opportunity || opportunity.createdAt > asOf) {
    return attribution;
  }
  attribution.opportunityId = opportunity.id;
  milestones.push({ key: "opportunity-created", occurredAt: opportunity.createdAt, evidenceId: opportunity.id });

  // --- Opportunity → Strategiegespräch ------------------------------------------
  const strategyCalls = strategyCallAppointmentsByOpportunityId.get(opportunity.id) ?? [];
  let earliestStrategyBooked: { occurredAt: string; evidenceId: string } | undefined;
  let earliestStrategyHeld: { occurredAt: string; evidenceId: string } | undefined;
  for (const appointment of strategyCalls) {
    const stateAt = appointmentStatusAt(appointment, asOf);
    if (!stateAt) {
      continue;
    }
    attribution.strategyCallAppointmentIds.push(appointment.id);
    if (!earliestStrategyBooked || appointment.bookedAt < earliestStrategyBooked.occurredAt) {
      earliestStrategyBooked = { occurredAt: appointment.bookedAt, evidenceId: appointment.id };
    }
    if (stateAt.status === "held" && appointment.heldAt) {
      if (!earliestStrategyHeld || appointment.heldAt < earliestStrategyHeld.occurredAt) {
        earliestStrategyHeld = { occurredAt: appointment.heldAt, evidenceId: appointment.id };
      }
    }
  }
  if (earliestStrategyBooked) {
    milestones.push({ key: "strategy-call-booked", occurredAt: earliestStrategyBooked.occurredAt, evidenceId: earliestStrategyBooked.evidenceId });
  }
  if (earliestStrategyHeld) {
    milestones.push({ key: "strategy-call-held", occurredAt: earliestStrategyHeld.occurredAt, evidenceId: earliestStrategyHeld.evidenceId });
  }

  // --- Opportunity → Won (B6: möglich ganz ohne Strategiegespräch) -------------
  if (opportunity.currentStage === "gewonnen" && opportunity.closedAt !== undefined && opportunity.closedAt <= asOf) {
    milestones.push({ key: "won-opportunity", occurredAt: opportunity.closedAt, evidenceId: opportunity.id });
  }

  return attribution;
}

export function generateMarketingToSalesAttribution(params: {
  asOf: string;
  metaLeadGeneratedEvents: readonly MetaLeadGenerated[];
  marketingLeadIdentityMatchedEvents: readonly MarketingLeadIdentityMatched[];
  marketingCrmLeadIngestedEvents: readonly MarketingCrmLeadIngested[];
  salesAppointments: readonly SalesAppointment[];
  opportunities: readonly Opportunity[];
}): MarketingAttributionSnapshot {
  const { asOf, metaLeadGeneratedEvents, marketingLeadIdentityMatchedEvents, marketingCrmLeadIngestedEvents, salesAppointments, opportunities } = params;

  const crmLeadIngestedById = new Map(marketingCrmLeadIngestedEvents.map((e) => [e.id, e]));
  const matchByMetaLeadId = new Map(marketingLeadIdentityMatchedEvents.map((m) => [m.metaLeadGeneratedEventId, m]));
  const opportunityByLeadId = new Map(opportunities.map((o) => [o.leadId, o]));

  const firstCallAppointmentsByLeadId = new Map<string, SalesAppointment[]>();
  const strategyCallAppointmentsByOpportunityId = new Map<string, SalesAppointment[]>();
  for (const appointment of salesAppointments) {
    if (appointment.appointmentType === "first-call" && appointment.leadId) {
      const list = firstCallAppointmentsByLeadId.get(appointment.leadId) ?? [];
      list.push(appointment);
      firstCallAppointmentsByLeadId.set(appointment.leadId, list);
    } else if (appointment.appointmentType === "strategy-call" && appointment.opportunityId) {
      const list = strategyCallAppointmentsByOpportunityId.get(appointment.opportunityId) ?? [];
      list.push(appointment);
      strategyCallAppointmentsByOpportunityId.set(appointment.opportunityId, list);
    }
  }

  const attributions = metaLeadGeneratedEvents
    .filter((metaLead) => metaLead.generatedAt <= asOf)
    .map((metaLead) =>
      buildLeadAttribution(
        metaLead,
        asOf,
        crmLeadIngestedById,
        matchByMetaLeadId,
        firstCallAppointmentsByLeadId,
        opportunityByLeadId,
        strategyCallAppointmentsByOpportunityId,
      ),
    );

  return { asOf, attributions };
}

// --- B9: Censoring/Maturity-Reporting (rein informativ, keine Bewertung) -----
//
// Berichtet Zeitdistanzen (Kalendertage) von `generatedAt` (dem natürlichen
// Kohorten-Ursprung) bis zu jedem Meilenstein — ausschließlich für bereits
// erreichte Fälle (N je Stufe explizit ausgewiesen). Ein fehlender späterer
// Meilenstein wird hier NICHT als endgültiges Scheitern gewertet — junge,
// noch nicht ausgereifte Kohorten haben schlicht noch keine Zeit gehabt
// (B9, ausdrücklich gefordert). Keine Reifegrenze, kein Schwellenwert, keine
// Bewertung — reine deskriptive Statistik.
export interface MarketingAttributionMaturityStats {
  n: number;
  minDays: number;
  medianDays: number;
  maxDays: number;
}

export interface MarketingAttributionMaturityReport {
  metaGeneratedToCrmMatched: MarketingAttributionMaturityStats | undefined;
  metaGeneratedToFirstCallBooked: MarketingAttributionMaturityStats | undefined;
  metaGeneratedToFirstCallHeld: MarketingAttributionMaturityStats | undefined;
  metaGeneratedToOpportunityCreated: MarketingAttributionMaturityStats | undefined;
  metaGeneratedToStrategyCallBooked: MarketingAttributionMaturityStats | undefined;
  metaGeneratedToStrategyCallHeld: MarketingAttributionMaturityStats | undefined;
  metaGeneratedToWon: MarketingAttributionMaturityStats | undefined;
}

function statsFor(durations: number[]): MarketingAttributionMaturityStats | undefined {
  if (durations.length === 0) {
    return undefined; // kein erfundener 0-Fall — "kein Fall erreicht" bleibt undefined
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianDays = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return { n: sorted.length, minDays: sorted[0]!, medianDays, maxDays: sorted[sorted.length - 1]! };
}

function durationsTo(attributions: readonly MarketingLeadAttribution[], key: MarketingAttributionMilestoneKey): number[] {
  const durations: number[] = [];
  for (const a of attributions) {
    const milestone = a.milestones.find((m) => m.key === key);
    if (milestone) {
      durations.push(daysBetween(a.generatedAt, milestone.occurredAt));
    }
  }
  return durations;
}

export function computeMarketingAttributionMaturity(attributions: readonly MarketingLeadAttribution[]): MarketingAttributionMaturityReport {
  return {
    metaGeneratedToCrmMatched: statsFor(durationsTo(attributions, "crm-matched")),
    metaGeneratedToFirstCallBooked: statsFor(durationsTo(attributions, "first-call-booked")),
    metaGeneratedToFirstCallHeld: statsFor(durationsTo(attributions, "first-call-held")),
    metaGeneratedToOpportunityCreated: statsFor(durationsTo(attributions, "opportunity-created")),
    metaGeneratedToStrategyCallBooked: statsFor(durationsTo(attributions, "strategy-call-booked")),
    metaGeneratedToStrategyCallHeld: statsFor(durationsTo(attributions, "strategy-call-held")),
    metaGeneratedToWon: statsFor(durationsTo(attributions, "won-opportunity")),
  };
}
