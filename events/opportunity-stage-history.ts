// Feldebene wie im eingefrorenen Architekturmodell festgelegt (DYNAMISCH). Invariante:
// Einträge je Opportunity sind lückenlos und überlappungsfrei von createdAt bis
// closedAt ?? WORLD_NOW; der offene Eintrag (kein exitedAt) entspricht exakt
// opportunity.currentStage.
export interface OpportunityStageHistory {
  id: string;
  opportunityId: string;
  stage: "qualifizierung" | "angebot" | "verhandlung" | "gewonnen" | "verloren";
  enteredAt: string;
  exitedAt?: string;
  // Kann von opportunity.responsibleEmployeeId abweichen bei Besitzerwechsel im Verlauf.
  responsibleEmployeeId: string;
  // Grund beim Verlassen — vor allem beim Übergang zu gewonnen/verloren gesetzt.
  outcome?: string;
}
