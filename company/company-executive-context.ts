import type { CompanyAreaKey, CompanyAreaSummary } from "./company-area";

// Company Aggregation Foundation, Phase 13: minimale Struktur für eine einzelne,
// bereits belegbare Cross-Area-Kausalkette (Phase 16) — kein generisches
// Kausalitäts-Framework, keine Spekulation über künftige Ketten.
export interface CompanyCrossAreaLink {
  from: CompanyAreaKey;
  to: CompanyAreaKey;
  kind: "kausal" | "korrelation";
  evidenceIds: string[];
}

export interface CompanyExecutiveContextSnapshot {
  id: string;
  timestamp: string;
  companyBusinessStateId: string;
  affectedAreas: CompanyAreaKey[];
  areaSummaries: CompanyAreaSummary[];
  topSituations: string[];
  crossAreaLinks: CompanyCrossAreaLink[];
  insufficientEvidenceAreas: CompanyAreaKey[];
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
function companyExecutiveContextId(companyBusinessStateId: string, timestamp: string): string {
  const fingerprint = `${companyBusinessStateId}|${timestamp}`;
  return `cexec-${String(hashString(fingerprint) % 100000).padStart(5, "0")}`;
}

// Phase 14 — "affected" bedeutet "besitzt aktuell relevante Evidenz", NICHT
// "ist problematisch". Für Sales/People: ein bewerteter State, der vom neutralen
// Ausgangszustand "ausgeglichen" abweicht (identischer Wortlaut, identische
// Bedeutung in beiden Domänen) — "ausgeglichen" selbst zählt bewusst nicht als
// affected, sonst wäre Sales strukturell immer affected (Sales' eigenes
// "ausgeglichen" zitiert bereits heute Evidence als Beruhigungsbeleg, siehe
// business-state.ts). Für Operations: eine aktive Observation existiert
// (evidenceIds nicht leer) — das ist ausdrücklich erlaubt, obwohl state === null
// und evaluationStatus === "unzureichende-evidenz" (Phase 14, letzter Absatz).
function isAreaAffected(area: CompanyAreaSummary): boolean {
  if (area.key === "operations") {
    return area.evidenceIds.length > 0;
  }
  return area.state !== null && area.state !== "ausgeglichen";
}

// Phase 15 — topSituations, maximal 3, deterministische Reihenfolge: bewertete
// Areas zuerst in fester, bestehender Domänen-Reihenfolge (Sales, People — keine
// neue Score-Matrix, keine Sales/People-übergreifende Severity-Rangfolge, da Sales
// keine vergleichbare Area-Severity exponiert), Operations zuletzt. "People:
// bestehende Severity verwenden, hoch vor mittel" (mehrere People-eigene
// Observations untereinander) tritt im aktuellen Modell nicht auf (People trägt
// heute höchstens eine relevante Situation) — keine zusätzliche Sortierlogik nötig,
// um sie zu erfüllen. Genau 3 Areas existieren heute, jede trägt höchstens ein
// Statement bei — die Obergrenze wird dadurch strukturell nie überschritten.
const AREA_PRIORITY_ORDER: readonly CompanyAreaKey[] = ["sales", "people", "operations"];

function generateTopSituations(areaSummaries: readonly CompanyAreaSummary[]): string[] {
  const situations: string[] = [];
  for (const key of AREA_PRIORITY_ORDER) {
    const area = areaSummaries.find((a) => a.key === key);
    if (area?.statement) {
      situations.push(area.statement);
    }
  }
  return situations.slice(0, 3);
}

// Phase 16 — die einzige heute belegbare Cross-Area-Kette: gewonnene Sales
// Opportunities erzeugen DeliveryUnits (world/delivery-units.ts,
// checkOpportunityClosedAtConsistency + DeliveryUnit.opportunityId). Evidence sind
// die aktiven DeliveryUnit-IDs der Operations Area Summary — von dort bereits
// bestehend und getestet bis Opportunity/closedAt zurückverfolgbar (Operations
// Foundation, Phase 14/20). Kein zweiter Link (People→Sales, People→Operations,
// Operations→Sales, Marketing→Sales o. Ä.) — keiner davon ist heute belegt.
function generateSalesToOperationsLink(operationsSummary: CompanyAreaSummary): CompanyCrossAreaLink | undefined {
  if (operationsSummary.evidenceIds.length === 0) {
    return undefined;
  }
  return {
    from: "sales",
    to: "operations",
    kind: "kausal",
    evidenceIds: [...operationsSummary.evidenceIds],
  };
}

export function generateCompanyExecutiveContextSnapshot(
  companyBusinessStateId: string,
  areaSummaries: readonly CompanyAreaSummary[],
  timestamp: string,
): CompanyExecutiveContextSnapshot {
  const affectedAreas = areaSummaries.filter(isAreaAffected).map((a) => a.key);
  const insufficientEvidenceAreas = areaSummaries.filter((a) => a.evaluationStatus === "unzureichende-evidenz").map((a) => a.key);
  const topSituations = generateTopSituations(areaSummaries);

  const operationsSummary = areaSummaries.find((a) => a.key === "operations");
  const salesToOperationsLink = operationsSummary ? generateSalesToOperationsLink(operationsSummary) : undefined;
  const crossAreaLinks = salesToOperationsLink ? [salesToOperationsLink] : [];

  return {
    id: companyExecutiveContextId(companyBusinessStateId, timestamp),
    timestamp,
    companyBusinessStateId,
    affectedAreas,
    areaSummaries: [...areaSummaries],
    topSituations,
    crossAreaLinks,
    insufficientEvidenceAreas,
  };
}
