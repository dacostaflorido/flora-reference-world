// Feldebene wie im eingefrorenen Architekturmodell festgelegt. Invariante: genau
// eines von leadId/opportunityId ist gesetzt (nicht beide, nicht keines) — nach
// Lead-Konversion hängt die Dokumentation an der Opportunity, nicht mehr am Lead.
export interface CrmActivity {
  id: string;
  timestamp: string;
  employeeId: string;
  leadId?: string;
  opportunityId?: string;
  activityType: "notiz" | "aufgabe-erstellt" | "aufgabe-erledigt" | "status-erinnerung";
  note: string;
}
