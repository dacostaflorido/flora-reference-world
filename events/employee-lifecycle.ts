import { EMPLOYEES, type Employee } from "../world/employees";

// Materialisiert bereits bestehende Employee-Stammdatenfelder (hiredAt/terminatedAt)
// als eigenständige Events — keine neue Personaldatenerhebung, keine neue
// RNG-Entscheidung, kein neuer Zufallsstrom. World Before Events (PRINCIPLES.md,
// Prinzip 6) ist hier bereits strukturell erzwungen: es kann kein
// EmployeeHired/EmployeeTerminated ohne einen entsprechenden Employee-Datensatz
// entstehen, aus dem es 1:1 abgeleitet ist.
//
// IDs sind bewusst aus employee.id abgeleitet statt aus einem Modul-Zähler
// (nextId()-Muster in anderen events/-Dateien): die Events entstehen nicht aus einer
// RNG-Sequenz, sondern direkt und vollständig deterministisch aus EMPLOYEES selbst —
// ein Zähler wäre hier nur eine unnötige zusätzliche Indirektion und liefe in
// dieselbe Aufrufreihenfolge-Abhängigkeit, die ground-truth.ts/business-state.ts für
// ihre eigenen IDs bereits bewusst vermeiden.
//
// Zeitliche Einordnung (Prinzip 5, Temporal Consistency): hiredAt/terminatedAt dürfen
// wie die zugrunde liegenden Employee-Felder vor WORLD_TIMELINE_START liegen — exakt
// dieselbe, bereits etablierte Ausnahme wie bei CustomerAccount.createdAt (siehe
// timeline/world-clock.ts). Ein EmployeeTerminated-Event trägt exakt terminatedAt als
// eigenen Zeitstempel; ein WorldSnapshot zu einem asOf < terminatedAt darf dieses
// Event nicht enthalten (Backward Explainability, Prinzip 18) — durchgesetzt über
// dieselbe Existenz-Filterung wie jedes andere Event (asOf-Vergleich gegen den
// Event-eigenen Zeitstempel), siehe snapshot/snapshot.ts.
export interface EmployeeHired {
  id: string;
  employeeId: string;
  roleId: string;
  departmentId: string;
  hiredAt: string;
}

export interface EmployeeTerminated {
  id: string;
  employeeId: string;
  roleId: string;
  departmentId: string;
  managerId?: string;
  terminatedAt: string;
}

function hiredEventId(employee: Employee): string {
  return `hired-${employee.id}`;
}

function terminatedEventId(employee: Employee): string {
  return `terminated-${employee.id}`;
}

export function generateEmployeeHiredEvents(employees: readonly Employee[]): EmployeeHired[] {
  return employees.map((e) => ({
    id: hiredEventId(e),
    employeeId: e.id,
    roleId: e.roleId,
    departmentId: e.departmentId,
    hiredAt: e.hiredAt,
  }));
}

export function generateEmployeeTerminatedEvents(employees: readonly Employee[]): EmployeeTerminated[] {
  return employees
    .filter((e): e is Employee & { terminatedAt: string } => e.terminatedAt !== undefined)
    .map((e) => ({
      id: terminatedEventId(e),
      employeeId: e.id,
      roleId: e.roleId,
      departmentId: e.departmentId,
      managerId: e.managerId,
      terminatedAt: e.terminatedAt,
    }));
}

// Scenario-unabhängig, exakt wie EMPLOYEES selbst (siehe engine/generator.ts:
// Employees bleiben über alle Scenario Profiles identisch) — deshalb als
// Singleton-Export, demselben Muster wie LEADS/OPPORTUNITIES in
// generate-sales-pipeline.ts folgend, hier aber ohne RNG-Abhängigkeit.
export const EMPLOYEE_HIRED_EVENTS: EmployeeHired[] = generateEmployeeHiredEvents(EMPLOYEES);
export const EMPLOYEE_TERMINATED_EVENTS: EmployeeTerminated[] = generateEmployeeTerminatedEvents(EMPLOYEES);
