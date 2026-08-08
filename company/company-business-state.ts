import type { CompanyAreaKey, CompanyAreaSummary } from "./company-area";

// Company Aggregation Foundation, Phase 7: verbindlicher, bewusst auf zwei Werte
// beschränkter Typ. KEINE weiteren Kategorien (kein "kritisch", "angespannt",
// "unbekannt", "unzureichend", "belastet", "gesund") — Company-Level verdichtet nur,
// was in den bewerteten Areas bereits belegt ist, und die einzige belegbare
// Unterscheidung ist heute: widerspruchsfrei vs. widersprüchlich zwischen den
// bewerteten Areas (Phase 10). Operations trägt strukturell nie zu dieser
// Unterscheidung bei (kein Business State, Domain Decision 3).
export type CompanyBusinessStateType = "ausgeglichen" | "department-divergenz";

export interface CompanyBusinessStateSnapshot {
  id: string;
  timestamp: string;
  type: CompanyBusinessStateType;
  statement: string;
  evaluatedAreas: CompanyAreaKey[];
  insufficientEvidenceAreas: CompanyAreaKey[];
  supportingEvidenceIds: string[];
}

// Phase 9 — redaktionelle, explizite Klassifikation bestehender State-Werte in
// "positiv/nicht belastet" vs. "belastet". KEINE Score-Logik, KEINE numerischen
// Gewichte — eine reine, handgepflegte Zuordnungstabelle, exakt dieselbe Methode
// wie GROUND_TRUTH_PRIORITIES/OBSERVATION_GROUP_LABELS in ground-truth.ts.
// "wachstum-ueber-kapazitaet" (Sales) bewusst NICHT aufgenommen: strukturell heute
// unerreichbar (siehe business-state.ts) — würde hier nie zutreffen und darf nicht
// für Testdaten künstlich erzwungen werden. Ein State ohne Eintrag in einer der
// beiden Mengen trägt nicht zur Divergenzprüfung bei (weder positiv noch belastet),
// statt eine Annahme zu erzwingen.
type AreaLoadClassification = "positiv" | "belastet";

const POSITIVE_STATES = new Set<string>([
  "ausgeglichen", // Sales UND People — identischer Wortlaut, identische Bedeutung in beiden Domänen
  "strategischer-freiraum", // Sales
]);

const BELASTET_STATES = new Set<string>([
  "verlangsamte-pipeline", // Sales
  "operative-anspannung", // Sales
  "konzentrierte-last", // Sales
  "letzte-person-verbleibt", // People
  "rolle-unbesetzt", // People
]);

function classifyAreaLoad(state: string): AreaLoadClassification | undefined {
  if (POSITIVE_STATES.has(state)) return "positiv";
  if (BELASTET_STATES.has(state)) return "belastet";
  return undefined;
}

// Phase 11 — Statement-Text semantisch geprüft und absichtlich exakt so formuliert:
// KEINE Aussage über das gesamte Unternehmen, ausschließlich eine Aussage über die
// bewerteten Areas plus eine explizite Nennung der Evidenzgrenze bei Operations.
// Das ist keine Operations-Bewertung, sondern eine Aussage über die Grenze
// vorhandener Evidenz — der Typname "ausgeglichen" bleibt tragfähig, weil die
// tatsächliche Bedeutung im Statement steht, nicht im Typnamen allein (derselbe
// bereits etablierte Grundsatz wie bei Sales' eigenem "ausgeglichen": auch dort
// bedeutet der Name nie "das gesamte Unternehmen ist gesund", sondern "kein
// dominanter Druck innerhalb der bewerteten Evidenz dieser Domäne").
const AUSGEGLICHEN_STATEMENT =
  "Die bewerteten Bereiche zeigen keinen widersprüchlichen Zustand; für Operations liegt noch keine kalibrierte " +
  "Bewertung vor.";

const DEPARTMENT_DIVERGENZ_STATEMENT =
  "Die bewerteten Bereiche zeigen gleichzeitig einen positiven und einen belasteten Zustand.";

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
function companyBusinessStateId(timestamp: string, type: CompanyBusinessStateType, evaluatedAreas: readonly CompanyAreaKey[]): string {
  const fingerprint = `${timestamp}|${type}|${[...evaluatedAreas].sort().join(",")}`;
  return `cbstate-${String(hashString(fingerprint) % 100000).padStart(5, "0")}`;
}

// Phase 8/10: bewertete und unbewertete Areas werden zuerst explizit getrennt.
// Operations (evaluationStatus "unzureichende-evidenz") nimmt an der
// Divergenzklassifikation strukturell nicht teil — sie wird aus `evaluated`
// herausgefiltert, bevor überhaupt eine Klassifikation stattfindet, nicht erst
// nachträglich ignoriert. department-divergenz entsteht ausschließlich, wenn unter
// den BEWERTETEN Areas gleichzeitig mindestens eine "positiv" und eine ANDERE
// "belastet" ist — keine Zahlenschwelle, keine Operations-Beteiligung.
export function generateCompanyBusinessStateSnapshot(
  areaSummaries: readonly CompanyAreaSummary[],
  timestamp: string,
): CompanyBusinessStateSnapshot {
  const evaluated = areaSummaries.filter((a) => a.evaluationStatus === "bewertet");
  const insufficientEvidence = areaSummaries.filter((a) => a.evaluationStatus === "unzureichende-evidenz");

  const classified = evaluated
    .map((a) => ({ key: a.key, classification: a.state !== null ? classifyAreaLoad(a.state) : undefined, area: a }))
    .filter(
      (c): c is { key: CompanyAreaKey; classification: AreaLoadClassification; area: CompanyAreaSummary } =>
        c.classification !== undefined,
    );

  const positive = classified.filter((c) => c.classification === "positiv");
  const belastet = classified.filter((c) => c.classification === "belastet");
  const isDivergent = positive.length > 0 && belastet.length > 0;

  const type: CompanyBusinessStateType = isDivergent ? "department-divergenz" : "ausgeglichen";
  const statement = isDivergent ? DEPARTMENT_DIVERGENZ_STATEMENT : AUSGEGLICHEN_STATEMENT;

  const evaluatedAreas = evaluated.map((a) => a.key);
  const insufficientEvidenceAreas = insufficientEvidence.map((a) => a.key);

  // supportingEvidenceIds referenziert ausschließlich bereits vorhandene IDs aus den
  // Area Summaries — bei department-divergenz die Evidence der divergenten Areas
  // (das belegt konkret WORIN die Divergenz besteht), bei ausgeglichen die Evidence
  // aller bewerteten Areas (das belegt den geprüften, widerspruchsfreien Zustand).
  const relevantAreaKeys = isDivergent ? [...positive, ...belastet].map((c) => c.key) : evaluatedAreas;
  const supportingEvidenceIds = areaSummaries
    .filter((a) => relevantAreaKeys.includes(a.key))
    .flatMap((a) => a.evidenceIds);

  return {
    id: companyBusinessStateId(timestamp, type, evaluatedAreas),
    timestamp,
    type,
    statement,
    evaluatedAreas,
    insufficientEvidenceAreas,
    supportingEvidenceIds,
  };
}
