import { addDays } from "../engine/random";
import { WORLD_TIMELINE_START, WORLD_NOW } from "../timeline/world-clock";

// Marketing Source Coverage V1 (Korrekturauftrag "Marketing Data Completeness
// Truth + Public Contract Protection") — eigener, kanonischer Source-Fakt
// darüber, WIE VOLLSTÄNDIG jeder der drei Marketing-Rohdatenströme zu einem
// gegebenen Zeitpunkt tatsächlich verarbeitet ist. Löst den ursprünglichen
// Fehler des Vorauftrags: ein fehlender Spend-/Lead-/CRM-Record wurde bisher
// implizit als "0" interpretiert — das ist unbewiesen. Ein fehlender Record
// kann ebenso gut bedeuten: noch nicht importiert, verspätet, fehlgeschlagen,
// oder der Zeitraum ist schlicht noch nicht vollständig synchronisiert.
// Coverage macht diese Unterscheidung selbst zu einem Fakt, statt sie aus der
// bloßen Abwesenheit von Records zu erraten.
//
// Bewusst NICHT über snapshot/snapshot.ts (WorldSnapshot) geführt: WorldSnapshot
// ist über index.ts Teil des Public Contracts (siehe K1-Forensik im
// Abschlussbericht) — jedes neue Pflichtfeld dort wäre eine nicht genehmigte
// Contract-Erweiterung. MarketingSourceCoverage bleibt daher ausschließlich
// auf ScenarioWorldTruth-Ebene (engine/generator.ts) verfügbar, exakt wie
// jede andere interne Quellwahrheit, die nicht für externe Consumer bestimmt
// ist.
//
// Korrekturauftrag "Honest Cohort Spend + Maturity + Downstream Coverage"
// (K6): zwei zusätzliche Streams für die Sales-seitigen Domänen, die bislang
// fälschlich implizit durch "crm-lead-ingestion"-Coverage mitvertreten
// wurden — CRM-Lead-Coverage beweist ausschließlich vollständige CRM-Lead-
// Eingänge, NICHT die Vollständigkeit von Appointment- oder Opportunity-
// Daten. Beide neuen Streams sind in dieser Referenzwelt bewusst IMMER
// "complete" über den gesamten Zeitraum: Sales-seitige Daten
// (SalesAppointment/Opportunity) werden hier deterministisch synchron
// generiert, ohne jeden Import-/Sync-Lag-Begriff (world/sales-appointments.ts,
// events/generate-sales-pipeline.ts) — eine erfundene Verzögerung wäre ein
// nicht belegter Fakt (PRINCIPLES.md: "keine Coverage aus bloß vorhandenen
// Records erraten"). Der Wert dieser Erweiterung ist rein ARCHITEKTONISCH:
// sie erzwingt, dass jede Kennzahl ihre TATSÄCHLICH relevante Quelle prüft,
// statt eine fachlich unpassende Quelle (CRM-Lead-Ingestion) als Ersatz zu
// missbrauchen — vorbereitet für eine künftige, ehrliche Modellierung
// echten Sales-Sync-Lags, ohne dass sich an der Architektur etwas ändern
// müsste.
export type MarketingSourceStream =
  | "meta-ad-spend"
  | "meta-lead-generation"
  | "crm-lead-ingestion"
  | "crm-sales-appointment-lifecycle"
  | "crm-opportunity-lifecycle";

export interface MarketingSourceCoverage {
  id: string;
  stream: MarketingSourceStream;
  provider: "meta" | "crm";
  // Der letzte fachliche Kalendertag, dessen Quelle innerhalb dieses Records
  // vollständig verarbeitet wurde (bei status "complete") bzw. dessen
  // Verarbeitung diesen Status trägt (bei "partial"/"failed").
  coveredFrom: string;
  coveredThrough: string;
  // Wann diese Coverage-Information selbst festgestellt wurde (Date-only,
  // wie überall in dieser Referenzwelt) — eigener Zeitanker, getrennt von
  // coveredThrough, damit auch die Coverage-Aussage selbst
  // Future-Knowledge-sicher gefiltert werden kann.
  importedAt: string;
  status: "complete" | "partial" | "failed";
}

// Abgeleiteter Belastbarkeitsstatus EINER konkreten Zeitraumkennzahl (nicht
// zu verwechseln mit MarketingSourceCoverage.status oben, das den Zustand
// EINES Coverage-Fakts beschreibt). "complete": der gesamte abgefragte
// Zeitraum liegt innerhalb einer bestätigten vollständigen Coverage — ein
// gezählter Wert von 0 ist dann eine echte, bewiesene Null. "partial": nur
// ein Teil des Zeitraums ist vollständig abgedeckt — ein beobachteter Wert
// darf intern erhalten bleiben, aber nicht als vollständige Periodensumme
// dargestellt werden. "unavailable": keine belastbare Abdeckung — kein
// künstlicher Zahlenwert, insbesondere keine Null.
export type PeriodDataStatus = "complete" | "partial" | "unavailable";

// Kalibrierung (K7, deterministisch aus WORLD_NOW/WORLD_TIMELINE_START
// abgeleitet — keine hartcodierten Datumswerte): unterschiedliche
// Complete-Lags je Stream, um echte, unabhängige Streams abzubilden (K9,
// "mehrere Streams unabhängig"). Meta Ad Spend hat den größten Lag (externe
// Werbeplattform-Reports treffen typischerweise verzögert ein), CRM-Ingestion
// den kleinsten (eigenes System, nahezu Echtzeit-Sicht).
const META_AD_SPEND_COMPLETE_LAG_DAYS = 3;
const META_LEAD_GENERATION_COMPLETE_LAG_DAYS = 2;
const CRM_LEAD_INGESTION_COMPLETE_LAG_DAYS = 1;

// Ein bewusst eingefügter, isolierter Sync-Fehler mitten in der historischen
// Meta-Ad-Spend-Coverage (K3: "failed" bedeutet keine belastbare
// Periodensumme, unabhängig vom tatsächlichen Spend-Inhalt dieses Tages) —
// realistisch: ein einzelner API-Abruf schlägt fehl, ohne die umgebende
// Coverage zu invalidieren. Fixer Tagesoffset statt Literal-Datum, damit die
// Kalibrierung bei einer künftigen Verschiebung von WORLD_TIMELINE_START
// automatisch mitwandert.
const META_AD_SPEND_FAILED_DAY = addDays(WORLD_TIMELINE_START, 288);

function buildStreamCoverage(
  stream: MarketingSourceStream,
  provider: "meta" | "crm",
  completeLagDays: number,
  idPrefix: string,
): MarketingSourceCoverage[] {
  const completeThrough = addDays(WORLD_NOW, -completeLagDays);
  const partialThrough = addDays(WORLD_NOW, -1);
  const records: MarketingSourceCoverage[] = [];

  if (stream === "meta-ad-spend") {
    // Historie vor dem Fehltag: vollständig verarbeitet.
    records.push({
      id: `${idPrefix}-complete-1`,
      stream,
      provider,
      coveredFrom: WORLD_TIMELINE_START,
      coveredThrough: addDays(META_AD_SPEND_FAILED_DAY, -1),
      importedAt: addDays(META_AD_SPEND_FAILED_DAY, -1),
      status: "complete",
    });
    records.push({
      id: `${idPrefix}-failed`,
      stream,
      provider,
      coveredFrom: META_AD_SPEND_FAILED_DAY,
      coveredThrough: META_AD_SPEND_FAILED_DAY,
      importedAt: META_AD_SPEND_FAILED_DAY,
      status: "failed",
    });
    records.push({
      id: `${idPrefix}-complete-2`,
      stream,
      provider,
      coveredFrom: addDays(META_AD_SPEND_FAILED_DAY, 1),
      coveredThrough: completeThrough,
      importedAt: completeThrough,
      status: "complete",
    });
  } else {
    records.push({
      id: `${idPrefix}-complete`,
      stream,
      provider,
      coveredFrom: WORLD_TIMELINE_START,
      coveredThrough: completeThrough,
      importedAt: completeThrough,
      status: "complete",
    });
  }

  // Teilweise synchronisierter Rand zwischen completeThrough und
  // partialThrough (falls vorhanden — bei CRM-Ingestion mit Lag 1 fallen
  // beide Grenzen zusammen, dort existiert bewusst kein Partial-Fenster).
  if (completeThrough < partialThrough) {
    records.push({
      id: `${idPrefix}-partial`,
      stream,
      provider,
      coveredFrom: addDays(completeThrough, 1),
      coveredThrough: partialThrough,
      importedAt: partialThrough,
      status: "partial",
    });
  }
  // Alles nach partialThrough bis einschließlich WORLD_NOW bleibt bewusst
  // OHNE Coverage-Record — "unavailable" ergibt sich strukturell aus der
  // Abwesenheit eines Records, nicht aus einer erratenen Annahme.

  return records;
}

export function generateMarketingSourceCoverage(): MarketingSourceCoverage[] {
  return [
    ...buildStreamCoverage("meta-ad-spend", "meta", META_AD_SPEND_COMPLETE_LAG_DAYS, "coverage-spend"),
    ...buildStreamCoverage("meta-lead-generation", "meta", META_LEAD_GENERATION_COMPLETE_LAG_DAYS, "coverage-leadgen"),
    ...buildStreamCoverage("crm-lead-ingestion", "crm", CRM_LEAD_INGESTION_COMPLETE_LAG_DAYS, "coverage-crmingest"),
    // K6: eigene, unabhängig prüfbare Coverage-Fakten für die Sales-seitigen
    // Domänen — immer "complete" über die gesamte Timeline (siehe
    // Kopfkommentar für die vollständige Begründung: keine echte
    // Sync-Verzögerung in dieser Referenzwelt, aber architektonisch
    // notwendig, damit crm-lead-ingestion-Coverage nicht implizit als Ersatz
    // für Appointment-/Opportunity-Vollständigkeit missbraucht wird).
    {
      id: "coverage-appointment-lifecycle-complete",
      stream: "crm-sales-appointment-lifecycle",
      provider: "crm",
      coveredFrom: WORLD_TIMELINE_START,
      coveredThrough: WORLD_NOW,
      importedAt: WORLD_NOW,
      status: "complete",
    },
    {
      id: "coverage-opportunity-lifecycle-complete",
      stream: "crm-opportunity-lifecycle",
      provider: "crm",
      coveredFrom: WORLD_TIMELINE_START,
      coveredThrough: WORLD_NOW,
      importedAt: WORLD_NOW,
      status: "complete",
    },
  ];
}

// Kanonische, einzige Auswertungsfunktion: bestimmt den Belastbarkeitsstatus
// eines abgefragten Zeitraums für einen Stream. "complete" ausschließlich,
// wenn der GESAMTE Zeitraum innerhalb eines einzigen, bereits sichtbaren
// "complete"-Coverage-Records liegt. "unavailable", wenn der Zeitraum keinen
// einzigen sichtbaren Coverage-Record berührt. Sonst "partial" (teilweise
// Überschneidung, oder vollständig innerhalb eines "partial"/"failed"-
// Records). `importedAt <= asOf` filtert die Coverage-Fakten selbst
// Future-Knowledge-sicher (K3, K9 Test 7) — ein erst nach asOf importierter
// Coverage-Fakt kann einen historischen Snapshot nicht beeinflussen.
// Tagesstatus einer einzelnen Quelle an einem einzelnen Kalendertag —
// Zwischenergebnis der tagesweisen Auswertung unten, nicht exportiert.
type DayCoverageStatus = "complete" | "partial" | "unavailable";

// Append-only-Supersession-Regel (Korrekturauftrag "Marketing Coverage
// Consistency", V2): Coverage-Fakten werden nie gelöscht oder überschrieben,
// sondern ausschließlich als neue Records mit eigenem `importedAt` ergänzt.
// Für JEDEN EINZELNEN Kalendertag gilt daher: unter allen zu `asOf` bereits
// sichtbaren (`importedAt <= asOf`) Records, die diesen Tag abdecken, gewinnt
// der mit dem JÜNGSTEN `importedAt` — das ist der zuletzt bekannte Fakt für
// diesen Tag. Das bildet Retries korrekt ab: ein früherer "failed"-Tag, der
// später mit neuem `importedAt` erfolgreich als "complete" nachgemeldet wird,
// gilt ab genau diesem `importedAt` als complete; ein historischer Snapshot
// VOR diesem Zeitpunkt sieht weiterhin nur den alten (failed) Fakt. Ein
// späterer "failed"-Record mit jüngerem `importedAt` kann umgekehrt auch
// einen älteren "complete"-Fakt für denselben Tag nachträglich zurückweisen
// (z. B. eine nachträglich erkannte Datenkorruption) — auch das wird durch
// dieselbe Regel korrekt abgebildet, OHNE dass ein Record je verändert oder
// entfernt werden muss.
//
// Bei exakt identischem `importedAt` mit widersprüchlichem `status` für
// denselben Tag ist der Fakt nicht auflösbar — das ist ein Datenfehler in der
// Coverage-Erzeugung selbst (zwei gleichzeitige, widersprüchliche Meldungen
// für denselben Tag können in einem echten System nicht beide "zuletzt
// bekannt" sein) und wird bewusst mit einer Exception abgelehnt statt einen
// der beiden Fakten stillschweigend zu bevorzugen.
function resolveDayCoverageStatus(
  day: string,
  stream: MarketingSourceStream,
  coverage: readonly MarketingSourceCoverage[],
  asOf: string,
): DayCoverageStatus {
  const covering = coverage.filter(
    (c) => c.stream === stream && c.importedAt <= asOf && c.coveredFrom <= day && day <= c.coveredThrough,
  );
  if (covering.length === 0) {
    return "unavailable";
  }
  const latestImportedAt = covering.reduce((max, c) => (c.importedAt > max ? c.importedAt : max), covering[0]!.importedAt);
  const winners = covering.filter((c) => c.importedAt === latestImportedAt);
  const distinctStatuses = new Set(winners.map((c) => c.status));
  if (distinctStatuses.size > 1) {
    throw new Error(
      `marketing-source-coverage: widersprüchliche Coverage-Fakten für Stream "${stream}" am ${day} mit identischem importedAt (${latestImportedAt}) — nicht auflösbar`,
    );
  }
  const winnerStatus = winners[0]!.status;
  if (winnerStatus === "complete") {
    return "complete";
  }
  if (winnerStatus === "failed") {
    // K3: "failed bedeutet: keine belastbare Periodensumme" — ein failed-Tag
    // trägt damit ebenso wenig belastbare Information wie ein Tag ohne jeden
    // Coverage-Fakt und wird konsequent identisch behandelt (nicht als
    // "partial", das echte, wenn auch unvollständige Beobachtung suggerieren
    // würde). Ein Failed-Tag kann dadurch niemals zu "complete" führen (V4)
    // und verwässert auch nicht fälschlich zu "partial", wo tatsächlich gar
    // keine Daten vorliegen.
    return "unavailable";
  }
  return "partial";
}

// Kanonische, einzige Auswertungsfunktion (siehe Kommentar oben an der
// Funktionssignatur weiter unten für die vollständige Verhaltensbeschreibung
// der drei PeriodDataStatus-Werte). Werte jeden Kalendertag von bounds.from
// bis bounds.through EINZELN aus (Korrekturauftrag V3: mehrere lückenlos
// aneinandergrenzende "complete"-Records müssen eine vollständig abgedeckte
// Periode ergeben, auch ohne einen einzigen, die gesamte Periode
// überspannenden Record) und aggregiert danach:
// - "complete" nur, wenn AUSNAHMSLOS jeder Tag "complete" ist.
// - "unavailable" nur, wenn AUSNAHMSLOS jeder Tag "unavailable" ist (keinerlei
//   Information für die gesamte Periode vorhanden).
// - sonst "partial" (mindestens ein Tag trägt Information, aber nicht jeder
//   Tag ist vollständig abgedeckt — exakt die in V4 verlangte Definition).
export function resolveMarketingSourceCoverageStatus(
  stream: MarketingSourceStream,
  bounds: { from: string; through: string },
  coverage: readonly MarketingSourceCoverage[],
  asOf: string,
): PeriodDataStatus {
  const dayStatuses: DayCoverageStatus[] = [];
  for (let day = bounds.from; day <= bounds.through; day = addDays(day, 1)) {
    dayStatuses.push(resolveDayCoverageStatus(day, stream, coverage, asOf));
  }
  if (dayStatuses.length === 0) {
    // Strukturell nicht erreichbar (bounds.from <= bounds.through gilt überall
    // in dieser Referenzwelt) — defensiv statt einer irreführenden
    // Vacuous-Truth-"complete"-Antwort auf einen leeren Zeitraum.
    return "unavailable";
  }
  if (dayStatuses.every((s) => s === "complete")) {
    return "complete";
  }
  if (dayStatuses.every((s) => s === "unavailable")) {
    return "unavailable";
  }
  return "partial";
}

// Kombiniert zwei Stream-Status zum jeweils schwächeren (K6: eine gematchte
// CRM-Landung bzw. ein Pending-Bestand ist nur so belastbar wie die
// unsicherste beteiligte Quelle). "unavailable" schlägt "partial" schlägt
// "complete".
const STATUS_RANK: Record<PeriodDataStatus, number> = { unavailable: 0, partial: 1, complete: 2 };
export function combinePeriodDataStatus(a: PeriodDataStatus, b: PeriodDataStatus): PeriodDataStatus {
  return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b;
}
