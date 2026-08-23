import { startOfWeek, startOfMonth } from "../timeline/calendar";
import { addDays, daysBetween } from "../engine/random";
import { isDeliveryUnitActiveAt, type DeliveryUnit } from "../world/delivery-units";

// Operations Period Metrics V1 (Auftrag "Operations Workspace Data Contract +
// Entrepreneur View V1", freigegeben CEO D052) — rein deskriptive
// Zeitraumebene über bereits vorhandenen DeliveryUnit-Fakten, exakt nach dem
// bereits etablierten Muster von company/sales-period-metrics.ts und
// company/customer-period-metrics.ts. Erzeugt KEINE zweite Wahrheit: liest
// ausschließlich bereits vorhandene DeliveryUnit-Felder (startDate,
// actualStartDate, actualEndDate — world/delivery-units.ts), keine neue
// Zufallsziehung, keine neue Fachregel.
//
// Verbindliche fachliche Wahrheit (D052, unverändert aus
// world/delivery-units.ts übernommen): Won-Opportunity = Lieferverpflichtung
// (1:1, siehe validation/operations-invariants.test.ts, `deliveryUnits.length
// === won.length`). Es existiert keine pauschale Fristzusage — plannedEndDate
// ist strukturell nie gesetzt. Dauerwerte sind tatsächliche, bereits
// eingetretene Beobachtungen (Start→Ist-Start, Ist-Start→Ist-Abschluss),
// keine Bewertung gegen eine Zusage, die es nicht gibt — dieses Modul
// berechnet daher an keiner Stelle Termintreue, SLA-Erfüllung, Früh-/
// Pünktlich-/Spät-Klassifikation oder Planabweichung.
//
// NICHT über index.ts exportiert — dieselbe Sichtbarkeitsstufe wie
// sales-period-metrics.ts/customer-period-metrics.ts.
//
// --- Periodengrenzen ---------------------------------------------------------
//
// Dieselben drei Kalenderperioden, dieselben Helfer (timeline/calendar.ts) wie
// Sales/Customer Period Metrics — keine zweite Kalenderimplementierung.
//
// --- Aktivität vs. Bestand ----------------------------------------------------
//
// Aktivität zählt EIGENE Ereigniszeitpunkte innerhalb der Periode (wie Sales
// Period Metrics) — keine Kohortenlogik. Bestand ("stockAtPeriodEnd") ist ein
// Stichtags-Snapshot exakt zu `bounds.through` (nicht zu `asOf`!) und
// verwendet dieselbe, bereits an anderer Stelle bewiesene As-of-Grenze wie
// `isDeliveryUnitActiveAt`/`generateOperationsCurrentDeliveryQueueSnapshotObservation`
// (observations/operations-observations.ts) — für die Periode "Gestern" ist
// `bounds.through` ein FRÜHERER Stichtag als `asOf` selbst; ein später
// gestarteter oder abgeschlossener Unit verändert diesen historischen Bestand
// nicht rückwirkend (dieselbe Garantie wie beim bestehenden Queue-Snapshot).
//
// --- Dauerpopulationen ---------------------------------------------------------
//
// Queue-Dauer-Population = exakt dieselbe Population wie `deliveriesStarted`
// (tatsächlicher Start innerhalb der Periode). Delivery-Dauer-Population =
// exakt dieselbe Population wie `deliveriesCompleted` (tatsächlicher Abschluss
// innerhalb der Periode). N=0 liefert `medianDays: undefined` (kein erfundener
// Nullwert für eine nicht existente Verteilung — dieselbe Regel wie
// `generateOperationsQueueDurationObservation`/
// `generateOperationsCompletedDeliveryDurationObservation`). Median-Berechnung
// (sortierte Mitte bzw. Mittel der beiden mittleren Werte bei gerader
// Population) ist dieselbe, bereits zweifach etablierte Formel wie in
// observations/operations-observations.ts — hier bewusst erneut dateilokal
// dupliziert statt in eine geteilte Utility ausgelagert (dieselbe, bereits an
// mehreren Stellen etablierte Konvention, siehe world/delivery-units.ts).

export type OperationsPeriodKey = "yesterday" | "week-to-date" | "month-to-date";

export interface OperationsPeriodBounds {
  from: string;
  through: string;
}

export interface OperationsActivityMetrics {
  deliveryCommitmentsCreated: number;
  deliveryCommitmentsCreatedDeliveryUnitIds: string[];
  deliveriesStarted: number;
  deliveriesStartedDeliveryUnitIds: string[];
  deliveriesCompleted: number;
  deliveriesCompletedDeliveryUnitIds: string[];
}

// medianDays/minDays/maxDays sind nur gesetzt, wenn population > 0 — dieselbe
// "kein erfundener Wert für eine leere Verteilung"-Regel wie überall sonst in
// diesem Modell.
export interface OperationsDurationMetric {
  medianDays: number | undefined;
  minDays: number | undefined;
  maxDays: number | undefined;
  population: number;
  deliveryUnitIds: string[];
}

export interface OperationsDurationFacts {
  queueDurationDaysMedianForStartedDeliveries: OperationsDurationMetric;
  deliveryDurationDaysMedianForCompletedDeliveries: OperationsDurationMetric;
}

export interface OperationsStockAtPeriodEnd {
  queuedDeliveriesAtPeriodEnd: number;
  queuedDeliveriesAtPeriodEndDeliveryUnitIds: string[];
  activeDeliveriesAtPeriodEnd: number;
  activeDeliveriesAtPeriodEndDeliveryUnitIds: string[];
}

export interface OperationsPeriodMetrics {
  period: OperationsPeriodKey;
  bounds: OperationsPeriodBounds;
  activity: OperationsActivityMetrics;
  durationFacts: OperationsDurationFacts;
  stockAtPeriodEnd: OperationsStockAtPeriodEnd;
}

export interface OperationsPeriodMetricsSnapshot {
  asOf: string;
  yesterday: OperationsPeriodMetrics;
  weekToDate: OperationsPeriodMetrics;
  monthToDate: OperationsPeriodMetrics;
}

function withinPeriod(date: string, bounds: OperationsPeriodBounds): boolean {
  return date >= bounds.from && date <= bounds.through;
}

function median(sortedValues: readonly number[]): number {
  const n = sortedValues.length;
  return n % 2 === 0
    ? (sortedValues[n / 2 - 1]! + sortedValues[n / 2]!) / 2
    : sortedValues[(n - 1) / 2]!;
}

function buildDurationMetric(
  units: readonly DeliveryUnit[],
  durationOf: (unit: DeliveryUnit) => number,
): OperationsDurationMetric {
  if (units.length === 0) {
    return { medianDays: undefined, minDays: undefined, maxDays: undefined, population: 0, deliveryUnitIds: [] };
  }
  const durations = units.map(durationOf).sort((a, b) => a - b);
  return {
    medianDays: median(durations),
    minDays: durations[0]!,
    maxDays: durations[durations.length - 1]!,
    population: units.length,
    deliveryUnitIds: units.map((u) => u.id),
  };
}

// Aktivität + Dauerpopulationen (asOf-sicher, B3/B4/B9): jede einbezogene ID
// stammt aus einer bereits vorhandenen DeliveryUnit, deren EIGENER
// Zeitstempel bereits <= bounds.through <= asOf liegt — spätere Starts/
// Abschlüsse können sich per Konstruktion nicht einschleichen, exakt dasselbe
// Prinzip wie computePeriodMetrics in sales-period-metrics.ts.
function computeActivityAndDuration(
  deliveryUnits: readonly DeliveryUnit[],
  bounds: OperationsPeriodBounds,
): { activity: OperationsActivityMetrics; durationFacts: OperationsDurationFacts } {
  const committed = deliveryUnits.filter((u) => withinPeriod(u.startDate, bounds));

  const started = deliveryUnits.filter(
    (u): u is DeliveryUnit & { actualStartDate: string } =>
      u.actualStartDate !== undefined && withinPeriod(u.actualStartDate, bounds),
  );

  const completed = deliveryUnits.filter(
    (u): u is DeliveryUnit & { actualStartDate: string; actualEndDate: string } =>
      u.actualStartDate !== undefined && u.actualEndDate !== undefined && withinPeriod(u.actualEndDate, bounds),
  );

  return {
    activity: {
      deliveryCommitmentsCreated: committed.length,
      deliveryCommitmentsCreatedDeliveryUnitIds: committed.map((u) => u.id),
      deliveriesStarted: started.length,
      deliveriesStartedDeliveryUnitIds: started.map((u) => u.id),
      deliveriesCompleted: completed.length,
      deliveriesCompletedDeliveryUnitIds: completed.map((u) => u.id),
    },
    durationFacts: {
      queueDurationDaysMedianForStartedDeliveries: buildDurationMetric(started, (u) =>
        daysBetween(u.startDate, u.actualStartDate!),
      ),
      deliveryDurationDaysMedianForCompletedDeliveries: buildDurationMetric(completed, (u) =>
        daysBetween(u.actualStartDate!, u.actualEndDate!),
      ),
    },
  };
}

// Bestand exakt zu bounds.through (B6/B9) — bewusst NICHT asOf: für die
// Periode "Gestern" ist bounds.through ein früherer Stichtag als asOf selbst.
// queued: dieselbe Population wie die "waiting"-Teilmenge in
// generateOperationsCurrentDeliveryQueueSnapshotObservation, hier zu
// bounds.through statt zu asOf ausgewertet. active: direkte Wiederverwendung
// von isDeliveryUnitActiveAt (world/delivery-units.ts) — keine zweite
// Aktiv-Definition.
function computeStockAtPeriodEnd(
  deliveryUnits: readonly DeliveryUnit[],
  bounds: OperationsPeriodBounds,
): OperationsStockAtPeriodEnd {
  const queued = deliveryUnits.filter(
    (u) => u.startDate <= bounds.through && (u.actualStartDate === undefined || u.actualStartDate > bounds.through),
  );
  const active = deliveryUnits.filter((u) => isDeliveryUnitActiveAt(u, bounds.through));

  return {
    queuedDeliveriesAtPeriodEnd: queued.length,
    queuedDeliveriesAtPeriodEndDeliveryUnitIds: queued.map((u) => u.id),
    activeDeliveriesAtPeriodEnd: active.length,
    activeDeliveriesAtPeriodEndDeliveryUnitIds: active.map((u) => u.id),
  };
}

function computePeriodMetrics(
  period: OperationsPeriodKey,
  bounds: OperationsPeriodBounds,
  deliveryUnits: readonly DeliveryUnit[],
): OperationsPeriodMetrics {
  const { activity, durationFacts } = computeActivityAndDuration(deliveryUnits, bounds);
  const stockAtPeriodEnd = computeStockAtPeriodEnd(deliveryUnits, bounds);
  return { period, bounds, activity, durationFacts, stockAtPeriodEnd };
}

export function generateOperationsPeriodMetrics(
  asOf: string,
  deliveryUnits: readonly DeliveryUnit[],
): OperationsPeriodMetricsSnapshot {
  const yesterdayDate = addDays(asOf, -1);
  const yesterdayBounds: OperationsPeriodBounds = { from: yesterdayDate, through: yesterdayDate };
  const weekToDateBounds: OperationsPeriodBounds = { from: startOfWeek(asOf), through: asOf };
  const monthToDateBounds: OperationsPeriodBounds = { from: startOfMonth(asOf), through: asOf };

  return {
    asOf,
    yesterday: computePeriodMetrics("yesterday", yesterdayBounds, deliveryUnits),
    weekToDate: computePeriodMetrics("week-to-date", weekToDateBounds, deliveryUnits),
    monthToDate: computePeriodMetrics("month-to-date", monthToDateBounds, deliveryUnits),
  };
}
