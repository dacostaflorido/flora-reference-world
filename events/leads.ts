// Feldebene wie im eingefrorenen Architekturmodell festgelegt (DYNAMISCH). Typdefinition
// getrennt von der Generierung (siehe generate-sales-pipeline.ts) — Lead und Opportunity
// sind kausal gekoppelt (Konversion), ein Import von opportunities.ts hierher würde
// einen Zyklus erzeugen, wenn beide ihre Daten unabhängig voneinander exportieren
// wollten.
export interface Lead {
  id: string;
  accountId: string;
  contactId: string;
  source: string;
  // Kein "gewonnen" auf Lead-Ebene — nur die Opportunity kennt gewonnen/verloren.
  status: "neu" | "kontaktiert" | "qualifiziert" | "konvertiert" | "verloren";
  createdAt: string;
  ownerEmployeeId: string;
  lastContactedAt?: string;
  convertedToOpportunityId?: string;
  lostReason?: string;
}
