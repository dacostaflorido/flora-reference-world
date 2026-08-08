import { EMPLOYEES, type Employee } from "../world/employees";
import { EMPLOYEE_TERMINATED_EVENTS, type EmployeeTerminated } from "../events/employee-lifecycle";
import type { Observation } from "./observations";

// People-Observations sind bewusst event-getrieben, nicht zustandsbasiert: eine
// Observation entsteht ausschließlich als Reaktion auf ein konkretes
// EmployeeTerminated-Event, nie als wiederkehrende Prüfung des aktuellen
// Organigramm-Schnappschusses. Eine rein zustandsbasierte Fassung dieser Regel wurde
// vor Implementierung gegen den echten EMPLOYEES-Datensatz geprüft und verworfen: sie
// hätte entweder nie ausgelöst (mit einem zusätzlichen Top-Performer-/
// Einzigartigkeits-Gate) oder dauerhaft bei allen sechs Nicht-Vertrieb-
// Abteilungsleitungen gleichzeitig und permanent ausgelöst (ohne dieses Gate) — ein
// Artefakt der statischen Organigramm-Form, keine echte, zeitlich verankerte
// Beobachtung, und damit ein Verstoß gegen PRINCIPLES.md Prinzip 7 ("Beobachtungen
// entstehen ausschließlich aus vorhandenen Ereignissen. Nie aus Annahmen."). Die
// event-getriebene Übergangsregel unten ist die freigegebene Korrektur.
//
// isTopPerformer ist bewusst NICHT Teil dieser Regel — ein mögliches künftiges Signal
// "Schlüsselperson verlässt Unternehmen" wäre ein eigenständiger, hier nicht
// implementierter fachlicher Gegenstand.
//
// Kein neuer Schwellenwert: die Regel vergleicht ausschließlich exakte Kopfzahlen vor
// und nach einem einzelnen Termination-Event, keine Prozent-/Ratio-Schwelle.

function isEmployeeActiveAt(employee: Employee, isoDate: string): boolean {
  return employee.hiredAt <= isoDate && (employee.terminatedAt === undefined || isoDate <= employee.terminatedAt);
}

// Peer-Gruppe: alle Employees derselben roleId unter demselben managerId. Für
// Personen ohne managerId (Geschäftsführungsebene) gilt dieselbe Prüfung
// unternehmensweit auf Ebene der roleId (freigegebene Regel, Fall D).
function peerGroup(employees: readonly Employee[], roleId: string, managerId: string | undefined): Employee[] {
  if (managerId === undefined) {
    return employees.filter((e) => e.roleId === roleId);
  }
  return employees.filter((e) => e.roleId === roleId && e.managerId === managerId);
}

function roleName(roleId: string): string {
  // Keine neue Rollen-Namenstabelle: ROLES ist bereits vorhanden, wird hier bewusst
  // nicht importiert, um keine zusätzliche Kopplung einzuführen, die für Step 1 nicht
  // gebraucht wird — die Observation zitiert roleId direkt im derivedFrom/statement,
  // lesbar genug für diese Ausbaustufe.
  return roleId;
}

export interface PeopleObservationResult {
  observation: Observation;
  employeeId: string;
  roleId: string;
  managerId: string | undefined;
  beforeCount: number;
  afterCount: number;
}

// Rekonstruiert für ein einzelnes EmployeeTerminated-Event explizit den Zustand VOR
// und NACH dem Event (zwei getrennte Auswertungen von isEmployeeActiveAt, nicht eine
// reine Kopfrechnung) und wendet die freigegebene Übergangsregel an. Gibt undefined
// zurück, wenn kein Übergang (>=2 → 1) oder (>=1 → 0) vorliegt.
export function evaluateTerminationForPeopleObservation(
  event: EmployeeTerminated,
  employees: readonly Employee[],
): PeopleObservationResult | undefined {
  const peers = peerGroup(employees, event.roleId, event.managerId);

  // VOR dem Event: wer war zum Zeitpunkt terminatedAt aktiv? Das schließt die
  // terminierte Person selbst ein (isEmployeeActiveAt ist bei isoDate === terminatedAt
  // inklusiv), exakt das gesuchte "unmittelbar vor Wirksamwerden"-Bild.
  const before = peers.filter((e) => isEmployeeActiveAt(e, event.terminatedAt));

  // NACH dem Event: dieselbe Auswertung, aber explizit ohne die terminierte Person —
  // eine eigenständige Rekonstruktion, keine bloße Subtraktion von before.length.
  const after = peers.filter((e) => e.id !== event.employeeId && isEmployeeActiveAt(e, event.terminatedAt));

  const remaining = after[0];

  if (before.length >= 2 && after.length === 1) {
    const statement =
      event.managerId === undefined
        ? `Nach dem Ausscheiden von ${event.employeeId} ist ${remaining?.name ?? remaining?.id ?? "eine einzelne Person"} ` +
          `unternehmensweit die letzte aktive Person in der Rolle „${roleName(event.roleId)}".`
        : `Nach dem Ausscheiden von ${event.employeeId} ist ${remaining?.name ?? remaining?.id ?? "eine einzelne Person"} ` +
          `im Team von ${event.managerId} die letzte aktive Person in der Rolle „${roleName(event.roleId)}" ` +
          `(zuvor ${before.length} Personen, jetzt 1).`;
    return {
      observation: {
        id: `people-obs-last-person-${event.employeeId}`,
        kind: "people-critical-role-last-person",
        generatedAt: event.terminatedAt,
        statement,
        category: "team-hinweis",
        severity: "mittel",
        confidence: "hoch",
        derivedFrom: [event.id, ...(remaining ? [remaining.id] : [])],
      },
      employeeId: event.employeeId,
      roleId: event.roleId,
      managerId: event.managerId,
      beforeCount: before.length,
      afterCount: after.length,
    };
  }

  if (before.length >= 1 && after.length === 0) {
    const statement =
      event.managerId === undefined
        ? `Nach dem Ausscheiden von ${event.employeeId} ist die Rolle „${roleName(event.roleId)}" unternehmensweit unbesetzt.`
        : `Nach dem Ausscheiden von ${event.employeeId} ist die Rolle „${roleName(event.roleId)}" im Team von ` +
          `${event.managerId} unbesetzt.`;
    return {
      observation: {
        id: `people-obs-unstaffed-${event.employeeId}`,
        kind: "people-critical-role-unstaffed",
        generatedAt: event.terminatedAt,
        statement,
        category: "risiko",
        severity: "hoch",
        confidence: "hoch",
        derivedFrom: [event.id],
      },
      employeeId: event.employeeId,
      roleId: event.roleId,
      managerId: event.managerId,
      beforeCount: before.length,
      afterCount: after.length,
    };
  }

  return undefined;
}

export function generatePeopleObservations(
  terminationEvents: readonly EmployeeTerminated[],
  employees: readonly Employee[],
): Observation[] {
  const results: Observation[] = [];
  for (const event of terminationEvents) {
    const result = evaluateTerminationForPeopleObservation(event, employees);
    if (result) {
      results.push(result.observation);
    }
  }
  return results;
}

// Baseline (WORLD_NOW, aktueller EMPLOYEES-Stand): erzeugt gegen die beiden echten
// historischen Terminations (Tobias Reuter 4→3, Merle Winkler 3→2) erwartungsgemäß
// KEINE Observation — siehe validation/people-invariants.test.ts für die verbindliche
// Regressionsprüfung. Das ist der freigegebene, gewollte Baseline-Zustand, keine
// Modellierungslücke.
export const PEOPLE_OBSERVATIONS: Observation[] = generatePeopleObservations(EMPLOYEE_TERMINATED_EVENTS, EMPLOYEES);
