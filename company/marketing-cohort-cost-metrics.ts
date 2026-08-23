import { startOfWeek, startOfMonth } from "../timeline/calendar";
import { addDays, daysBetween } from "../engine/random";
import type { MetaAdSpendRecord } from "../events/marketing-meta-ad-spend";
import type { MetaLeadGenerated, MarketingCrmLeadIngested, MarketingLeadIdentityMatched } from "../events/marketing-meta-crm-source";
import type { SalesAppointment } from "../world/sales-appointments";
import type { Opportunity } from "../events/opportunities";
import {
  resolveMarketingSourceCoverageStatus,
  combinePeriodDataStatus,
  type MarketingSourceCoverage,
  type MarketingSourceStream,
  type PeriodDataStatus,
} from "../events/marketing-source-coverage";
import { generateMarketingToSalesAttribution, type MarketingLeadAttribution } from "./marketing-sales-attribution";

// Marketing Cohort Cost Metrics V1, korrigiert durch KORREKTURAUFTRAG "Honest
// Cohort Spend + Maturity + Downstream Coverage". Rein deskriptiv, keine
// Bewertung, kein CAC, kein Neukundenbegriff (harte Scope-Grenze, B10/B13).
//
// --- K1/K2: Gesamter Perioden-Spend + Campaign-Level ---------------------------
//
// URSPRÜNGLICHER FEHLER (korrigiert): der Zähler enthielt bislang nur Spend
// von Campaigns, die in der Kohorte tatsächlich mindestens einen Lead
// generiert hatten — eine Campaign mit Spend, aber 0 Leads, verschwand
// komplett aus dem Gesamtspend. Das machte die Kosten künstlich besser.
// Jetzt: der Gesamtspend-Zähler umfasst AUSNAHMSLOS jeden `MetaAdSpendRecord`
// mit `spendDate` innerhalb der Kohortengrenzen, unabhängig davon, ob die
// jeweilige Campaign in dieser Periode Leads erzeugt hat. Zusätzlich liefert
// `campaigns` eine vollständige Campaign-Level-Aufschlüsselung (Spend, Leads,
// alle sieben Nenner/Kosten je Campaign) — eine Campaign mit Spend und 0
// Leads bleibt darin sichtbar, mit `denominatorCount: 0` und
// `availability: "no-denominator-events"` für jede Kennzahl. Der
// Gesamt-Level-Wert ist stets Σ Spend / Σ Nenner — NIEMALS der Durchschnitt
// der einzelnen Campaign-Kostenwerte (K1, K2).
//
// --- K3/K4: Maturity — nur beweisbar begrenzte Stufen werden "mature" ---------
//
// URSPRÜNGLICHER FEHLER (korrigiert): "praktische" Horizonte (reiner
// Vorwärtsverlauf ohne Regression/Stillstand) wurden für Strategy Call und
// Won als Reifebeweis behandelt — das ist keine absolute Obergrenze. Direkte
// Prüfung des Generator-Codes (events/generate-sales-pipeline.ts,
// Stage-History-Erzeugung für offene Opportunities):
//
//   while (true) {
//     ... advance/regress/stay ...
//     if (candidateCursor >= WORLD_NOW) break;
//   }
//
// Dieser Random Walk besitzt KEINEN festen Schrittzähler — er läuft, bis die
// Zeitachse selbst (WORLD_NOW) erreicht ist, nicht bis eine feste
// Stufenanzahl verbraucht ist. Ob eine noch offene Opportunity JEMALS
// "angebot" erreicht (Voraussetzung für Strategy Call) oder gewinnt, ist
// daher zu keinem Zeitpunkt mit einer festen Tageszahl beweisbar — jede
// bereits abgeschlossene (gewonnen/verloren) Opportunity durchlief zwar
// einen strukturell begrenzten Pfad (`stagesToTraverse`,
// `fitDurationsToBudget`), aber AUS SICHT DER KOHORTE wissen wir vorab
// nicht, welche noch offenen Opportunities diesen begrenzten Pfad je
// erreichen werden. Strategy Call Booked/Held und Won sind daher STRUKTURELL
// UNBOUNDED — unabhängig vom Kohortenalter und unabhängig vom
// `stageDurationMultiplier` jedes der sechs Scenario Profiles (geprüft: der
// Multiplikator ändert nur die Dauer innerhalb des bereits unbounded Walks,
// nicht dessen Unboundedness selbst) — und werden IMMER als
// `"indeterminate"` ausgewiesen, nie als `"mature"`.
//
// Demgegenüber SIND folgende vier Stufen beweisbar absolut begrenzt, per
// hartem Konstantenwert im Generator (kein Random Walk, kein unbegrenzter
// Schrittzähler, keine Scenario-Profile-Abhängigkeit — siehe je Konstante
// unten):
// 1) CRM Match: 6 Tage (`DELAYED_INGESTION_MAX_DAYS`,
//    events/marketing-meta-crm-source.ts — randomInt(1,6), hart begrenzt).
// 2) First Call Booked: 6 Tage (`bookedAt === matchedAt` exakt,
//    world/sales-appointments.ts — keine zusätzliche Verzögerung).
// 3) First Call Held: 84 Tage — 6 (CRM) + [12+10+10] (Buchung + höchstens
//    zwei Reschedules, `drawReschedules` hat KEINE Schleife, maximal zwei
//    feste Aufrufe) + 14 (Rebooking-Delay, höchstens EIN Rebooking-Level,
//    kein rekursives Re-Rebooking im Code) + [12+10+10] (identischer,
//    ebenfalls fest begrenzter Rebook-Lebenszyklus) = 84 Tage. Geprüft:
//    world/sales-appointments.ts referenziert an keiner Stelle
//    `scenarioProfile`/`multiplier` — vollständig profil-unabhängig.
// 4) Opportunity Created: 31 Tage — 6 (CRM) + 25
//    (`Math.min(conversionBudget, 25)`, events/generate-sales-pipeline.ts —
//    UNBEDINGT auf 25 gedeckelt, unabhängig von `remainingDays`, unabhängig
//    von jedem Multiplikator).
//
// Für diese vier Stufen gilt: `age >= horizonDays` ⇒ `"mature"`, sonst
// `"developing"`. `costPerMetaLead` benötigt keinen Reifehorizont — ein
// generierter Lead ist per Definition sofort vollständig gezählt (K5, letzter
// Satz) und daher immer `"mature"`.
//
// --- K6/K7: Getrennte Source-Coverage je Kennzahl -------------------------------
//
// URSPRÜNGLICHER FEHLER (korrigiert): `crm-lead-ingestion`-Coverage wurde
// als Ersatz für die Vollständigkeit von Appointment- und Opportunity-Daten
// verwendet. Das ist fachlich falsch — ein vollständiger CRM-Lead-Eingang
// beweist nichts über nachgelagerte Sales-Ereignisse. Jetzt geprüft:
// - costPerMetaLead: "meta-ad-spend" + "meta-lead-generation" (über bounds).
// - costPerCrmMatchedLead: zusätzlich "crm-lead-ingestion" (horizont-
//   begrenztes Fenster, siehe unten — mature-fähig).
// - costPerLeadWithFirstCallBooked/Held: zusätzlich "crm-lead-ingestion" UND
//   "crm-sales-appointment-lifecycle" (horizont-begrenzt — mature-fähig).
// - costPerOpportunityWithStrategyCallBooked/Held: zusätzlich
//   "crm-lead-ingestion", "crm-sales-appointment-lifecycle" UND
//   "crm-opportunity-lifecycle" (Fenster bis `asOf` — IMMER indeterminate,
//   siehe K8, daher niemals "available", höchstens "provisional").
// - costPerWonOpportunity: zusätzlich "crm-lead-ingestion" UND
//   "crm-opportunity-lifecycle" (Fenster bis `asOf` — IMMER indeterminate).
//
// --- K8/KORREKTURAUFTRAG "Source-Specific Coverage Windows": Fenster pro
// Stream, nicht pro Kennzahl -----------------------------------------------
//
// URSPRÜNGLICHER FEHLER (korrigiert): `boundedWindowCoverage` prüfte
// bislang ALLE beteiligten Streams einer Kennzahl (inklusive
// "meta-ad-spend"/"meta-lead-generation") über EIN GEMEINSAMES, auf den
// jeweiligen Downstream-Horizont ausgedehntes Fenster. Für
// `costPerLeadWithFirstCallHeld` (Horizont 84 Tage) bedeutete das: ein
// Meta-Ad-Spend-Sync-Fehler Wochen NACH Kohortenende (weit außerhalb der
// eigentlichen Spend-Periode) konnte die Kennzahl auf "partial-data"
// herabstufen — obwohl der Spend-ZÄHLER dieser Kohorte ausschließlich aus
// `[bounds.from, bounds.through]` stammt und von späteren Tagen niemals
// beeinflusst wird (K1: "kein Zähler aus späteren Aktivitätstagen"). Ein
// Coverage-Fehler außerhalb des fachlich tatsächlich gelesenen Zeitraums
// darf eine Kennzahl nicht beeinflussen.
//
// Jeder Source-Stream besitzt daher jetzt sein EIGENES, fachlich
// begründetes Fenster, unabhängig vom Fenster jedes anderen Streams:
// - "meta-ad-spend" / "meta-lead-generation": AUSSCHLIESSLICH
//   `[bounds.from, bounds.through]` — der Zähler (Spend) bzw. die
//   Kohorten-Mitgliedschaft (Leadgen) stammen ausschließlich aus der
//   Kohortenperiode selbst, niemals aus einem späteren Horizont.
// - "crm-lead-ingestion": `[bounds.from, min(asOf, bounds.through +
//   CRM_MATCH_HORIZON_DAYS)]` — das CRM-Match kann bis zu
//   `CRM_MATCH_HORIZON_DAYS` nach Kohortenende eintreffen (siehe
//   `DELAYED_INGESTION_MAX_DAYS`), unabhängig davon, welche
//   Downstream-Kennzahl diesen Nenner benötigt.
// - "crm-sales-appointment-lifecycle": horizontbegrenzt auf den jeweils
//   EIGENEN Reifehorizont der konsumierenden Kennzahl (6 Tage für Booked,
//   84 Tage für Held) für die vier mature-fähigen Stufen; für die
//   strukturell unbestimmten Stufen (Strategy Call) bis `asOf`.
// - "crm-opportunity-lifecycle": analog — horizontbegrenzt für mature-
//   fähige Stufen (aktuell keine der sieben Kennzahlen benötigt dies mit
//   eigenem Horizont), bis `asOf` für Strategy Call/Won (indeterminate).
//
// Jede Kennzahl kombiniert (K2) ausschließlich die für sie tatsächlich
// relevanten Einzel-Stream-Status — niemals ein bereits für eine andere
// Kennzahl berechnetes, weiter gefasstes Gesamtfenster.
//
// --- K8 (Grundprinzip, weiterhin gültig): Coverage vs. Maturity -----------
//
// Coverage beantwortet: "Sind die tatsächlich relevanten Quelldaten
// vollständig synchronisiert?" Maturity beantwortet: "Hatte die Kohorte
// genug Zeit, sämtliche möglichen Outcomes zu entwickeln?" Für beweisbar
// begrenzte Stufen wird das jeweilige Stream-Fenster auf
// `[Kohortenbeginn, min(asOf, Kohortenende + EIGENER Horizont dieser
// Stufe)]` begrenzt — eine längst ausgereifte Kohorte darf nicht ewig
// "unvollständig" bleiben, nur weil der HEUTIGE Sync (irrelevant für ihre
// eigene, längst abgeschlossene Zeitspanne) noch nicht fertig ist. Für
// unbestimmte Stufen reicht das Fenster der downstream-spezifischen Streams
// bis `asOf` selbst — mehr Gewissheit ist strukturell nicht erreichbar,
// daher bleibt die Kennzahl auch bei vollständiger Coverage höchstens
// `"provisional"`, nie `"available"`.

export type MarketingCohortPeriodKey = "yesterday" | "week-to-date" | "month-to-date" | "reference";

export interface MarketingCohortBounds {
  from: string;
  through: string;
}

export type CohortMaturityStatus = "mature" | "developing" | "indeterminate";

export type CohortCostAvailability = "available" | "provisional" | "partial-data" | "unavailable-data" | "no-denominator-events";

export interface CohortCostMetric {
  availability: CohortCostAvailability;
  maturity: CohortMaturityStatus;
  numeratorAmountMinor?: number;
  denominatorCount: number;
  // Nur gesetzt, wenn availability === "available" (Coverage vollständig UND
  // Reife bewiesen). Niemals gleichzeitig mit provisionalAmountMinor gesetzt.
  amountMinor?: number;
  // Nur gesetzt, wenn ein Zahlenwert existiert, aber NICHT final ist
  // (availability "provisional" oder "partial-data").
  provisionalAmountMinor?: number;
  currency: "EUR";
  numeratorEvidenceIds: string[];
  denominatorEvidenceIds: string[];
}

export interface MarketingCohortCampaignBreakdown {
  externalCampaignId: string;
  // Best-effort intern aufgelöst, sofern mindestens ein Lead dieser Campaign
  // in der Kohorte existiert — bei einer reinen Spend-ohne-Lead-Campaign
  // bleibt dies unbestimmt (keine erfundene interne ID).
  campaignId?: string;
  spendAmountMinor: number;
  spendRecordIds: string[];
  metaLeadGeneratedEventIds: string[];

  costPerMetaLead: CohortCostMetric;
  costPerCrmMatchedLead: CohortCostMetric;
  costPerLeadWithFirstCallBooked: CohortCostMetric;
  costPerLeadWithFirstCallHeld: CohortCostMetric;
  costPerOpportunityWithStrategyCallBooked: CohortCostMetric;
  costPerOpportunityWithStrategyCallHeld: CohortCostMetric;
  costPerWonOpportunity: CohortCostMetric;
}

export interface MarketingCohort {
  period: MarketingCohortPeriodKey;
  bounds: MarketingCohortBounds;
  // Interne Campaign-IDs, die in dieser Kohorte tatsächlich Leads erzeugten
  // (Teilmenge von `campaigns` unten — nicht mit dem vollständigen
  // Spend-Scope zu verwechseln).
  campaignIds: string[];
  metaLeadGeneratedEventIds: string[];

  // Gesamt-Level (K1): SÄMTLICHER Spend aller im Zeitraum aktiven Campaigns,
  // unabhängig davon, ob sie Leads erzeugten.
  spendAmountMinor: number;
  spendAvailability: PeriodDataStatus;
  spendRecordIds: string[];
  leadGenerationAvailability: PeriodDataStatus;
  currency: "EUR";

  // Campaign-Level (K2): eine Zeile je in der Periode aktiver Campaign
  // (Spend und/oder Leads), inklusive Null-Lead-Campaigns.
  campaigns: MarketingCohortCampaignBreakdown[];

  // Gesamt-Level-Kostenkennzahlen: Σ Spend / Σ Nenner, NIEMALS Durchschnitt
  // der Campaign-Werte.
  costPerMetaLead: CohortCostMetric;
  costPerCrmMatchedLead: CohortCostMetric;
  costPerLeadWithFirstCallBooked: CohortCostMetric;
  costPerLeadWithFirstCallHeld: CohortCostMetric;
  costPerOpportunityWithStrategyCallBooked: CohortCostMetric;
  costPerOpportunityWithStrategyCallHeld: CohortCostMetric;
  costPerWonOpportunity: CohortCostMetric;

  // Activity-Diagnostik (B8/B9, sekundär): Rohnenner, Rebookings zählen
  // mehrfach — bewusst getrennt von den primären Unique-Lead-/Opportunity-
  // Nennern oben.
  firstCallBookedEventCount: number;
  firstCallHeldEventCount: number;
  strategyCallBookedEventCount: number;
  strategyCallHeldEventCount: number;
}

export interface MarketingCohortCostSnapshot {
  asOf: string;
  yesterday: MarketingCohort;
  weekToDate: MarketingCohort;
  monthToDate: MarketingCohort;
}

// Absolute Maturity-Horizonte in Kalendertagen ab `generatedAt` — siehe
// Herleitung im Kopfkommentar oben. NUR für die vier beweisbar begrenzten
// Stufen definiert; Strategy Call/Won besitzen bewusst KEINEN Horizont
// (immer "indeterminate").
const MATURITY_HORIZON_CRM_MATCHED_DAYS = 6;
const MATURITY_HORIZON_FIRST_CALL_BOOKED_DAYS = 6;
const MATURITY_HORIZON_FIRST_CALL_HELD_DAYS = 84;
const MATURITY_HORIZON_OPPORTUNITY_CREATED_DAYS = 31;

function maturityForBoundedStage(bounds: MarketingCohortBounds, asOf: string, horizonDays: number): CohortMaturityStatus {
  const age = daysBetween(bounds.through, asOf);
  return age >= horizonDays ? "mature" : "developing";
}

function withinBounds(date: string, bounds: MarketingCohortBounds): boolean {
  return date >= bounds.from && date <= bounds.through;
}

function combineAll(statuses: readonly PeriodDataStatus[]): PeriodDataStatus {
  return statuses.reduce((acc, s) => combinePeriodDataStatus(acc, s));
}

// Source-spezifisches Fenster (KORREKTURAUFTRAG "Source-Specific Coverage
// Windows", K1/K2): jeder Stream wird EINZELN und mit SEINEM EIGENEN Fenster
// ausgewertet — niemals als Teil eines für mehrere Streams geteilten,
// weiter gefassten Fensters. Ein Defekt außerhalb des hier übergebenen
// Fensters kann diesen Aufruf strukturell nicht beeinflussen (er wird gar
// nicht erst abgefragt).

// "meta-ad-spend"/"meta-lead-generation": AUSSCHLIESSLICH die
// Kohortenperiode selbst — der Spend-Zähler und die Kohorten-Mitgliedschaft
// stammen nie aus einem späteren Horizont, unabhängig davon, welche
// Downstream-Kennzahl diesen Wert mitverwendet.
function periodOnlyCoverage(stream: MarketingSourceStream, bounds: MarketingCohortBounds, coverage: readonly MarketingSourceCoverage[], asOf: string): PeriodDataStatus {
  return resolveMarketingSourceCoverageStatus(stream, bounds, coverage, asOf);
}

// Horizontbegrenztes Fenster für einen einzelnen Stream (K8, für
// beweisbar begrenzte Stufen): endet spätestens am für DIESEN Stream/DIESE
// Kennzahl relevanten Reifehorizont, nicht an `asOf` selbst — eine längst
// ausgereifte Kohorte bleibt dadurch nicht ewig "unvollständig", und ein
// Defekt jenseits dieses Horizonts bleibt irrelevant.
function horizonWindowCoverage(stream: MarketingSourceStream, bounds: MarketingCohortBounds, asOf: string, horizonDays: number, coverage: readonly MarketingSourceCoverage[]): PeriodDataStatus {
  const latestRelevantDate = addDays(bounds.through, horizonDays);
  const through = latestRelevantDate < asOf ? latestRelevantDate : asOf;
  const window: MarketingCohortBounds = { from: bounds.from, through };
  return resolveMarketingSourceCoverageStatus(stream, window, coverage, asOf);
}

// Fenster bis `asOf` für einen einzelnen Stream (K8, für strukturell
// unbestimmte Stufen): mehr Gewissheit ist nicht erreichbar, das Ergebnis
// bleibt unabhängig vom Coverage-Status höchstens "provisional".
function asOfWindowCoverage(stream: MarketingSourceStream, bounds: MarketingCohortBounds, asOf: string, coverage: readonly MarketingSourceCoverage[]): PeriodDataStatus {
  const window: MarketingCohortBounds = { from: bounds.from, through: asOf };
  return resolveMarketingSourceCoverageStatus(stream, window, coverage, asOf);
}

// Einzige Stelle, an der ein Kostenwert aus Zähler/Nenner berechnet und in
// den fünfwertigen Availability-Zustand eingeordnet wird (K13,
// "exakt eine Produktionsberechnung"). Rundung: kaufmännisch auf die
// nächste Minor Unit (Math.round), da alle Beträge hier nichtnegativ sind.
// Präzedenz: Nenner-Existenz > Coverage-Vollständigkeit > Maturity.
function computeCostMetric(
  numeratorAmountMinor: number | undefined,
  numeratorEvidenceIds: string[],
  denominatorIds: string[],
  coverageStatus: PeriodDataStatus,
  maturity: CohortMaturityStatus,
): CohortCostMetric {
  const denominatorCount = denominatorIds.length;

  if (denominatorCount === 0) {
    return {
      availability: "no-denominator-events",
      maturity,
      numeratorAmountMinor,
      denominatorCount: 0,
      currency: "EUR",
      numeratorEvidenceIds,
      denominatorEvidenceIds: [],
    };
  }

  const rawAmount = numeratorAmountMinor !== undefined ? Math.round(numeratorAmountMinor / denominatorCount) : undefined;
  const base = { maturity, numeratorAmountMinor, denominatorCount, currency: "EUR" as const, numeratorEvidenceIds, denominatorEvidenceIds: denominatorIds };

  if (coverageStatus === "unavailable") {
    // Keine belastbare Abdeckung — auch kein vorläufiger Wert (er wäre nicht
    // einmal als grobe Schätzung vertrauenswürdig, siehe Marketing Period
    // Metrics für dasselbe Prinzip).
    return { ...base, availability: "unavailable-data" };
  }
  if (coverageStatus === "partial") {
    return { ...base, availability: "partial-data", provisionalAmountMinor: rawAmount };
  }
  // coverageStatus === "complete"
  if (maturity === "mature") {
    return { ...base, availability: "available", amountMinor: rawAmount };
  }
  // "developing" oder "indeterminate" mit vollständiger Coverage: der
  // beobachtete Wert ist bekannt, aber niemals final.
  return { ...base, availability: "provisional", provisionalAmountMinor: rawAmount };
}

interface CampaignScope {
  externalCampaignId: string;
  campaignId?: string;
  spendAmountMinor: number;
  spendRecordIds: string[];
  leads: MetaLeadGenerated[];
}

function computeSevenMetrics(
  scope: { spendAmountMinor: number; spendRecordIds: string[]; leads: readonly MetaLeadGenerated[] },
  bounds: MarketingCohortBounds,
  asOf: string,
  marketingLeadIdentityMatchedEvents: readonly MarketingLeadIdentityMatched[],
  marketingCrmLeadIngestedEvents: readonly MarketingCrmLeadIngested[],
  salesAppointments: readonly SalesAppointment[],
  opportunities: readonly Opportunity[],
  coverage: readonly MarketingSourceCoverage[],
): {
  costPerMetaLead: CohortCostMetric;
  costPerCrmMatchedLead: CohortCostMetric;
  costPerLeadWithFirstCallBooked: CohortCostMetric;
  costPerLeadWithFirstCallHeld: CohortCostMetric;
  costPerOpportunityWithStrategyCallBooked: CohortCostMetric;
  costPerOpportunityWithStrategyCallHeld: CohortCostMetric;
  costPerWonOpportunity: CohortCostMetric;
  attributions: readonly MarketingLeadAttribution[];
} {
  const { attributions } = generateMarketingToSalesAttribution({
    asOf,
    metaLeadGeneratedEvents: scope.leads,
    marketingLeadIdentityMatchedEvents,
    marketingCrmLeadIngestedEvents,
    salesAppointments,
    opportunities,
  });

  const metaLeadGeneratedEventIds = scope.leads.map((e) => e.id);
  const crmMatchedIds = attributions.filter((a) => a.leadId !== undefined).map((a) => a.metaLeadGeneratedEventId);
  const firstCallBookedLeadIds = attributions.filter((a) => a.milestones.some((m) => m.key === "first-call-booked")).map((a) => a.metaLeadGeneratedEventId);
  const firstCallHeldLeadIds = attributions.filter((a) => a.milestones.some((m) => m.key === "first-call-held")).map((a) => a.metaLeadGeneratedEventId);
  const strategyCallBookedOppIds = attributions.filter((a) => a.milestones.some((m) => m.key === "strategy-call-booked")).map((a) => a.opportunityId!);
  const strategyCallHeldOppIds = attributions.filter((a) => a.milestones.some((m) => m.key === "strategy-call-held")).map((a) => a.opportunityId!);
  const wonOppIds = attributions.filter((a) => a.milestones.some((m) => m.key === "won-opportunity")).map((a) => a.opportunityId!);

  const numerator = scope.spendAmountMinor;
  const numeratorIds = scope.spendRecordIds;

  // "meta-ad-spend"/"meta-lead-generation" werden IMMER ausschließlich über
  // die Kohortenperiode selbst geprüft (K1) — dieser Status wird von jeder
  // der sieben Kennzahlen benötigt (der Zähler ist überall derselbe
  // Perioden-Spend), aber NIEMALS über ein für eine Downstream-Kennzahl
  // ausgedehntes Fenster.
  const spendCoverage = periodOnlyCoverage("meta-ad-spend", bounds, coverage, asOf);
  const leadGenCoverage = periodOnlyCoverage("meta-lead-generation", bounds, coverage, asOf);
  const basePeriodCoverage = combinePeriodDataStatus(spendCoverage, leadGenCoverage);

  const costPerMetaLead = computeCostMetric(
    numerator, numeratorIds, metaLeadGeneratedEventIds,
    basePeriodCoverage,
    "mature", // K5: CPL benötigt keine Downstream-Maturity
  );

  // CRM-Match-Fenster: eigenständig, unabhängig vom Horizont der jeweils
  // konsumierenden Downstream-Kennzahl — ein CRM-Match kann strukturell nur
  // innerhalb von MATURITY_HORIZON_CRM_MATCHED_DAYS nach Kohortenende
  // eintreffen (K1 "CRM Lead Ingestion und Match").
  const crmIngestionCoverage = horizonWindowCoverage("crm-lead-ingestion", bounds, asOf, MATURITY_HORIZON_CRM_MATCHED_DAYS, coverage);
  const crmCoverage = combineAll([basePeriodCoverage, crmIngestionCoverage]);
  const costPerCrmMatchedLead = computeCostMetric(
    numerator, numeratorIds, crmMatchedIds, crmCoverage,
    maturityForBoundedStage(bounds, asOf, MATURITY_HORIZON_CRM_MATCHED_DAYS),
  );

  const appointmentBookedCoverage = horizonWindowCoverage("crm-sales-appointment-lifecycle", bounds, asOf, MATURITY_HORIZON_FIRST_CALL_BOOKED_DAYS, coverage);
  const fcBookedCoverage = combineAll([basePeriodCoverage, crmIngestionCoverage, appointmentBookedCoverage]);
  const costPerLeadWithFirstCallBooked = computeCostMetric(
    numerator, numeratorIds, firstCallBookedLeadIds, fcBookedCoverage,
    maturityForBoundedStage(bounds, asOf, MATURITY_HORIZON_FIRST_CALL_BOOKED_DAYS),
  );

  const appointmentHeldCoverage = horizonWindowCoverage("crm-sales-appointment-lifecycle", bounds, asOf, MATURITY_HORIZON_FIRST_CALL_HELD_DAYS, coverage);
  const fcHeldCoverage = combineAll([basePeriodCoverage, crmIngestionCoverage, appointmentHeldCoverage]);
  const costPerLeadWithFirstCallHeld = computeCostMetric(
    numerator, numeratorIds, firstCallHeldLeadIds, fcHeldCoverage,
    maturityForBoundedStage(bounds, asOf, MATURITY_HORIZON_FIRST_CALL_HELD_DAYS),
  );

  // Strategy Call Booked/Held: strukturell indeterminate — Appointment- und
  // Opportunity-Coverage werden bis `asOf` geprüft (kein Horizont
  // beweisbar), Spend/Leadgen/CRM bleiben bei ihrem jeweils eigenen,
  // fachlich korrekten Fenster.
  const appointmentAsOfCoverage = asOfWindowCoverage("crm-sales-appointment-lifecycle", bounds, asOf, coverage);
  const opportunityAsOfCoverage = asOfWindowCoverage("crm-opportunity-lifecycle", bounds, asOf, coverage);
  const strategyCallCoverage = combineAll([basePeriodCoverage, crmIngestionCoverage, appointmentAsOfCoverage, opportunityAsOfCoverage]);
  const costPerOpportunityWithStrategyCallBooked = computeCostMetric(
    numerator, numeratorIds, strategyCallBookedOppIds, strategyCallCoverage, "indeterminate",
  );
  const costPerOpportunityWithStrategyCallHeld = computeCostMetric(
    numerator, numeratorIds, strategyCallHeldOppIds, strategyCallCoverage, "indeterminate",
  );

  // Won: strukturell indeterminate — Opportunity-Coverage bis `asOf`,
  // Appointment-Coverage wird für Won nicht benötigt (Won hängt nicht am
  // Strategiegespräch, siehe Attribution Foundation B6).
  const wonCoverage = combineAll([basePeriodCoverage, crmIngestionCoverage, opportunityAsOfCoverage]);
  const costPerWonOpportunity = computeCostMetric(
    numerator, numeratorIds, wonOppIds, wonCoverage, "indeterminate",
  );

  return {
    costPerMetaLead,
    costPerCrmMatchedLead,
    costPerLeadWithFirstCallBooked,
    costPerLeadWithFirstCallHeld,
    costPerOpportunityWithStrategyCallBooked,
    costPerOpportunityWithStrategyCallHeld,
    costPerWonOpportunity,
    attributions,
  };
}

function buildCohort(
  period: MarketingCohortPeriodKey,
  bounds: MarketingCohortBounds,
  asOf: string,
  metaAdSpendRecords: readonly MetaAdSpendRecord[],
  metaLeadGeneratedEvents: readonly MetaLeadGenerated[],
  marketingLeadIdentityMatchedEvents: readonly MarketingLeadIdentityMatched[],
  marketingCrmLeadIngestedEvents: readonly MarketingCrmLeadIngested[],
  salesAppointments: readonly SalesAppointment[],
  opportunities: readonly Opportunity[],
  coverage: readonly MarketingSourceCoverage[],
): MarketingCohort {
  // --- B2: Cohort Membership — ausschließlich nach generatedAt -----------------
  const cohortLeads = metaLeadGeneratedEvents.filter((e) => withinBounds(e.generatedAt, bounds) && e.generatedAt <= asOf);
  const metaLeadGeneratedEventIds = cohortLeads.map((e) => e.id);
  const campaignIds = [...new Set(cohortLeads.map((e) => e.campaignId))];

  // --- K1: SÄMTLICHER Spend im Zeitraum, unabhängig von Lead-Erzeugung ---------
  const allSpendInCohort = metaAdSpendRecords.filter((r) => withinBounds(r.spendDate, bounds));
  const spendAmountMinor = allSpendInCohort.reduce((sum, r) => sum + r.amountMinor, 0);
  const spendRecordIds = allSpendInCohort.map((r) => r.id);
  const spendAvailability = resolveMarketingSourceCoverageStatus("meta-ad-spend", bounds, coverage, asOf);
  const leadGenerationAvailability = resolveMarketingSourceCoverageStatus("meta-lead-generation", bounds, coverage, asOf);

  // --- K2: Campaign-Level-Aufschlüsselung — Union aus Spend- und Lead-Campaigns
  const campaignScopes = new Map<string, CampaignScope>();
  for (const r of allSpendInCohort) {
    const scope = campaignScopes.get(r.externalCampaignId) ?? { externalCampaignId: r.externalCampaignId, spendAmountMinor: 0, spendRecordIds: [], leads: [] };
    scope.spendAmountMinor += r.amountMinor;
    scope.spendRecordIds.push(r.id);
    campaignScopes.set(r.externalCampaignId, scope);
  }
  for (const lead of cohortLeads) {
    const scope = campaignScopes.get(lead.externalCampaignId) ?? { externalCampaignId: lead.externalCampaignId, spendAmountMinor: 0, spendRecordIds: [], leads: [] };
    scope.leads.push(lead);
    scope.campaignId = scope.campaignId ?? lead.campaignId;
    campaignScopes.set(lead.externalCampaignId, scope);
  }

  const campaigns: MarketingCohortCampaignBreakdown[] = [...campaignScopes.values()]
    .sort((a, b) => a.externalCampaignId.localeCompare(b.externalCampaignId))
    .map((scope) => {
      const metrics = computeSevenMetrics(
        scope, bounds, asOf,
        marketingLeadIdentityMatchedEvents, marketingCrmLeadIngestedEvents, salesAppointments, opportunities, coverage,
      );
      return {
        externalCampaignId: scope.externalCampaignId,
        campaignId: scope.campaignId,
        spendAmountMinor: scope.spendAmountMinor,
        spendRecordIds: scope.spendRecordIds,
        metaLeadGeneratedEventIds: scope.leads.map((l) => l.id),
        costPerMetaLead: metrics.costPerMetaLead,
        costPerCrmMatchedLead: metrics.costPerCrmMatchedLead,
        costPerLeadWithFirstCallBooked: metrics.costPerLeadWithFirstCallBooked,
        costPerLeadWithFirstCallHeld: metrics.costPerLeadWithFirstCallHeld,
        costPerOpportunityWithStrategyCallBooked: metrics.costPerOpportunityWithStrategyCallBooked,
        costPerOpportunityWithStrategyCallHeld: metrics.costPerOpportunityWithStrategyCallHeld,
        costPerWonOpportunity: metrics.costPerWonOpportunity,
      };
    });

  // --- Gesamt-Level: Σ Spend / Σ Nenner, exakt einmal für die volle Kohorte ----
  const aggregate = computeSevenMetrics(
    { spendAmountMinor, spendRecordIds, leads: cohortLeads }, bounds, asOf,
    marketingLeadIdentityMatchedEvents, marketingCrmLeadIngestedEvents, salesAppointments, opportunities, coverage,
  );

  const firstCallBookedEventCount = aggregate.attributions.reduce((sum, a) => sum + a.firstCallAppointmentIds.length, 0);
  const firstCallHeldEventCount = aggregate.attributions.filter((a) => a.milestones.some((m) => m.key === "first-call-held")).length;
  const strategyCallBookedEventCount = aggregate.attributions.reduce((sum, a) => sum + a.strategyCallAppointmentIds.length, 0);
  const strategyCallHeldEventCount = aggregate.attributions.filter((a) => a.milestones.some((m) => m.key === "strategy-call-held")).length;

  return {
    period,
    bounds,
    campaignIds,
    metaLeadGeneratedEventIds,
    spendAmountMinor,
    spendAvailability,
    spendRecordIds,
    leadGenerationAvailability,
    currency: "EUR",
    campaigns,
    costPerMetaLead: aggregate.costPerMetaLead,
    costPerCrmMatchedLead: aggregate.costPerCrmMatchedLead,
    costPerLeadWithFirstCallBooked: aggregate.costPerLeadWithFirstCallBooked,
    costPerLeadWithFirstCallHeld: aggregate.costPerLeadWithFirstCallHeld,
    costPerOpportunityWithStrategyCallBooked: aggregate.costPerOpportunityWithStrategyCallBooked,
    costPerOpportunityWithStrategyCallHeld: aggregate.costPerOpportunityWithStrategyCallHeld,
    costPerWonOpportunity: aggregate.costPerWonOpportunity,
    firstCallBookedEventCount,
    firstCallHeldEventCount,
    strategyCallBookedEventCount,
    strategyCallHeldEventCount,
  };
}

export function generateMarketingCohortCostMetrics(params: {
  asOf: string;
  metaAdSpendRecords: readonly MetaAdSpendRecord[];
  metaLeadGeneratedEvents: readonly MetaLeadGenerated[];
  marketingLeadIdentityMatchedEvents: readonly MarketingLeadIdentityMatched[];
  marketingCrmLeadIngestedEvents: readonly MarketingCrmLeadIngested[];
  salesAppointments: readonly SalesAppointment[];
  opportunities: readonly Opportunity[];
  marketingSourceCoverage: readonly MarketingSourceCoverage[];
}): MarketingCohortCostSnapshot {
  const { asOf, metaAdSpendRecords, metaLeadGeneratedEvents, marketingLeadIdentityMatchedEvents, marketingCrmLeadIngestedEvents, salesAppointments, opportunities, marketingSourceCoverage } = params;

  const yesterdayDate = addDays(asOf, -1);
  const yesterdayBounds: MarketingCohortBounds = { from: yesterdayDate, through: yesterdayDate };
  const weekToDateBounds: MarketingCohortBounds = { from: startOfWeek(asOf), through: asOf };
  const monthToDateBounds: MarketingCohortBounds = { from: startOfMonth(asOf), through: asOf };

  const build = (period: MarketingCohortPeriodKey, bounds: MarketingCohortBounds) =>
    buildCohort(period, bounds, asOf, metaAdSpendRecords, metaLeadGeneratedEvents, marketingLeadIdentityMatchedEvents, marketingCrmLeadIngestedEvents, salesAppointments, opportunities, marketingSourceCoverage);

  return {
    asOf,
    yesterday: build("yesterday", yesterdayBounds),
    weekToDate: build("week-to-date", weekToDateBounds),
    monthToDate: build("month-to-date", monthToDateBounds),
  };
}

// Additiv (B14): eine ältere Referenzkohorte außerhalb Yesterday/WTD/MTD,
// dieselbe kanonische Berechnung, frei wählbare Grenzen.
export function generateMarketingCohortForBounds(
  period: MarketingCohortPeriodKey,
  bounds: MarketingCohortBounds,
  asOf: string,
  metaAdSpendRecords: readonly MetaAdSpendRecord[],
  metaLeadGeneratedEvents: readonly MetaLeadGenerated[],
  marketingLeadIdentityMatchedEvents: readonly MarketingLeadIdentityMatched[],
  marketingCrmLeadIngestedEvents: readonly MarketingCrmLeadIngested[],
  salesAppointments: readonly SalesAppointment[],
  opportunities: readonly Opportunity[],
  marketingSourceCoverage: readonly MarketingSourceCoverage[],
): MarketingCohort {
  return buildCohort(period, bounds, asOf, metaAdSpendRecords, metaLeadGeneratedEvents, marketingLeadIdentityMatchedEvents, marketingCrmLeadIngestedEvents, salesAppointments, opportunities, marketingSourceCoverage);
}

// K5 letzter Satz: exportiert nur der Vollständigkeit halber referenziert,
// damit ein Konsument die absoluten Horizonte ohne Duplikation einsehen kann.
export const MATURITY_HORIZONS_DAYS = {
  crmMatched: MATURITY_HORIZON_CRM_MATCHED_DAYS,
  firstCallBooked: MATURITY_HORIZON_FIRST_CALL_BOOKED_DAYS,
  firstCallHeld: MATURITY_HORIZON_FIRST_CALL_HELD_DAYS,
  opportunityCreated: MATURITY_HORIZON_OPPORTUNITY_CREATED_DAYS,
} as const;
