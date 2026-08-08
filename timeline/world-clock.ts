// Einzige Quelle des Simulationszeitraums (PRINCIPLES.md, Prinzip 3 & 14). Feste,
// literale Datumskonstanten — kein Date.now(), keine Abhängigkeit von der echten
// Systemzeit. Ersetzt den bisherigen technischen Platzhalter in
// world/customer-accounts.ts (Step 2).
//
// Gilt für DYNAMISCHE Entitäten (Lead, Opportunity, OpportunityStageHistory, künftig
// Interaktionen) — nicht für die statische Stammdatenhistorie (CustomerAccount.createdAt,
// Employee.hiredAt), die bewusst weiter zurückreicht als die 15-monatige Simulationshistorie.
export const WORLD_TIMELINE_START = "2024-06-01";
export const WORLD_NOW = "2025-09-01"; // 15 Monate Historie vor WORLD_NOW

export function isWithinWorldTimeline(isoDate: string): boolean {
  return isoDate >= WORLD_TIMELINE_START && isoDate <= WORLD_NOW;
}

export function isBeforeOrAtWorldNow(isoDate: string): boolean {
  return isoDate <= WORLD_NOW;
}
