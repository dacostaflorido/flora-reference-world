import { startOfWeek, startOfMonth } from "../timeline/calendar";
import { addDays } from "../engine/random";
import type { SalesAppointmentBooked, SalesAppointmentHeld } from "../events/sales-appointment-lifecycle";
import type { Opportunity } from "../events/opportunities";

// Sales Period KPI Foundation V1 — rein deskriptive Sales-Zeitraumebene
// (Auftrag "Sales Appointment Checkpoint + Sales Period KPI Foundation V1").
// Implementiert AUSSCHLIESSLICH Bereichszahlen der Ebene 1 der später
// geplanten Executive-Capability-Architektur (Source Events → Zeitraum-KPIs →
// Observations → Capability State → Cross-Domain Constraint → Executive
// Decision Requirement, siehe "Executive Capability & Decision Architecture
// Audit") — keine Rate, keine Bewertung, kein State, keine Empfehlung.
//
// --- B1: Architekturforensik — Ablageentscheidung ---------------------------
//
// Diese Datei erzeugt KEINE zweite Wahrheit: sie liest ausschließlich bereits
// vorhandene, an anderer Stelle generierte Fakten (SalesAppointmentBooked/
// -Held-Events aus events/sales-appointment-lifecycle.ts, Opportunity.closedAt
// aus events/opportunities.ts) und bündelt sie nach drei deterministischen
// Kalenderperioden — reine Filterung/Zählung, kein neuer Zufallsstrom, keine
// neue Fachregel.
//
// Bewusst NICHT in `company/company-executive-kpis.ts` (CompanyExecutiveKpiData)
// integriert, obwohl diese Datei strukturell das nächstliegende Vorbild ist:
// deren eigener Kopfkommentar hält bereits fest, dass Kalender-/
// Darstellungsperioden (Gestern/Woche/Monat) BEWUSST NICHT Teil dieses
// Contracts sind ("das bleibt Aufgabe des Consumers, damit die Reference World
// frei von UI-/Reporting-Kalenderlogik bleibt") — UND `CompanyExecutiveKpiData`
// ist bereits Teil des Public Contracts (index.ts exportiert diesen Typ). Eine
// Erweiterung dort hätte zwangsläufig entweder diese frühere, dokumentierte
// Entscheidung widersprochen oder einen Public-Contract-Eingriff erzwungen —
// beides vermeidet dieser Auftrag ausdrücklich (B7: "kein Public-Contract-
// Eingriff, sofern nicht architektonisch zwingend"). Diese Datei bleibt daher
// eine eigenständige, NICHT über index.ts exportierte Struktur — exakt
// dieselbe Sichtbarkeitsstufe wie world/sales-appointments.ts selbst. Eine
// spätere, eigene Auftragsfreigabe kann sie bei Bedarf explizit in den Public
// Contract aufnehmen; das ist ausdrücklich NICHT Teil dieses Auftrags.
//
// Bewusst NICHT über snapshot/snapshot.ts (WorldSnapshot) geleitet: WorldSnapshot
// enthält heute keine SalesAppointment-Daten (additiv seit dem letzten Auftrag
// nur in ScenarioWorldTruth, nicht im Snapshot verdrahtet — eine Erweiterung
// von snapshot.ts wäre ein zusätzlicher, hier nicht beauftragter Eingriff in
// eine bereits große, vollständig getestete Datei gewesen). Stattdessen liest
// diese Funktion direkt die bereits vollständig generierten, bis WORLD_NOW
// bekannten Booked-/Held-Event-Arrays sowie Opportunities — jede Zählung
// filtert ausschließlich nach dem EIGENEN, bereits vorhandenen Ereigniszeit-
// stempel (bookedAt/heldAt/closedAt) gegen die Periodengrenzen. Das ist
// beweisbar Future-Knowledge-sicher (siehe unten), ohne eine zweite
// asOf-Rekonstruktionslogik neben der bereits bestehenden
// (appointmentStatusAt, world/sales-appointments.ts) einzuführen — diese wird
// hier bewusst NICHT verwendet, weil sie eine andere Frage beantwortet ("wie
// ist der AKTUELLE Zustand eines Termins zu einem historischen asOf", inkl.
// Reschedule-Kettenauflösung) als die hier verlangte, einfachere Frage ("liegt
// der EIGENE Ereigniszeitpunkt dieses bereits eingetretenen Events in der
// Periode").
//
// --- B2: Periodendefinitionen ------------------------------------------------
//
// Drei feste, deterministisch aus asOf abgeleitete Perioden — KEINE
// rollierenden Zeitfenster:
// - "yesterday": genau der Kalendertag vor asOf (from === through).
// - "week-to-date": Montag der laufenden Woche bis einschließlich asOf
//   (Montag als Wochenbeginn, siehe timeline/calendar.ts, startOfWeek).
// - "month-to-date": erster Kalendertag des laufenden Monats bis
//   einschließlich asOf (timeline/calendar.ts, startOfMonth).
// Date-only (siehe timeline/calendar.ts für die vollständige Begründung, warum
// keine Uhrzeit/Zeitzone eingeführt wird).
//
// --- B3: Zählsemantik (Aktivitätslogik, keine Cohort-Logik) ------------------
//
// 1) Erstgespräche terminiert: SalesAppointmentBooked, appointmentType
//    "first-call", gezählt nach bookedAt. Reschedules erzeugen kein
//    zusätzliches Booked-Event (siehe events/sales-appointment-lifecycle.ts —
//    pro Appointment existiert immer genau EIN Booked-Event) und zählen daher
//    automatisch, ohne Sonderbehandlung, nicht erneut. Ein Rebooking ist ein
//    komplett NEUER Appointment mit eigener id und eigenem bookedAt (siehe
//    world/sales-appointments.ts, rebookedFromAppointmentId) — erzeugt also
//    automatisch ein neues, eigenständiges Booked-Event im Zeitraum seines
//    eigenen bookedAt.
// 2) Erstgespräche stattgefunden: SalesAppointmentHeld, appointmentType
//    "first-call", gezählt nach heldAt. Scheduled/No-Show/Cancelled erzeugen
//    kein Held-Event (siehe generateSalesAppointmentHeldEvents) und zählen
//    daher strukturell nicht mit.
// 3)/4) Strategiegespräche: identische Regeln, appointmentType "strategy-call".
// 5) Gewonnene Kunden/Opportunities: siehe Forensik-Ergebnis unten (B3,
//    Kunden-/Won-Forensik).
//
// --- B3, Kunden-/Won-Forensik: Ergebnis --------------------------------------
//
// Untersucht: entsteht im bestehenden Modell ein kanonisches "neuer Kunde"-
// Ereignis? Existiert eine 1:1-Beziehung zwischen einer gewonnenen Opportunity
// und einem NEUEN Kunden?
//
// Befund (empirisch gemessen, Referenzwelt WORLD_NOW): 79 gewonnene
// Opportunities verteilen sich auf nur 58 eindeutige Accounts — 17 Accounts
// besitzen MEHR ALS EINE gewonnene Opportunity (Repeat-/Erweiterungsgeschäft).
// Das bestehende Modell kennt dieses Phänomen bereits explizit als eigenen
// Observation-Fund (`chance-account-repeat-business`,
// observations/observations.ts). Variante B (1:1 Won-Opportunity = neuer
// Kunde) ist damit NACHWEISLICH FALSCH — eine zweite oder dritte gewonnene
// Opportunity an einem bereits zuvor gewonnenen Account ist kein neuer Kunde,
// sondern Bestandskundengeschäft.
//
// Kein kanonisches "Customer Acquired"-Ereignis existiert im Modell (Variante
// A entfällt): `CustomerAccount.createdAt` markiert die Account-ANLAGE im
// Prospect-Pool, nicht "Kunde seit" — exakt dieselbe Grenze, die bereits
// company/company-executive-kpis.ts unabhängig dokumentiert ("Neukunden ...
// nicht belegbar als 'Kunde seit'").
//
// Gewählt: **Variante C** — ausschließlich "gewonnene Opportunities" gezählt
// und benannt (`wonOpportunities`), NIEMALS "Kunden". Kanonischer
// Ereigniszeitpunkt: `Opportunity.closedAt` — empirisch gegen die parallele
// Stage-History-Quelle geprüft (alle 79 gewonnenen Opportunities: `closedAt`
// ist in jedem Fall exakt identisch zum `enteredAt` des zugehörigen
// OpportunityStageHistory-Eintrags mit stage="gewonnen", 0 Abweichungen) —
// `closedAt` ist damit nachweislich der kanonische, bereits an anderer Stelle
// bestätigte Won-Zeitpunkt, keine neue Zeitquelle.

export type SalesPeriodKey = "yesterday" | "week-to-date" | "month-to-date";

export interface SalesPeriodBounds {
  from: string;
  through: string;
}

// Getrennte Evidenzlisten je Kennzahl (Auftrag B5, ausdrücklich bevorzugt
// gegenüber einer unstrukturierten gemeinsamen derivedFrom-Liste) — jede Liste
// referenziert ausschließlich IDs innerhalb der jeweiligen Periode, ohne
// Duplikate (jede Appointment besitzt höchstens ein Booked- und höchstens ein
// Held-Event je Terminart, jede Opportunity höchstens ein Won-Ereignis).
export interface SalesPeriodMetrics {
  period: SalesPeriodKey;
  bounds: SalesPeriodBounds;
  firstCallsBooked: number;
  firstCallsHeld: number;
  strategyCallsBooked: number;
  strategyCallsHeld: number;
  wonOpportunities: number;
  firstCallsBookedAppointmentIds: string[];
  firstCallsHeldAppointmentIds: string[];
  strategyCallsBookedAppointmentIds: string[];
  strategyCallsHeldAppointmentIds: string[];
  wonOpportunityIds: string[];
}

export interface SalesPeriodMetricsSnapshot {
  asOf: string;
  yesterday: SalesPeriodMetrics;
  weekToDate: SalesPeriodMetrics;
  monthToDate: SalesPeriodMetrics;
}

function withinPeriod(date: string, bounds: SalesPeriodBounds): boolean {
  return date >= bounds.from && date <= bounds.through;
}

// asOf-sicher (B6): jede einbezogene ID stammt aus einem Event/einer
// Opportunity, deren EIGENER Zeitstempel bereits <= bounds.through <= asOf
// liegt — spätere Reschedules, Outcomes oder Won-Ereignisse können sich per
// Konstruktion nicht einschleichen (sie tragen ihren eigenen, späteren
// Zeitstempel und fallen aus dem Filter, unabhängig vom aktuellen Stand der
// zugehörigen Appointment/Opportunity zu WORLD_NOW).
function computePeriodMetrics(
  period: SalesPeriodKey,
  bounds: SalesPeriodBounds,
  bookedEvents: readonly SalesAppointmentBooked[],
  heldEvents: readonly SalesAppointmentHeld[],
  opportunities: readonly Opportunity[],
): SalesPeriodMetrics {
  const firstCallsBookedAppointmentIds = bookedEvents
    .filter((e) => e.appointmentType === "first-call" && withinPeriod(e.bookedAt, bounds))
    .map((e) => e.appointmentId);
  const firstCallsHeldAppointmentIds = heldEvents
    .filter((e) => e.appointmentType === "first-call" && withinPeriod(e.heldAt, bounds))
    .map((e) => e.appointmentId);
  const strategyCallsBookedAppointmentIds = bookedEvents
    .filter((e) => e.appointmentType === "strategy-call" && withinPeriod(e.bookedAt, bounds))
    .map((e) => e.appointmentId);
  const strategyCallsHeldAppointmentIds = heldEvents
    .filter((e) => e.appointmentType === "strategy-call" && withinPeriod(e.heldAt, bounds))
    .map((e) => e.appointmentId);
  const wonOpportunityIds = opportunities
    .filter((o): o is Opportunity & { closedAt: string } => o.currentStage === "gewonnen" && o.closedAt !== undefined && withinPeriod(o.closedAt, bounds))
    .map((o) => o.id);

  return {
    period,
    bounds,
    firstCallsBooked: firstCallsBookedAppointmentIds.length,
    firstCallsHeld: firstCallsHeldAppointmentIds.length,
    strategyCallsBooked: strategyCallsBookedAppointmentIds.length,
    strategyCallsHeld: strategyCallsHeldAppointmentIds.length,
    wonOpportunities: wonOpportunityIds.length,
    firstCallsBookedAppointmentIds,
    firstCallsHeldAppointmentIds,
    strategyCallsBookedAppointmentIds,
    strategyCallsHeldAppointmentIds,
    wonOpportunityIds,
  };
}

export function generateSalesPeriodMetrics(
  asOf: string,
  bookedEvents: readonly SalesAppointmentBooked[],
  heldEvents: readonly SalesAppointmentHeld[],
  opportunities: readonly Opportunity[],
): SalesPeriodMetricsSnapshot {
  const yesterdayDate = addDays(asOf, -1);
  const yesterdayBounds: SalesPeriodBounds = { from: yesterdayDate, through: yesterdayDate };
  const weekToDateBounds: SalesPeriodBounds = { from: startOfWeek(asOf), through: asOf };
  const monthToDateBounds: SalesPeriodBounds = { from: startOfMonth(asOf), through: asOf };

  return {
    asOf,
    yesterday: computePeriodMetrics("yesterday", yesterdayBounds, bookedEvents, heldEvents, opportunities),
    weekToDate: computePeriodMetrics("week-to-date", weekToDateBounds, bookedEvents, heldEvents, opportunities),
    monthToDate: computePeriodMetrics("month-to-date", monthToDateBounds, bookedEvents, heldEvents, opportunities),
  };
}
