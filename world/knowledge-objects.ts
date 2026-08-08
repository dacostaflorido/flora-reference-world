import { createRng, WORLD_SEED } from "../engine/seed";
import { addDays, daysBetween, pick, randomInt } from "../engine/random";
import { WORLD_NOW } from "../timeline/world-clock";
import { EMPLOYEES, type Employee } from "./employees";
import { CUSTOMER_ACCOUNTS, type CustomerAccount } from "./customer-accounts";
import { CONTACTS, type Contact } from "./contacts";
import { LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY } from "../events/generate-sales-pipeline";
import type { Opportunity } from "../events/opportunities";
import type { OpportunityStageHistory } from "../events/opportunity-stage-history";

// Feldebene wie im eingefrorenen Architekturmodell festgelegt. Placement bewusst in
// world/ (nicht events/), wie in der Architekturrunde entschieden: KnowledgeObject
// selbst ist eine statische Dokument-Entität; Instanzen mit relatedOpportunityId sind
// lediglich an die Laufzeit einer Opportunity gebunden (Invariante), ohne dass
// KnowledgeObject dadurch ein dynamisches Event wird.
export interface KnowledgeObject {
  id: string;
  type: "angebotsdokument" | "gespraechsleitfaden" | "preisliste" | "sop" | "interne-dokumentation" | "produktblatt";
  title: string;
  authorEmployeeId: string;
  createdAt: string;
  updatedAt: string;
  visibility: "intern" | "team" | "vertraulich";
  relatedAccountId?: string;
  relatedOpportunityId?: string;
  content: string;
  tags: string[];
}

function isEmployeeValidAt(employee: Employee, isoDate: string): boolean {
  return employee.hiredAt <= isoDate && (employee.terminatedAt === undefined || isoDate <= employee.terminatedAt);
}

function formatEuro(value: number): string {
  return `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;
}

const STRATEGIC_SIZE_BANDS = new Set(["250–999 Mitarbeiter", "1.000+ Mitarbeiter"]);

// --- Unternehmensweite Knowledge Objects (handkuratiert, statisch — analog zu
// Company/Department/Role in Schritt 1: geringe Stückzahl, jede Instanz bewusst
// gewählt statt aus Textbausteinen generiert). ------------------------------------

interface CompanyWideSeed {
  type: KnowledgeObject["type"];
  title: string;
  authorId: string;
  createdAt: string;
  updatedAt?: string;
  visibility: KnowledgeObject["visibility"];
  content: string;
  tags: string[];
}

const COMPANY_WIDE_DOCS: CompanyWideSeed[] = [
  {
    type: "preisliste",
    title: "Preisliste – Vertrieb (Stand Juni 2024)",
    authorId: "emp-jan-philipp-suhr",
    createdAt: "2024-06-10",
    updatedAt: "2024-08-09",
    visibility: "vertraulich",
    content:
      "Interne Preisliste für Vertriebsgespräche. Starter-Paket: ab 249 €/Monat, geeignet für Teams bis 10 Nutzer. " +
      "Professional-Paket: ab 890 €/Monat, geeignet für wachsende Vertriebsteams bis 50 Nutzer, inkl. erweiterter " +
      "Auswertungen. Enterprise-Paket: individuelles Angebot ab 2.500 €/Monat, inkl. dediziertem Ansprechpartner und " +
      "individuellen SLAs. Rabatte bei Jahreszahlung: 10 %. Rabatte über 15 % erfordern Freigabe des Sales Managers.",
    tags: ["Preise", "Pakete", "Rabatte"],
  },
  {
    type: "preisliste",
    title: "Preisliste – Vertrieb (Stand Februar 2025)",
    authorId: "emp-jan-philipp-suhr",
    createdAt: "2025-02-15",
    visibility: "vertraulich",
    content:
      "Aktualisierte Preisliste. Starter-Paket: ab 279 €/Monat. Professional-Paket: ab 990 €/Monat, jetzt inkl. " +
      "Prioritäts-Support. Enterprise-Paket weiterhin individuell, Richtwert ab 2.800 €/Monat. Jahresrabatt " +
      "unverändert bei 10 %. Diese Version ersetzt die Preisliste vom Juni 2024.",
    tags: ["Preise", "Pakete", "Update"],
  },
  {
    type: "sop",
    title: "SOP – Lead-Routing",
    authorId: "emp-jan-philipp-suhr",
    createdAt: "2024-06-05",
    visibility: "intern",
    content:
      "Eingehende Leads werden dem für den jeweiligen Account zuständigen SDR zugewiesen (siehe Account-Ownership). " +
      "Ist noch kein SDR zugewiesen, erfolgt die Zuteilung nach Territory und aktueller Auslastung durch den " +
      "zuständigen Sales Manager. Ziel: Erstkontakt innerhalb von 2 Werktagen nach Lead-Erstellung.",
    tags: ["Routing", "SDR", "Territory"],
  },
  {
    type: "sop",
    title: "SOP – Opportunity-Hygiene",
    authorId: "emp-fabian-krueger",
    createdAt: "2024-07-01",
    visibility: "intern",
    content:
      "Jede Opportunity muss nach jedem Kundenkontakt in der CRM-Aktivität dokumentiert werden. Opportunities ohne " +
      "dokumentierten nächsten Schritt gelten nach 14 Tagen als hygienebedürftig und werden im Pipeline Review " +
      "angesprochen. Stage-Wechsel müssen am selben Tag im CRM nachgezogen werden.",
    tags: ["Hygiene", "CRM", "Pipeline Review"],
  },
  {
    type: "sop",
    title: "SOP – Angebots-Freigabeprozess",
    authorId: "emp-timo-albrecht",
    createdAt: "2024-09-01",
    visibility: "intern",
    content:
      "Angebote bis 50.000 € können vom zuständigen Account Executive eigenständig versendet werden. Angebote über " +
      "50.000 € benötigen die Freigabe des zuständigen Sales Managers vor Versand. Rabatte über 15 % erfordern " +
      "zusätzlich Rücksprache mit der Geschäftsführung.",
    tags: ["Freigabe", "Angebote", "Prozess"],
  },
  {
    type: "interne-dokumentation",
    title: "Interne Dokumentation – Lead-Qualifizierung",
    authorId: "emp-fabian-krueger",
    createdAt: "2024-06-15",
    visibility: "intern",
    content:
      "Ein Lead gilt als qualifiziert, wenn Bedarf, Budgetrahmen, Entscheidungsbefugnis des Kontakts und ein " +
      "realistischer Zeitrahmen für eine Entscheidung erkennbar sind. Fehlt eines dieser Kriterien deutlich, bleibt " +
      "der Lead im Status 'kontaktiert', bis weitere Informationen vorliegen.",
    tags: ["Qualifizierung", "BANT", "Lead-Status"],
  },
  {
    type: "interne-dokumentation",
    title: "Interne Dokumentation – Onboarding neue SDRs",
    authorId: "emp-svenja-brandt",
    createdAt: "2024-08-20",
    visibility: "intern",
    content:
      "Neue SDRs erhalten in den ersten zwei Wochen ein reduziertes Territory, das schrittweise erweitert wird. Der " +
      "zuständige Sales Manager begleitet die ersten zehn Erstgespräche. Zielgröße nach drei Monaten: eigenständige " +
      "Bearbeitung eines vollständigen Territorys.",
    tags: ["Onboarding", "SDR", "Territory"],
  },
  {
    type: "gespraechsleitfaden",
    title: "Gesprächsleitfaden – Erstgespräch",
    authorId: "emp-fabian-krueger",
    createdAt: "2024-06-20",
    visibility: "team",
    content:
      "Ziel des Erstgesprächs: Bedarf verstehen, aktuellen Prozess des Kunden erfassen, groben Zeitrahmen klären. " +
      "Typische Einstiegsfrage: 'Wie läuft die Vertriebssteuerung bei Ihnen aktuell ab?' Nutzenargumentation über " +
      "Klarheit und Zeitersparnis in der Führung stellen, nicht über Funktionsumfang.",
    tags: ["Erstgespräch", "Value", "Discovery"],
  },
  {
    type: "gespraechsleitfaden",
    title: "Gesprächsleitfaden – Einwandbehandlung Preisgespräche",
    authorId: "emp-svenja-brandt",
    createdAt: "2024-07-10",
    visibility: "team",
    content:
      "Bei Preiseinwänden zunächst den wahrgenommenen Nutzen bestätigen lassen, bevor über den Preis gesprochen " +
      "wird. Bei Budget-Einwänden nach dem internen Freigabeprozess des Kunden fragen. Bei Wettbewerbsvergleichen " +
      "konkret nach dem Vergleichskriterium fragen, nicht pauschal abwerten.",
    tags: ["Einwand", "Preis", "Wettbewerb"],
  },
  {
    type: "produktblatt",
    title: "Produktblatt – Flora Core",
    authorId: "emp-antonia-reetz",
    createdAt: "2024-06-25",
    visibility: "intern",
    content:
      "Flora Core liefert Vertriebsleitungen ein tägliches Führungsbriefing: die wichtigste Entscheidung des Tages, " +
      "priorisierte Themen und die zugrunde liegende Evidenz. Zielgruppe: wachsende Vertriebsorganisationen ab ca. " +
      "5 Vertriebsmitarbeitenden. Keine neue Oberfläche für das Tagesgeschäft, sondern eine Verdichtung " +
      "bestehender CRM-Daten.",
    tags: ["Produkt", "Führungsbriefing", "Zielgruppe"],
  },
  {
    type: "produktblatt",
    title: "Produktblatt – Enterprise Paket",
    authorId: "emp-antonia-reetz",
    createdAt: "2024-10-01",
    visibility: "intern",
    content:
      "Das Enterprise-Paket ergänzt Flora Core um individuelle SLAs, einen dedizierten Ansprechpartner und " +
      "erweiterte Auswertungen über mehrere Teams hinweg. Geeignet für Organisationen mit mehreren " +
      "Sales-Manager-Teams und komplexeren Freigabeprozessen.",
    tags: ["Produkt", "Enterprise", "SLA"],
  },
];

export function generateKnowledgeObjects(
  seed: number,
  employees: readonly Employee[],
  accounts: readonly CustomerAccount[],
  contacts: readonly Contact[],
  opportunities: readonly Opportunity[],
  stageHistory: readonly OpportunityStageHistory[],
): KnowledgeObject[] {
  const rng = createRng(seed);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const leadById = new Map(LEADS.map((l) => [l.id, l]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const objects: KnowledgeObject[] = [];
  let counter = 1;
  const nextId = () => `kobj-${String(counter++).padStart(5, "0")}`;

  // 1) Unternehmensweite Dokumente.
  for (const doc of COMPANY_WIDE_DOCS) {
    objects.push({
      id: nextId(),
      type: doc.type,
      title: doc.title,
      authorEmployeeId: doc.authorId,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt ?? doc.createdAt,
      visibility: doc.visibility,
      content: doc.content,
      tags: doc.tags,
    });
  }

  // 2) Account-bezogene interne Dokumentation — nur für strategische Accounts
  // (großes Größenband), fachlich plausibel als "Account-Profil" für Key Accounts,
  // nicht für den gesamten Bestand.
  const strategicAccounts = accounts.filter((a) => STRATEGIC_SIZE_BANDS.has(a.sizeBand));
  for (const account of strategicAccounts) {
    if (rng() >= 0.6) {
      continue;
    }
    const profileDate = addDays(account.createdAt, 120);
    if (profileDate > WORLD_NOW) {
      continue;
    }
    const ownerCandidates = employees.filter(
      (e) => (e.roleId === "role-account-executive" || e.roleId === "role-sales-manager") && isEmployeeValidAt(e, profileDate),
    );
    if (ownerCandidates.length === 0) continue;
    const owner = pick(rng, ownerCandidates);
    objects.push({
      id: nextId(),
      type: "interne-dokumentation",
      title: `Account-Profil (intern) – ${account.name}`,
      authorEmployeeId: owner.id,
      createdAt: profileDate,
      updatedAt: profileDate,
      visibility: "intern",
      relatedAccountId: account.id,
      content:
        `Strategischer Account. Branche: ${account.industry}. Größenklasse: ${account.sizeBand}. Region: ` +
        `${account.region}. Territory-Zuständigkeit wird im Pipeline Review regelmäßig überprüft.`,
      tags: ["Account-Profil", "Strategisch", account.industry],
    });
  }

  // 3) Angebotsdokumente — für einen Teil der Opportunities, die die Stage "angebot"
  // erreicht haben, zeitlich innerhalb dieser Stage, mit dem tatsächlichen Dealwert.
  const stagesByOpportunity = new Map<string, OpportunityStageHistory[]>();
  for (const entry of stageHistory) {
    const list = stagesByOpportunity.get(entry.opportunityId) ?? [];
    list.push(entry);
    stagesByOpportunity.set(entry.opportunityId, list);
  }

  for (const opportunity of opportunities) {
    const entries = stagesByOpportunity.get(opportunity.id) ?? [];
    const angebotEntry = entries.find((e) => e.stage === "angebot");
    if (!angebotEntry) continue;
    if (rng() >= 0.6) continue;

    const windowEnd = angebotEntry.exitedAt ?? WORLD_NOW;
    const span = Math.min(7, Math.max(0, daysBetween(angebotEntry.enteredAt, windowEnd)));
    const createdAt = addDays(angebotEntry.enteredAt, randomInt(rng, 0, span));
    const author = employeeById.get(angebotEntry.responsibleEmployeeId);
    if (!author || !isEmployeeValidAt(author, createdAt)) continue;

    const account = accounts.find((a) => a.id === opportunity.accountId);
    if (!account) continue;
    const lead = leadById.get(opportunity.leadId);
    const contact = lead ? contactById.get(lead.contactId) : undefined;

    const hasRevision = rng() < 0.2;
    const updatedAt = hasRevision ? minIso(addDays(createdAt, randomInt(rng, 2, 6)), windowEnd) : createdAt;

    objects.push({
      id: nextId(),
      type: "angebotsdokument",
      title: `Angebot – ${account.name}`,
      authorEmployeeId: author.id,
      createdAt,
      updatedAt,
      visibility: "team",
      relatedAccountId: account.id,
      relatedOpportunityId: opportunity.id,
      content:
        `Angebot für ${account.name}` +
        (contact ? ` — Ansprechpartner: ${contact.name} (${contact.roleAtCustomer})` : "") +
        `. Gesamtvolumen: ${formatEuro(opportunity.value)}. Branche: ${account.industry}. Gültig bis ` +
        `${addDays(createdAt, 30)}.`,
      tags: ["Angebot", account.industry],
    });
  }

  return objects;
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

export const KNOWLEDGE_OBJECTS: KnowledgeObject[] = generateKnowledgeObjects(
  WORLD_SEED + 6,
  EMPLOYEES,
  CUSTOMER_ACCOUNTS,
  CONTACTS,
  OPPORTUNITIES,
  OPPORTUNITY_STAGE_HISTORY,
);
