import type { Observation, ObservationKind } from "./observations";
import { activeDeliveryUnitsAt, type DeliveryUnit } from "../world/delivery-units";
import type { Employee } from "../world/employees";
import { daysBetween } from "../engine/random";

// Bewusst KEIN Import von engine/generator.ts (SCENARIO_WORLDS) hier: generator.ts
// importiert bereits generateGroundTruthSnapshot aus ground-truth.ts, und
// ground-truth.ts würde — falls es umgekehrt einen hier definierten
// Operations-Singleton importierte — einen Zirkelbezug
// generator.ts → ground-truth.ts → operations-observations.ts → generator.ts
// schließen. Deshalb bleibt diese Datei eine reine Funktionsbibliothek ohne eigenen,
// bei Modul-Load berechneten Singleton; Aufrufer (Tests, künftig Snapshot-Integration)
// übergeben deliveryUnits/employees/asOf explizit, exakt wie
// generateBusinessStateSnapshot bereits heute ohne eigenen Singleton auskommt.

// Phase 9 (Severity-/Confidence-Typfrage) — Ergebnis der Prüfung:
//
// A. Eine vorhandene neutrale Severity verwenden? Verworfen — severity kennt nur
//    "niedrig"/"mittel"/"hoch", alle drei sind inhärent wertend. "niedrig" wäre kein
//    neutraler Nichtbefund, sondern eine implizite, unbelegte Behauptung
//    ("unbedenklich geprüft") — genau die künstliche Bewertung, die die freigegebene
//    Domain Decision 5 ausschließt.
// B. severity additiv optional machen? Technisch möglich, aber teurer als es
//    aussieht: validation/invariants.ts prüft heute mit
//    checkObservationFieldsValid/OBSERVATION_SEVERITIES, dass JEDE Observation eine
//    gültige severity trägt — ein Set<string>.has(obs.severity) unter strict:true
//    würde bei optionalem severity selbst brechen und müsste angepasst werden. Das
//    würde eine heute für alle 19 Sales-/People-Kinds geltende Garantie dauerhaft
//    aufweichen, nur um einer einzigen, bewusst andersartigen Domäne
//    entgegenzukommen — mehr Eingriff, als es zunächst scheint.
// C. Eine separate Observation-Struktur? Gewählt. OperationsObservation unten ist
//    KEIN Observation (keine severity, keine category) — sie behauptet nicht,
//    severity-bewertet zu sein, weil sie es laut Domain Decision nicht ist.
//    confidence bleibt trotzdem dieselbe, bereits bestehende Skala
//    (Observation["confidence"]) — keine neue Confidence-Skala; hier ausschließlich
//    "unzureichend" verwendet (Domain Decision 7). kind nutzt weiterhin denselben,
//    additiv erweiterten ObservationKind, damit derselbe generische
//    Ground-Truth-Generator (ground-truth.ts, ObservationLike — liest ohnehin nur
//    id/kind) unverändert wiederverwendet werden kann, ohne Observation selbst
//    anzufassen.
// D. Präzedenzfall für unbewertete Observations? Keiner gefunden — alle 17
//    bestehenden Sales-Kinds setzen severity durchgehend. Kein bestehendes Muster
//    wurde also gebrochen oder umgangen, sondern bewusst nicht künstlich imitiert.
//
// Ergebnis: kleinste tragfähige additive Lösung ohne neue fachliche Semantik und
// ohne Aufweichung bestehender Invarianten — kein STOP nötig.
export interface OperationsObservation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  area: "Delivery";
  statement: string;
  confidence: Observation["confidence"];
  activeDeliveryUnitsTotal: number;
  activeUnitsByEmployeeId: Record<string, number>;
  fairShare: number;
  maxAssignedCount: number;
  maxAssignedEmployeeId: string;
  maxShare: number;
  fairShareRatio: number;
  derivedFrom: string[];
}

// Rein deskriptiv (Domain Decisions 5-8): berichtet Ist-Verteilung und rechnerischen
// Fair Share als Fakt, klassifiziert nichts als kritisch/überlastet/problematisch,
// spricht keine Handlungsempfehlung aus. derivedFrom referenziert exakt die zum
// Zeitpunkt asOf aktiven DeliveryUnit-IDs (Backward Explainability, Prinzip 18) —
// über DeliveryUnit.opportunityId/accountId von dort aus vollständig bis zu
// Opportunity/OpportunityStageHistory/closedAt zurückverfolgbar.
//
// Zero-Active-Explainability-Fix (Operations Evidence Audit, Phase C, bestätigt an
// realen Baseline-Tagen 2025-03-29 bis 2025-04-01): "0 aktive DeliveryUnits" ist
// zweideutig, solange derivedFrom in jedem Fall [] ist — Prinzip 8 (Evidence
// Required) verlangt eine unterscheidbare Referenz zwischen "es existiert noch
// keine geprüfte Population" (vor der ersten DeliveryUnit) und "eine Population
// wurde geprüft, keine Einheit war aktiv" (bereits gestartete, inzwischen
// abgeschlossene Einheiten). derivedFrom referenziert deshalb bei 0 aktiven
// Einheiten ersatzweise die bereits gestartete Population (startDate <= asOf,
// dieselbe Zukunftswissen-Grenze wie activeDeliveryUnitsAt) — bei aktiven Einheiten
// bleibt das bisherige, bereits getestete Verhalten (exakt die aktiven IDs)
// unverändert.
export function generateOperationsDeliveryFairShareObservation(
  deliveryUnits: readonly DeliveryUnit[],
  employees: readonly Employee[],
  asOf: string,
): OperationsObservation | undefined {
  const operationsEmployeeIds = employees
    .filter((e) => e.departmentId === "dept-operations" && e.terminatedAt === undefined)
    .map((e) => e.id)
    .sort();

  if (operationsEmployeeIds.length === 0) {
    return undefined;
  }

  const active = activeDeliveryUnitsAt(deliveryUnits, asOf);

  const activeUnitsByEmployeeId: Record<string, number> = {};
  for (const id of operationsEmployeeIds) activeUnitsByEmployeeId[id] = 0;
  for (const unit of active) {
    activeUnitsByEmployeeId[unit.assignedEmployeeId] = (activeUnitsByEmployeeId[unit.assignedEmployeeId] ?? 0) + 1;
  }

  const fairShare = active.length / operationsEmployeeIds.length;

  // Tie-break bei gleichem Maximalwert: deterministisch über die bereits
  // alphabetisch nach employeeId sortierte operationsEmployeeIds-Liste — die erste
  // Person mit dem Maximalwert wird berichtet. Eine rein technische
  // Determinismus-Entscheidung (Reproduzierbarkeit, Prinzip 3), keine fachliche
  // Aussage über die betroffenen Personen.
  let maxAssignedCount = 0;
  let maxAssignedEmployeeId = operationsEmployeeIds[0]!;
  for (const id of operationsEmployeeIds) {
    const count = activeUnitsByEmployeeId[id] ?? 0;
    if (count > maxAssignedCount) {
      maxAssignedCount = count;
      maxAssignedEmployeeId = id;
    }
  }

  const maxShare = active.length > 0 ? maxAssignedCount / active.length : 0;
  const fairShareRatio = fairShare > 0 ? maxAssignedCount / fairShare : 0;

  const statement =
    active.length === 0
      ? `Zum ${asOf} sind keine DeliveryUnits aktiv.`
      : `Von ${active.length} laufenden DeliveryUnits ${active.length === 1 ? "ist" : "sind"} ${maxAssignedCount} ` +
        `einer Person zugeordnet; bei Gleichverteilung über ${operationsEmployeeIds.length} Personen entsprächen ` +
        `${fairShare.toFixed(1)} je Person.`;

  return {
    id: `operations-obs-fair-share-${asOf}`,
    kind: "operations-delivery-fair-share",
    generatedAt: asOf,
    area: "Delivery",
    statement,
    confidence: "unzureichend",
    activeDeliveryUnitsTotal: active.length,
    activeUnitsByEmployeeId,
    fairShare,
    maxAssignedCount,
    maxAssignedEmployeeId,
    maxShare,
    fairShareRatio,
    derivedFrom:
      active.length > 0
        ? active.map((u) => u.id)
        : deliveryUnits.filter((u) => u.startDate <= asOf).map((u) => u.id),
  };
}

// Kein Modul-Load-Singleton (s. Import-Kommentar oben, Zirkelbezug-Vermeidung).
// Aufrufer bilden die Ein-Element-/Leer-Liste bei Bedarf selbst:
// const obs = generateOperationsDeliveryFairShareObservation(...);
// const observations = obs ? [obs] : [];

// Completed Delivery Duration Observation V1 (Operations Observation Evidence
// Audit, Empfehlung "Slice C"): beantwortet ausschließlich, wie lange die
// Leistungserbringung bei den bis zu asOf bereits abgeschlossenen DeliveryUnits
// tatsächlich dauerte (Start bis Abschluss) — eine exakt definierte historische
// Teilpopulation, keine Aussage über laufende oder eingereihte Units, keine
// Prognose, keine Termintreue-/SLA-Aussage. KEIN Observation (dieselbe Phase-9-
// Begründung wie bei OperationsObservation oben: keine severity, keine category).
// Median statt Mittelwert bevorzugt (robuster gegenüber einzelnen kurzen/langen
// Fällen) — kein Mittelwertfeld, da keine bestehende Operations-KPI-Konvention es
// verlangt und Median bereits die geforderte, robustere Aussage liefert.
export interface CompletedDeliveryDurationObservation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  area: "Delivery";
  statement: string;
  confidence: Observation["confidence"];
  completedDeliveryUnitsTotal: number;
  durationDaysMedian: number;
  durationDaysMin: number;
  durationDaysMax: number;
  populationStartedAt: string;
  populationEndedAt: string;
  derivedFrom: string[];
}

// Population (verbindlich, siehe Auftrag "Completed Delivery Duration Observation
// V1"): actualStartDate und actualEndDate müssen beide gesetzt UND beide <= asOf
// sein. Die bloße Existenz von actualStartDate/actualEndDate genügt nicht (beide
// Felder sind zwar bereits WORLD_NOW-Future-Knowledge-sicher gesetzt, siehe
// world/delivery-units.ts, aber ein Aufruf mit einem asOf VOR WORLD_NOW verlangt
// eine eigene, erneute Zeitgrenze — exakt dieselbe Notwendigkeit wie bei
// isDeliveryUnitActiveAt). derivedFrom referenziert DeliveryUnit-IDs (nicht
// Completion-Event-IDs) — dieselbe Entscheidung wie bei der bereits bestehenden
// Fair-Share-Observation oben, aus Konsistenzgründen: die Lifecycle-Events
// (events/delivery-lifecycle.ts) sind bewusst nicht in die Observation-/Ground-
// Truth-Evidenzkette verdrahtet (siehe dortiger Kopfkommentar), DeliveryUnit-IDs
// sind bereits der etablierte, getestete Anker für Backward Explainability
// (DeliveryUnit → Opportunity → Account/closedAt).
export function generateOperationsCompletedDeliveryDurationObservation(
  deliveryUnits: readonly DeliveryUnit[],
  asOf: string,
): CompletedDeliveryDurationObservation | undefined {
  const completed = deliveryUnits.filter(
    (u): u is DeliveryUnit & { actualStartDate: string; actualEndDate: string } =>
      u.actualStartDate !== undefined &&
      u.actualEndDate !== undefined &&
      u.actualStartDate <= asOf &&
      u.actualEndDate <= asOf,
  );

  // N = 0: bewusst KEINE Observation (nicht Median/Min/Max = 0) — ein
  // deskriptiver Fakt über eine leere Population wäre keine Aussage, sondern ein
  // erfundener Platzhalterwert. Dieselbe "leere, ehrliche Summary statt
  // erfundenem Ersatzinhalt"-Regel wie überall sonst in diesem Modul, hier jedoch
  // bewusst über den kompletten Undefined-Rückgabewert statt über Nullwerte
  // durchgesetzt (anders als bei der Fair-Share-Observation, die bei 0 aktiven
  // Einheiten weiterhin eine Observation mit Werten 0 liefert — dort ist "0
  // aktiv" selbst der Fakt; hier wäre "Median 0 Tage" eine falsche Behauptung
  // über eine nicht existente Verteilung).
  if (completed.length === 0) {
    return undefined;
  }

  const durations = completed
    .map((u) => daysBetween(u.actualStartDate, u.actualEndDate))
    .sort((a, b) => a - b);
  const n = durations.length;
  const durationDaysMedian =
    n % 2 === 0 ? (durations[n / 2 - 1]! + durations[n / 2]!) / 2 : durations[(n - 1) / 2]!;
  const durationDaysMin = durations[0]!;
  const durationDaysMax = durations[n - 1]!;

  const populationStartedAt = completed.reduce(
    (earliest, u) => (u.actualStartDate < earliest ? u.actualStartDate : earliest),
    completed[0]!.actualStartDate,
  );
  const populationEndedAt = completed.reduce(
    (latest, u) => (u.actualEndDate > latest ? u.actualEndDate : latest),
    completed[0]!.actualEndDate,
  );

  const statement =
    n === 1
      ? `Zum ${asOf} liegt genau eine bis dahin abgeschlossene DeliveryUnit vor; die tatsächliche Dauer vom Start bis zum Abschluss betrug ${durationDaysMin} Tage. Laufende und noch nicht gestartete DeliveryUnits sind nicht enthalten.`
      : `Bei den ${n} bis zum ${asOf} abgeschlossenen DeliveryUnits betrug die tatsächliche Dauer vom Start bis zum Abschluss zwischen ${durationDaysMin} und ${durationDaysMax} Tagen; der Median lag bei ${durationDaysMedian} Tagen. Laufende und noch nicht gestartete DeliveryUnits sind nicht enthalten.`;

  return {
    id: `operations-obs-completed-delivery-duration-${asOf}`,
    kind: "operations-completed-delivery-duration",
    generatedAt: asOf,
    area: "Delivery",
    statement,
    confidence: "unzureichend",
    completedDeliveryUnitsTotal: n,
    durationDaysMedian,
    durationDaysMin,
    durationDaysMax,
    populationStartedAt,
    populationEndedAt,
    derivedFrom: completed.map((u) => u.id),
  };
}

// Queue Duration Observation V1: beantwortet ausschließlich, wie lange es bei den
// bis zu asOf bereits gestarteten DeliveryUnits vom Entstehen der
// Lieferverpflichtung (DeliveryQueued.queuedAt == DeliveryUnit.startDate) bis zum
// tatsächlichen Delivery-Start (actualStartDate) dauerte. Anders als die Completed
// Delivery Duration Observation ist KEIN Completion Event erforderlich — laufende
// UND bereits abgeschlossene Units zählen beide zur Population, solange sie
// tatsächlich gestartet sind. Kind-Name bewusst "completed-queue-duration": die
// QUEUE-Phase ist abgeschlossen (die Unit hat gestartet), nicht die Delivery-Phase
// — parallel zur Namensstruktur von "operations-completed-delivery-duration",
// vermeidet die im Auftrag ausdrücklich verbotene "current"/"laufend"-Lesart.
// derivedFrom referenziert DeliveryUnit-IDs, dieselbe Konsistenzentscheidung wie
// oben. KEIN Observation (Phase-9-Begründung wie überall in dieser Datei).
export interface QueueDurationObservation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  area: "Delivery";
  statement: string;
  confidence: Observation["confidence"];
  startedDeliveryUnitsTotal: number;
  queueDurationDaysMedian: number;
  queueDurationDaysMin: number;
  queueDurationDaysMax: number;
  populationQueuedAt: string;
  populationStartedAt: string;
  derivedFrom: string[];
}

// Population: startDate <= asOf UND actualStartDate !== undefined UND
// actualStartDate <= asOf (beide Bedingungen explizit geprüft, obwohl
// actualStartDate <= asOf die erste rechnerisch bereits impliziert —
// actualStartDate ist als startDate + Wartezeit>=0 definiert, siehe
// world/delivery-units.ts — explizite Prüfung dient ausschließlich der
// Lesbarkeit/Auditierbarkeit, keine funktionale Notwendigkeit). Eingereihte
// Units (kein actualStartDate) und zukünftige Starts (actualStartDate > asOf)
// sind ausgeschlossen; Completion wird nicht verlangt.
export function generateOperationsQueueDurationObservation(
  deliveryUnits: readonly DeliveryUnit[],
  asOf: string,
): QueueDurationObservation | undefined {
  const started = deliveryUnits.filter(
    (u): u is DeliveryUnit & { actualStartDate: string } =>
      u.startDate <= asOf && u.actualStartDate !== undefined && u.actualStartDate <= asOf,
  );

  // N = 0: bewusst KEINE Observation — dieselbe Regel wie bei der Completed
  // Delivery Duration Observation oben (kein erfundener Nullwert für eine nicht
  // existente Verteilung).
  if (started.length === 0) {
    return undefined;
  }

  const queueDurations = started
    .map((u) => daysBetween(u.startDate, u.actualStartDate))
    .sort((a, b) => a - b);
  const n = queueDurations.length;
  const queueDurationDaysMedian =
    n % 2 === 0 ? (queueDurations[n / 2 - 1]! + queueDurations[n / 2]!) / 2 : queueDurations[(n - 1) / 2]!;
  const queueDurationDaysMin = queueDurations[0]!;
  const queueDurationDaysMax = queueDurations[n - 1]!;

  const populationQueuedAt = started.reduce(
    (earliest, u) => (u.startDate < earliest ? u.startDate : earliest),
    started[0]!.startDate,
  );
  const populationStartedAt = started.reduce(
    (latest, u) => (u.actualStartDate > latest ? u.actualStartDate : latest),
    started[0]!.actualStartDate,
  );

  const statement =
    n === 1
      ? `Zum ${asOf} liegt genau eine bis dahin bereits gestartete DeliveryUnit vor; die Wartezeit zwischen dem Entstehen der Lieferverpflichtung und dem tatsächlichen Start betrug ${queueDurationDaysMin} Tage. Noch nicht gestartete DeliveryUnits sind nicht enthalten.`
      : `Bei den ${n} bis zum ${asOf} bereits gestarteten DeliveryUnits betrug die Wartezeit zwischen dem Entstehen der Lieferverpflichtung und dem tatsächlichen Start zwischen ${queueDurationDaysMin} und ${queueDurationDaysMax} Tagen; der Median lag bei ${queueDurationDaysMedian} Tagen. Noch nicht gestartete DeliveryUnits sind nicht enthalten.`;

  return {
    id: `operations-obs-queue-duration-${asOf}`,
    kind: "operations-completed-queue-duration",
    generatedAt: asOf,
    area: "Delivery",
    statement,
    confidence: "unzureichend",
    startedDeliveryUnitsTotal: n,
    queueDurationDaysMedian,
    queueDurationDaysMin,
    queueDurationDaysMax,
    populationQueuedAt,
    populationStartedAt,
    derivedFrom: started.map((u) => u.id),
  };
}
