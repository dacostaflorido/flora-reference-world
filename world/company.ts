// Feldebene wie im eingefrorenen Architekturmodell festgelegt (World → Singleton).
export interface Company {
  id: string;
  name: string;
  industry: string;
  foundedYear: number;
  headquarterCity: string;
  // Beschreibende Bandbreite — muss mit der tatsächlichen Employee[]-Anzahl konsistent
  // sein (Invariante, siehe validation/). Zielgröße laut CEO-Entscheidung: 35–50.
  employeeCountBand: string;
}

export const COMPANY: Company = {
  id: "company-elbfeld",
  name: "Elbfeld Software GmbH",
  industry: "B2B SaaS",
  foundedYear: 2013,
  headquarterCity: "Hamburg",
  employeeCountBand: "35–50 Mitarbeiter",
};
