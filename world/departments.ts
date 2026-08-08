// Feldebene wie im eingefrorenen Architekturmodell festgelegt. Marketing/Customer
// Success/Operations/RevOps/Assistenz existieren ausschließlich für Organigramm-Realismus
// (Headcount, Berichtslinien) — die Referenzwelt generiert für sie keine eigenen
// Event-Typen (siehe PRINCIPLES.md, Prinzip 10 und 11). Dynamische Events bleiben
// ausschließlich Sales-Domäne.
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
