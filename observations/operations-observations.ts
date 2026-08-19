import type { Observation, ObservationKind } from "./observations";
import { activeDeliveryUnitsAt, type DeliveryUnit } from "../world/delivery-units";
import type { Employee } from "../world/employees";
import { addDays, daysBetween } from "../engine/random";
import { restrictedMeanSurvivalTime, censoredCount, type SurvivalCase } from "../engine/survival-analysis";

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

// Current Delivery Queue Snapshot V1: beantwortet ausschließlich, wie viele bis
// zu asOf entstandene Lieferverpflichtungen zu asOf noch auf ihren tatsächlichen
// Start warten, und wie lange sie bisher gewartet haben. Ein reiner
// Stichtags-Snapshot — anders als die beiden Duration-Observations oben MUSS
// diese Funktion immer ein definiertes Ergebnis liefern (nie undefined), auch bei
// N=0: "bis zum Stichtag sind keine Lieferverpflichtungen entstanden" ist selbst
// ein wahrer, informativer Fakt (keine erfundene Nullverteilung, exakt wie bei
// der Fair-Share-Observation, die bei 0 aktiven Einheiten ebenfalls weiterhin
// eine definierte Observation liefert — nicht wie die beiden Duration-
// Observations, wo ein Nullwert eine nicht existente Verteilung vorgetäuscht
// hätte). Drei klar unterscheidbare Fälle (siehe Auftrag "Current Delivery Queue
// Snapshot V1", B5): A) N=0, B) N>0/W=0, C) N>0/W>0. Kind-Name
// "operations-current-delivery-queue": "current" bezieht sich hier eindeutig auf
// den asOf-Stichtag, nicht auf einen Trend — der gesamte Vertrag ist auf einen
// einzelnen Zeitpunkt beschränkt, keine Persistenz, keine Vergleichsfenster.
export interface CurrentDeliveryQueueSnapshotObservation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  area: "Delivery";
  statement: string;
  confidence: Observation["confidence"];
  evaluatedDeliveryCommitmentsTotal: number;
  waitingDeliveryUnitsTotal: number;
  waitingQueueAgeDaysMedian: number | undefined;
  waitingQueueAgeDaysMin: number | undefined;
  waitingQueueAgeDaysMax: number | undefined;
  oldestWaitingQueuedAt: string | undefined;
  waitingDeliveryUnitIds: string[];
  derivedFrom: string[];
}

// Gesamtpopulation (N): startDate <= asOf — jede bis asOf entstandene
// Lieferverpflichtung, unabhängig vom weiteren Status. Wartende Teilpopulation
// (W) ⊆ N: actualStartDate === undefined ODER actualStartDate > asOf (ein
// tatsächlicher Start, der erst NACH diesem asOf liegt, zählt zu diesem
// historischen Stichtag als noch wartend — Future-Knowledge-Schutz: eine später
// tatsächlich gestartete Unit bleibt in einem früheren Snapshot wartend, exakt
// wie im Auftrag verlangt). derivedFrom referenziert IMMER die VOLLSTÄNDIGE
// Population N (nicht nur die wartende Treffermenge W) — Begründung: die
// Observation trifft eine "W von N"-Aussage, beide Zahlen müssen rückverfolgbar
// sein, sonst wäre bei W=0 die Aussage "N geprüft, keine wartet" nicht von "0
// geprüft" unterscheidbar (derselbe Explainability-Grundsatz wie beim
// Zero-Active-Explainability-Fix der Fair-Share-Observation).
// waitingDeliveryUnitIds ⊆ derivedFrom referenziert zusätzlich exakt die wartende
// Teilmenge. Queue-Alter = daysBetween(startDate, asOf) — die bisherige
// Wartezeit BIS asOf, keine finale Dauer, keine Prognose (ein zukünftiger Start
// verändert dieses Alter für einen bereits berechneten historischen asOf nicht).
export function generateOperationsCurrentDeliveryQueueSnapshotObservation(
  deliveryUnits: readonly DeliveryUnit[],
  asOf: string,
): CurrentDeliveryQueueSnapshotObservation {
  const evaluated = deliveryUnits.filter((u) => u.startDate <= asOf);
  const waiting = evaluated.filter((u) => u.actualStartDate === undefined || u.actualStartDate > asOf);

  const n = evaluated.length;
  const w = waiting.length;

  let waitingQueueAgeDaysMedian: number | undefined;
  let waitingQueueAgeDaysMin: number | undefined;
  let waitingQueueAgeDaysMax: number | undefined;
  let oldestWaitingQueuedAt: string | undefined;

  if (w > 0) {
    const ages = waiting.map((u) => daysBetween(u.startDate, asOf)).sort((a, b) => a - b);
    waitingQueueAgeDaysMin = ages[0]!;
    waitingQueueAgeDaysMax = ages[ages.length - 1]!;
    waitingQueueAgeDaysMedian =
      ages.length % 2 === 0 ? (ages[ages.length / 2 - 1]! + ages[ages.length / 2]!) / 2 : ages[(ages.length - 1) / 2]!;
    oldestWaitingQueuedAt = waiting.reduce(
      (earliest, u) => (u.startDate < earliest ? u.startDate : earliest),
      waiting[0]!.startDate,
    );
  }

  const statement =
    n === 0
      ? `Bis zum ${asOf} waren keine Lieferverpflichtungen entstanden.`
      : w === 0
        ? `Von den ${n} bis zum ${asOf} entstandenen Lieferverpflichtungen wartete zu diesem Zeitpunkt keine mehr auf den tatsächlichen Start.`
        : w === 1
          ? `Von den ${n} bis zum ${asOf} entstandenen Lieferverpflichtungen wartete zu diesem Stichtag genau eine noch auf den tatsächlichen Start; ihre bisherige Wartezeit betrug ${waitingQueueAgeDaysMin} Tage.`
          : `Von den ${n} bis zum ${asOf} entstandenen Lieferverpflichtungen warteten ${w} zu diesem Stichtag noch auf den tatsächlichen Start. Ihre bisherige Wartezeit lag zwischen ${waitingQueueAgeDaysMin} und ${waitingQueueAgeDaysMax} Tagen; der Median lag bei ${waitingQueueAgeDaysMedian} Tagen.`;

  return {
    id: `operations-obs-current-delivery-queue-${asOf}`,
    kind: "operations-current-delivery-queue",
    generatedAt: asOf,
    area: "Delivery",
    statement,
    confidence: "unzureichend",
    evaluatedDeliveryCommitmentsTotal: n,
    waitingDeliveryUnitsTotal: w,
    waitingQueueAgeDaysMedian,
    waitingQueueAgeDaysMin,
    waitingQueueAgeDaysMax,
    oldestWaitingQueuedAt,
    waitingDeliveryUnitIds: waiting.map((u) => u.id),
    derivedFrom: evaluated.map((u) => u.id),
  };
}

// ============================================================================
// Queue/Delivery Duration Signal Observations (Auftrag "Operations Delivery
// Flow Signal Design — Censor-Aware, Persistent, Sales-Decoupled")
// ============================================================================
//
// Beantworten je EINE, eng begrenzte Führungsfrage: "Verändert sich die
// jeweilige tatsächliche Dauer gerade anhaltend gegenüber ihrem historischen
// Referenzniveau — länger, kürzer, oder gar nicht?" Exakt dasselbe
// Frageformat wie MarketingDemandRegimeSignal
// (observations/marketing-observations.ts), hier auf rechtszensierte
// Dauerdaten angewendet statt auf reine Volumendichte.
//
// Methodik (siehe Abschlussbericht "Operations Delivery Flow Signal Design",
// Phase 3/4 für den vollständigen Methodenaudit): Kaplan-Meier/Restricted-Mean-
// Survival-Time (engine/survival-analysis.ts) statt Complete-Case oder
// Maturity-Buffer. Noch wartende Queue-Fälle bzw. noch laufende Delivery-Units
// werden NICHT aus der Population entfernt — sie zählen als rechtszensierte
// Fälle mit ihrem bisherigen Alter (asOf - Ankerdatum), nicht als fehlendes
// Ereignis. Ein einfacher Median/Mittelwert über nur bereits abgeschlossene
// Fälle würde systematisch gerade die potenziell längsten, noch laufenden
// Fälle ausschließen (Right-Censoring-Bias) — siehe Complete-Case-Vergleich im
// Abschlussbericht.
//
// Fenster-/Persistence-Design (Phase 6/7, empirisch hergeleitet, nicht von
// Marketings 28/56-Tage-Fenstern blind übernommen, siehe Abschlussbericht
// Phase 5/6/9 für die vollständige Messreihe über 6 Seeds):
// - zwei nicht überlappende, je 28-tägige "bestätigende" Kohorten-Fenster
//   (Einreihungs- bzw. Start-Zeitpunkt der Unit im jeweiligen Fenster) —
//   beide müssen unabhängig dieselbe Richtung zeigen (Kandidat C aus dem
//   Fensterdesign-Audit).
// - eine unbeschränkte historische Referenz (alles vor den beiden Fenstern,
//   ab timelineStart) — dieselbe Konvention wie
//   generateMarketingDemandRegimeSignalObservation.
// - RMST-Horizont: 14 Tage für Queue (baseline liegt vollständig 0-8 Tage,
//   14 Tage bereits deutlich darüber, aber nicht so groß, dass ein
//   Backlog-Alter die Baseline-Referenz selbst unnötig aufbläht — siehe
//   Abschlussbericht Phase 5), 42 Tage für Delivery (Baseline-Maximaldauer,
//   der Horizont ist AUSDRÜCKLICH keine SLA und keine Zusage, ausschließlich
//   die statistische Integrationsgrenze für RMST, siehe
//   engine/survival-analysis.ts).
// - ASYMMETRISCHE Schwellen: "verlaengerte-dauer" ab +25% über der Referenz,
//   "verkuerzte-dauer" erst ab -50% unter der Referenz. Nicht symmetrisch
//   gewählt (Auftrag, Phase 9: "Die Fähigkeit, Verschlechterungen zuverlässig
//   zu erkennen, hat Vorrang vor einer symmetrischen Taxonomie") — eine
//   symmetrische 25%-Schwelle für beide Richtungen erzeugte im Kalibrierungs-
//   Audit einen dokumentierten Fehlerfall: eine kürzlich beendete Elevated-
//   Phase kontaminiert die unbeschränkte historische Referenz teilweise (sie
//   liegt noch teilweise IN der Referenzperiode), wodurch ein völlig normales,
//   bereits wieder auf Baseline zurückgekehrtes aktuelles Fenster fälschlich
//   als "verkuerzte-dauer" erschiene (relativ zur künstlich erhöhten
//   Referenz). Eine strengere Verkürzungs-Schwelle (-50% statt -25%) verhindert
//   dieses falsche Richtungssignal zuverlässig, ohne echte Reduced-Regime-
//   Erkennung zu verlieren (im Kalibrierungs-Audit weiterhin in 5/6 bzw. 4/6
//   Seeds korrekt erkannt — echte Reduced-Regime liegen 85-90 % unter der
//   Referenz, weit jenseits der 50%-Schwelle).
//
// Mindest-Evidenz (Phase 8): je Fenster mindestens 5 Units, Referenz
// mindestens 20 Units UND mindestens 90 Tage Historie (dieselbe
// Mindestlaufzeit-Konvention wie Marketing) — unterhalb dieser Schwelle liefert
// die Funktion `undefined` ("unzureichende-evidenz" auf Company-Area-Ebene,
// exakt wie bei den beiden bestehenden Duration-Observations oben), statt einen
// Wert auf dünner Evidenz zu erzwingen.
const SIGNAL_WINDOW_DAYS = 28;
const QUEUE_SIGNAL_HORIZON_DAYS = 14;
const DELIVERY_SIGNAL_HORIZON_DAYS = 42;
const SIGNAL_MIN_WINDOW_POPULATION = 5;
const SIGNAL_MIN_REFERENCE_POPULATION = 20;
const SIGNAL_MIN_REFERENCE_DAYS = 90;
const SIGNAL_ELEVATED_THRESHOLD_FRAC = 0.25;
const SIGNAL_REDUCED_THRESHOLD_FRAC = 0.5;

export type OperationsDurationSignalValue = "unzureichende-evidenz" | "stabil" | "verlaengerte-dauer" | "verkuerzte-dauer";

export interface DurationSignalWindow {
  startsAt: string;
  endsAt: string;
  populationSize: number;
  censoredCount: number;
  rmstDays: number;
}

interface DurationCohort {
  cases: SurvivalCase[];
  unitIds: string[];
}

// Queue-Kohorte: Anker ist queuedAt (== DeliveryUnit.startDate, Auftrag B4.1).
// Ereignis = tatsächlicher Start (actualStartDate <= asOf); Zensierung = noch
// kein Start bis asOf, mit dem bisherigen Alter (asOf - startDate).
function queueCohort(
  units: readonly DeliveryUnit[],
  cohortStartExclusive: string,
  cohortEndInclusive: string,
  asOf: string,
): DurationCohort {
  const matched = units.filter((u) => u.startDate > cohortStartExclusive && u.startDate <= cohortEndInclusive);
  const cases: SurvivalCase[] = matched.map((u) =>
    u.actualStartDate !== undefined && u.actualStartDate <= asOf
      ? { durationDays: daysBetween(u.startDate, u.actualStartDate), censored: false }
      : { durationDays: daysBetween(u.startDate, asOf), censored: true },
  );
  return { cases, unitIds: matched.map((u) => u.id) };
}

// Delivery-Kohorte: Anker ist der tatsächliche Start (actualStartDate, Auftrag
// B4.2) — niemals der Queue-/Commitment-Zeitpunkt. Ereignis = tatsächlicher
// Abschluss (actualEndDate <= asOf); Zensierung = noch kein Abschluss bis asOf,
// mit dem bisherigen Alter (asOf - actualStartDate).
function deliveryCohort(
  units: readonly DeliveryUnit[],
  cohortStartExclusive: string,
  cohortEndInclusive: string,
  asOf: string,
): DurationCohort {
  const matched = units.filter(
    (u): u is DeliveryUnit & { actualStartDate: string } =>
      u.actualStartDate !== undefined && u.actualStartDate > cohortStartExclusive && u.actualStartDate <= cohortEndInclusive,
  );
  const cases: SurvivalCase[] = matched.map((u) =>
    u.actualEndDate !== undefined && u.actualEndDate <= asOf
      ? { durationDays: daysBetween(u.actualStartDate, u.actualEndDate), censored: false }
      : { durationDays: daysBetween(u.actualStartDate, asOf), censored: true },
  );
  return { cases, unitIds: matched.map((u) => u.id) };
}

function buildSignalWindow(cohort: DurationCohort, startsAt: string, endsAt: string, horizonDays: number): DurationSignalWindow {
  return {
    startsAt,
    endsAt,
    populationSize: cohort.cases.length,
    censoredCount: censoredCount(cohort.cases),
    rmstDays: restrictedMeanSurvivalTime(cohort.cases, horizonDays),
  };
}

interface DurationSignalResult {
  signal: OperationsDurationSignalValue;
  currentWindow: DurationSignalWindow;
  priorWindow: DurationSignalWindow;
  referenceWindow: DurationSignalWindow;
}

// Reine Entscheidungslogik, unabhängig von Queue/Delivery — dieselbe
// Zwei-Fenster-Bestätigungs- und Schwellenregel für beide Dimensionen (Phase 7:
// "ein persistentes Signal muss auf mehreren unabhängigen ... Evidenzmengen
// beruhen"). Gibt `undefined` zurück, wenn die Mindest-Evidenz (Phase 8) nicht
// erreicht ist.
function evaluateDurationSignal(
  currentCohort: DurationCohort,
  priorCohort: DurationCohort,
  referenceCohort: DurationCohort,
  currentBounds: { startsAt: string; endsAt: string },
  priorBounds: { startsAt: string; endsAt: string },
  referenceBounds: { startsAt: string; endsAt: string },
  horizonDays: number,
): DurationSignalResult | undefined {
  if (
    currentCohort.cases.length < SIGNAL_MIN_WINDOW_POPULATION ||
    priorCohort.cases.length < SIGNAL_MIN_WINDOW_POPULATION ||
    referenceCohort.cases.length < SIGNAL_MIN_REFERENCE_POPULATION
  ) {
    return undefined;
  }

  const currentWindow = buildSignalWindow(currentCohort, currentBounds.startsAt, currentBounds.endsAt, horizonDays);
  const priorWindow = buildSignalWindow(priorCohort, priorBounds.startsAt, priorBounds.endsAt, horizonDays);
  const referenceWindow = buildSignalWindow(referenceCohort, referenceBounds.startsAt, referenceBounds.endsAt, horizonDays);

  const upThreshold = referenceWindow.rmstDays * (1 + SIGNAL_ELEVATED_THRESHOLD_FRAC);
  const downThreshold = referenceWindow.rmstDays * (1 - SIGNAL_REDUCED_THRESHOLD_FRAC);
  const elevated = currentWindow.rmstDays > upThreshold && priorWindow.rmstDays > upThreshold;
  const reduced = currentWindow.rmstDays < downThreshold && priorWindow.rmstDays < downThreshold;
  const signal: OperationsDurationSignalValue = elevated ? "verlaengerte-dauer" : reduced ? "verkuerzte-dauer" : "stabil";

  return { signal, currentWindow, priorWindow, referenceWindow };
}

function durationSignalStatement(
  signal: OperationsDurationSignalValue,
  subject: string,
  result: DurationSignalResult,
  horizonDays: number,
): string {
  const { currentWindow, priorWindow, referenceWindow } = result;
  if (signal === "stabil") {
    return (
      `${subject} zeigt in den letzten ${2 * SIGNAL_WINDOW_DAYS} Tagen keine anhaltende Abweichung vom historischen ` +
      `Referenzniveau (RMST ${currentWindow.rmstDays.toFixed(1)} und ${priorWindow.rmstDays.toFixed(1)} Tage in den letzten ` +
      `beiden ${SIGNAL_WINDOW_DAYS}-Tage-Fenstern vs. ${referenceWindow.rmstDays.toFixed(1)} Tage Referenz, Horizont ${horizonDays} Tage).`
    );
  }
  const direction = signal === "verlaengerte-dauer" ? "über" : "unter";
  return (
    `${subject} lag in zwei bestätigenden Zeitfenstern anhaltend ${direction} dem historischen Referenzniveau ` +
    `(RMST ${currentWindow.rmstDays.toFixed(1)} und ${priorWindow.rmstDays.toFixed(1)} Tage vs. ${referenceWindow.rmstDays.toFixed(1)} ` +
    `Tage Referenz, Horizont ${horizonDays} Tage).`
  );
}

export interface QueueDurationSignalObservation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  area: "Delivery";
  statement: string;
  confidence: Observation["confidence"];
  signal: OperationsDurationSignalValue;
  horizonDays: number;
  currentWindow: DurationSignalWindow;
  priorWindow: DurationSignalWindow;
  referenceWindow: DurationSignalWindow;
  differenceDays: number;
  derivedFrom: string[];
}

// asOf-sicher (dieselbe Garantie wie generateMarketingDemandRegimeSignalObservation):
// verwendet ausschließlich Units mit den bereits asOf-gefilterten Zeitstempeln
// aus der übergebenen deliveryUnits-Liste plus timelineStart als einzige
// zusätzliche, nicht von deliveryUnits abgeleitete Information. Kein Regime-
// Wissen, keine Kenntnis künftiger Ereignisse.
export function generateOperationsQueueDurationSignalObservation(
  deliveryUnits: readonly DeliveryUnit[],
  asOf: string,
  timelineStart: string,
): QueueDurationSignalObservation | undefined {
  const currentStart = addDays(asOf, -SIGNAL_WINDOW_DAYS);
  const priorStart = addDays(asOf, -2 * SIGNAL_WINDOW_DAYS);
  const referenceEnd = priorStart;

  if (referenceEnd < timelineStart) {
    return undefined;
  }
  const referenceDays = daysBetween(timelineStart, referenceEnd);
  if (referenceDays < SIGNAL_MIN_REFERENCE_DAYS) {
    return undefined;
  }

  const currentCohort = queueCohort(deliveryUnits, currentStart, asOf, asOf);
  const priorCohort = queueCohort(deliveryUnits, priorStart, currentStart, asOf);
  const referenceCohort = queueCohort(deliveryUnits, addDays(timelineStart, -1), referenceEnd, asOf);

  const result = evaluateDurationSignal(
    currentCohort,
    priorCohort,
    referenceCohort,
    { startsAt: currentStart, endsAt: asOf },
    { startsAt: priorStart, endsAt: currentStart },
    { startsAt: timelineStart, endsAt: referenceEnd },
    QUEUE_SIGNAL_HORIZON_DAYS,
  );
  if (result === undefined) {
    return undefined;
  }

  const statement = durationSignalStatement(
    result.signal,
    "Die Zeit zwischen Lieferverpflichtung und tatsächlichem Start",
    result,
    QUEUE_SIGNAL_HORIZON_DAYS,
  );

  return {
    id: `operations-obs-queue-duration-signal-${asOf}`,
    kind: "operations-queue-duration-signal",
    generatedAt: asOf,
    area: "Delivery",
    statement,
    // "hoch": beide Fenster bestätigen unabhängig dieselbe Berechnung UND die
    // Referenz erfüllt bereits das Mindest-Evidenz-Kriterium (dieselbe
    // Begründung wie MarketingDemandSignalObservation.confidence) — gilt auch
    // für signal="stabil" (die Abwesenheit einer Abweichung ist ebenfalls eine
    // fachlich gut begründete Aussage, keine geratene).
    confidence: "hoch",
    signal: result.signal,
    horizonDays: QUEUE_SIGNAL_HORIZON_DAYS,
    currentWindow: result.currentWindow,
    priorWindow: result.priorWindow,
    referenceWindow: result.referenceWindow,
    differenceDays: result.currentWindow.rmstDays - result.referenceWindow.rmstDays,
    derivedFrom: [...new Set([...currentCohort.unitIds, ...priorCohort.unitIds, ...referenceCohort.unitIds])],
  };
}

export interface DeliveryDurationSignalObservation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  area: "Delivery";
  statement: string;
  confidence: Observation["confidence"];
  signal: OperationsDurationSignalValue;
  horizonDays: number;
  currentWindow: DurationSignalWindow;
  priorWindow: DurationSignalWindow;
  referenceWindow: DurationSignalWindow;
  differenceDays: number;
  derivedFrom: string[];
}

export function generateOperationsDeliveryDurationSignalObservation(
  deliveryUnits: readonly DeliveryUnit[],
  asOf: string,
  timelineStart: string,
): DeliveryDurationSignalObservation | undefined {
  const currentStart = addDays(asOf, -SIGNAL_WINDOW_DAYS);
  const priorStart = addDays(asOf, -2 * SIGNAL_WINDOW_DAYS);
  const referenceEnd = priorStart;

  if (referenceEnd < timelineStart) {
    return undefined;
  }
  const referenceDays = daysBetween(timelineStart, referenceEnd);
  if (referenceDays < SIGNAL_MIN_REFERENCE_DAYS) {
    return undefined;
  }

  const currentCohort = deliveryCohort(deliveryUnits, currentStart, asOf, asOf);
  const priorCohort = deliveryCohort(deliveryUnits, priorStart, currentStart, asOf);
  const referenceCohort = deliveryCohort(deliveryUnits, addDays(timelineStart, -1), referenceEnd, asOf);

  const result = evaluateDurationSignal(
    currentCohort,
    priorCohort,
    referenceCohort,
    { startsAt: currentStart, endsAt: asOf },
    { startsAt: priorStart, endsAt: currentStart },
    { startsAt: timelineStart, endsAt: referenceEnd },
    DELIVERY_SIGNAL_HORIZON_DAYS,
  );
  if (result === undefined) {
    return undefined;
  }

  const statement = durationSignalStatement(
    result.signal,
    "Die tatsächliche Dauer zwischen Start und Abschluss",
    result,
    DELIVERY_SIGNAL_HORIZON_DAYS,
  );

  return {
    id: `operations-obs-delivery-duration-signal-${asOf}`,
    kind: "operations-delivery-duration-signal",
    generatedAt: asOf,
    area: "Delivery",
    statement,
    confidence: "hoch",
    signal: result.signal,
    horizonDays: DELIVERY_SIGNAL_HORIZON_DAYS,
    currentWindow: result.currentWindow,
    priorWindow: result.priorWindow,
    referenceWindow: result.referenceWindow,
    differenceDays: result.currentWindow.rmstDays - result.referenceWindow.rmstDays,
    derivedFrom: [...new Set([...currentCohort.unitIds, ...priorCohort.unitIds, ...referenceCohort.unitIds])],
  };
}
