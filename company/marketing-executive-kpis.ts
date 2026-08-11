import type { WorldSnapshot } from "../snapshot/snapshot";

// Marketing Executive KPI Contract v1 Foundation — additive Ergänzung zu
// CompanyExecutiveKpiData (siehe company-executive-kpis.ts für die
// übergeordnete Contract-Philosophie: keine Bewertung, keine Ground Truth,
// keine Observation, direkt aus dem bereits vorhandenen WorldSnapshot
// abgeleitet). Marketing ist bewusst KEINE eigene Company Area (company-area.ts,
// CompanyAreaKey bleibt unverändert "sales"|"operations"|"people") — es
// existiert keine belastbare Business-State-/Evaluation-Semantik für Marketing
// (keine Marketing-Observations, keine Ground Truth, kein etabliertes
// "gesund"/"kritisch"-Vokabular für diesen Bereich), und eine erfundene
// Bewertung nur um der Vollständigkeit willen widerspräche Prinzip 17-19
// (Business State bleibt eingefroren, keine neue Charakterisierung ohne
// Evidenzbasis). Marketing bleibt daher ein reiner additiver Fact-Contract,
// analog zu company-executive-kpis.ts' people/sales-Zweigen.
//
// Explizit NICHT implementiert (Marketing Foundation Audit):
// - Qualified Leads: Lead.status ("qualifiziert" etc.) ist ein finaler,
//   nicht historisierter Zustand ohne Übergangs-Zeitstempel je Zwischenstatus
//   (siehe snapshot.ts, "Bekannte, bewusst nicht gelöste Grenze": der
//   Generator würfelt genau einen finalen status, keine Statushistorie). Für
//   historisches asOf nicht ehrlich rekonstruierbar — ein Qualified-Lead-Fact
//   würde für frühe asOf-Werte den FINALEN (WORLD_NOW-)Status zeigen statt des
//   tatsächlichen Status zum jeweiligen Zeitpunkt (Zukunftskenntnis, Prinzip 5/18).
// - CAC/Spend/Budget/Kosten: kein Campaign-/Cost-/Budget-Datenmodell existiert
//   irgendwo in dieser Reference World — Lead.source ist ein reiner
//   Beschreibungsstring ("Webinar", "Kaltakquise" usw.), keine verknüpfte
//   Kampagnen-Entität mit Ausgaben.
// - Attribution/Conversion Rate/Channel Performance: dieselbe fehlende
//   Kosten-/Kampagnenbasis, zusätzlich keine im Modell definierte
//   Nenner-Semantik für eine Conversion Rate.
//
// Lead ist im bestehenden Modell strukturell Teil der Sales-Pipeline
// (events/generate-sales-pipeline.ts: "Lead und Opportunity sind zwei
// Zustände derselben Sales-Reise", generiert von generateSalesPipeline). Die
// Wiederverwendung von Lead.createdAt als "Marketing Lead generiert"-Fakt ist
// eine Neuinterpretation eines bestehenden Sales-nah modellierten Fakts, keine
// genuine, separat erhobene Marketing-Quelle — bewusst hier dokumentiert,
// nicht verschwiegen.
export interface MarketingLeadFact {
  leadId: string;
  createdAt: string;
}

// handedOffAt = Opportunity.createdAt, im Domainmodell explizit dokumentiert
// als "Zeitpunkt der Lead-Konversion" (events/opportunities.ts) — derselbe
// Zeitpunkt, zu dem Lead.convertedToOpportunityId gesetzt wird (siehe
// generate-sales-pipeline.ts). Jede Opportunity in diesem Modell entsteht
// ausschließlich aus genau dieser Lead-Konversion, leadId ist daher
// strukturell immer eine echte, existierende Lead-Referenz.
export interface MarketingSalesHandoffFact {
  leadId: string;
  opportunityId: string;
  handedOffAt: string;
}

export interface MarketingExecutiveKpiData {
  leads: MarketingLeadFact[];
  salesHandoffs: MarketingSalesHandoffFact[];
}

export function generateMarketingExecutiveKpiData(snapshot: WorldSnapshot): MarketingExecutiveKpiData {
  // snapshot.leads ist bereits auf createdAt <= asOf gefiltert (snapshot.ts) —
  // reine Ableitung, keine erneute Zeitfilterung nötig.
  const leads: MarketingLeadFact[] = snapshot.leads
    .map((lead) => ({ leadId: lead.id, createdAt: lead.createdAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.leadId.localeCompare(b.leadId));

  // snapshot.opportunities enthält bereits ausschließlich Opportunities mit
  // createdAt <= asOf (snapshot.ts) — dieselbe Existenz-Filterung reicht hier,
  // da der Handoff-Zeitpunkt exakt Opportunity.createdAt ist (keine separate
  // Stage-Rekonstruktion nötig, anders als bei wonDeals in
  // company-executive-kpis.ts, wo der aktuelle Stage-Zustand relevant ist).
  const salesHandoffs: MarketingSalesHandoffFact[] = snapshot.opportunities
    .map(({ opportunity }) => ({
      leadId: opportunity.leadId,
      opportunityId: opportunity.id,
      handedOffAt: opportunity.createdAt,
    }))
    .sort((a, b) => a.handedOffAt.localeCompare(b.handedOffAt) || a.opportunityId.localeCompare(b.opportunityId));

  return { leads, salesHandoffs };
}
