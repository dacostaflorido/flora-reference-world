// Feldebene wie im eingefrorenen Architekturmodell festgelegt. Ausschließlich ein
// TypeScript-Interface — keine Laufzeit-Abstraktion, keine gemeinsame Tabelle, kein
// Dispatch-System. Call/Email/Meeting erweitern dies strukturell (eigene Datei, eigene
// Entität), nicht per Vererbungshierarchie zur Laufzeit.
//
// Invariante (Interaction-Zuordnung): direction="intern" OHNE Kundenbezug, ODER
// mindestens eines von contactId/leadId/opportunityId gesetzt.
export interface InteractionBase {
  id: string;
  timestamp: string;
  employeeId: string;
  contactId?: string;
  accountId?: string;
  leadId?: string;
  opportunityId?: string;
  direction: "eingehend" | "ausgehend" | "intern";
  outcome?: string;
}
