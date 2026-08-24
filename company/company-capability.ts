import type { CompanyAreaKey, CompanyAreaSummary, CompanyAreaObservationSummary } from "./company-area";
import type { CompanyExecutiveContextSnapshot } from "./company-executive-context";

// Company Capability + Executive Decision View V1 (Auftrag "Company Capability
// Evidence Audit + Executive Decision View V1", CEO-Freigabe D054) — rein
// deskriptive Projektion bereits bestehender Domain-States auf einen
// gemeinsamen, dreiwertigen Capability-Status. Berechnet KEINE neue
// Bewertung: jede Einstufung ist eine reine Tabellen-Abbildung eines bereits
// an anderer Stelle erzeugten `CompanyAreaSummary.state`/`evaluationStatus`
// (company-area-summaries.ts) — keine neue Schwelle, kein neuer Zufallsstrom,
// kein Gesamtscore.
//
// --- Phase 3: Capability-Mapping-Tabelle (exhaustiv) --------------------------
//
// Grundregel:
// - evaluationStatus === "unzureichende-evidenz" (state === null, strukturell
//   nur Operations, sowie Marketing solange kein Regime-Signal aktiv ist) →
//   "insufficient-evidence".
// - evaluationStatus === "bewertet" UND state ist einer der bereits an
//   anderer Stelle als "positiv"/neutral eingestuften Werte → "demonstrated".
// - evaluationStatus === "bewertet" UND state ist ein beliebiger anderer,
//   nicht-neutraler Wert → "attention-required".
//
// DEMONSTRATED_STATES = POSITIVE_STATES (company-business-state.ts:
// "ausgeglichen" [Sales UND People, identischer Wortlaut], "strategischer-
// freiraum" [Sales]) VEREINIGT MIT Marketings eigenem Neutralwert
// "stabile-nachfrage" (company-executive-context.ts, NEUTRAL_STATES) — beide
// bereits bestehende, hier nur wiederverwendete Konstanten, keine neue
// Zuordnung erfunden.
//
// ATTENTION_STATES = alle übrigen, aktuell im Repository definierten,
// nicht-null State-Werte: BELASTET_STATES (company-business-state.ts:
// "verlangsamte-pipeline", "operative-anspannung", "konzentrierte-last"
// [Sales], "letzte-person-verbleibt", "rolle-unbesetzt" [People]) sowie
// Sales' strukturell heute unerreichbarer "wachstum-ueber-kapazitaet" und
// Marketings beide Abweichungs-Zustände "erhoehte-nachfrage"/
// "unterdrueckte-nachfrage" (bewusst NICHT in POSITIVE_STATES/
// BELASTET_STATES eingetragen, weil eine Abweichung nicht per se gut oder
// belastend ist — hier dennoch als "attention-required" eingestuft, weil sie
// eine bestätigte, evidenzbelegte Abweichung vom Referenzniveau darstellt,
// die eine Führungskraft plausibel prüfen möchte; keine Aussage darüber, ob
// die Abweichung positiv oder negativ ist).
//
// Diese beiden Mengen sind exhaustiv über alle heute im Repository
// existierenden State-Strings (Sales: 6, People: 3, Marketing: 3 — siehe
// business-state/business-state.ts, business-state/people-business-state.ts,
// observations/marketing-observations.ts). Operations hat strukturell nie
// einen State (Domain Decision 3) und erscheint hier nicht.
const DEMONSTRATED_STATES = new Set<string>([
  "ausgeglichen",
  "strategischer-freiraum",
  "stabile-nachfrage",
]);

const ATTENTION_STATES = new Set<string>([
  "verlangsamte-pipeline",
  "operative-anspannung",
  "konzentrierte-last",
  "wachstum-ueber-kapazitaet",
  "letzte-person-verbleibt",
  "rolle-unbesetzt",
  "erhoehte-nachfrage",
  "unterdrueckte-nachfrage",
]);

export type CapabilityStatus = "demonstrated" | "attention-required" | "insufficient-evidence";

// Reine Tabellen-Abbildung — kein Zweig berechnet einen neuen Wert, jeder
// Zweig liest ausschließlich bereits vorhandene Felder von `area`.
function toCapabilityStatus(area: CompanyAreaSummary): CapabilityStatus {
  if (area.evaluationStatus === "unzureichende-evidenz" || area.state === null) {
    return "insufficient-evidence";
  }
  if (DEMONSTRATED_STATES.has(area.state)) {
    return "demonstrated";
  }
  // Exhaustivität wird in validation/company-capability.test.ts geprüft (Test
  // "keine numerische/undokumentierte State-Kategorie") — ein State, der in
  // keiner der beiden Mengen steht, fällt hier bewusst auf "attention-
  // required" statt eine dritte, unausgesprochene Kategorie zu erzeugen.
  return "attention-required";
}

export interface AreaCapability {
  area: CompanyAreaKey;
  status: CapabilityStatus;
  // Unverändert aus CompanyAreaSummary übernommen — keine Neuformulierung,
  // keine neue Textgenerierung.
  statement: string | null;
  evaluationStatus: "bewertet" | "unzureichende-evidenz";
  evidenceIds: string[];
}

function toAreaCapability(area: CompanyAreaSummary): AreaCapability {
  return {
    area: area.key,
    status: toCapabilityStatus(area),
    statement: area.statement,
    evaluationStatus: area.evaluationStatus,
    evidenceIds: [...area.evidenceIds],
  };
}

// --- Phase 4/5: Executive Decision Points — Evidence Gate (Ergebnis) --------
//
// Einzige implementierte, vollständig belegte Auslöseregel: eine Area mit
// evaluationStatus="bewertet" UND Capability-Status "attention-required"
// erzeugt GENAU EINEN Entscheidungspunkt. Dieser ist die einzige Kombination,
// die einen doppelten Nachweis besitzt (1. ein bereits bestehender,
// kalibrierter State-Übergang — keine Rohzahl — UND 2. mindestens ein
// bestätigter State-String außerhalb der Neutral-/Positiv-Menge). Jede
// andere denkbare Auslöserquelle wurde geprüft und bewusst NICHT
// implementiert:
//
// - "unzureichende Evidenz" (Operations, ggf. Marketing vor Kalibrierung) als
//   Auslöser: AUSGESCHLOSSEN — Hard Stop, das würde fehlende Evidenz als
//   Problem umdeuten. Operations erreicht strukturell nie evaluationStatus=
//   "bewertet" (Domain Decision 3) und erzeugt deshalb nie einen
//   Entscheidungspunkt — kein Sonderfall im Code nötig, folgt bereits aus der
//   obigen Regel.
// - Unternehmensweite "department-divergenz" (company-business-state.ts) als
//   eigener, bereichsübergreifender Entscheidungspunkt: AUSGESCHLOSSEN für
//   V1 — hätte keinen einzelnen `CompanyAreaKey` als Träger und würde die
//   bestehende, bewusst schmale Area-Vokabular erweitern. Die divergente
//   (belastete) Area erzeugt bereits eigenständig ihren eigenen
//   Entscheidungspunkt über die Grundregel oben — keine Information geht
//   verloren, nur keine zusätzliche, eigene Struktur dafür.
// - Rohzahlen ohne State (z. B. einzelne Workspace-Kennzahlen aus
//   Marketing-/Sales-/Operations-/People-Workspace-Daten): AUSGESCHLOSSEN —
//   Hard Stop, Entscheidungspunkte ausschließlich aus bereits bewerteten
//   States.
// - Individuelle Personalentscheidungen (z. B. konkrete Employee-IDs):
//   AUSGESCHLOSSEN — Hard Stop, Area-Ebene bleibt verbindlich.
//
// Urgency-Herleitung: ausschließlich aus der bereits vorhandenen severity der
// unterstützenden Observations (Observation.severity, "niedrig"/"mittel"/
// "hoch") — die schwerste vorhandene severity gewinnt (dasselbe Prinzip wie
// bereits in business-state.ts/people-business-state.ts, "schwereres Signal
// gewinnt", hier nur auf severity statt auf Observation-kind angewendet).
// Marketing-Observations tragen strukturell KEINE severity (bewusste
// Auslassung, siehe observations/marketing-observations.ts) — für Marketing-
// Entscheidungspunkte (und jeden anderen Fall ohne vorhandene severity) ist
// "monitor" der einzig ehrliche Default: das Fehlen einer severity ist kein
// Beleg für "now"/"soon", also wird der am wenigsten dringliche, keine neue
// Dringlichkeit behauptende Wert verwendet. Keine numerische Formel.
export type ExecutiveDecisionUrgency = "now" | "soon" | "monitor";

const SEVERITY_RANK: Record<string, number> = { hoch: 3, mittel: 2, niedrig: 1 };

function deriveUrgency(topObservations: readonly CompanyAreaObservationSummary[]): ExecutiveDecisionUrgency {
  let worst: string | undefined;
  for (const o of topObservations) {
    if (o.severity === undefined) continue;
    if (worst === undefined || (SEVERITY_RANK[o.severity] ?? 0) > (SEVERITY_RANK[worst] ?? 0)) {
      worst = o.severity;
    }
  }
  if (worst === "hoch") return "now";
  if (worst === "mittel") return "soon";
  return "monitor";
}

export interface ExecutiveDecisionPoint {
  id: string;
  area: CompanyAreaKey;
  title: string;
  question: string;
  reason: string;
  urgency: ExecutiveDecisionUrgency;
  evidenceIds: string[];
  generatedAt: string;
  asOf: string;
  decisionStatus: "open";
}

// Feste, sachliche Frageformulierungen je Bereich — exakt demselben Muster
// wie die im Auftrag erlaubten Beispiele ("Muss die Vertriebsführung die
// aktuelle Entwicklung prüfen?"). Reine Fragen zur Prüfung, keine
// automatisch getroffene Entscheidung, keine konkrete Handlungsanweisung.
const DECISION_TEXT: Record<CompanyAreaKey, { title: string; question: string }> = {
  sales: { title: "Vertriebsentwicklung prüfen", question: "Muss die Vertriebsführung die aktuelle Entwicklung prüfen?" },
  marketing: {
    title: "Marketingnachfrage prüfen",
    question: "Muss die Marketingführung die aktuelle Nachfrageentwicklung prüfen?",
  },
  people: {
    title: "Teamkontinuität prüfen",
    question: "Muss die Unternehmensführung die aktuelle Teamsituation prüfen?",
  },
  // Strukturell unerreichbar (Operations erreicht evaluationStatus="bewertet"
  // nie, Domain Decision 3) — hier nur der Vollständigkeit halber definiert,
  // damit DECISION_TEXT über CompanyAreaKey exhaustiv bleibt.
  operations: { title: "Operations-Entwicklung prüfen", question: "Muss die Operations-Führung die aktuelle Entwicklung prüfen?" },
};

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
function decisionPointId(area: CompanyAreaKey, state: string, asOf: string): string {
  const fingerprint = `${area}|${state}|${asOf}`;
  return `decision-${String(hashString(fingerprint) % 100000).padStart(5, "0")}`;
}

function toDecisionPoint(area: CompanyAreaSummary, asOf: string): ExecutiveDecisionPoint | undefined {
  if (area.evaluationStatus !== "bewertet" || area.state === null) return undefined;
  if (toCapabilityStatus(area) !== "attention-required") return undefined;

  const text = DECISION_TEXT[area.key];
  return {
    id: decisionPointId(area.key, area.state, asOf),
    area: area.key,
    title: text.title,
    question: text.question,
    reason: area.statement ?? text.title,
    urgency: deriveUrgency(area.topObservations),
    evidenceIds: [...area.evidenceIds],
    generatedAt: asOf,
    asOf,
    decisionStatus: "open",
  };
}

// --- Phase 6: Executive Summary — regelbasiert, deterministisch ------------
//
// Kein freier Fließtext, keine KI-Textgenerierung: jedes Feld ist entweder
// eine feste Vorlage über bereits vorhandene Werte (knownFacts) oder eine
// direkte Weiterreichung bereits vorhandener Area-Key-Listen/Zählungen.
export interface ExecutiveSummary {
  knownFacts: string[];
  attentionAreas: CompanyAreaKey[];
  insufficientEvidenceAreas: CompanyAreaKey[];
  openDecisionPoints: number;
}

const AREA_DISPLAY_NAME: Record<CompanyAreaKey, string> = {
  sales: "Sales",
  marketing: "Marketing",
  people: "People",
  operations: "Operations",
};

function formatEvidenceCount(count: number): string {
  return count === 1 ? "1 Evidenzquelle" : `${count} Evidenzquellen`;
}

function buildKnownFact(capability: AreaCapability): string {
  const name = AREA_DISPLAY_NAME[capability.area];
  const evidence = formatEvidenceCount(capability.evidenceIds.length);
  if (capability.status === "insufficient-evidence") {
    return `${name}: unzureichende Evidenz (${evidence}).`;
  }
  if (capability.status === "attention-required") {
    return `${name}: Handlungsbedarf, belegt durch ${evidence}.`;
  }
  return `${name}: belegte Fähigkeit, belegt durch ${evidence}.`;
}

// Feste Reihenfolge (dieselbe wie AREA_PRIORITY_ORDER in
// company-executive-context.ts) — stabile Sortierung, unabhängig von der
// Eingabereihenfolge von areaSummaries.
const AREA_ORDER: readonly CompanyAreaKey[] = ["sales", "marketing", "people", "operations"];

export interface CompanyCapabilitySnapshot {
  asOf: string;
  capabilities: AreaCapability[];
  decisionPoints: ExecutiveDecisionPoint[];
  summary: ExecutiveSummary;
}

// Einzige Orchestrierungsstelle: liest ausschließlich bereits vorhandene
// Felder aus `executiveContext.areaSummaries` (company-executive-context.ts)
// — keine zweite Weltgenerierung, kein zusätzlicher RNG-Aufruf, kein neuer
// Snapshot-Zugriff.
export function generateCompanyCapabilitySnapshot(
  executiveContext: CompanyExecutiveContextSnapshot,
): CompanyCapabilitySnapshot {
  const asOf = executiveContext.timestamp;
  const byKey = new Map(executiveContext.areaSummaries.map((a) => [a.key, a]));

  const capabilities: AreaCapability[] = AREA_ORDER.filter((key) => byKey.has(key)).map((key) =>
    toAreaCapability(byKey.get(key)!),
  );

  const decisionPoints: ExecutiveDecisionPoint[] = AREA_ORDER.filter((key) => byKey.has(key))
    .map((key) => toDecisionPoint(byKey.get(key)!, asOf))
    .filter((d): d is ExecutiveDecisionPoint => d !== undefined);

  const summary: ExecutiveSummary = {
    knownFacts: capabilities.map(buildKnownFact),
    attentionAreas: capabilities.filter((c) => c.status === "attention-required").map((c) => c.area),
    insufficientEvidenceAreas: capabilities.filter((c) => c.status === "insufficient-evidence").map((c) => c.area),
    openDecisionPoints: decisionPoints.length,
  };

  return { asOf, capabilities, decisionPoints, summary };
}
