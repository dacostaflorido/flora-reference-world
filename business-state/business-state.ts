import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";
import type { Observation } from "../observations/observations";

// Business State verdichtet Ground Truth zu einer verständlichen Gesamtlage. Er
// beantwortet ausschließlich "wie ist die Lage insgesamt zu verstehen?" — nie "was
// soll getan werden?". Rein deskriptiv, niemals normativ (siehe PRINCIPLES.md,
// Prinzip 19).
//
// Scenario-Blindheit ist hier durch den Typ selbst erzwungen, nicht nur durch
// Disziplin: generateBusinessStateSnapshot() nimmt ausschließlich GroundTruthSnapshot
// und Observation[] entgegen — ScenarioProfile taucht in der Signatur nicht auf und
// kann daher nicht versehentlich gelesen werden. Business State entsteht aus der
// erzeugten Realität, nie aus dem Namen des Szenarios, das sie erzeugt hat.
//
// Keine Rohdatenanalyse: es werden ausschließlich bereits bestätigte
// Observation-Felder gelesen (kind, category, severity) — keine Leads/Opportunities/
// Calls/Emails/KnowledgeObjects erneut ausgewertet. Business State ist keine zweite
// Analyse-Engine.
export type BusinessStateType =
  | "ausgeglichen"
  | "operative-anspannung"
  | "wachstum-ueber-kapazitaet"
  | "konzentrierte-last"
  | "verlangsamte-pipeline"
  | "strategischer-freiraum";

export interface BusinessStateSnapshot {
  id: string;
  timestamp: string;
  groundTruthSnapshotId: string;
  type: BusinessStateType;
  statement: string;
  supportingObservationIds: string[];
}

// id ist — wie bei GroundTruthSnapshot — eine reine Funktion des Inhalts, kein
// modulweiter Zähler (siehe ground-truth.ts für die ausführliche Begründung: ein
// Zähler wäre aufrufreihenfolge-abhängig, sobald diese Funktion mehrfach pro Prozess
// läuft, was bei sechs Scenario-Welten der Regelfall ist).
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
function businessStateId(groundTruthSnapshotId: string, type: BusinessStateType, timestamp: string): string {
  const fingerprint = `${groundTruthSnapshotId}|${type}|${timestamp}`;
  return `bstate-${String(hashString(fingerprint) % 100000).padStart(5, "0")}`;
}

// Redaktionelle Klassifikationsmethode — keine Rule Engine, keine DSL, keine
// konfigurierbare Decision Table. Ein einziger, explizit begründeter Entscheidungsbaum
// über eine kleine Zahl handverlesener, stabiler Signale. Geschlüsselt ausschließlich
// über Observation.kind und Observation.category/severity — niemals über
// Observation.id (siehe PRINCIPLES.md, Lehre aus dem Ground-Truth-Bug).
//
// Diese Fassung wurde erweitert, nachdem die Observation-Ebene (Schritt "Observation-
// Ebene vervollständigen") mehrere zuvor fest kodierte Kinds durch echte, dynamisch
// berechnete severity/category ersetzt und fünf neue Kinds ergänzt hat. Jedes neu
// verwendete Signal wurde vor Aufnahme gegen alle sechs Scenario-Welten geprüft (siehe
// Kommentare an den jeweiligen Stellen) — kein Signal wurde aufgenommen, ohne dass
// seine eigene, bereits bestehende Berechnung tatsächlich unterscheidet.
//
// 1) pipeline-stagnation-summary.severity — wie bisher das primäre Pipeline-
//    Bewegungssignal; pipeline-synthesis.category bestätigt dieselbe Tatsache aus
//    einer zweiten, unabhängig referenzierbaren Observation.
//
// 2) Anzahl category==="chance"-Observations — wie bisher.
//
// 3) ae-workload-distribution.severity === "hoch" — NEU. Seit der Observation-
//    Korrektur berechnet dieser Kind eine echte, szenarioabhängige Konzentration
//    (Anteil der am stärksten belasteten Person am gesamten aktiven Opportunity-
//    Volumen, relativ zu einem rechnerisch fairen Anteil). "hoch" ist die höchste,
//    von der Observation selbst bereits definierte Stufe — hier wird kein neuer,
//    Business-State-eigener Schwellenwert eingeführt, nur die bereits bestehende
//    Einstufung gelesen. In den sechs bekannten Welten erreicht ausschließlich
//    team-engpass diese Stufe (Lukas Hansen, 29 % der aktiven Pipeline gegenüber
//    einem fairen Anteil von 11 %) — kein Ergebnis wurde auf dieses Resultat hin
//    zurückgerechnet, die Stufe war bereits vor dieser Erweiterung so definiert.
//
// 4) Kombination unabhängiger operativer Signale — NEU, und zwar bewusst NICHT als
//    einzelne zusätzliche Observation, sondern als Konvergenzprüfung über bereits
//    vorhandene, voneinander unabhängige Kinds: sales-cycle-duration.severity==="hoch"
//    (Achtung: "mittel" ist bei diesem Kind in fünf von sechs Welten der Normalfall,
//    siehe unten — nur "hoch" ist ein echtes Abweichungssignal), team-win-rate-
//    parity.category==="team-hinweis" und follow-up-consistency-across-sdrs.
//    category==="team-hinweis" (beide zeigen "stabil", solange keine echte Divergenz
//    vorliegt, siehe Observation-Korrektur). Geprüft gegen alle sechs Welten: nur
//    pipeline-risiko zeigt gleichzeitig mehrere dieser Signale (Stagnation UND
//    Sales-Cycle UND Team-Win-Rate-Spanne) — dort wird die Aussage dadurch breiter
//    fachlich getragen als durch Stagnation allein und wird deshalb als
//    "operative-anspannung" statt des engeren "verlangsamte-pipeline" beschrieben.
//    operativer-fokus zeigt weiterhin ausschließlich das Stagnationssignal und bleibt
//    bei "verlangsamte-pipeline" — die Unterscheidung entsteht ausschließlich aus der
//    tatsächlichen Anzahl unabhängig bestätigter Signale, nicht aus einer neuen
//    Schwelle auf einem einzelnen Wert.
//
// Weiterhin NICHT verwendet, mit Begründung: stagnation-concentration-by-ae ist zwar
// jetzt dynamisch, misst aber Stagnations-Konzentration (welche AEs stagnierende Deals
// tragen), nicht Gesamtlast-Konzentration — inhaltlich näher an
// pipeline-stagnation-summary als an einem eigenständigen Lastsignal, und in keiner
// der sechs Welten zusätzlich unterscheidend gegenüber den bereits verwendeten
// Signalen. lead-volume-trend bleibt bewusst ungenutzt: es misst Beschleunigung
// (jüngste 90 Tage vs. davor), nicht Niveau, und zeigt in allen sechs Welten
// "niedrig" — auch in wachstumsdruck (nur 5 % Zuwachs trotz 45 % höherem
// Gesamtvolumen über die gesamte Historie). "wachstum-ueber-kapazitaet" bleibt
// deshalb bewusst unerreichbar — siehe Abschlussbericht. Kein Ersatzsignal wurde
// eingeführt; das zu tun wäre genau die Art künstlicher Schwelle, die vermieden
// werden soll.
const BASELINE_CHANCE_OBSERVATION_COUNT = 3;
const ELEVATED_CHANCE_THRESHOLD = BASELINE_CHANCE_OBSERVATION_COUNT * 2;

export function generateBusinessStateSnapshot(
  groundTruth: GroundTruthSnapshot,
  allObservations: readonly Observation[],
): BusinessStateSnapshot {
  const activeIds = new Set(groundTruth.activeObservationIds);
  const observations = allObservations.filter((o) => activeIds.has(o.id));

  const stagnationSummary = observations.find((o) => o.kind === "pipeline-stagnation-summary");
  const synthesis = observations.find((o) => o.kind === "pipeline-synthesis");
  const chanceObservations = observations.filter((o) => o.category === "chance");
  const aeWorkload = observations.find((o) => o.kind === "ae-workload-distribution");
  const salesCycle = observations.find((o) => o.kind === "sales-cycle-duration");
  const teamWinRate = observations.find((o) => o.kind === "team-win-rate-parity");
  const followUpConsistency = observations.find((o) => o.kind === "follow-up-consistency-across-sdrs");

  let type: BusinessStateType;
  let statement: string;
  let supportingObservationIds: string[];

  if (stagnationSummary && (stagnationSummary.severity === "mittel" || stagnationSummary.severity === "hoch")) {
    const additionalSignals: Observation[] = [];
    if (salesCycle && salesCycle.severity === "hoch") additionalSignals.push(salesCycle);
    if (teamWinRate && teamWinRate.category === "team-hinweis") additionalSignals.push(teamWinRate);
    if (followUpConsistency && followUpConsistency.category === "team-hinweis") additionalSignals.push(followUpConsistency);

    supportingObservationIds = [stagnationSummary.id];
    if (synthesis) supportingObservationIds.push(synthesis.id);
    const biggestStagnant = observations.find((o) => o.kind === "biggest-stagnant-opportunity");
    if (biggestStagnant) supportingObservationIds.push(biggestStagnant.id);

    if (additionalSignals.length > 0) {
      // Mehrere unabhängig bestätigte operative Signale zusammen — nicht nur die
      // Pipeline-Bewegung allein, sondern auch Abschlussgeschwindigkeit und/oder
      // Team-Performance weichen erkennbar vom Normalzustand ab.
      type = "operative-anspannung";
      statement = "Die operative Belastung zeigt sich über mehrere unabhängige Signale hinweg, nicht nur in der Pipeline-Bewegung.";
      supportingObservationIds.push(...additionalSignals.map((o) => o.id));
    } else {
      type = "verlangsamte-pipeline";
      statement = "Die Pipeline bewegt sich langsamer als im Normalzustand.";
    }
  } else if (aeWorkload && aeWorkload.severity === "hoch") {
    type = "konzentrierte-last";
    statement = "Die operative Belastung konzentriert sich auf einzelne Mitarbeitende.";
    supportingObservationIds = [aeWorkload.id];
  } else if (chanceObservations.length >= ELEVATED_CHANCE_THRESHOLD) {
    type = "strategischer-freiraum";
    statement =
      "Es besteht aktuell kein dominanter operativer Druck; die Geschäftslage zeigt überdurchschnittlich viele " +
      "bestätigte positive Signale.";
    supportingObservationIds = chanceObservations.map((o) => o.id);
  } else {
    type = "ausgeglichen";
    statement = "Es besteht aktuell kein dominanter operativer Druck.";
    supportingObservationIds = [];
    if (stagnationSummary) supportingObservationIds.push(stagnationSummary.id);
    if (synthesis) supportingObservationIds.push(synthesis.id);
    if (supportingObservationIds.length === 0) {
      // Randfall (keine offenen Opportunities zu diesem Snapshot): pipeline-
      // stagnation-summary/-synthesis existieren dann nicht. supportingObservationIds
      // darf nie leer sein — Team-Win-Rate-Parität ist die nächstbeste, tatsächlich
      // zur "keine dominante Lage"-Aussage beitragende, real vorhandene Evidenz.
      if (teamWinRate) supportingObservationIds.push(teamWinRate.id);
    }
  }

  return {
    id: businessStateId(groundTruth.id, type, groundTruth.timestamp),
    timestamp: groundTruth.timestamp,
    groundTruthSnapshotId: groundTruth.id,
    type,
    statement,
    supportingObservationIds,
  };
}
