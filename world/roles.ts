// Feldebene wie im eingefrorenen Architekturmodell festgelegt. typicalCapacityThreshold
// ist nur für vertriebsnahe Rollen gesetzt (SDR/AE/Sales Manager) — für alle anderen
// Rollen ergibt eine "max. gleichzeitige Leads/Opportunities"-Kennzahl keinen Sinn
// (siehe Employee.capacityThreshold, bewusst optional).
export interface Role {
  id: string;
  name: string;
  category: "leadership" | "sales" | "support";
  typicalCapacityThreshold?: number;
}

export const ROLES: Role[] = [
  { id: "role-geschaeftsfuehrer", name: "Geschäftsführer/in", category: "leadership" },
  {
    id: "role-assistenz-geschaeftsfuehrung",
    name: "Assistenz der Geschäftsführung",
    category: "support",
  },
  {
    id: "role-sales-manager",
    name: "Sales Manager",
    category: "sales",
    typicalCapacityThreshold: 10,
  },
  {
    id: "role-account-executive",
    name: "Account Executive (AE)",
    category: "sales",
    typicalCapacityThreshold: 15,
  },
  {
    id: "role-sales-development-rep",
    name: "Sales Development Rep (SDR)",
    category: "sales",
    typicalCapacityThreshold: 40,
  },
  { id: "role-revops-manager", name: "RevOps Manager", category: "support" },
  { id: "role-marketing-manager", name: "Marketing Manager", category: "support" },
  {
    id: "role-customer-success-manager",
    name: "Customer Success Manager",
    category: "support",
  },
  { id: "role-operations-manager", name: "Operations Manager", category: "support" },
];
