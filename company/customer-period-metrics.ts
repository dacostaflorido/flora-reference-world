import { startOfWeek, startOfMonth } from "../timeline/calendar";
import { addDays } from "../engine/random";
import type { Opportunity } from "../events/opportunities";
import { generateCustomerAcquisitionLifecycle } from "./customer-acquisition-lifecycle";

// Customer Period Metrics V1 (Auftrag "Customer Lifecycle Checkpoint +
// Customer Period Metrics + Cohort CAC V1", Phase B1-B4) — rein deskriptive
// Zeitraumebene darüber, WIE VIELE Accounts in einer Kalenderperiode
// erstmals zum Kunden wurden. Baut auf der bereits kanonischen
// `generateCustomerAcquisitionLifecycle` auf (keine zweite Won-/Acquisition-
// Wahrheit) — zählt ausschließlich bereits dort abgeleitete
// `CustomerAcquired`-Fakten nach `acquiredAt`, niemals Won-Opportunities,
// Account- oder Opportunity-Erstellungsdaten. NICHT über index.ts
// exportiert — dieselbe Sichtbarkeitsstufe wie
// company/customer-acquisition-lifecycle.ts, company/sales-period-metrics.ts
// und company/marketing-cohort-cost-metrics.ts.
//
// --- B2/B3: Periodengrenzen + Zählregel -----------------------------------
//
// Dieselben drei Kalenderperioden wie Sales Period Metrics und Marketing
// Period Metrics — keine zweite Kalenderimplementierung, dieselben Helfer
// (timeline/calendar.ts: startOfWeek/startOfMonth):
// - "yesterday": genau der Kalendertag vor `asOf`.
// - "week-to-date": Montag der laufenden Woche bis einschließlich `asOf`.
// - "month-to-date": erster Kalendertag des laufenden Monats bis
//   einschließlich `asOf`.
// Ein Kunde zählt in einer Periode genau dann, wenn
// `bounds.from <= acquiredAt <= bounds.through` — NICHT nach
// Account-Erstellung, Opportunity-Erstellung, Strategy Call, Repeat-Win,
// Delivery-Start oder aktuellem Kundenbestand. Da
// `generateCustomerAcquisitionLifecycle` bereits selbst nach `asOf` filtert
// (siehe dort, B6), ist `acquiredAt <= asOf` strukturell bereits erfüllt,
// bevor die Periodengrenzen überhaupt geprüft werden — kein zusätzlicher
// Future-Knowledge-Pfad möglich.
//
// Beantwortet: "Wie viele Kunden wurden in diesem Zeitraum NEU akquiriert?"
// Beantwortet NICHT: "Wie viele Kunden besitzt das Unternehmen insgesamt?"
// (das wäre die volle Länge von `lifecycle.customerRelationships`, hier
// bewusst nicht berichtet).

export type CustomerPeriodKey = "yesterday" | "week-to-date" | "month-to-date";

export interface CustomerPeriodBounds {
  from: string;
  through: string;
}

// B4: vollständige Evidenz je Periodenzahl — jede Liste eindeutig, keine
// ID außerhalb der Periode, kein Repeat-Win (CustomerAcquired referenziert
// strukturell immer nur die akquirierende, niemals eine spätere Won-
// Opportunity, siehe customer-acquisition-lifecycle.ts).
export interface CustomerAcquisitionPeriodMetric {
  period: CustomerPeriodKey;
  bounds: CustomerPeriodBounds;
  customersAcquired: number;
  customerAcquiredEventIds: string[];
  accountIds: string[];
  acquiringOpportunityIds: string[];
}

export interface CustomerAcquisitionPeriodMetricsSnapshot {
  asOf: string;
  yesterday: CustomerAcquisitionPeriodMetric;
  weekToDate: CustomerAcquisitionPeriodMetric;
  monthToDate: CustomerAcquisitionPeriodMetric;
}

function buildPeriodMetric(period: CustomerPeriodKey, bounds: CustomerPeriodBounds, customerAcquiredEvents: ReturnType<typeof generateCustomerAcquisitionLifecycle>["customerAcquiredEvents"]): CustomerAcquisitionPeriodMetric {
  const inPeriod = customerAcquiredEvents.filter((e) => e.acquiredAt >= bounds.from && e.acquiredAt <= bounds.through);
  return {
    period,
    bounds,
    customersAcquired: inPeriod.length,
    customerAcquiredEventIds: inPeriod.map((e) => e.id),
    accountIds: inPeriod.map((e) => e.accountId),
    acquiringOpportunityIds: inPeriod.map((e) => e.opportunityId),
  };
}

export function generateCustomerAcquisitionPeriodMetrics(
  opportunities: readonly Opportunity[],
  asOf: string,
): CustomerAcquisitionPeriodMetricsSnapshot {
  // Einzige Ableitungsquelle (B1-Prinzip: keine zweite Opportunity-/
  // Acquisition-Wahrheit) — bereits vollständig As-of-sicher (B6 dort).
  const { customerAcquiredEvents } = generateCustomerAcquisitionLifecycle(opportunities, asOf);

  const yesterdayDate = addDays(asOf, -1);
  const yesterdayBounds: CustomerPeriodBounds = { from: yesterdayDate, through: yesterdayDate };
  const weekToDateBounds: CustomerPeriodBounds = { from: startOfWeek(asOf), through: asOf };
  const monthToDateBounds: CustomerPeriodBounds = { from: startOfMonth(asOf), through: asOf };

  return {
    asOf,
    yesterday: buildPeriodMetric("yesterday", yesterdayBounds, customerAcquiredEvents),
    weekToDate: buildPeriodMetric("week-to-date", weekToDateBounds, customerAcquiredEvents),
    monthToDate: buildPeriodMetric("month-to-date", monthToDateBounds, customerAcquiredEvents),
  };
}
