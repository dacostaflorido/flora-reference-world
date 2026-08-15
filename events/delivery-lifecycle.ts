import type { DeliveryUnit } from "../world/delivery-units";

// Real Delivery Lifecycle V1, korrigiert nach verbindlicher CEO-Entscheidung
// "Delivery Commitment Truth": eine Lieferverpflichtung entsteht ausschließlich
// durch eine gewonnene Opportunity, ohne automatische Fristzusage. Die drei
// kleinsten fachlich notwendigen Eventtypen lösen den Delivery-Lifecycle in
// unterscheidbare, zeitlich nachvollziehbare Schritte auf: Won → DeliveryQueued
// (Commitment entsteht) → DeliveryStarted (tatsächlicher Beginn) →
// DeliveryCompleted (tatsächlicher Abschluss). Kein plannedEndDate/keine
// Fristzusage in irgendeinem dieser drei Events — ein zugesagtes Enddatum existiert
// in diesem Modell schlicht nicht (siehe world/delivery-units.ts,
// DeliveryUnit.plannedEndDate-Dokumentation).
//
// Source of Truth (Delivery-Commitment-Truth-Auftrag, Phase 4): DeliveryUnit bleibt
// die generierte Wahrheit, Events sind eine reine, beweisbar widerspruchsfreie
// Projektion davon (Variante A) — nicht umgekehrt. Das ist keine Verkürzung,
// sondern deckt sich mit Prinzip 6 (World Before Events): DeliveryUnit ist eine
// World-Entität (world/delivery-units.ts), Events entstehen aus der bestehenden
// Welt, nicht die Welt aus Events. Jede Feldzuweisung unten ist ein direkter,
// wörtlicher Lesezugriff auf ein bereits vorhandenes DeliveryUnit-Feld
// (unit.startDate/unit.actualStartDate/unit.actualEndDate) — keine unabhängige
// Neuberechnung, kein zweiter RNG-Aufruf, keine Möglichkeit einer Abweichung.
// Dasselbe, bereits etablierte Muster wie EmployeeHired/EmployeeTerminated
// (events/employee-lifecycle.ts), die ebenfalls aus bereits vorhandenen
// Employee-Feldern materialisiert werden. Variante B (Events zuerst, DeliveryUnit
// daraus projiziert) würde Prinzip 6 verletzen; Variante C (zusätzlicher
// interner kanonischer Lifecycle-Record) wurde geprüft und verworfen — sie würde
// eine dritte Struktur ohne Mehrwert einführen, wo Variante A bereits beweisbar
// keine doppelte Wahrheit erzeugt.
//
// deliveryUnitId ist der verpflichtende Anker für Backward Explainability
// (Prinzip 18): jedes Event ist darüber bis zu DeliveryUnit → Opportunity →
// Account/closedAt zurückverfolgbar. Event-IDs werden direkt aus der bereits
// eindeutigen DeliveryUnit.id abgeleitet, kein eigener Zähler.
//
// In ScenarioWorld verdrahtet (engine/generator.ts, Delivery-Commitment-Truth-
// Auftrag Phase 4.3): reproduzierbar abrufbar für den nachfolgenden Operations
// Observation Evidence Audit, ohne WorldSnapshotSource/Ground
// Truth/Observations/index.ts zu berühren — eine World-Integration impliziert
// hier ausdrücklich keine neue Observation, keinen KPI, keinen State und keinen
// Public-Contract-Zugriff.

export interface DeliveryQueued {
  id: string;
  deliveryUnitId: string;
  opportunityId: string;
  accountId: string;
  queuedAt: string;
}

export interface DeliveryStarted {
  id: string;
  deliveryUnitId: string;
  startedAt: string;
}

export interface DeliveryCompleted {
  id: string;
  deliveryUnitId: string;
  completedAt: string;
}

function queuedEventId(unit: DeliveryUnit): string {
  return `delivery-queued-${unit.id}`;
}

function startedEventId(unit: DeliveryUnit): string {
  return `delivery-started-${unit.id}`;
}

function completedEventId(unit: DeliveryUnit): string {
  return `delivery-completed-${unit.id}`;
}

// 1:1 zu jeder DeliveryUnit — die Lieferverpflichtung entsteht und wird
// eingereiht, sobald sie existiert (queuedAt == DeliveryUnit.startDate, siehe
// world/delivery-units.ts für die vollständige Begründung dieses Ankers).
export function generateDeliveryQueuedEvents(units: readonly DeliveryUnit[]): DeliveryQueued[] {
  return units.map((unit) => ({
    id: queuedEventId(unit),
    deliveryUnitId: unit.id,
    opportunityId: unit.opportunityId,
    accountId: unit.accountId,
    queuedAt: unit.startDate,
  }));
}

// Nur für Units, die zu WORLD_NOW bereits tatsächlich gestartet sind
// (DeliveryUnit.actualStartDate ist bereits Future-Knowledge-sicher gesetzt, siehe
// world/delivery-units.ts) — kein Start Event für eine noch nicht gestartete
// Unit.
export function generateDeliveryStartedEvents(units: readonly DeliveryUnit[]): DeliveryStarted[] {
  return units
    .filter((unit): unit is DeliveryUnit & { actualStartDate: string } => unit.actualStartDate !== undefined)
    .map((unit) => ({
      id: startedEventId(unit),
      deliveryUnitId: unit.id,
      startedAt: unit.actualStartDate,
    }));
}

// Nur für Units, die zu WORLD_NOW bereits tatsächlich abgeschlossen sind — kein
// Completion Event für eine noch laufende oder eingereihte Unit (Prinzip 5/6,
// keine zukünftigen Abschlussereignisse als bereits bekannte Wahrheit).
export function generateDeliveryCompletedEvents(units: readonly DeliveryUnit[]): DeliveryCompleted[] {
  return units
    .filter((unit): unit is DeliveryUnit & { actualEndDate: string } => unit.actualEndDate !== undefined)
    .map((unit) => ({
      id: completedEventId(unit),
      deliveryUnitId: unit.id,
      completedAt: unit.actualEndDate,
    }));
}
