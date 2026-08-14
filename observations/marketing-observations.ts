import type { Observation, ObservationKind } from "./observations";
import type { Lead } from "../events/leads";
import type { Opportunity } from "../events/opportunities";
import { addDays, daysBetween } from "../engine/random";

// Marketing as First-Class Company Area — Evidence Audit (siehe Abschlussbericht):
// die einzigen echten, asOf-sicheren, eindeutig Marketing zuordenbaren Signale sind
// Lead-Entstehung (Lead.createdAt) und Übergabe an Sales (Opportunity.createdAt via
// Lead.convertedToOpportunityId, identisch zu MarketingSalesHandoffFact in
// company/marketing-executive-kpis.ts). Beide sind reine Volumen-/Zeitfakten ohne
// jeden im Domainmodell vorhandenen Vergleichsmaßstab (kein Zielwert, keine
// Vorperiode mit definierter Signifikanzschwelle, keine Kapazitäts-/Fair-Share-Größe
// wie bei Operations). Selbst Operations — mit einer echten, mathematisch klar
// definierten Fair-Share-Kennzahl — hat sich laut freigegebener Domain Decision 5
// gegen eine Severity-/State-Bewertung entschieden, weil kein Schwellenwert im
// Domainmodell begründbar ist. Marketings Evidenzlage ist strukturell schwächer als
// die von Operations (kein Fair-Share-Konzept, keine vergleichbare Kennzahl) —
// dieselbe Domain-Decision-5-Logik greift daher zwingend auch hier. MarketingObservation
// ist deshalb bewusst KEIN Observation (keine severity, keine category) — exakt
// dieselbe strukturelle Entscheidung wie OperationsObservation
// (observations/operations-observations.ts), aus identischer Begründung.
//
// Ausdrücklich NICHT verwendet, mit Begründung (Marketing Evidence Audit):
// - Lead.status ("qualifiziert" etc.): keine Übergangs-Zeitstempel-Historie (siehe
//   snapshot.ts, "Bekannte, bewusst nicht gelöste Grenze") — QUALIFIED LEAD TEMPORAL
//   SEMANTICS NOT AVAILABLE.
// - Lead.source: rein gleichverteilt zufällig generiert
//   (events/generate-sales-pipeline.ts, `pick(rng, LEAD_SOURCES)`), trägt keine
//   reale Kanal-Performance-Bedeutung — eine "Kanal X performt besser"-Aussage wäre
//   Rauschen als Erkenntnis verkleidet.
// - Lead.ownerEmployeeId (SDR): SDRs gehören zu dept-vertrieb (Sales), nicht
//   dept-marketing — eine Verteilungsanalyse hierüber wäre Sales-SDR-Auslastung
//   unter Marketing-Etikett (verboten, "Marketing darf nicht Sales mit anderem
//   Namen sein").
// - dept-marketing-Mitarbeitende: reiner Organigramm-Realismus ohne eigene
//   Event-Typen (world/employees.ts) — keine Verknüpfung zu Leads/Kampagnen.
//
// AUFTRAG — Marketing Leadership State: die obige Begründung ("kein im
// Domainmodell vorhandener Vergleichsmaßstab") gilt für DIESE Observation
// (reine Momentaufnahme) unverändert weiter — sie bleibt deshalb unangetastet.
// Seit den vorangegangenen Kalibrierungsaufträgen (Marketing Demand Regime v2,
// Sales Ownership / Marketing Demand Decoupling) existiert jedoch erstmals ein
// echter, empirisch (nicht redaktionell) hergeleiteter Vergleichsmaßstab für
// Lead.createdAt: eine rollierende historische Referenzdichte plus ein
// Persistence-Test mit einer aus dem Rausch-Boden (nicht aus einem
// Wunschergebnis) hergeleiteten Schwelle. Das ist die Voraussetzung, die beim
// ursprünglichen Marketing Evidence Audit noch fehlte — siehe
// generateMarketingDemandRegimeSignalObservation weiter unten.
export interface MarketingObservation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  area: "Marketing";
  statement: string;
  confidence: Observation["confidence"];
  leadsTotal: number;
  salesHandoffsTotal: number;
  derivedFrom: string[];
}

// Rein deskriptiv (dieselbe Methode wie generateOperationsDeliveryFairShareObservation):
// berichtet Lead-/Handoff-Volumen als Fakt, klassifiziert nichts als
// gesund/kritisch/effizient, spricht keine Handlungsempfehlung aus. derivedFrom
// referenziert exakt die zum Zeitpunkt asOf existierenden Lead-IDs plus die
// Opportunity-IDs der bereits erfolgten Übergaben (Backward Explainability,
// Prinzip 18) — über Opportunity.leadId vollständig bis zum ursprünglichen Lead
// zurückverfolgbar.
export function generateMarketingDemandGenerationObservation(
  leads: readonly Lead[],
  opportunities: readonly Opportunity[],
  asOf: string,
): MarketingObservation | undefined {
  if (leads.length === 0) {
    return undefined;
  }

  const salesHandoffsTotal = opportunities.length;

  const statement =
    salesHandoffsTotal === 0
      ? `Zum ${asOf} sind ${leads.length} Leads erfasst, noch keine Übergabe an Sales.`
      : `Zum ${asOf} sind ${leads.length} Leads erfasst, davon ${salesHandoffsTotal} an Sales übergeben.`;

  return {
    id: `marketing-obs-demand-generation-${asOf}`,
    kind: "marketing-demand-generation-volume",
    generatedAt: asOf,
    area: "Marketing",
    statement,
    confidence: "unzureichend",
    leadsTotal: leads.length,
    salesHandoffsTotal,
    derivedFrom: [...leads.map((l) => l.id), ...opportunities.map((o) => o.id)],
  };
}

// ============================================================================
// Marketing Leadership State — Demand Regime Signal
// ============================================================================
//
// Beantwortet EINE, eng begrenzte Führungsfrage: "Weicht die Lead-Entstehung
// gerade anhaltend von ihrem historischen Referenzniveau ab — nach oben, nach
// unten, oder gar nicht?" Ausdrücklich NICHT beantwortet (weiterhin fehlende
// Daten, siehe observations/marketing-observations.ts oben und
// PROJECT-Auftrag "Marketing Leadership State"): ob das gut oder schlecht ist,
// ob es an einem Kanal/einer Kampagne liegt, ob es sich lohnt, ob Budget
// angepasst werden sollte. "erhöht"/"unterdrückt" ist ein reines Niveau-Wort,
// keine Chance-/Risiko-Einstufung — deshalb bewusst KEIN Observation.category.
//
// Methodik (identisch zur bereits validierten Kalibrierung, siehe
// validation/marketing-demand-regime-v2-calibration.test.ts und
// validation/sales-ownership-decoupling.test.ts — hier nur auf einen
// beliebigen asOf statt ausschließlich WORLD_NOW verallgemeinert):
// - Fenstergröße 28 Tage, Persistence über 2 nicht überlappende Fenster (56
//   Tage) — empirisch als kürzeste Kombination bestätigt, die sowohl das
//   84-Tage-Produktionsregime robust erkennt als auch unter reinem Rauschen
//   eine False-Positive-Rate < 5 % hält.
// - Referenzdichte = Lead-Dichte über die GESAMTE Historie VOR den beiden
//   Fenstern (nicht nur ein kurzer Ausschnitt) — asOf-sicher, da ausschließlich
//   Leads mit createdAt <= asOf-56 verwendet werden, und robust gegen
//   Kurzzeit-Rauschen durch die lange Mittelungsbasis.
// - Schwelle 20 % Abweichung von der Referenzdichte — NICHT redaktionell
//   gewählt, sondern aus dem Rausch-Boden hergeleitet (bei 15 % Schwelle lag
//   die persistente False-Positive-Rate unter reinem Rauschen noch bei 9,5 %,
//   bei 20 % bei 3,6 % — siehe Abschlussbericht "Marketing Demand Regime v2").
export type MarketingDemandRegimeSignal = "erhoeht" | "unterdrueckt" | "stabil";

export interface MarketingDemandSignalObservation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  area: "Marketing";
  statement: string;
  confidence: Observation["confidence"];
  regimeSignal: MarketingDemandRegimeSignal;
  windowDays: number;
  recentWindowDensities: [number, number];
  referenceDensity: number;
  referenceLeadCount: number;
  derivedFrom: string[];
}

const REGIME_SIGNAL_WINDOW_DAYS = 28;
const REGIME_SIGNAL_THRESHOLD_FRAC = 0.2;
// Mindest-Evidenz für eine belastbare Referenzdichte — dieselbe "n>=30"-
// Konvention wie an anderer Stelle in diesem Repository (z. B.
// lead-volume-trend: confidence "hoch" erst ab 30 Leads je Fenster), plus eine
// Mindestlaufzeit, damit die Referenz nicht durch wenige, zufällig frühe Leads
// dominiert wird.
const REGIME_SIGNAL_MIN_REFERENCE_LEADS = 30;
const REGIME_SIGNAL_MIN_REFERENCE_DAYS = 90;

function countInWindow(leads: readonly Lead[], startExclusive: string, endInclusive: string): number {
  return leads.filter((l) => l.createdAt > startExclusive && l.createdAt <= endInclusive).length;
}

// asOf-sicher: verwendet ausschließlich Leads mit createdAt <= asOf (über die
// bereits asOf-gefilterte `leads`-Eingabe hinaus keine weitere Zukunftskenntnis
// möglich) und timelineStart als einzige zusätzliche, nicht von Leads
// abgeleitete Information — ein reines Kalenderdatum, keine Weltkenntnis.
export function generateMarketingDemandRegimeSignalObservation(
  leads: readonly Lead[],
  asOf: string,
  timelineStart: string,
): MarketingDemandSignalObservation | undefined {
  const recentStart = addDays(asOf, -REGIME_SIGNAL_WINDOW_DAYS);
  const midStart = addDays(asOf, -2 * REGIME_SIGNAL_WINDOW_DAYS);
  const referenceEnd = midStart;

  if (referenceEnd < timelineStart) {
    return undefined;
  }
  const referenceDays = daysBetween(timelineStart, referenceEnd);
  if (referenceDays < REGIME_SIGNAL_MIN_REFERENCE_DAYS) {
    return undefined;
  }
  const referenceLeads = leads.filter((l) => l.createdAt <= referenceEnd);
  if (referenceLeads.length < REGIME_SIGNAL_MIN_REFERENCE_LEADS) {
    return undefined;
  }
  const referenceDensity = referenceLeads.length / referenceDays;

  const window1 = leads.filter((l) => l.createdAt > recentStart && l.createdAt <= asOf);
  const window2 = leads.filter((l) => l.createdAt > midStart && l.createdAt <= recentStart);
  const density1 = window1.length / REGIME_SIGNAL_WINDOW_DAYS;
  const density2 = window2.length / REGIME_SIGNAL_WINDOW_DAYS;

  const elevatedThreshold = referenceDensity * (1 + REGIME_SIGNAL_THRESHOLD_FRAC);
  const suppressedThreshold = referenceDensity * (1 - REGIME_SIGNAL_THRESHOLD_FRAC);
  const elevated = density1 > elevatedThreshold && density2 > elevatedThreshold;
  const suppressed = density1 < suppressedThreshold && density2 < suppressedThreshold;
  const regimeSignal: MarketingDemandRegimeSignal = elevated ? "erhoeht" : suppressed ? "unterdrueckt" : "stabil";

  const statement =
    regimeSignal === "stabil"
      ? `Die Lead-Entstehung der letzten ${2 * REGIME_SIGNAL_WINDOW_DAYS} Tage (${density1.toFixed(2)}/${density2.toFixed(2)} Leads/Tag in den letzten beiden ${REGIME_SIGNAL_WINDOW_DAYS}-Tage-Fenstern) weicht nicht anhaltend vom historischen Referenzniveau (${referenceDensity.toFixed(2)} Leads/Tag, ${referenceLeads.length} Leads über ${referenceDays} Tage) ab.`
      : `Die Lead-Entstehung liegt seit mindestens ${2 * REGIME_SIGNAL_WINDOW_DAYS} Tagen anhaltend ${regimeSignal === "erhoeht" ? "über" : "unter"} dem historischen Referenzniveau (${density1.toFixed(2)} und ${density2.toFixed(2)} Leads/Tag in den letzten beiden ${REGIME_SIGNAL_WINDOW_DAYS}-Tage-Fenstern vs. ${referenceDensity.toFixed(2)} Leads/Tag Referenz, ${referenceLeads.length} Leads über ${referenceDays} Tage).`;

  return {
    id: `marketing-obs-demand-regime-${asOf}`,
    kind: "marketing-demand-regime-signal",
    generatedAt: asOf,
    area: "Marketing",
    statement,
    // Beide Fenster bestätigen unabhängig dieselbe Richtung (oder beide
    // bestätigen "keine Abweichung") UND die Referenz erfüllt bereits das
    // Mindest-Evidenz-Kriterium oben — "hoch" ist damit fachlich begründet,
    // nicht großzügig geraten.
    confidence: "hoch",
    regimeSignal,
    windowDays: REGIME_SIGNAL_WINDOW_DAYS,
    recentWindowDensities: [density1, density2],
    referenceDensity,
    referenceLeadCount: referenceLeads.length,
    // Backward Explainability (Prinzip 18): referenziert die beiden vollständig
    // ausgewerteten jüngsten Fenster plus eine Stichprobe der Referenzperiode
    // (dieselbe Sampling-Konvention wie bei lead-volume-trend/observations.ts,
    // wo eine vollständige Referenzierung bei potenziell hunderten Leads die
    // Liste unhandlich machen würde) — auch "stabil"/"keine Abweichung" ist
    // eine Tatsachenbehauptung über eine ausgewertete Population und braucht
    // eine nachvollziehbare Evidenzbasis, nie ein leeres derivedFrom.
    derivedFrom: [...window1.map((l) => l.id), ...window2.map((l) => l.id), ...referenceLeads.slice(0, 10).map((l) => l.id)],
  };
}
