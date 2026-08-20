import { createRng, type Rng } from "../engine/seed";
import { addDays, randomInt } from "../engine/random";
import { WORLD_TIMELINE_START, WORLD_NOW } from "../timeline/world-clock";
import type { MarketingCampaign } from "../world/marketing-campaigns";

// Marketing Meta/CRM Source Foundation V1 — Meta Ad Spend Source Record.
//
// Geld intern ausschließlich in Minor Units (Euro-Cent, `amountMinor: number`,
// stets ganzzahlig, stets > 0) — kein Floating-Point-Betrag. Währung fest
// "EUR": die gesamte Referenzwelt verwendet bereits durchgehend Euro (siehe
// world/knowledge-objects.ts, formatEuro()) und modelliert an keiner Stelle
// eine zweite Währung — keine stille Umrechnung, kein erfundener Wechselkurs,
// kein STOP nötig (Auftrag B3: STOP nur bei mehreren Währungen OHNE kanonische
// Umrechnung; hier gibt es von Anfang an nur eine).
//
// `spendDate` (fachlicher Ausgabetag) ist strikt von `importedAt` (wann der
// Datensatz in diese Plattform importiert wurde) getrennt — Auftrag B7.
// `importedAt` ist NIEMALS gleich `spendDate` (ein Datenimport erfolgt real
// grundsätzlich zeitversetzt, nie exakt am Ausgabetag selbst) und wird niemals
// als Zeitraum-Anker verwendet (das bleibt ausschließlich `spendDate`).
//
// Kein Budget: ein MetaAdSpendRecord ist ausschließlich TATSÄCHLICHER,
// bereits eingetretener Spend — kein geplantes/zugesagtes Budget, das mit
// echtem Spend verwechselt werden könnte (dieselbe Unterscheidung wie bei
// DeliveryUnit.plannedEndDate, das aus identischem Grund nie befüllt wird).
export interface MetaAdSpendRecord {
  id: string;
  provider: "meta";
  externalAdAccountId: string;
  externalCampaignId: string;
  spendDate: string;
  currency: "EUR";
  amountMinor: number;
  importedAt: string;
}

const SPEND_PROBABILITY = 0.62;
const SPEND_MIN_MINOR = 1500; // 15,00 EUR
const SPEND_MAX_MINOR = 42000; // 420,00 EUR
const IMPORT_DELAY_MIN_DAYS = 1;
const IMPORT_DELAY_MAX_DAYS = 2;

const META_AD_SPEND_SEED_OFFSET = 60_000_000;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Entity-stabiler Teilstrom je (Campaign, Kalendertag) — geschlüsselt über den
// bereits stabilen Campaign.id-String plus die Tagesposition seit
// WORLD_TIMELINE_START (ein reines Kalenderoffset, keine Array-Position eines
// veränderlichen Datensatzes). Dasselbe, bereits etablierte Präzedenzmuster
// wie DELIVERY_LIFECYCLE_SEED_OFFSET (world/delivery-units.ts).
function spendRngFor(seed: number, campaign: MarketingCampaign, dayOffset: number): Rng {
  return createRng(seed + META_AD_SPEND_SEED_OFFSET + (hashString(campaign.id) % 1_000_000) + dayOffset * 7919);
}

export function generateMetaAdSpendRecords(seed: number, campaigns: readonly MarketingCampaign[]): MetaAdSpendRecord[] {
  const records: MetaAdSpendRecord[] = [];
  const totalDays = Math.round((new Date(`${WORLD_NOW}T00:00:00Z`).getTime() - new Date(`${WORLD_TIMELINE_START}T00:00:00Z`).getTime()) / 86400000);

  for (const campaign of campaigns) {
    for (let dayOffset = 0; dayOffset <= totalDays; dayOffset++) {
      const rng = spendRngFor(seed, campaign, dayOffset);
      if (rng() >= SPEND_PROBABILITY) {
        continue;
      }
      const spendDate = addDays(WORLD_TIMELINE_START, dayOffset);
      const amountMinor = randomInt(rng, SPEND_MIN_MINOR, SPEND_MAX_MINOR);
      const importedAt = addDays(spendDate, randomInt(rng, IMPORT_DELAY_MIN_DAYS, IMPORT_DELAY_MAX_DAYS));
      // Kein Capping auf WORLD_NOW: ein MetaAdSpendRecord IST per Definition
      // die bereits importierte Repräsentation eines Spend-Tages (derselbe
      // Grundsatz wie bei Lead/CRM-Ingestion — keine Ingestion, kein
      // Datensatz). Ein Capping hätte für sehr späte spendDate-Werte
      // importedAt === spendDate erzeugen können (ein Datenimport erfolgt
      // real nie exakt am Ausgabetag selbst, B7) — spend, dessen frühestmöglicher
      // Import erst nach WORLD_NOW läge, ist im hiesigen Datenbestand schlicht
      // noch nicht angekommen und wird konsequent nicht erzeugt (keine
      // Future-Knowledge, keine Verletzung der spendDate/importedAt-Trennung).
      if (importedAt > WORLD_NOW) {
        continue;
      }
      records.push({
        id: `meta-spend-${campaign.id}-${spendDate}`,
        provider: "meta",
        externalAdAccountId: campaign.externalAdAccountId,
        externalCampaignId: campaign.externalCampaignId,
        spendDate,
        currency: "EUR",
        amountMinor,
        importedAt,
      });
    }
  }

  return records;
}
