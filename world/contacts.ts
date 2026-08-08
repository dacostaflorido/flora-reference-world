import { createRng, WORLD_SEED } from "../engine/seed";
import { addDays, pick, randomInt } from "../engine/random";
import { CUSTOMER_ACCOUNTS, type CustomerAccount } from "./customer-accounts";

export interface Contact {
  id: string;
  accountId: string;
  name: string;
  roleAtCustomer: string;
  decisionInfluence: "entscheider" | "nutzer" | "einflussnehmer";
  createdAt: string;
}

const FIRST_NAMES = [
  "Anna", "Julia", "Laura", "Sophie", "Lena", "Sarah", "Nina", "Katharina",
  "Maria", "Johanna", "Lisa", "Hannah", "Emma", "Mia", "Clara", "Paul",
  "Jonas", "Leon", "Lukas", "Finn", "Max", "Felix", "Tim", "David",
  "Julian", "Niklas", "Simon", "Moritz", "Jan", "Tobias", "Philipp",
  "Daniel", "Marco", "Sebastian", "Christian", "Michael", "Thomas",
  "Andreas", "Stefan", "Martin",
] as const;

const LAST_NAMES = [
  "Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner",
  "Becker", "Schulz", "Hoffmann", "Schäfer", "Koch", "Bauer", "Richter",
  "Klein", "Wolf", "Neumann", "Schwarz", "Zimmermann", "Braun", "Krüger",
  "Hofmann", "Hartmann", "Lange", "Werner", "Krause", "Meier", "Lehmann",
  "Schmid", "Schulze", "Maier", "Köhler", "Herrmann", "König", "Walter",
  "Mayer", "Huber", "Kaiser", "Fuchs", "Peters",
] as const;

const ROLES_AT_CUSTOMER = [
  "Head of Sales", "Geschäftsführer/in", "Einkaufsleiter/in", "IT-Leiter/in",
  "Vertriebsleiter/in", "Operations Manager", "CFO", "Teamleiter/in Vertrieb",
  "Produktmanager/in", "HR-Leiter/in",
] as const;

// Gewichtet Richtung "nutzer"/"einflussnehmer" — pro Account meist nur eine
// tatsächliche Entscheiderperson.
const DECISION_INFLUENCE_WEIGHTED: readonly Contact["decisionInfluence"][] = [
  "entscheider", "entscheider",
  "nutzer", "nutzer", "nutzer",
  "einflussnehmer", "einflussnehmer", "einflussnehmer",
];

export function generateContacts(seed: number, accounts: readonly CustomerAccount[]): Contact[] {
  const rng = createRng(seed);
  const contacts: Contact[] = [];
  let counter = 1;

  for (const account of accounts) {
    const contactCount = randomInt(rng, 1, 4);
    for (let i = 0; i < contactCount; i++) {
      const id = `contact-${String(counter++).padStart(4, "0")}`;
      const createdAt = addDays(account.createdAt, randomInt(rng, 0, 60));
      contacts.push({
        id,
        accountId: account.id,
        name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
        roleAtCustomer: pick(rng, ROLES_AT_CUSTOMER),
        decisionInfluence: pick(rng, DECISION_INFLUENCE_WEIGHTED),
        createdAt,
      });
    }
  }
  return contacts;
}

export const CONTACTS: Contact[] = generateContacts(WORLD_SEED + 2, CUSTOMER_ACCOUNTS);
