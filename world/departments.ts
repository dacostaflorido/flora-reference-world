// Feldebene wie im eingefrorenen Architekturmodell festgelegt. Customer
// Success/RevOps/Assistenz existieren weiterhin ausschließlich für
// Organigramm-Realismus (Headcount, Berichtslinien) — die Referenzwelt generiert für
// sie keine eigenen Event-Typen (siehe PRINCIPLES.md, Prinzip 10 und 11). Operations
// hat seit Reference World v2 / "Operations Foundation" eigene dynamische Events
// (DeliveryUnit, aus gewonnenen Opportunities abgeleitet, siehe
// world/delivery-units.ts). Zusätzlich erzeugen die People-Lifecycle-Events
// (EmployeeHired/EmployeeTerminated, siehe events/employee-lifecycle.ts) für JEDE
// Abteilung Events — sie sind eine unternehmensweite, abteilungsübergreifende
// Querschnitts-Domäne, keine weitere Ausnahme für eine einzelne Abteilung hier.
//
// Marketing (Marketing as First-Class Company Area): die dept-marketing-
// Mitarbeitenden selbst bleiben reiner Organigramm-Realismus ohne eigene
// Event-Typen — keine Kampagnen-, Budget- oder Aktivitäts-Events sind ihnen
// zugeordnet. Die Marketing Company Area selbst bezieht ihre Evidenz jedoch NICHT
// von diesen Mitarbeitenden, sondern von bereits bestehenden Lead-/Opportunity-
// Events aus der Sales-Pipeline (siehe observations/marketing-observations.ts) —
// dieselbe Unterscheidung wie bei Operations: das Department als Organigramm-Eintrag
// bleibt unverändert ereignislos, die Company Area darüber ist es nicht.
export interface Department {
  id: string;
  name: string;
  parentDepartmentId?: string;
}

export const DEPARTMENTS: Department[] = [
  { id: "dept-geschaeftsfuehrung", name: "Geschäftsführung" },
  { id: "dept-vertrieb", name: "Vertrieb" },
  { id: "dept-revops", name: "RevOps" },
  { id: "dept-marketing", name: "Marketing" },
  { id: "dept-customer-success", name: "Customer Success" },
  { id: "dept-operations", name: "Operations" },
  { id: "dept-assistenz", name: "Assistenz" },
];
