import { startOfWeek, startOfMonth } from "../timeline/calendar";
import { addDays } from "../engine/random";
import { WORLD_TIMELINE_START } from "../timeline/world-clock";
import type { MetaAdSpendRecord } from "../events/marketing-meta-ad-spend";
import {
  resolveMarketingLeadMatchStatus,
  type MetaLeadGenerated,
  type MarketingCrmLeadIngested,
  type MarketingLeadIdentityMatched,
} from "../events/marketing-meta-crm-source";
import {
  resolveMarketingSourceCoverageStatus,
  combinePeriodDataStatus,
  type MarketingSourceCoverage,
  type PeriodDataStatus,
} from "../events/marketing-source-coverage";

// Marketing Period Metrics V1 — rein deskriptive Marketing-Zeitraumebene,
// korrigiert durch KORREKTURAUFTRAG "Marketing Data Completeness Truth +
// Public Contract Protection". Implementiert AUSSCHLIESSLICH Rohzahlen der
// Ebene 1 der Executive-Capability-Architektur — keine Kostenquote, keine
// Rate, keine Bewertung, kein State, keine Empfehlung (harte Scope-Grenze).
//
// --- K1: Public-Contract-Forensik — Ergebnis ---------------------------------
//
// `WorldSnapshot` wird tatsächlich über index.ts exportiert
// (`export type { WorldSnapshot } from "./snapshot/snapshot"`). Ein neues
// Pflichtfeld dort verändert damit nachweislich den Public Contract — auch
// wenn `generateWorldSnapshot` selbst nicht exportiert ist und
// `FullCompanyContext` (der einzige tatsächlich von `generateFullCompanyContext`
// zurückgegebene öffentliche Wert) keinen `WorldSnapshot` enthält. Frühere,
// bereits committete Erweiterungen von `WorldSnapshot`
// (`salesPeriodMetrics`, `metaAdSpendRecords`, `metaLeadGeneratedEvents`,
// `marketingCrmLeadIngestedEvents`, `marketingLeadIdentityMatchedEvents`)
// waren damit im selben Sinne bereits Public-Contract-Änderungen — sie
// bleiben unangetastet (keine rückwirkende Entfernung committeter Felder),
// aber dieser Auftrag wiederholt das Muster nicht erneut.
//
// Diese Datei wird daher bewusst NICHT über `snapshot/snapshot.ts`
// integriert. Sie bleibt eine eigenständige, ausschließlich auf
// ScenarioWorldTruth-Ebene erreichbare Berechnungsstruktur (exakt wie
// `MARKETING_CAMPAIGNS` oder `MarketingSourceCoverage`) — aufrufbar durch
// jeden internen Konsumenten (Tests, eine künftige Marketing-Arbeitsbereichs-
// ansicht) über `generateMarketingPeriodMetrics(asOf, world.metaAdSpendRecords,
// world.metaLeadGeneratedEvents, world.marketingCrmLeadIngestedEvents,
// world.marketingLeadIdentityMatchedEvents, world.marketingSourceCoverage)`,
// ohne dass `WorldSnapshot`, `WorldSnapshotSource`, `generateWorldSnapshot`
// oder `index.ts` dafür berührt werden müssen. Keine zweite Berechnung
// entsteht dadurch — es gibt weiterhin nur diese eine kanonische Funktion.
//
// --- K2-K8: Vollständigkeits-Wahrheit -----------------------------------------
//
// Der ursprüngliche Fehler dieses Auftrags: ein fehlender Record wurde
// implizit als "0" interpretiert. Das ist unbewiesen — ein fehlender Record
// kann ebenso gut bedeuten: noch nicht importiert, verspätet, fehlgeschlagen,
// oder der Zeitraum ist schlicht noch nicht vollständig synchronisiert.
// Jede Kennzahl trägt daher jetzt einen `PeriodMetricValue`: `status`
// ("complete"/"partial"/"unavailable", siehe
// events/marketing-source-coverage.ts) plus optional `value` (nur bei
// "complete" gesetzt — die einzige als vollständig behauptbare Aussage) und
// `observedValue` (immer gesetzt — der tatsächlich aus sichtbaren Records
// berechnete Wert, unabhängig vom Belastbarkeitsstatus, niemals als
// vollständige Periodensumme dargestellt, wenn status !== "complete").
//
// Zuordnung Kennzahl -> Coverage-Stream (K5/K6):
// - metaSpend: "meta-ad-spend"
// - metaLeadsGenerated: "meta-lead-generation"
// - crmLeadsIngested: "crm-lead-ingestion"
// - matchedMetaLeadsIngested: "crm-lead-ingestion" (der Match selbst entsteht
//   synchron beim CRM-Eingang, matchedAt === ingestedAt — die Match-Aussage
//   ist daher nur so belastbar wie der CRM-Ingestion-Stream, siehe K6)
// - pendingMetaLeadsAtPeriodEnd: kombiniert "meta-lead-generation" UND
//   "crm-lead-ingestion" über den GESAMTEN Zeitraum bis zum Stichtag
//   (bounds.through) — ein Pending-Bestand ist nur so belastbar wie die
//   unsicherste der beiden beteiligten Quellen (combinePeriodDataStatus,
//   schwächerer Status gewinnt).

export type MarketingPeriodKey = "yesterday" | "week-to-date" | "month-to-date";

export interface MarketingPeriodBounds {
  from: string;
  through: string;
}

// Wert einer einzelnen Zeitraumkennzahl mit explizitem Belastbarkeitsstatus.
// `value` ist NUR bei status === "complete" gesetzt (echte Null ist damit nur
// möglich, wenn `value === 0`). `observedValue` ist IMMER gesetzt — der roh
// aus aktuell sichtbaren Records berechnete Wert, unabhängig vom Status,
// niemals als vollständige Aussage zu verstehen, wenn status !== "complete".
export interface PeriodMetricValue {
  status: PeriodDataStatus;
  value?: number;
  observedValue: number;
  coveredThrough?: string;
}

export interface MarketingPeriodActivityMetrics {
  period: MarketingPeriodKey;
  bounds: MarketingPeriodBounds;
  currency: "EUR";
  metaSpendAmountMinor: PeriodMetricValue;
  metaLeadsGenerated: PeriodMetricValue;
  matchedMetaLeadsIngested: PeriodMetricValue;
  crmLeadsIngested: PeriodMetricValue;
  evidence: {
    metaSpendRecordIds: string[];
    metaLeadGeneratedEventIds: string[];
    matchedMetaLeadIngestedEventIds: string[];
    crmLeadIngestedEventIds: string[];
  };
}

export interface MarketingPeriodMetrics {
  activity: MarketingPeriodActivityMetrics;
  pendingMetaLeadsAtPeriodEnd: PeriodMetricValue;
  pendingMetaLeadGeneratedEventIds: string[];
}

export interface MarketingPeriodMetricsSnapshot {
  asOf: string;
  yesterday: MarketingPeriodMetrics;
  weekToDate: MarketingPeriodMetrics;
  monthToDate: MarketingPeriodMetrics;
}

function withinPeriod(date: string, bounds: MarketingPeriodBounds): boolean {
  return date >= bounds.from && date <= bounds.through;
}

// Verpackt einen roh beobachteten Wert gemäß Coverage-Status — die einzige
// Stelle, an der `value` aus `observedValue` abgeleitet wird (K9, "exakt eine
// Produktionsberechnung").
function toMetricValue(observedValue: number, status: PeriodDataStatus, coveredThrough: string | undefined): PeriodMetricValue {
  return {
    status,
    value: status === "complete" ? observedValue : undefined,
    observedValue,
    coveredThrough,
  };
}

function latestCoveredThrough(stream: MarketingSourceCoverage["stream"], coverage: readonly MarketingSourceCoverage[], asOf: string): string | undefined {
  const visible = coverage.filter((c) => c.stream === stream && c.importedAt <= asOf);
  if (visible.length === 0) {
    return undefined;
  }
  return visible.reduce((max, c) => (c.coveredThrough > max ? c.coveredThrough : max), visible[0]!.coveredThrough);
}

function computePeriodMetrics(
  period: MarketingPeriodKey,
  bounds: MarketingPeriodBounds,
  spendRecords: readonly MetaAdSpendRecord[],
  metaLeadGeneratedEvents: readonly MetaLeadGenerated[],
  crmLeadIngestedEvents: readonly MarketingCrmLeadIngested[],
  matchEvents: readonly MarketingLeadIdentityMatched[],
  coverage: readonly MarketingSourceCoverage[],
  asOf: string,
): MarketingPeriodMetrics {
  // --- Meta Spend (K5) ---------------------------------------------------------
  const spendInPeriod = spendRecords.filter((r) => withinPeriod(r.spendDate, bounds));
  const currencies = new Set(spendInPeriod.map((r) => r.currency));
  if (currencies.size > 1) {
    // Strukturell durch das Typsystem ausgeschlossen (currency: "EUR" ist ein
    // Literal) — reine Verteidigung, kann in der aktuellen Referenzwelt nie
    // auslösen.
    throw new Error("marketing-period-metrics: mehrere Währungen in einem Zeitraum — STOP erforderlich");
  }
  const observedSpendAmountMinor = spendInPeriod.reduce((sum, r) => sum + r.amountMinor, 0);
  const metaSpendRecordIds = spendInPeriod.map((r) => r.id);
  const spendStatus = resolveMarketingSourceCoverageStatus("meta-ad-spend", bounds, coverage, asOf);
  const metaSpendAmountMinor = toMetricValue(observedSpendAmountMinor, spendStatus, latestCoveredThrough("meta-ad-spend", coverage, asOf));

  // --- Meta-Leads generiert (K4) ------------------------------------------------
  const metaLeadGeneratedInPeriod = metaLeadGeneratedEvents.filter((e) => withinPeriod(e.generatedAt, bounds));
  const metaLeadGeneratedEventIds = metaLeadGeneratedInPeriod.map((e) => e.id);
  const leadGenStatus = resolveMarketingSourceCoverageStatus("meta-lead-generation", bounds, coverage, asOf);
  const metaLeadsGenerated = toMetricValue(metaLeadGeneratedEventIds.length, leadGenStatus, latestCoveredThrough("meta-lead-generation", coverage, asOf));

  // --- Meta-Leads im CRM gelandet (K5, K6) --------------------------------------
  const matchedMetaLeadIngestedEventIds: string[] = [];
  for (const m of matchEvents) {
    if (m.matchedAt > asOf) {
      continue; // As-of-Schutz: ein noch nicht sichtbares Match zählt nirgends
    }
    const crm = crmLeadIngestedEvents.find((e) => e.id === m.crmLeadIngestedEventId);
    if (crm && withinPeriod(crm.ingestedAt, bounds)) {
      matchedMetaLeadIngestedEventIds.push(crm.id);
    }
  }
  const crmIngestionStatus = resolveMarketingSourceCoverageStatus("crm-lead-ingestion", bounds, coverage, asOf);
  const matchedMetaLeadsIngested = toMetricValue(
    matchedMetaLeadIngestedEventIds.length,
    crmIngestionStatus, // K6: gematchte CRM-Landung ist nur so belastbar wie der CRM-Ingestion-Stream
    latestCoveredThrough("crm-lead-ingestion", coverage, asOf),
  );

  // --- Sämtliche CRM-Leads (K6) --------------------------------------------------
  const crmLeadIngestedInPeriod = crmLeadIngestedEvents.filter((e) => withinPeriod(e.ingestedAt, bounds));
  const crmLeadIngestedEventIds = crmLeadIngestedInPeriod.map((e) => e.id);
  const crmLeadsIngested = toMetricValue(crmLeadIngestedEventIds.length, crmIngestionStatus, latestCoveredThrough("crm-lead-ingestion", coverage, asOf));

  // --- Pending-Bestand (K6, K8) ---------------------------------------------------
  // Bestandskennzahl: Stichtag ist bounds.through dieser Periode, nicht asOf
  // selbst. Coverage wird über den GESAMTEN Zeitraum bis zum Stichtag geprüft
  // (nicht nur innerhalb der Aktivitätsperiode), da der Bestand alle jemals
  // generierten Meta-Leads berücksichtigt.
  const stockBounds: MarketingPeriodBounds = { from: WORLD_TIMELINE_START, through: bounds.through };
  const pendingMetaLeadGeneratedEventIds = metaLeadGeneratedEvents
    .filter((e) => e.generatedAt <= bounds.through)
    .filter((e) => resolveMarketingLeadMatchStatus(e.id, bounds.through, matchEvents) !== "matched")
    .map((e) => e.id);
  const leadGenStockStatus = resolveMarketingSourceCoverageStatus("meta-lead-generation", stockBounds, coverage, asOf);
  const crmStockStatus = resolveMarketingSourceCoverageStatus("crm-lead-ingestion", stockBounds, coverage, asOf);
  const pendingStatus = combinePeriodDataStatus(leadGenStockStatus, crmStockStatus);
  const leadGenCoveredThrough = latestCoveredThrough("meta-lead-generation", coverage, asOf);
  const crmCoveredThrough = latestCoveredThrough("crm-lead-ingestion", coverage, asOf);
  // Der Bestand kombiniert zwei Streams — coveredThrough zeigt die
  // EINSCHRÄNKENDERE (frühere) der beiden Grenzen, damit das Feld die
  // tatsächlich bindende Schranke widerspiegelt, nicht nur eine der beiden.
  const pendingCoveredThrough =
    leadGenCoveredThrough === undefined ? crmCoveredThrough
    : crmCoveredThrough === undefined ? leadGenCoveredThrough
    : leadGenCoveredThrough < crmCoveredThrough ? leadGenCoveredThrough
    : crmCoveredThrough;
  const pendingMetaLeadsAtPeriodEnd = toMetricValue(
    pendingMetaLeadGeneratedEventIds.length,
    pendingStatus,
    pendingCoveredThrough,
  );

  return {
    activity: {
      period,
      bounds,
      currency: "EUR",
      metaSpendAmountMinor,
      metaLeadsGenerated,
      matchedMetaLeadsIngested,
      crmLeadsIngested,
      evidence: {
        metaSpendRecordIds,
        metaLeadGeneratedEventIds,
        matchedMetaLeadIngestedEventIds,
        crmLeadIngestedEventIds,
      },
    },
    pendingMetaLeadsAtPeriodEnd,
    pendingMetaLeadGeneratedEventIds,
  };
}

export function generateMarketingPeriodMetrics(
  asOf: string,
  spendRecords: readonly MetaAdSpendRecord[],
  metaLeadGeneratedEvents: readonly MetaLeadGenerated[],
  crmLeadIngestedEvents: readonly MarketingCrmLeadIngested[],
  matchEvents: readonly MarketingLeadIdentityMatched[],
  coverage: readonly MarketingSourceCoverage[],
): MarketingPeriodMetricsSnapshot {
  const yesterdayDate = addDays(asOf, -1);
  const yesterdayBounds: MarketingPeriodBounds = { from: yesterdayDate, through: yesterdayDate };
  const weekToDateBounds: MarketingPeriodBounds = { from: startOfWeek(asOf), through: asOf };
  const monthToDateBounds: MarketingPeriodBounds = { from: startOfMonth(asOf), through: asOf };

  return {
    asOf,
    yesterday: computePeriodMetrics("yesterday", yesterdayBounds, spendRecords, metaLeadGeneratedEvents, crmLeadIngestedEvents, matchEvents, coverage, asOf),
    weekToDate: computePeriodMetrics("week-to-date", weekToDateBounds, spendRecords, metaLeadGeneratedEvents, crmLeadIngestedEvents, matchEvents, coverage, asOf),
    monthToDate: computePeriodMetrics("month-to-date", monthToDateBounds, spendRecords, metaLeadGeneratedEvents, crmLeadIngestedEvents, matchEvents, coverage, asOf),
  };
}
