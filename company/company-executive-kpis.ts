import type { WorldSnapshot } from "../snapshot/snapshot";
import type { Employee } from "../world/employees";
import { generateMarketingExecutiveKpiData, type MarketingExecutiveKpiData } from "./marketing-executive-kpis";

// Executive KPI Contract v1.1 Foundation — eine rein deskriptive Ergänzung zu
// FullCompanyContext, die bereits vorhandene, datierte Rohfakten aus dem
// WorldSnapshot bündelt. Kein Business State, keine Ground Truth, keine
// Observation, keine neue Bewertung. Diese Facts überspringen bewusst die
// Business-State-Kette (PRINCIPLES.md, Prinzip 17/18): sie sind direkt aus
// World/Events abgeleitet, nicht aus Observations/Ground Truth, weil sie
// keine Charakterisierung darstellen, sondern reine Zählungen/Listen bereits
// bestehender, bereits an anderer Stelle modellierter Ereignisse. Business
// State bleibt eingefroren (Prinzip 19) und wird durch diesen Contract nicht
// berührt oder erweitert.
//
// asOf-Semantik: identisch zu WorldSnapshot selbst — jeder Fact spiegelt
// ausschließlich das, was bereits bis snapshot.asOf eingetreten ist (keine
// Zukunftskenntnis, Prinzip 5/18). Kalender-/Darstellungsperioden (Gestern/
// Woche/Monat) sind bewusst NICHT Teil dieses Contracts — das bleibt Aufgabe
// des Consumers, damit die Reference World frei von UI-/Reporting-
// Kalenderlogik bleibt.
//
// Explizit NICHT Bestandteil (siehe Auftrag "Executive KPI Contract v1.1
// Foundation"): revenue/umsatz/cashflow/invoice/payment (kein
// entsprechendes Domänenkonzept existiert irgendwo in dieser Reference
// World), Neukunden (CustomerAccount.createdAt markiert die Account-Anlage
// im Prospect-Pool, nicht belegbar als "Kunde seit" — siehe
// Abschlussbericht, Phase 12), Operations (bereits vollständig öffentlich
// über CompanyAreaSummary.relevantMetrics der "operations"-Area — eine
// zweite Kopie derselben fünf Werte hier wäre reine Duplikation ohne neuen
// Fakt).
//
// Marketing (Marketing Foundation, additiv): seit diesem Schritt Teil dieses
// Contracts als eigener `marketing`-Zweig (siehe marketing-executive-kpis.ts
// für Facts/Rationale) — bleibt aber weiterhin KEINE eigene Company Area
// (company-area.ts, CompanyAreaKey unverändert). Nur Leads und Sales-Handoffs
// sind evidenzbasiert belegbar; Qualified Leads und CAC/Spend sind
// ausdrücklich NICHT implementiert (siehe dortige Begründung).
export interface PeopleHireFact {
  employeeId: string;
  hiredAt: string;
}

export interface PeopleTerminationFact {
  employeeId: string;
  terminatedAt: string;
}

export interface SalesWonDealFact {
  opportunityId: string;
  accountId: string;
  closedAt: string;
  value: number;
}

export interface CompanyExecutiveKpiData {
  asOf: string;
  people: {
    activeHeadcount: number;
    hires: PeopleHireFact[];
    terminations: PeopleTerminationFact[];
  };
  sales: {
    wonDeals: SalesWonDealFact[];
  };
  marketing: MarketingExecutiveKpiData;
}

// Bereits an mehreren Stellen im Repository identisch dupliziert (siehe
// observations/people-observations.ts, events/generate-sales-pipeline.ts,
// events/generate-interactions.ts, validation/invariants.ts) — dieselbe
// etablierte Konvention lokaler Duplikate statt einer gemeinsamen
// Utility-Datei wird hier fortgesetzt, keine neue Aktivitätsregel erfunden.
function isEmployeeActiveAt(employee: Employee, isoDate: string): boolean {
  return employee.hiredAt <= isoDate && (employee.terminatedAt === undefined || isoDate <= employee.terminatedAt);
}

export function generateCompanyExecutiveKpiData(snapshot: WorldSnapshot): CompanyExecutiveKpiData {
  const activeHeadcount = snapshot.employees.filter((e) => isEmployeeActiveAt(e, snapshot.asOf)).length;

  const hires: PeopleHireFact[] = snapshot.employeeHiredEvents
    .map((e) => ({ employeeId: e.employeeId, hiredAt: e.hiredAt }))
    .sort((a, b) => a.hiredAt.localeCompare(b.hiredAt) || a.employeeId.localeCompare(b.employeeId));

  const terminations: PeopleTerminationFact[] = snapshot.employeeTerminatedEvents
    .map((e) => ({ employeeId: e.employeeId, terminatedAt: e.terminatedAt }))
    .sort((a, b) => a.terminatedAt.localeCompare(b.terminatedAt) || a.employeeId.localeCompare(b.employeeId));

  // Won Deal ausschließlich anhand der bereits asOf-rekonstruierten Stage
  // (stageAsOf.stage), NICHT anhand opportunity.currentStage — Letzteres ist
  // der finale, WORLD_NOW-bezogene Zustand und würde bei historischem asOf
  // Zukunftskenntnis in den Snapshot einschleusen (Prinzip 18). Keine
  // nachträgliche zweite Sales-Historie — dieselbe, bereits im Snapshot
  // rekonstruierte Historie wird hier nur gefiltert, nicht neu interpretiert.
  const wonDeals: SalesWonDealFact[] = snapshot.opportunities
    .filter(({ stageAsOf }) => stageAsOf.stage === "gewonnen")
    .flatMap(({ opportunity }) =>
      opportunity.closedAt !== undefined
        ? [
            {
              opportunityId: opportunity.id,
              accountId: opportunity.accountId,
              closedAt: opportunity.closedAt,
              value: opportunity.value,
            },
          ]
        : [],
    )
    .sort((a, b) => a.closedAt.localeCompare(b.closedAt) || a.opportunityId.localeCompare(b.opportunityId));

  // Reine Weiterverwendung desselben Snapshots — keine zweite Weltgenerierung,
  // kein zusätzlicher RNG-Aufruf (Marketing Foundation, wie bereits bei
  // people/sales oben).
  const marketing = generateMarketingExecutiveKpiData(snapshot);

  return {
    asOf: snapshot.asOf,
    people: { activeHeadcount, hires, terminations },
    sales: { wonDeals },
    marketing,
  };
}
