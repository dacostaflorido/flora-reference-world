// Feldebene wie im eingefrorenen Architekturmodell festgelegt.
//
// Bewusst als handkuratiertes, statisches Organigramm modelliert statt RNG-generiert:
// die Anforderung war ein plausibles Organigramm (korrekte Führungslinien, keine
// Zyklen, realistische Rollenverteilung), nicht Zufallsvariation. Eine statische
// Liste ist damit die stärkste Form von Determinismus (PRINCIPLES.md, Prinzip 3) und
// macht die Organisationsstruktur direkt überprüfbar statt nur wahrscheinlich korrekt.
export interface Employee {
  id: string;
  name: string;
  departmentId: string;
  roleId: string;
  managerId?: string;
  hiredAt: string;
  terminatedAt?: string;
  capacityThreshold?: number;
  isTopPerformer?: boolean;
}

export const EMPLOYEES: Employee[] = [
  // Geschäftsführung — zwei gleichrangige Geschäftsführer:innen, kein managerId.
  {
    id: "emp-jonas-reimers",
    name: "Jonas Reimers",
    departmentId: "dept-geschaeftsfuehrung",
    roleId: "role-geschaeftsfuehrer",
    hiredAt: "2013-01-15",
  },
  {
    id: "emp-katharina-voss",
    name: "Katharina Voss",
    departmentId: "dept-geschaeftsfuehrung",
    roleId: "role-geschaeftsfuehrer",
    hiredAt: "2014-03-01",
  },

  // Assistenz — je eine Assistenz pro Geschäftsführer:in.
  {
    id: "emp-pia-lindqvist",
    name: "Pia Lindqvist",
    departmentId: "dept-assistenz",
    roleId: "role-assistenz-geschaeftsfuehrung",
    managerId: "emp-jonas-reimers",
    hiredAt: "2016-02-01",
  },
  {
    id: "emp-malte-cordes",
    name: "Malte Cordes",
    departmentId: "dept-assistenz",
    roleId: "role-assistenz-geschaeftsfuehrung",
    managerId: "emp-katharina-voss",
    hiredAt: "2019-05-15",
  },

  // Vertrieb — drei Sales Manager, jeweils mit eigenem AE-/SDR-Team, unter Jonas Reimers.
  {
    id: "emp-fabian-krueger",
    name: "Fabian Krüger",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-manager",
    managerId: "emp-jonas-reimers",
    hiredAt: "2015-11-02",
    capacityThreshold: 10,
  },
  {
    id: "emp-svenja-brandt",
    name: "Svenja Brandt",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-manager",
    managerId: "emp-jonas-reimers",
    hiredAt: "2016-04-18",
    capacityThreshold: 10,
  },
  {
    id: "emp-timo-albrecht",
    name: "Timo Albrecht",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-manager",
    managerId: "emp-jonas-reimers",
    hiredAt: "2018-09-03",
    capacityThreshold: 10,
  },

  // Team Fabian Krüger — 3 AE, 3 SDR.
  {
    id: "emp-lukas-hansen",
    name: "Lukas Hansen",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-fabian-krueger",
    hiredAt: "2016-06-01",
    capacityThreshold: 15,
    isTopPerformer: true,
  },
  {
    id: "emp-mareike-thiel",
    name: "Mareike Thiel",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-fabian-krueger",
    hiredAt: "2018-02-01",
    capacityThreshold: 15,
  },
  {
    id: "emp-jannik-ostermann",
    name: "Jannik Ostermann",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-fabian-krueger",
    hiredAt: "2021-03-15",
    capacityThreshold: 15,
  },
  {
    id: "emp-ole-jansen",
    name: "Ole Jansen",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-fabian-krueger",
    hiredAt: "2017-03-01",
    capacityThreshold: 40,
  },
  {
    id: "emp-miriam-kowalski",
    name: "Miriam Kowalski",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-fabian-krueger",
    hiredAt: "2020-01-15",
    capacityThreshold: 40,
  },
  {
    id: "emp-david-lorenz",
    name: "David Lorenz",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-fabian-krueger",
    hiredAt: "2023-02-01",
    capacityThreshold: 40,
  },

  // Team Svenja Brandt — 3 AE, 3 SDR.
  {
    id: "emp-carolin-wagner",
    name: "Carolin Wagner",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-svenja-brandt",
    hiredAt: "2017-01-10",
    capacityThreshold: 15,
  },
  {
    id: "emp-finn-petersen",
    name: "Finn Petersen",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-svenja-brandt",
    hiredAt: "2019-08-01",
    capacityThreshold: 15,
  },
  {
    id: "emp-leonie-marquardt",
    name: "Leonie Marquardt",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-svenja-brandt",
    hiredAt: "2022-05-01",
    capacityThreshold: 15,
  },
  {
    id: "emp-sophie-renner",
    name: "Sophie Renner",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-svenja-brandt",
    hiredAt: "2018-06-01",
    capacityThreshold: 40,
    isTopPerformer: true,
  },
  {
    id: "emp-kevin-matthes",
    name: "Kevin Matthes",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-svenja-brandt",
    hiredAt: "2021-09-01",
    capacityThreshold: 40,
  },
  {
    id: "emp-franziska-bode",
    name: "Franziska Bode",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-svenja-brandt",
    hiredAt: "2024-01-15",
    capacityThreshold: 40,
  },

  // Team Timo Albrecht — 3 aktive AE + 1 ausgeschiedener AE, 3 aktive SDR + 1 ausgeschiedener SDR.
  {
    id: "emp-robert-kuhn",
    name: "Robert Kuhn",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-timo-albrecht",
    hiredAt: "2019-01-15",
    capacityThreshold: 15,
  },
  {
    id: "emp-anna-lena-sievers",
    name: "Anna-Lena Sievers",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-timo-albrecht",
    hiredAt: "2020-11-01",
    capacityThreshold: 18,
    isTopPerformer: true,
  },
  {
    id: "emp-paul-ehlers",
    name: "Paul Ehlers",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-timo-albrecht",
    hiredAt: "2023-06-01",
    capacityThreshold: 15,
  },
  {
    id: "emp-tobias-reuter",
    name: "Tobias Reuter",
    departmentId: "dept-vertrieb",
    roleId: "role-account-executive",
    managerId: "emp-timo-albrecht",
    hiredAt: "2019-04-01",
    terminatedAt: "2023-11-30",
    capacityThreshold: 15,
  },
  {
    id: "emp-julius-ahrens",
    name: "Julius Ahrens",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-timo-albrecht",
    hiredAt: "2019-07-01",
    capacityThreshold: 40,
  },
  {
    id: "emp-ines-vogler",
    name: "Ines Vogler",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-timo-albrecht",
    hiredAt: "2021-11-15",
    capacityThreshold: 40,
  },
  {
    id: "emp-yannick-bruns",
    name: "Yannick Bruns",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-timo-albrecht",
    hiredAt: "2024-08-01",
    capacityThreshold: 40,
  },
  {
    id: "emp-merle-winkler",
    name: "Merle Winkler",
    departmentId: "dept-vertrieb",
    roleId: "role-sales-development-rep",
    managerId: "emp-timo-albrecht",
    hiredAt: "2021-02-01",
    terminatedAt: "2022-08-15",
    capacityThreshold: 40,
  },

  // RevOps — an Jonas Reimers angebunden, ein Head plus zwei Teammitglieder.
  {
    id: "emp-jan-philipp-suhr",
    name: "Jan-Philipp Suhr",
    departmentId: "dept-revops",
    roleId: "role-revops-manager",
    managerId: "emp-jonas-reimers",
    hiredAt: "2019-03-01",
  },
  {
    id: "emp-carla-niemeyer",
    name: "Carla Niemeyer",
    departmentId: "dept-revops",
    roleId: "role-revops-manager",
    managerId: "emp-jan-philipp-suhr",
    hiredAt: "2021-06-01",
  },
  {
    id: "emp-dennis-wulff",
    name: "Dennis Wulff",
    departmentId: "dept-revops",
    roleId: "role-revops-manager",
    managerId: "emp-jan-philipp-suhr",
    hiredAt: "2022-09-15",
  },

  // Marketing — Organigramm-Realismus, keine eigenen Event-Typen (PRINCIPLES.md, Prinzip 10/11).
  {
    id: "emp-antonia-reetz",
    name: "Antonia Reetz",
    departmentId: "dept-marketing",
    roleId: "role-marketing-manager",
    managerId: "emp-jonas-reimers",
    hiredAt: "2018-04-01",
  },
  {
    id: "emp-simon-trautmann",
    name: "Simon Trautmann",
    departmentId: "dept-marketing",
    roleId: "role-marketing-manager",
    managerId: "emp-antonia-reetz",
    hiredAt: "2020-08-01",
  },
  {
    id: "emp-laura-feddersen",
    name: "Laura Feddersen",
    departmentId: "dept-marketing",
    roleId: "role-marketing-manager",
    managerId: "emp-antonia-reetz",
    hiredAt: "2022-02-15",
  },

  // Customer Success — Organigramm-Realismus, keine eigenen Event-Typen.
  {
    id: "emp-nils-bergmann",
    name: "Nils Bergmann",
    departmentId: "dept-customer-success",
    roleId: "role-customer-success-manager",
    managerId: "emp-katharina-voss",
    hiredAt: "2019-09-01",
  },
  {
    id: "emp-sina-kappel",
    name: "Sina Kappel",
    departmentId: "dept-customer-success",
    roleId: "role-customer-success-manager",
    managerId: "emp-nils-bergmann",
    hiredAt: "2020-05-01",
  },
  {
    id: "emp-bastian-hoyer",
    name: "Bastian Hoyer",
    departmentId: "dept-customer-success",
    roleId: "role-customer-success-manager",
    managerId: "emp-nils-bergmann",
    hiredAt: "2021-10-01",
  },
  {
    id: "emp-vanessa-moeller",
    name: "Vanessa Möller",
    departmentId: "dept-customer-success",
    roleId: "role-customer-success-manager",
    managerId: "emp-nils-bergmann",
    hiredAt: "2023-03-01",
  },

  // Operations — Organigramm-Realismus, keine eigenen Event-Typen.
  {
    id: "emp-henrik-paulsen",
    name: "Henrik Paulsen",
    departmentId: "dept-operations",
    roleId: "role-operations-manager",
    managerId: "emp-katharina-voss",
    hiredAt: "2017-08-01",
  },
  {
    id: "emp-greta-lohmann",
    name: "Greta Lohmann",
    departmentId: "dept-operations",
    roleId: "role-operations-manager",
    managerId: "emp-henrik-paulsen",
    hiredAt: "2019-11-15",
  },
  {
    id: "emp-marc-oldenburg",
    name: "Marc Oldenburg",
    departmentId: "dept-operations",
    roleId: "role-operations-manager",
    managerId: "emp-henrik-paulsen",
    hiredAt: "2022-06-01",
  },
];
