import type { Observation, ObservationKind } from "./observations";
import type { Lead } from "../events/leads";
import type { Opportunity } from "../events/opportunities";

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
