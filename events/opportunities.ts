// Feldebene wie im eingefrorenen Architekturmodell festgelegt (DYNAMISCH). Einzige
// Entstehungsquelle ist die Lead-Konversion (siehe generate-sales-pipeline.ts) — kein
// Duplikatmodell, Lead und Opportunity sind zwei Zustände derselben Sales-Reise.
export interface Opportunity {
  id: string;
  leadId: string;
  // = leadId.accountId (Invariante, bewusste Redundanz für Queries).
  accountId: string;
  // = Zeitpunkt der Lead-Konversion.
  createdAt: string;
  currentStage: "qualifizierung" | "angebot" | "verhandlung" | "gewonnen" | "verloren";
  value: number;
  probability: number;
  responsibleEmployeeId: string;
  closedAt?: string;
  lostReason?: string;
}
