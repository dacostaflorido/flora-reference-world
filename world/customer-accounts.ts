import { createRng, WORLD_SEED } from "../engine/seed";
import { addDays, daysBetween, pick, randomInt } from "../engine/random";
import { WORLD_NOW } from "../timeline/world-clock";

export interface CustomerAccount {
  id: string;
  name: string;
  industry: string;
  sizeBand: string;
  region: string;
  createdAt: string;
}

const ACCOUNT_COUNT = 120;

// Zwei Accounts erhalten ein fest verdrahtetes createdAt statt eines zufälligen —
// sie dienen als Grundlage für handmodellierte Ownership-Wechsel in
// account-ownership.ts (u. a. ein Mitarbeiteraustritt), die auf ein bekanntes,
// stabiles Datum angewiesen sind.
const FIXED_CREATED_AT: Record<string, string> = {
  "account-0001": "2020-01-15",
  "account-0002": "2018-06-01",
};

const NAME_STEMS = [
  "Nordwind", "Elbmark", "Kranich", "Falkenberg", "Alsterblick", "Fehmarn",
  "Roggenkamp", "Vierlanden", "Speicherstadt", "Hanseatica", "Wattkamp",
  "Silberreiher", "Duvenstedt", "Moorwiesen", "Kiekeberg", "Bergedorf",
  "Rheinklang", "Schwarzwald", "Donaupark", "Havelblick", "Rüdesheim",
  "Taunusstein", "Loreley", "Zugspitze", "Odenwald", "Weserblick",
  "Mainlinie", "Isarquelle", "Spreepark", "Barnimwald",
] as const;

const NAME_SUFFIXES = [
  "GmbH", "GmbH & Co. KG", "AG", "Systems GmbH", "Software AG",
  "Solutions GmbH", "Logistik GmbH", "Handel GmbH", "Consulting GmbH",
  "Maschinenbau GmbH", "Technik GmbH", "Werke GmbH", "Group AG",
] as const;

const INDUSTRIES = [
  "Maschinenbau", "Logistik", "Einzelhandel", "IT-Dienstleistungen",
  "Gesundheitswesen", "Finanzdienstleistungen", "Bauwesen", "Konsumgüter",
  "Automotive-Zulieferer", "Energie & Versorgung", "Personaldienstleistungen",
  "Bildung", "Medien", "E-Commerce", "Chemie",
] as const;

// Größenbänder mit Gewichtung Richtung KMU (mehrfach enthalten statt separater
// Gewichtungslogik) — passend zum typischen B2B-SaaS-ICP.
const SIZE_BANDS_WEIGHTED = [
  "1–9 Mitarbeiter",
  "10–49 Mitarbeiter", "10–49 Mitarbeiter",
  "50–249 Mitarbeiter", "50–249 Mitarbeiter", "50–249 Mitarbeiter",
  "250–999 Mitarbeiter", "250–999 Mitarbeiter",
  "1.000+ Mitarbeiter",
] as const;

const REGIONS = [
  "Hamburg", "Berlin", "München", "Köln", "Frankfurt am Main", "Stuttgart",
  "Düsseldorf", "Hannover", "Bremen", "Leipzig", "Nürnberg", "Dortmund",
  "Wien", "Zürich",
] as const;

const WORLD_START_DATE = "2018-01-01";

// Step 3 (Timeline): an WORLD_NOW gekoppelt statt eines unabhängigen Platzhalterdatums
// — reiner Generatorparameter, kein Feldmodell geändert. 90 Tage Puffer vor WORLD_NOW,
// damit abgeleitete Contact-createdAt-Werte (bis zu +60 Tage, siehe contacts.ts)
// niemals über WORLD_NOW hinausreichen.
const WORLD_ACCOUNT_END_DATE = addDays(WORLD_NOW, -90);

// Alle Stamm/Suffix-Kombinationen deterministisch mischen (Fisher-Yates via Rng) und
// von vorn verbrauchen — garantiert eindeutige Namen ohne Kollisionsbehandlung
// (30 Stämme × 13 Suffixe = 390 Kombinationen, für 120 Accounts ausreichend).
function buildShuffledCompanyNamePool(rng: () => number): string[] {
  const combos: string[] = [];
  for (const stem of NAME_STEMS) {
    for (const suffix of NAME_SUFFIXES) {
      combos.push(`${stem} ${suffix}`);
    }
  }
  for (let i = combos.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = combos[i]!;
    combos[i] = combos[j]!;
    combos[j] = tmp;
  }
  return combos;
}

export function generateCustomerAccounts(seed: number): CustomerAccount[] {
  const rng = createRng(seed);
  const namePool = buildShuffledCompanyNamePool(rng);
  const accountDateRangeDays = daysBetween(WORLD_START_DATE, WORLD_ACCOUNT_END_DATE);

  const accounts: CustomerAccount[] = [];
  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    const id = `account-${String(i + 1).padStart(4, "0")}`;
    const createdAt =
      FIXED_CREATED_AT[id] ??
      addDays(WORLD_START_DATE, randomInt(rng, 0, accountDateRangeDays));

    accounts.push({
      id,
      name: namePool[i] ?? `${pick(rng, NAME_STEMS)} ${pick(rng, NAME_SUFFIXES)}`,
      industry: pick(rng, INDUSTRIES),
      sizeBand: pick(rng, SIZE_BANDS_WEIGHTED),
      region: pick(rng, REGIONS),
      createdAt,
    });
  }
  return accounts;
}

export const CUSTOMER_ACCOUNTS: CustomerAccount[] = generateCustomerAccounts(WORLD_SEED + 1);
