import { createRng, type Rng } from "../engine/seed";
import { addDays } from "../engine/random";
import { WORLD_NOW } from "../timeline/world-clock";
import type { Employee } from "./employees";
import type { Opportunity } from "../events/opportunities";
import type { OperationsScenarioConfig } from "../engine/scenario-profiles";

// Operations = Customer Onboarding / Implementation / Delivery nach gewonnenem Deal
// (freigegebene Domain Decision, Reference World v2 / Operations Foundation). Jede
// DeliveryUnit ist zwingend auf eine real existierende, tatsächlich gewonnene
// Opportunity zurückführbar — opportunityId ist Pflichtfeld, niemals eine frei
// erfundene Zuordnung. accountId ist bewusst 1:1 von opportunity.accountId
// übernommen, nicht neu nachgeschlagen (dieselbe Redundanz-Begründung wie bei
// Opportunity.accountId selbst: bewusste, invariantengeprüfte Redundanz für
// Queries).
//
// Real Delivery Lifecycle V1, korrigiert nach verbindlicher CEO-Entscheidung
// "Delivery Commitment Truth" (siehe events/delivery-lifecycle.ts): eine
// Lieferverpflichtung entsteht ausschließlich durch eine gewonnene Opportunity —
// mit dem Won-Zeitpunkt entsteht dabei KEINE automatische Fristzusage. startDate
// bleibt unverändert exakt opportunity.closedAt (Backward Explainability, Prinzip
// 18, Wert unverändert) — honest als Queue-Zeitpunkt dokumentiert: die
// Lieferverpflichtung entsteht und wird eingereiht, sobald der Deal gewonnen ist
// (kein Datum vor dem Won-Zeitpunkt wäre referenzierbar, ein künstlich verzögertes
// "Einreihungs"-Datum ohne Quelle wäre erfundene Prozessverzögerung).
// actualStartDate: der tatsächliche Beginn der Leistungserbringung, deterministisch
// entity-stabil nach startDate versetzt (Queue-Wartezeit) — nur gesetzt, wenn
// startDate + Wartezeit <= WORLD_NOW liegt (kein Future Knowledge, dasselbe Muster
// wie actualEndDate). actualEndDate: echte, unabhängig streuende tatsächliche
// Lieferdauer ab actualStartDate.
//
// plannedEndDate ist bewusst optional und in der aktuellen Reference World bei
// JEDER DeliveryUnit undefined — es existiert keine kanonische Quelle für ein
// zugesagtes/geplantes Enddatum (kein Vertrag, kein CRM-Termin, kein
// Projektmanagement-Datum in diesem Modell). Eine frühere Version dieses Feldes
// leitete plannedEndDate automatisch aus startDate + einer fixen 30-Tage-Konstante
// ab — das war eine erfundene Zusage ohne fachliche Grundlage und wurde entfernt.
// plannedEndDate darf ausschließlich befüllt werden, sobald eine echte
// Plan-/Vertrags-/Projektmanagementquelle existiert (siehe Canonical Operations
// Event Blueprint, `HandoffConfirmed`/künftige Planungsevents) — niemals aus Won-,
// Queue-, Start- oder tatsächlicher Dauer abgeleitet.
export interface DeliveryUnit {
  id: string;
  opportunityId: string;
  accountId: string;
  assignedEmployeeId: string;
  startDate: string;
  actualStartDate?: string;
  plannedEndDate?: string;
  actualEndDate?: string;
  status: "eingereiht" | "laufend" | "abgeschlossen";
}

// Real Delivery Lifecycle V1 — Kalibrierung der TATSÄCHLICHEN Zeiten (siehe
// Abschlussbericht "Delivery Commitment Truth + Event Source of Truth"): Queue-
// Wartezeit (Queue → tatsächlicher Start) und tatsächliche Lieferdauer (Start →
// tatsächlicher Abschluss) sind reale, deterministisch variierende
// Reference-World-Tatsachen — unabhängig von jeder Planzusage, die es nicht gibt.
// 18-42 Tage bleibt der kleinste plausible synthetische Bereich für die
// tatsächliche Lieferdauer: erzeugt bereits bei den 79 Baseline-Units ausreichend
// unterschiedliche Fälle (kurze/lange Lieferung, eingereiht/aktiv/abgeschlossen bei
// WORLD_NOW — siehe Abschlussbericht, Phase 5.3-Messung), bleibt unabhängig von der
// Queue-Dauer (getrennte RNG-Ziehung), keine unmöglichen Zeitfolgen. Transparente,
// synthetische Reference-World-Kalibrierung — keine Branchenbenchmark-Behauptung,
// keine Aussage über Planerfüllung.
export const QUEUE_DELAY_MIN_DAYS = 0;
export const QUEUE_DELAY_MAX_DAYS = 8;
export const ACTUAL_DELIVERY_DURATION_MIN_DAYS = 18;
export const ACTUAL_DELIVERY_DURATION_MAX_DAYS = 42;

function isActiveOperationsEmployee(employee: Employee): boolean {
  return employee.departmentId === "dept-operations" && employee.terminatedAt === undefined;
}

// Dieselbe Fair-Share-mit-realistischer-Schieflage-Methode wie
// pickWeightedByInverseLoad in world/account-ownership.ts (dort ausführlich
// begründet: reine Gleichverteilung wäre ein unrealistisches Generierungsartefakt,
// vollständig zufällige Zuteilung würde die spätere Fair-Share-Observation trivial
// machen). Lokal dupliziert statt importiert — dieselbe, bereits etablierte
// Konvention kleiner, dateilokaler Duplikate statt einer neuen geteilten
// Utility-Datei (siehe z. B. isEmployeeActiveAt in mehreren events/-/world/-Dateien).
// overloadWeights (Phase 12, "concentrated"-Modus): exakt dieselbe Mechanik wie
// overloadWeights in pickWeightedByInverseLoad (account-ownership.ts) — Standard 1
// (keine Wirkung), entspricht bei "balanced" unverändert der bisherigen Logik.
function pickByInverseLoad(
  rng: Rng,
  candidates: readonly Employee[],
  load: Map<string, number>,
  overloadWeights: ReadonlyMap<string, number>,
): Employee {
  const weights = candidates.map((e) => (1 / (1 + (load.get(e.id) ?? 0))) * (overloadWeights.get(e.id) ?? 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) {
      return candidates[i]!;
    }
  }
  return candidates[candidates.length - 1]!;
}

// Entity-stabiler Lifecycle-RNG-Teilstrom je Opportunity (dasselbe, bereits
// etablierte Präzedenzmuster wie MARKETING_DEMAND_SEED_OFFSET in
// events/generate-sales-pipeline.ts): ein fester additiver Offset plus eine aus
// opportunity.id abgeleitete, garantiert stabile Zahl — NICHT die Position in
// wonOpportunities (die sich verschieben würde, sobald irgendeine andere
// Opportunity gewonnen wird oder wegfällt — verboten laut Real-Delivery-Lifecycle-
// Auftrag, Phase 4.1/4.2). opportunity.id hat das feste Format "opp-NNNNN"
// (nextOppId() in generate-sales-pipeline.ts) — die eingebettete Zahl ist ein von
// Iterationsreihenfolge und Teilmenge vollständig unabhängiger, intrinsischer
// Schlüssel der Opportunity selbst. Die bestehende pickByInverseLoad-Zuweisung
// (assignedEmployeeId) bleibt bewusst unverändert auf dem gemeinsamen,
// sequenziellen rng-Strom — das ist der bereits freigegebene, getestete
// Fair-Share-Mechanismus (Phase 12/13) und nicht Teil dieses Auftrags; nur die NEUE
// Lifecycle-Zeitsteuerung erhält den zusätzlichen entity-stabilen Teilstrom.
const DELIVERY_LIFECYCLE_SEED_OFFSET = 20_000_000;

function opportunityNumericKey(opportunityId: string): number {
  const match = /^opp-(\d+)$/.exec(opportunityId);
  if (!match) {
    throw new Error(`generateDeliveryUnits: unerwartetes Opportunity-ID-Format "${opportunityId}"`);
  }
  return parseInt(match[1]!, 10);
}

function sampleDeliveryLifecycle(
  lifecycleRng: Rng,
  queuedAt: string,
): { actualStartDate: string; actualEndDateRaw: string } {
  // Feste Ziehungsreihenfolge (Queue-Verzögerung zuerst, dann Lieferdauer) —
  // deterministisch, entity-lokal, beeinflusst keinen anderen Teilstrom. Beide
  // Werte sind reale, tatsächliche Zeiten — keiner davon wird gegen eine Planzusage
  // berechnet, weil keine existiert.
  const queueDelayDays =
    Math.floor(lifecycleRng() * (QUEUE_DELAY_MAX_DAYS - QUEUE_DELAY_MIN_DAYS + 1)) + QUEUE_DELAY_MIN_DAYS;
  const deliveryDurationDays =
    Math.floor(lifecycleRng() * (ACTUAL_DELIVERY_DURATION_MAX_DAYS - ACTUAL_DELIVERY_DURATION_MIN_DAYS + 1)) +
    ACTUAL_DELIVERY_DURATION_MIN_DAYS;

  const actualStartDate = addDays(queuedAt, queueDelayDays);
  const actualEndDateRaw = addDays(actualStartDate, deliveryDurationDays);

  return { actualStartDate, actualEndDateRaw };
}

const DEFAULT_OPERATIONS_SCENARIO_CONFIG: OperationsScenarioConfig = {
  assignmentStrategy: "balanced",
  concentratedEmployeeIds: [],
  concentrationWeightMultiplier: 1,
};

export function generateDeliveryUnits(
  seed: number,
  opportunities: readonly Opportunity[],
  employees: readonly Employee[],
  config: OperationsScenarioConfig = DEFAULT_OPERATIONS_SCENARIO_CONFIG,
): DeliveryUnit[] {
  const rng = createRng(seed);
  const operationsEmployees = employees.filter(isActiveOperationsEmployee);
  const load = new Map<string, number>();
  const units: DeliveryUnit[] = [];

  if (operationsEmployees.length === 0) {
    return units;
  }

  // "balanced" (Standard, alle 6 bestehenden Scenario Profiles): leere Map, jedes
  // Gewicht defaultet über "?? 1" auf 1 — identisch zum bisherigen Verhalten vor
  // Phase 12. "concentrated": dieselbe Mechanik wie overloadedEmployeeIds/
  // overloadWeightMultiplier bei Sales (team-engpass), hier auf die konfigurierten
  // Operations-Mitarbeiter angewendet.
  const overloadWeights = new Map<string, number>(
    config.assignmentStrategy === "concentrated"
      ? config.concentratedEmployeeIds.map((id) => [id, config.concentrationWeightMultiplier])
      : [],
  );

  let counter = 1;
  const nextId = () => `delivery-${String(counter++).padStart(5, "0")}`;

  const wonOpportunities = opportunities.filter(
    (o): o is Opportunity & { closedAt: string } => o.currentStage === "gewonnen" && o.closedAt !== undefined,
  );

  for (const opportunity of wonOpportunities) {
    const assignee = pickByInverseLoad(rng, operationsEmployees, load, overloadWeights);
    load.set(assignee.id, (load.get(assignee.id) ?? 0) + 1);

    const startDate = opportunity.closedAt;
    const lifecycleRng = createRng(seed + DELIVERY_LIFECYCLE_SEED_OFFSET + opportunityNumericKey(opportunity.id));
    const { actualStartDate, actualEndDateRaw } = sampleDeliveryLifecycle(lifecycleRng, startDate);

    // Future-Knowledge-Schutz (unverändertes Muster wie zuvor bei actualEndDate):
    // ein deterministisch berechneter, aber noch in der Zukunft liegender
    // Zeitpunkt relativ zu WORLD_NOW wird nicht als bereits eingetretene Wahrheit
    // gespeichert.
    const hasStarted = actualStartDate <= WORLD_NOW;
    const hasCompleted = actualEndDateRaw <= WORLD_NOW;

    units.push({
      id: nextId(),
      opportunityId: opportunity.id,
      accountId: opportunity.accountId,
      assignedEmployeeId: assignee.id,
      startDate,
      actualStartDate: hasStarted ? actualStartDate : undefined,
      // plannedEndDate bleibt undefined — keine kanonische Planquelle vorhanden
      // (siehe DeliveryUnit-Dokumentation oben).
      plannedEndDate: undefined,
      actualEndDate: hasCompleted ? actualEndDateRaw : undefined,
      status: hasCompleted ? "abgeschlossen" : hasStarted ? "laufend" : "eingereiht",
    });
  }

  return units;
}

// Zeitpunktbezogene Aktivitäts-Prüfung (Operations Foundation, Schritt 2, Phase 6;
// Semantik seit Real Delivery Lifecycle V1 korrigiert): "aktiv" bedeutet jetzt
// tatsächlich gestartet (actualStartDate), nicht mehr bloß eingereiht (startDate).
// Eine eingereihte, aber noch nicht gestartete Unit ist NICHT aktiv (Real Delivery
// Lifecycle V1, Phase 3.3: "Ein Snapshot zu einem Zeitpunkt vor
// DeliveryStarted.startedAt darf die Unit nicht als aktiv behandeln"). Dieselbe
// exklusive Enddatums-Konvention wie bei OpportunityStageHistory in
// snapshot/snapshot.ts ("e.exitedAt === undefined || asOf < e.exitedAt"), nicht die
// inklusive Gültigkeitsintervall-Konvention von AccountOwnership
// ("asOf <= validTo") — am Tag von actualEndDate selbst ist die Unit bereits
// abgeschlossen, nicht mehr aktiv.
export function isDeliveryUnitActiveAt(unit: DeliveryUnit, asOf: string): boolean {
  return (
    unit.actualStartDate !== undefined &&
    unit.actualStartDate <= asOf &&
    (unit.actualEndDate === undefined || asOf < unit.actualEndDate)
  );
}

export function activeDeliveryUnitsAt(units: readonly DeliveryUnit[], asOf: string): DeliveryUnit[] {
  return units.filter((u) => isDeliveryUnitActiveAt(u, asOf));
}

// Vollständige 3-Wege-Statusableitung (Real Delivery Lifecycle V1, Phase 3.1/3.2):
// Events sind die zeitliche Source of Truth, dieser Status wird ausschließlich aus
// den bereits vorhandenen Lifecycle-Zeitstempeln abgeleitet, keine zweite,
// unabhängig widersprüchliche Wahrheit. Nur sinnvoll für Units, die zu asOf bereits
// existieren (startDate <= asOf) — exakt dieselbe Existenz-Voraussetzung, die
// snapshot.ts bereits für deliveryUnits durchsetzt, bevor diese Funktion aufgerufen
// wird.
export function deliveryUnitStatusAt(unit: DeliveryUnit, asOf: string): "eingereiht" | "laufend" | "abgeschlossen" {
  if (unit.actualEndDate !== undefined && asOf >= unit.actualEndDate) {
    return "abgeschlossen";
  }
  if (unit.actualStartDate !== undefined && unit.actualStartDate <= asOf) {
    return "laufend";
  }
  return "eingereiht";
}
