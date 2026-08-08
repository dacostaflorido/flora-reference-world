// Feldebene wie im eingefrorenen Architekturmodell festgelegt. Marketing/Customer
// Success/RevOps/Assistenz existieren weiterhin ausschließlich für
// Organigramm-Realismus (Headcount, Berichtslinien) — die Referenzwelt generiert für
// sie keine eigenen Event-Typen (siehe PRINCIPLES.md, Prinzip 10 und 11). Operations
// hat seit Reference World v2 / "Operations Foundation" eigene dynamische Events
// (DeliveryUnit, aus gewonnenen Opportunities abgeleitet, siehe
// world/delivery-units.ts). Zusätzlich erzeugen die People-Lifecycle-Events
// (EmployeeHired/EmployeeTerminated, siehe events/employee-lifecycle.ts) für JEDE
// Abteilung Events — sie sind eine unternehmensweite, abteilungsübergreifende
// Querschnitts-Domäne, keine weitere Ausnahme für eine einzelne Abteilung hier.
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
