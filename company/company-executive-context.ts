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
// "ist problematisch". Für Areas mit echtem State (Sales/People): ein bewerteter
// State, der vom neutralen Ausgangszustand "ausgeglichen" abweicht (identischer
// Wortlaut, identische Bedeutung in beiden Domänen) — "ausgeglichen" selbst zählt
// bewusst nicht als affected, sonst wäre Sales strukturell immer affected (Sales'
// eigenes "ausgeglichen" zitiert bereits heute Evidence als Beruhigungsbeleg, siehe
// business-state.ts). Für Areas ohne State (state === null): eine aktive
// Observation existiert (evidenceIds nicht leer) — das ist ausdrücklich erlaubt,
// obwohl evaluationStatus === "unzureichende-evidenz" (Phase 14, letzter Absatz).
//
// Marketing as First-Class Company Area: ursprünglich `area.key === "operations"`
// als Sonderfall geprüft — mit Marketing als zweiter state===null-Area wäre ein
// weiterer hartkodierter `|| area.key === "marketing"`-Zweig genau die Art
// Sonderbehandlung, die eine generische Area-Architektur vermeiden soll. Die
// Bedingung ist stattdessen strukturell auf `area.state === null` umgestellt —
// verhält sich für Operations identisch (Operations hat state stets null), deckt
// Marketing korrekt mit ab, und bleibt für jede künftige state-lose Area ohne
// weitere Änderung gültig.
//
// Marketing Leadership State: Marketings neutraler State heißt bewusst
// "stabile-nachfrage", NICHT "ausgeglichen" — eine reine String-Wiederverwendung
// hätte Marketing versehentlich auch in company-business-state.ts' POSITIVE_STATES
// gezogen (dort ist "ausgeglichen" bereits als gemeinsamer, geteilter String für
// Sales/People eingetragen) und damit an der Company-weiten Divergenzprüfung
// teilnehmen lassen — genau das, was marketing-business-state.ts bewusst
// vermeidet (mehr/weniger Nachfrage ist nicht per se positiv oder belastend).
// NEUTRAL_STATES ist deshalb eine eigene, explizite Zuordnungstabelle (dieselbe
// Methode wie POSITIVE_STATES/BELASTET_STATES) statt eines einzelnen
// String-Vergleichs — "betroffen" bedeutet für Marketing weiterhin "es gibt eine
// bestätigte Abweichung vom Referenzniveau", nicht "es gibt irgendeinen State".
const NEUTRAL_STATES = new Set<string>(["ausgeglichen", "stabile-nachfrage"]);

function isAreaAffected(area: CompanyAreaSummary): boolean {
  if (area.state === null) {
    return area.evidenceIds.length > 0;
  }
  return !NEUTRAL_STATES.has(area.state);
}

// Phase 15 — topSituations, maximal 3, deterministische Reihenfolge: bewertete
// Areas zuerst in fester, bestehender Domänen-Reihenfolge (Sales, People — keine
// neue Score-Matrix, keine Sales/People-übergreifende Severity-Rangfolge, da Sales
// keine vergleichbare Area-Severity exponiert), state-lose Areas danach (Marketing,
// Operations). "People: bestehende Severity verwenden, hoch vor mittel" (mehrere
// People-eigene Observations untereinander) tritt im aktuellen Modell nicht auf
// (People trägt heute höchstens eine relevante Situation) — keine zusätzliche
// Sortierlogik nötig, um sie zu erfüllen.
//
// Marketing as First-Class Company Area: die Reihenfolge folgt dem freigegebenen
// Zielbild "Sales · Marketing · People · Operations". Mit inzwischen vier Areas
// (statt vormals drei) kann die Obergrenze von 3 Statements erstmals tatsächlich
// greifen, falls alle vier gleichzeitig ein Statement beitragen — `slice(0, 3)`
// unten verhindert das strukturell, ohne eine neue Priorisierungsentscheidung zu
// treffen.
const AREA_PRIORITY_ORDER: readonly CompanyAreaKey[] = ["sales", "marketing", "people", "operations"];

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
