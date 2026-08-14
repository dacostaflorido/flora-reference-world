import { createRng, WORLD_SEED, type Rng } from "../engine/seed";
import { addDays, daysBetween, pick, randomInt } from "../engine/random";
import { sampleDemandDrivenDate } from "../engine/marketing-demand";
import { WORLD_NOW, WORLD_TIMELINE_START } from "../timeline/world-clock";
import { BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { EMPLOYEES, type Employee } from "../world/employees";
import { CUSTOMER_ACCOUNTS, type CustomerAccount } from "../world/customer-accounts";
import { CONTACTS, type Contact } from "../world/contacts";
import { ACCOUNT_OWNERSHIPS, type AccountOwnership } from "../world/account-ownership";
import type { Lead } from "./leads";
import type { Opportunity } from "./opportunities";
import type { OpportunityStageHistory } from "./opportunity-stage-history";

// Lead → Opportunity → OpportunityStageHistory werden bewusst in einem Generator
// erzeugt statt in drei unabhängigen Dateien: sie sind kausal gekoppelt (Konversion,
// s. PRINCIPLES.md Prinzip 6/7), die Verlinkung (Lead.convertedToOpportunityId) kann
// nur entstehen, während die Opportunity erzeugt wird. Das ist keine "vollständige
// Generator-Orchestrierung" (die würde World+Events+Observations+Scenario verbinden),
// sondern die minimal notwendige Kopplung innerhalb dieser drei Entitäten.

const LEAD_COUNT = 1100;

// Marketing Demand Model — World Generation First: eigener, vom
// Haupt-Pipeline-Rng vollständig getrennter Zufallsstrom für die
// Nachfrage-getriebene Bestimmung von Lead.createdAt (siehe
// engine/marketing-demand.ts). Ein großer, klar von allen bestehenden
// Seed-Offsets (SEED_STEP in engine/generator.ts: 3-7; SCENARIO_SEED_OFFSETS:
// 0-500.000) getrennter Offset — verhindert jede Kollision und stellt sicher,
// dass eine Änderung der Nachfrage-Verteilung die übrigen, fachlich
// unabhängigen Zufallsentscheidungen je Lead (Quelle, Status,
// Folgekontakt-Zeitpunkt, Konversions-Offset) nicht verschiebt: `rng` bleibt in
// exakt derselben Aufrufreihenfolge wie zuvor erhalten, nur die
// createdAt-Bestimmung wechselt von `rng` zu `demandRng`.
//
// AUFTRAG — Sales Ownership / Marketing Demand Decoupling: der Offset wird
// zusätzlich mit dem Lead-Loop-Index kombiniert (siehe unten, `seed +
// MARKETING_DEMAND_SEED_OFFSET + i`) — jeder Lead erhält dadurch einen
// eigenständigen, entity-stabilen demandRng-Teilstrom statt eines gemeinsam
// sequenziell verbrauchten Stroms. Ursache: `sampleDemandDrivenDate` verbraucht
// über Rejection Sampling eine VARIABLE Anzahl von rng()-Aufrufen pro Lead — bei
// einem gemeinsamen Strom verschiebt eine Nachfrage-Änderung für EIN
// Kalenderfenster dadurch die kumulative Stream-Position für JEDEN nachfolgenden
// Lead, unabhängig davon, ob dessen eigenes zulässiges Zeitfenster das
// geänderte Regime überhaupt berührt — ein reines RNG-Sequenz-/Order-Artefakt
// (Kategorie B/D), keine fachliche Kopplung. Reproduktion und Beleg (93 % auf
// 1,9 % divergente Leads bei einer isolierten Modelländerung) in
// validation/sales-ownership-decoupling.test.ts. `i` ist dabei bewusst der
// Lead-Loop-Index (nicht z. B. account.id+contact.id): er ist für ein gegebenes
// Scenario-Profil unabhängig vom Demand Model bereits stabil, da Account-/
// Contact-Picks weiterhin ausschließlich aus dem separaten Haupt-`rng`-Strom
// kommen (siehe oben) — keine neue Hash-/Seed-Bibliothek nötig, dieselbe
// additive Seed-Komposition wie überall sonst im Repository.
const MARKETING_DEMAND_SEED_OFFSET = 10_000_000;

const LEAD_SOURCES = [
  "Webinar", "Kaltakquise", "Empfehlung", "Website-Formular", "Messe",
  "LinkedIn Outreach", "Content-Download", "Bestandskunden-Erweiterung",
] as const;

const LEAD_LOST_REASONS = [
  "Kein Budget", "Kein Bedarf mehr", "Konkurrenzprodukt gewählt",
  "Kein Entscheider erreichbar", "Zeitpunkt ungünstig", "Interne Priorität verschoben",
] as const;

const OPPORTUNITY_LOST_REASONS = [
  "Budget nicht freigegeben", "Wettbewerber gewählt", "Interne Priorität verschoben",
  "Kein Entscheider-Buy-in", "Preis zu hoch", "Projekt intern verschoben",
] as const;

const VALUE_RANGE_BY_SIZE_BAND: Record<string, readonly [number, number]> = {
  "1–9 Mitarbeiter": [2000, 8000],
  "10–49 Mitarbeiter": [5000, 20000],
  "50–249 Mitarbeiter": [15000, 60000],
  "250–999 Mitarbeiter": [40000, 150000],
  "1.000+ Mitarbeiter": [100000, 400000],
};

const STAGE_ORDER = ["qualifizierung", "angebot", "verhandlung"] as const;
type OpenStage = (typeof STAGE_ORDER)[number];

function stageDurationDays(rng: Rng, stage: OpenStage, durationMultiplier: number): number {
  const [min, max] = (() => {
    switch (stage) {
      case "qualifizierung":
        return [5, 20] as const;
      case "angebot":
        return [10, 30] as const;
      case "verhandlung":
        return [7, 25] as const;
    }
  })();
  return Math.max(1, Math.round(randomInt(rng, min, max) * durationMultiplier));
}

function probabilityForStage(rng: Rng, stage: OpenStage): number {
  switch (stage) {
    case "qualifizierung":
      return randomInt(rng, 20, 40);
    case "angebot":
      return randomInt(rng, 40, 60);
    case "verhandlung":
      return randomInt(rng, 60, 80);
  }
}

// Passt natürliche Stage-Dauern proportional an ein Zeitbudget an, statt es zu
// überschreiten — garantiert, dass generierte Historien niemals über WORLD_NOW
// hinausreichen (siehe Timeline-Invariante).
function fitDurationsToBudget(durations: number[], budgetDays: number): number[] {
  const total = durations.reduce((sum, d) => sum + d, 0);
  if (total <= budgetDays || total === 0) {
    return durations;
  }
  const scale = budgetDays / total;
  return durations.map((d) => Math.max(1, Math.floor(d * scale)));
}

function isEmployeeValidAt(employee: Employee, isoDate: string): boolean {
  return employee.hiredAt <= isoDate && (employee.terminatedAt === undefined || isoDate <= employee.terminatedAt);
}

function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}

export interface SalesPipeline {
  leads: Lead[];
  opportunities: Opportunity[];
  stageHistory: OpportunityStageHistory[];
}

export function generateSalesPipeline(
  seed: number,
  accounts: readonly CustomerAccount[],
  contacts: readonly Contact[],
  employees: readonly Employee[],
  ownerships: readonly AccountOwnership[],
  scenarioProfile: ScenarioProfile = BASELINE_PROFILE,
): SalesPipeline {
  const rng = createRng(seed);
  const sales = scenarioProfile.sales;
  const marketingDemandModel = scenarioProfile.marketing.demandModel;
  const leadCount = Math.round(LEAD_COUNT * sales.leadCountMultiplier);
  const { neu, kontaktiert, qualifiziert, konvertiert } = sales.leadStatusThresholds;
  const { open: openThreshold, gewonnen: gewonnenThreshold } = sales.opportunityOutcomeThresholds;
  const { advanceOnly, bothAdvance, bothRegress, regressOnly } = sales.stageMovement;
  const followUpCapDays = Math.round(20 * sales.followUpDelayMultiplier);

  const contactsByAccount = new Map<string, Contact[]>();
  for (const contact of contacts) {
    const list = contactsByAccount.get(contact.accountId) ?? [];
    list.push(contact);
    contactsByAccount.set(contact.accountId, list);
  }

  function findOwnershipAt(
    accountId: string,
    role: AccountOwnership["ownershipRole"],
    date: string,
  ): AccountOwnership | undefined {
    return ownerships.find(
      (o) =>
        o.accountId === accountId &&
        o.ownershipRole === role &&
        o.validFrom <= date &&
        (o.validTo === undefined || date <= o.validTo),
    );
  }

  function resolveLeadOwner(accountId: string, date: string): string {
    const sdr = findOwnershipAt(accountId, "sdr", date);
    if (sdr) return sdr.employeeId;
    const owner = findOwnershipAt(accountId, "owner", date);
    if (owner) return owner.employeeId;
    const pool = employees.filter((e) => e.roleId === "role-sales-development-rep" && isEmployeeValidAt(e, date));
    return pick(rng, pool).id;
  }

  function resolveOpportunityOwner(accountId: string, date: string): string {
    const ae = findOwnershipAt(accountId, "ae", date);
    if (ae) return ae.employeeId;
    const aePool = employees.filter((e) => e.roleId === "role-account-executive" && isEmployeeValidAt(e, date));
    if (aePool.length > 0) return pick(rng, aePool).id;
    const smPool = employees.filter((e) => e.roleId === "role-sales-manager" && isEmployeeValidAt(e, date));
    return pick(rng, smPool).id;
  }

  function pickHandoffEmployee(currentEmployeeId: string, date: string): string {
    const pool = employees.filter(
      (e) => e.roleId === "role-account-executive" && e.id !== currentEmployeeId && isEmployeeValidAt(e, date),
    );
    return pool.length > 0 ? pick(rng, pool).id : currentEmployeeId;
  }

  const leads: Lead[] = [];
  const opportunities: Opportunity[] = [];
  const stageHistory: OpportunityStageHistory[] = [];

  let leadCounter = 1;
  let oppCounter = 1;
  let stageCounter = 1;
  const nextLeadId = () => `lead-${String(leadCounter++).padStart(5, "0")}`;
  const nextOppId = () => `opp-${String(oppCounter++).padStart(5, "0")}`;
  const nextStageId = () => `stage-${String(stageCounter++).padStart(5, "0")}`;

  function buildOpportunity(id: string, lead: Lead, account: CustomerAccount, createdAt: string): void {
    const remainingDays = daysBetween(createdAt, WORLD_NOW);
    const [minValue, maxValue] = VALUE_RANGE_BY_SIZE_BAND[account.sizeBand] ?? [5000, 20000];
    const value = Math.round(randomInt(rng, minValue, maxValue) / 100) * 100;

    let responsible = resolveOpportunityOwner(account.id, createdAt);
    const doHandoff = rng() < 0.15;

    // Verteilung aus scenarioProfile.sales.opportunityOutcomeThresholds (baseline: ~35%
    // offen / ~30% gewonnen / ~35% verloren) — mit Recency-Schutz: zu junge
    // Opportunities hatten noch keine Zeit, sich zu schließen.
    let outcome: "open" | "gewonnen" | "verloren";
    if (remainingDays < 15) {
      outcome = "open";
    } else {
      const roll = rng();
      outcome = roll < openThreshold ? "open" : roll < gewonnenThreshold ? "gewonnen" : "verloren";
    }

    const entries: OpportunityStageHistory[] = [];
    let cursor = createdAt;

    if (outcome === "open") {
      // Reference-World-Validation (Pipeline-Stagnation): eine offene Opportunity
      // wird jetzt stage-für-stage vom Erstellungszeitpunkt bis WORLD_NOW simuliert,
      // statt einmalig eine "aktuelle Stage" zu raten und danach einzufrieren — sonst
      // korreliert "Tage in aktueller Stage" fast 1:1 mit dem Erstellungsdatum statt
      // mit echtem Geschäftsverhalten (Generatorartefakt, kein Business-Muster).
      //
      // "verhandlung" darf dabei kein Absorptionszustand werden: eine erste Version
      // erlaubte nur Vorwärtsbewegung, wodurch praktisch jede alte offene Opportunity
      // irgendwann in "verhandlung" landete und dort für den Rest der Zeitachse
      // unverändert blieb — dieselbe Fehlerklasse, nur an anderer Stelle. Deshalb ist
      // an jedem Stage-Ende (außer am Anfang/Ende der Kette) auch ein realistisches
      // Zurückfallen möglich (Nachverhandlung, Rescoping) — ein echter, zeitlich
      // verankerter Stall bleibt weiterhin der wahrscheinlichste Einzelausgang.
      let stageIndex = 0;
      let entryStart = createdAt;
      let handoffApplied = false;

      while (true) {
        const stage = STAGE_ORDER[stageIndex]!;
        const duration = stageDurationDays(rng, stage, sales.stageDurationMultiplier);
        const candidateCursor = addDays(cursor, duration);
        if (candidateCursor >= WORLD_NOW) {
          break;
        }
        cursor = candidateCursor;

        const canAdvance = stageIndex < STAGE_ORDER.length - 1;
        const canRegress = stageIndex > 0;
        const roll = rng();
        let move: "advance" | "regress" | "stay";
        if (canAdvance && canRegress) {
          move = roll < bothAdvance ? "advance" : roll < bothAdvance + bothRegress ? "regress" : "stay";
        } else if (canAdvance) {
          move = roll < advanceOnly ? "advance" : "stay";
        } else {
          move = roll < regressOnly ? "regress" : "stay";
        }

        if (move !== "stay") {
          entries.push({
            id: nextStageId(),
            opportunityId: id,
            stage,
            enteredAt: entryStart,
            exitedAt: cursor,
            responsibleEmployeeId: responsible,
          });
          if (doHandoff && !handoffApplied) {
            responsible = pickHandoffEmployee(responsible, cursor);
            handoffApplied = true;
          }
          stageIndex += move === "advance" ? 1 : -1;
          entryStart = cursor;
        }
        // "stay": Opportunity bleibt in derselben Stage, entryStart bleibt
        // unverändert — ein echter, zeitlich verankerter Stall, kein Einfrieren.
      }

      const currentStage = STAGE_ORDER[stageIndex]!;
      entries.push({
        id: nextStageId(),
        opportunityId: id,
        stage: currentStage,
        enteredAt: entryStart,
        responsibleEmployeeId: responsible,
      });

      opportunities.push({
        id,
        leadId: lead.id,
        accountId: account.id,
        createdAt,
        currentStage,
        value,
        probability: probabilityForStage(rng, currentStage),
        responsibleEmployeeId: responsible,
      });
      stageHistory.push(...entries);
      return;
    }

    // Geschlossen (gewonnen/verloren): gewonnen durchläuft immer alle drei Stages;
    // verloren bricht nach 1–3 Stages ab (früher Verlust ist wahrscheinlicher).
    const stagesToTraverse: OpenStage[] =
      outcome === "gewonnen"
        ? [...STAGE_ORDER]
        : (() => {
            const roll = rng();
            const count = roll < 0.5 ? 1 : roll < 0.8 ? 2 : 3;
            return STAGE_ORDER.slice(0, count);
          })();

    const budget = Math.max(stagesToTraverse.length, remainingDays - 1);
    const durations = fitDurationsToBudget(
      stagesToTraverse.map((s) => stageDurationDays(rng, s, sales.stageDurationMultiplier)),
      budget,
    );

    stagesToTraverse.forEach((stage, i) => {
      const enteredAt = cursor;
      const exitedAt = addDays(cursor, durations[i] ?? 1);
      const isLastRegularStage = i === stagesToTraverse.length - 1;
      entries.push({
        id: nextStageId(),
        opportunityId: id,
        stage,
        enteredAt,
        exitedAt,
        responsibleEmployeeId: responsible,
        outcome: isLastRegularStage ? (outcome === "gewonnen" ? "Gewonnen" : pick(rng, OPPORTUNITY_LOST_REASONS)) : undefined,
      });
      if (doHandoff && i === Math.floor(stagesToTraverse.length / 2)) {
        responsible = pickHandoffEmployee(responsible, exitedAt);
      }
      cursor = exitedAt;
    });

    const closedAt = cursor;
    entries.push({
      id: nextStageId(),
      opportunityId: id,
      stage: outcome,
      enteredAt: closedAt,
      responsibleEmployeeId: responsible,
    });

    const lostReason = outcome === "verloren" ? (entries[entries.length - 2]?.outcome ?? pick(rng, OPPORTUNITY_LOST_REASONS)) : undefined;

    opportunities.push({
      id,
      leadId: lead.id,
      accountId: account.id,
      createdAt,
      currentStage: outcome,
      value,
      probability: outcome === "gewonnen" ? 100 : 0,
      responsibleEmployeeId: responsible,
      closedAt,
      lostReason,
    });
    stageHistory.push(...entries);
  }

  for (let i = 0; i < leadCount; i++) {
    const account = pick(rng, accounts);
    const accountContacts = contactsByAccount.get(account.id) ?? [];
    if (accountContacts.length === 0) {
      continue;
    }
    const contact = pick(rng, accountContacts);

    const earliestDate = maxIso(WORLD_TIMELINE_START, maxIso(account.createdAt, contact.createdAt));
    if (earliestDate > WORLD_NOW) {
      continue;
    }

    // Entity-stabiler demandRng-Teilstrom je Lead-Index (siehe
    // MARKETING_DEMAND_SEED_OFFSET oben für die vollständige Begründung).
    const demandRng = createRng(seed + MARKETING_DEMAND_SEED_OFFSET + i);
    const createdAt = sampleDemandDrivenDate(demandRng, marketingDemandModel, earliestDate, WORLD_NOW);
    const remainingDays = daysBetween(createdAt, WORLD_NOW);
    const ownerEmployeeId = resolveLeadOwner(account.id, createdAt);
    const source = pick(rng, LEAD_SOURCES);

    // Statusverteilung aus scenarioProfile.sales.leadStatusThresholds (kumulativ; "verloren"
    // ist der Rest bis 1.0).
    let status: Lead["status"];
    if (remainingDays < 10) {
      status = rng() < 0.5 ? "neu" : "kontaktiert";
    } else {
      const roll = rng();
      if (roll < neu) status = "neu";
      else if (roll < kontaktiert) status = "kontaktiert";
      else if (roll < qualifiziert) status = "qualifiziert";
      else if (roll < konvertiert) status = "konvertiert";
      else status = "verloren";
    }

    const lead: Lead = {
      id: nextLeadId(),
      accountId: account.id,
      contactId: contact.id,
      source,
      status,
      createdAt,
      ownerEmployeeId,
    };

    if (status !== "neu") {
      // maxOffset kann 0 sein (createdAt === WORLD_NOW) — dann bleibt lastContactedAt
      // auf createdAt, statt über WORLD_NOW hinauszulaufen. followUpCapDays ersetzt
      // die frühere feste 20-Tage-Grenze (scenarioProfile.sales.followUpDelayMultiplier).
      const maxOffset = Math.max(0, Math.min(remainingDays, followUpCapDays));
      const offset = maxOffset === 0 ? 0 : randomInt(rng, 1, maxOffset);
      lead.lastContactedAt = addDays(createdAt, offset);
    }

    if (status === "verloren") {
      lead.lostReason = pick(rng, LEAD_LOST_REASONS);
    }

    if (status === "konvertiert") {
      const conversionBudget = Math.max(1, remainingDays - 1);
      const conversionOffset = randomInt(rng, 1, Math.min(conversionBudget, 25));
      const convertedAt = addDays(createdAt, conversionOffset);
      const opportunityId = nextOppId();
      lead.convertedToOpportunityId = opportunityId;
      buildOpportunity(opportunityId, lead, account, convertedAt);
    }

    leads.push(lead);
  }

  return { leads, opportunities, stageHistory };
}

const PIPELINE = generateSalesPipeline(WORLD_SEED + 4, CUSTOMER_ACCOUNTS, CONTACTS, EMPLOYEES, ACCOUNT_OWNERSHIPS);

export const LEADS: Lead[] = PIPELINE.leads;
export const OPPORTUNITIES: Opportunity[] = PIPELINE.opportunities;
export const OPPORTUNITY_STAGE_HISTORY: OpportunityStageHistory[] = PIPELINE.stageHistory;
