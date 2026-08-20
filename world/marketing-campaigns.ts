// Marketing Meta/CRM Source Foundation V1 — kleine, handkuratierte, statische
// Campaign-Liste (exakt dasselbe Muster wie world/employees.ts,
// world/customer-accounts.ts: geringe Stückzahl, jede Instanz bewusst gewählt,
// kein per-Lead-Zufallsgenerator). Vor diesem Auftrag existierte im gesamten
// Repository KEINE Campaign-/Cost-/Budget-Entität (siehe
// company/marketing-executive-kpis.ts, expliziter Kopfkommentar: "kein
// Campaign-/Cost-/Budget-Datenmodell existiert irgendwo in dieser Reference
// World") — diese Datei füllt genau diese, bereits dokumentierte Lücke, rein
// additiv, ohne Lead.source oder irgendeine bestehende Struktur anzutasten.
export interface MarketingCampaign {
  id: string;
  externalAdAccountId: string;
  externalCampaignId: string;
  name: string;
}

export const MARKETING_CAMPAIGNS: MarketingCampaign[] = [
  { id: "campaign-01", externalAdAccountId: "act-770019442", externalCampaignId: "cmp-4471182201", name: "Brand Awareness DACH" },
  { id: "campaign-02", externalAdAccountId: "act-770019442", externalCampaignId: "cmp-4471182202", name: "Retargeting Website" },
  { id: "campaign-03", externalAdAccountId: "act-770019442", externalCampaignId: "cmp-4471182203", name: "Lookalike Neukunden" },
  { id: "campaign-04", externalAdAccountId: "act-770019442", externalCampaignId: "cmp-4471182204", name: "Lead-Formular Webinar" },
];
