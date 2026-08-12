// Company Aggregation Foundation (Reference World v2, Schritt 3) — gemeinsamer
// interner Vertrag für Company-Level-Aggregation über Sales/People/Operations
// hinweg. Bewusst minimal (Phase 3): ausschließlich die beiden Unterscheidungsachsen,
// die bereits fachlich entschieden sind (Domain Decision 9 — People ist eine
// Querschnittsdimension, kein Department) — keine weiteren Felder vorweggenommen,
// die erst in einer späteren Phase (Company Business State / Executive Context)
// benötigt und dort bewusst entschieden werden.
//
// kind unterscheidet strukturell, NICHT nur benennt: Sales/Marketing/Operations
// sind "department" (eigene departmentId in world/departments.ts), People ist
// "cross-cutting-dimension" (wertet Employee[] unternehmensweit aus, über alle
// Departments hinweg — es existiert kein "People"-Department im Organigramm). Das
// Company-Level-Domänenmodell darf diesen Unterschied nicht aus UI-Bequemlichkeit
// verwischen (People bleibt kein künstliches Department).
//
// Marketing (Marketing as First-Class Company Area): additive Erweiterung —
// Marketing ist strukturell gleichrangig zu Sales/People/Operations, besitzt aber
// aktuell state=null/evaluationStatus="unzureichende-evidenz" (siehe
// company-area-summaries.ts, generateMarketingAreaSummary) — dieselbe ehrliche
// Behandlung wie Operations, nicht weil Marketing weniger wichtig wäre, sondern
// weil das Domainmodell keine belastbare State-Bewertung hergibt (siehe
// observations/marketing-observations.ts für die vollständige Begründung).
export type CompanyAreaKey = "sales" | "marketing" | "people" | "operations";

export type CompanyAreaKind = "department" | "cross-cutting-dimension";

// Phase 4: gemeinsame Summary-Struktur je Area — ein reiner Adapter-Vertrag, keine
// neue Fachlogik. Jedes Feld ist eine unveränderte Weiterreichung bereits
// bestehender, evidenzgebundener Werte aus dem jeweiligen Domain-Layer (Sales
// Business State/Executive Context, People Business State, Operations
// Observation) — siehe company-area-summaries.ts für die konkreten Adapter.
//
// severity ist bewusst optional (`?`), nicht mit einem Platzhalterwert belegt:
// Sales-/People-Observations tragen eine echte severity (Observation-Interface),
// Operations-Observations strukturell keine (OperationsObservation, Phase 9 der
// Operations Foundation — kein severity vortäuschen). confidence ist dagegen immer
// vorhanden, weil beide bestehenden Observation-Typen (Observation und
// OperationsObservation) dieses Feld bereits garantiert führen.
export interface CompanyAreaObservationSummary {
  id: string;
  statement: string;
  severity?: string;
  confidence: string;
}

// state/statement sind `| null` statt weggelassen: das macht "keine Bewertung
// vorhanden" (Operations) strukturell von "Bewertung ist ein leerer String"
// unterscheidbar und erzwingt, dass jeder Konsument den Fall explizit behandelt
// (kein stiller Fallback auf einen falschen Default). evaluationStatus ist die
// eigentliche, maschinenlesbare Unterscheidung; state/statement sind die
// menschenlesbare Konsequenz daraus — beide müssen konsistent sein (durch die
// Generatoren in company-area-summaries.ts erzwungen, nicht durch den Typ selbst).
export interface CompanyAreaSummary {
  key: CompanyAreaKey;
  kind: CompanyAreaKind;
  departmentId?: string;
  state: string | null;
  evaluationStatus: "bewertet" | "unzureichende-evidenz";
  statement: string | null;
  topObservations: CompanyAreaObservationSummary[];
  relevantMetrics: Record<string, number | string>;
  evidenceIds: string[];
}
