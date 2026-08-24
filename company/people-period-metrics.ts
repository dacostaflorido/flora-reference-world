import { startOfWeek, startOfMonth } from "../timeline/calendar";
import { addDays } from "../engine/random";
import type { Employee } from "../world/employees";

// People Period Metrics V1 (Auftrag "People Intelligence Governance +
// Evidence Audit + Workspace V1", CEO-Freigabe D053) — rein deskriptive
// Zeitraumebene über bereits vorhandenen Employee-Stammdaten, exakt nach dem
// bereits etablierten Muster von company/sales-period-metrics.ts und
// company/operations-period-metrics.ts. Erzeugt KEINE zweite Wahrheit: liest
// ausschließlich bereits vorhandene Employee-Felder (hiredAt, terminatedAt,
// roleId, managerId — world/employees.ts), keine neue Zufallsziehung, keine
// neue Fachregel, keine neue Datenquelle.
//
// --- People Evidence Audit — Ergebnis (Phase 2) ------------------------------
//
// Untersucht: Employees, Rollen/Teams, Eintritts-/Austrittsdaten,
// Beschäftigungsstatus, Verfügbarkeit, Abwesenheitsdaten, Account Ownership,
// Verantwortungszuordnungen, People Observations, People State, ScenarioWorld,
// WorldSnapshot, Area Workspace Contract, Generatoren/RNG, bestehende
// People-Invariant-Tests, Public Contract.
//
// SUPPORTED (implementiert):
// 1) Mitarbeiterbestand am Periodenende — bereits als `activeHeadcount` im
//    Executive KPI Contract (company/company-executive-kpis.ts) etabliert und
//    getestet; hier lediglich auf `bounds.through` statt auf `asOf` erneut
//    ausgewertet, dieselbe `isEmployeeActiveAt`-Definition (hiredAt <=
//    Stichtag <= terminatedAt oder terminatedAt undefined) — bereits an
//    mehreren Stellen im Repository identisch dupliziert, hier bewusst erneut
//    dateilokal statt geteilte Utility (etablierte Konvention).
// 2) Eintritte im Zeitraum — `Employee.hiredAt`, exakt dieselbe Quelle wie
//    `PeopleHireFact`/`EmployeeHired`, hier nach Periodengrenzen gefiltert
//    statt vollständiger Liste.
// 3) Austritte im Zeitraum — `Employee.terminatedAt`, exakt dieselbe Quelle
//    wie `PeopleTerminationFact`/`EmployeeTerminated`, periodengefiltert.
// 6) Besetzte Verantwortungsbereiche am Periodenende — "Verantwortungsbereich"
//    = Peer-Gruppe (roleId + managerId), exakt dieselbe, bereits etablierte
//    Definition wie in `business-state/people-business-state.ts` und
//    `observations/people-observations.ts` (dortige `peerGroup`-Funktion) für
//    die Team-Kontinuitäts-Regel — keine neue Taxonomie. Grundgesamtheit: alle
//    Peer-Gruppen, die bis `bounds.through` mindestens einen Eintritt hatten.
//    "Besetzt" = mindestens ein Mitglied ist zu `bounds.through` aktiv.
// 7) Unbesetzte Verantwortungsbereiche am Periodenende — dieselbe
//    Grundgesamtheit, invertiert: kein Mitglied mehr aktiv. In der
//    Referenzwelt (WORLD_NOW) empirisch stets 0 (kein Peer-Gruppen-Austritt
//    hat je die letzte aktive Person entfernt) — ein echter, unverfälschter
//    Nullwert, keine erfundene Zahl.
//
// UNSUPPORTED (nicht implementiert, keine Erfindung):
// 4) "Verfügbare Mitarbeitende am Periodenende" — kein von Bestand (1)
//    unterscheidbares Konzept vorhanden: es existiert keine
//    Abwesenheits-/Verfügbarkeitsquelle, "verfügbar" würde strukturell exakt
//    denselben Wert wie `headcount` liefern. Eine zweite, gleichlautende
//    Kennzahl unter neuem Namen würde eine nicht vorhandene zusätzliche
//    Granularität vortäuschen (Fehlinterpretationsrisiko, siehe Audit-Frage
//    10) — deshalb bewusst nicht als eigene Kennzahl geführt.
// 5) "Abwesenheiten" — keine kanonische Quelle. Es existiert kein
//    Abwesenheits-/Urlaubs-/Krankheits-Event-Typ irgendwo im Repository
//    (world/, events/, snapshot/). Eine Implementierung würde entweder eine
//    neue Datenquelle erfinden oder Abwesenheit schätzen — beides
//    ausdrücklich untersagt.
// 8) "Sachliche Verteilung kanonischer Zuständigkeiten" (Department-/Rollen-
//    Aufschlüsselung) — technisch aus bereits vorhandenen Feldern ableitbar,
//    aber strukturell eine mehrwertige Verteilung/Tabelle, kein
//    Einzelwert-Kennzahl-Karte wie die übrigen sieben Bereiche (Marketing/
//    Sales/Operations) — nicht kompatibel mit dem bestehenden
//    WorkspaceMetricCard-Einzelwert-Muster ohne einen neuen UI-Baustein
//    einzuführen. Zurückgestellt aus Formatgründen, nicht aus Evidenzmangel.
//
// isTopPerformer (world/employees.ts) wird an KEINER Stelle dieser Datei
// gelesen oder referenziert — dieselbe bewusste Auslassung wie bereits in
// observations/people-observations.ts dokumentiert: kein Leistungssignal,
// kein Ranking, keine „beste/schlechteste Person"-Aussage.
//
// --- Aktivität vs. Bestand ----------------------------------------------------
//
// Aktivität zählt EIGENE Ereigniszeitpunkte innerhalb der Periode (wie Sales/
// Operations Period Metrics) — keine Kohortenlogik. Bestand
// ("stockAtPeriodEnd") ist ein Stichtags-Snapshot exakt zu `bounds.through`
// (nicht zu `asOf`!) — dieselbe, bereits mehrfach bewiesene As-of-Grenze wie
// bei Operations Stock. Für die Periode "Gestern" ist `bounds.through` ein
// FRÜHERER Stichtag als `asOf` selbst; ein späterer Eintritt oder Austritt
// verändert diesen historischen Bestand nicht rückwirkend.
//
// NICHT über index.ts exportiert — dieselbe Sichtbarkeitsstufe wie
// sales-period-metrics.ts/operations-period-metrics.ts.
//
// Keine Namen, keine sonstigen personenbezogenen Detaildaten: ausschließlich
// `employee.id` (Identifikator, keine Personendaten) erscheint in den
// Evidenzlisten — exakt dieselbe Grenze wie bereits bei
// `PeopleHireFact`/`PeopleTerminationFact` im Executive KPI Contract.

export type PeoplePeriodKey = "yesterday" | "week-to-date" | "month-to-date";

export interface PeoplePeriodBounds {
  from: string;
  through: string;
}

export interface PeopleActivityMetrics {
  hires: number;
  hiresEmployeeIds: string[];
  terminations: number;
  terminationsEmployeeIds: string[];
}

export interface PeopleStockAtPeriodEnd {
  headcount: number;
  headcountEmployeeIds: string[];
  staffedResponsibilityAreas: number;
  staffedResponsibilityAreaKeys: string[];
  unstaffedResponsibilityAreas: number;
  unstaffedResponsibilityAreaKeys: string[];
}

export interface PeoplePeriodMetrics {
  period: PeoplePeriodKey;
  bounds: PeoplePeriodBounds;
  activity: PeopleActivityMetrics;
  stockAtPeriodEnd: PeopleStockAtPeriodEnd;
}

export interface PeoplePeriodMetricsSnapshot {
  asOf: string;
  yesterday: PeoplePeriodMetrics;
  weekToDate: PeoplePeriodMetrics;
  monthToDate: PeoplePeriodMetrics;
}

function withinPeriod(date: string, bounds: PeoplePeriodBounds): boolean {
  return date >= bounds.from && date <= bounds.through;
}

// Bereits an mehreren Stellen im Repository identisch dupliziert (siehe
// company/company-executive-kpis.ts, observations/people-observations.ts) —
// dieselbe etablierte Konvention lokaler Duplikate statt einer gemeinsamen
// Utility-Datei wird hier fortgesetzt, keine neue Aktivitätsregel erfunden.
function isEmployeeActiveAt(employee: Employee, isoDate: string): boolean {
  return employee.hiredAt <= isoDate && (employee.terminatedAt === undefined || isoDate <= employee.terminatedAt);
}

// Verantwortungsbereich = Peer-Gruppe (roleId + managerId) — exakt dieselbe
// Definition wie `peerGroup` in observations/people-observations.ts. Personen
// ohne managerId (Geschäftsführungsebene) bilden dieselbe unternehmensweite
// Gruppe auf Ebene der roleId, dieselbe Fall-D-Regel wie dort.
function responsibilityAreaKey(roleId: string, managerId: string | undefined): string {
  return `${roleId}::${managerId ?? "unternehmensweit"}`;
}

function computeActivity(employees: readonly Employee[], bounds: PeoplePeriodBounds): PeopleActivityMetrics {
  const hired = employees.filter((e) => withinPeriod(e.hiredAt, bounds));
  const terminated = employees.filter(
    (e): e is Employee & { terminatedAt: string } => e.terminatedAt !== undefined && withinPeriod(e.terminatedAt, bounds),
  );

  return {
    hires: hired.length,
    hiresEmployeeIds: hired.map((e) => e.id).sort(),
    terminations: terminated.length,
    terminationsEmployeeIds: terminated.map((e) => e.id).sort(),
  };
}

// Bestand exakt zu bounds.through — bewusst NICHT asOf (siehe Kopfkommentar).
function computeStockAtPeriodEnd(employees: readonly Employee[], bounds: PeoplePeriodBounds): PeopleStockAtPeriodEnd {
  const active = employees.filter((e) => isEmployeeActiveAt(e, bounds.through));

  const everExisted = employees.filter((e) => e.hiredAt <= bounds.through);
  const areaKeys = new Set(everExisted.map((e) => responsibilityAreaKey(e.roleId, e.managerId)));

  const staffedKeys: string[] = [];
  const unstaffedKeys: string[] = [];
  for (const key of areaKeys) {
    const hasActiveMember = everExisted.some(
      (e) => responsibilityAreaKey(e.roleId, e.managerId) === key && isEmployeeActiveAt(e, bounds.through),
    );
    (hasActiveMember ? staffedKeys : unstaffedKeys).push(key);
  }
  staffedKeys.sort();
  unstaffedKeys.sort();

  return {
    headcount: active.length,
    headcountEmployeeIds: active.map((e) => e.id).sort(),
    staffedResponsibilityAreas: staffedKeys.length,
    staffedResponsibilityAreaKeys: staffedKeys,
    unstaffedResponsibilityAreas: unstaffedKeys.length,
    unstaffedResponsibilityAreaKeys: unstaffedKeys,
  };
}

function computePeriodMetrics(period: PeoplePeriodKey, bounds: PeoplePeriodBounds, employees: readonly Employee[]): PeoplePeriodMetrics {
  return {
    period,
    bounds,
    activity: computeActivity(employees, bounds),
    stockAtPeriodEnd: computeStockAtPeriodEnd(employees, bounds),
  };
}

export function generatePeoplePeriodMetrics(asOf: string, employees: readonly Employee[]): PeoplePeriodMetricsSnapshot {
  const yesterdayDate = addDays(asOf, -1);
  const yesterdayBounds: PeoplePeriodBounds = { from: yesterdayDate, through: yesterdayDate };
  const weekToDateBounds: PeoplePeriodBounds = { from: startOfWeek(asOf), through: asOf };
  const monthToDateBounds: PeoplePeriodBounds = { from: startOfMonth(asOf), through: asOf };

  return {
    asOf,
    yesterday: computePeriodMetrics("yesterday", yesterdayBounds, employees),
    weekToDate: computePeriodMetrics("week-to-date", weekToDateBounds, employees),
    monthToDate: computePeriodMetrics("month-to-date", monthToDateBounds, employees),
  };
}
