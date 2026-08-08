import { createRng, WORLD_SEED, type Rng } from "../engine/seed";
import { addDays, pick, randomInt } from "../engine/random";
import { WORLD_NOW } from "../timeline/world-clock";
import { BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { EMPLOYEES, type Employee } from "./employees";
import { CUSTOMER_ACCOUNTS, type CustomerAccount } from "./customer-accounts";

export interface AccountOwnership {
  id: string;
  accountId: string;
  employeeId: string;
  ownershipRole: "owner" | "sdr" | "ae";
  validFrom: string;
  validTo?: string;
  reason?: string;
}

const REASSIGNMENT_REASONS = [
  "Neuzuweisung nach Territory-Wechsel",
  "Reassignment nach Kapazitätsengpass",
  "Wechsel im Rahmen einer Team-Umstrukturierung",
] as const;

const STRATEGIC_SIZE_BANDS = new Set(["250–999 Mitarbeiter", "1.000+ Mitarbeiter"]);

// Zwei Accounts werden bewusst nicht durch die generische Schleife befüllt, sondern
// unten manuell modelliert — sie demonstrieren gezielt einen Ownership-Wechsel infolge
// eines Mitarbeiteraustritts (siehe employees.ts: emp-merle-winkler, emp-tobias-reuter).
const HAND_MODELED_ACCOUNT_IDS = new Set(["account-0001", "account-0002"]);

function candidatesHiredBy(pool: readonly Employee[], asOfDate: string): Employee[] {
  return pool.filter((employee) => employee.hiredAt <= asOfDate);
}

function isActive(employee: Employee): boolean {
  return employee.terminatedAt === undefined;
}

// Reference-World-Validation (Finding 1): eine rein nach Tenure eingeschränkte
// Kandidatenauswahl (candidatesHiredBy + uniform pick) lässt früh eingestellte
// Mitarbeiter für praktisch den gesamten historischen Account-Bestand infrage
// kommen, spät eingestellte dagegen nur für einen schrumpfenden Rest — das ist ein
// Generierungsartefakt, kein realistisches Auslastungsmuster. Diese gewichtete
// Auswahl bevorzugt aktuell geringer ausgelastete Kandidaten, ohne Gleichverteilung
// zu erzwingen (weiterhin stochastisch, "leichte natürliche Unterschiede"
// ausdrücklich möglich).
//
// overloadWeights (Scenario Profile "team-engpass"): ein optionales, zusätzliches
// Gewicht je Employee, das die Fairness-Gewichtung gezielt und dokumentiert
// überschreibt — Standard 1 (keine Wirkung, entspricht der bisherigen Logik). Das
// ist der einzige Unterschied zum früher behobenen Tenure-Bias: dort entstand die
// Konzentration versehentlich aus Kandidatenpool-Größe, hier entsteht sie bewusst
// aus einem benannten Scenario-Parameter.
function pickWeightedByInverseLoad(
  rng: Rng,
  candidates: readonly Employee[],
  load: Map<string, number>,
  overloadWeights: ReadonlyMap<string, number>,
): Employee {
  const weights = candidates.map((e) => (1 / (1 + (load.get(e.id) ?? 0))) * (overloadWeights.get(e.id) ?? 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) {
      return candidates[i]!;
    }
  }
  return candidates[candidates.length - 1]!;
}

// Reine Overload-Gewichtung ohne Lastausgleich (owner/ae hatten nie eine Fairness-
// Balancierung wie SDRs) — Standardgewicht 1 lässt uniform pick() unverändert.
function pickWeightedByOverload(rng: Rng, candidates: readonly Employee[], overloadWeights: ReadonlyMap<string, number>): Employee {
  const weights = candidates.map((e) => overloadWeights.get(e.id) ?? 1);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) {
      return candidates[i]!;
    }
  }
  return candidates[candidates.length - 1]!;
}

export function generateAccountOwnerships(
  seed: number,
  employees: readonly Employee[],
  accounts: readonly CustomerAccount[],
  scenarioProfile: ScenarioProfile = BASELINE_PROFILE,
): AccountOwnership[] {
  const rng = createRng(seed);
  const overloadWeights = new Map<string, number>(
    scenarioProfile.sales.overloadedEmployeeIds.map((id) => [id, scenarioProfile.sales.overloadWeightMultiplier]),
  );
  const ownerships: AccountOwnership[] = [];
  let counter = 1;
  const nextId = () => `ownership-${String(counter++).padStart(4, "0")}`;

  const activeSdrs = employees.filter((e) => e.roleId === "role-sales-development-rep" && isActive(e));
  const activeAes = employees.filter((e) => e.roleId === "role-account-executive" && isActive(e));
  const activeSalesManagers = employees.filter((e) => e.roleId === "role-sales-manager" && isActive(e));

  // Laufende Auslastung je SDR über den gesamten Generierungsdurchlauf — Grundlage
  // für die lastgewichtete Zuweisung/Rebalancierung unten (Finding 1).
  const sdrLoad = new Map<string, number>();
  const bumpSdrLoad = (employeeId: string) => sdrLoad.set(employeeId, (sdrLoad.get(employeeId) ?? 0) + 1);

  for (const account of accounts) {
    if (HAND_MODELED_ACCOUNT_IDS.has(account.id)) {
      continue;
    }

    // SDR — Zuständigkeit über die Kontolaufzeit mit periodischen Territory-Reviews
    // (alle ~240–420 Tage, jeweils ~30% Wechselwahrscheinlichkeit). Bei jedem Review
    // wird aus allen dann aktiven SDRs lastgewichtet neu gezogen (s.
    // pickWeightedByInverseLoad) — dadurch können auch später eingestellte SDRs im
    // Zeitverlauf Teile des bestehenden Account-Bestands übernehmen, statt dass die
    // Erstzuweisung für die gesamte Kontolebensdauer bestehen bleibt.
    {
      let currentSdr = pickWeightedByInverseLoad(rng, candidatesHiredBy(activeSdrs, account.createdAt), sdrLoad, overloadWeights);
      bumpSdrLoad(currentSdr.id);
      let intervalStart = account.createdAt;
      let checkpoint = addDays(account.createdAt, randomInt(rng, 240, 420));

      while (checkpoint < WORLD_NOW) {
        if (rng() < 0.3) {
          const candidates = candidatesHiredBy(activeSdrs, checkpoint).filter((e) => e.id !== currentSdr.id);
          if (candidates.length > 0) {
            const nextSdr = pickWeightedByInverseLoad(rng, candidates, sdrLoad, overloadWeights);
            ownerships.push({
              id: nextId(),
              accountId: account.id,
              employeeId: currentSdr.id,
              ownershipRole: "sdr",
              validFrom: intervalStart,
              validTo: checkpoint,
              reason: pick(rng, REASSIGNMENT_REASONS),
            });
            currentSdr = nextSdr;
            bumpSdrLoad(currentSdr.id);
            intervalStart = addDays(checkpoint, 1);
          }
        }
        checkpoint = addDays(checkpoint, randomInt(rng, 240, 420));
      }

      ownerships.push({
        id: nextId(),
        accountId: account.id,
        employeeId: currentSdr.id,
        ownershipRole: "sdr",
        validFrom: intervalStart,
      });
    }

    // Owner — meist ein AE, bei strategischen Accounts teils ein Sales Manager,
    // ~12% mit Wechsel.
    const isStrategic = STRATEGIC_SIZE_BANDS.has(account.sizeBand) && rng() < 0.4;
    const ownerPoolBase = isStrategic
      ? candidatesHiredBy(activeSalesManagers, account.createdAt)
      : candidatesHiredBy(activeAes, account.createdAt);
    const ownerPool = ownerPoolBase.length > 0 ? ownerPoolBase : candidatesHiredBy(activeAes, account.createdAt);
    const firstOwner = pickWeightedByOverload(rng, ownerPool, overloadWeights);
    if (rng() < 0.12) {
      const switchDate = addDays(account.createdAt, randomInt(rng, 150, 800));
      const secondPool = candidatesHiredBy(activeAes, switchDate).filter((e) => e.id !== firstOwner.id);
      if (secondPool.length > 0) {
        const secondOwner = pick(rng, secondPool);
        ownerships.push({
          id: nextId(),
          accountId: account.id,
          employeeId: firstOwner.id,
          ownershipRole: "owner",
          validFrom: account.createdAt,
          validTo: switchDate,
          reason: pick(rng, REASSIGNMENT_REASONS),
        });
        ownerships.push({
          id: nextId(),
          accountId: account.id,
          employeeId: secondOwner.id,
          ownershipRole: "owner",
          validFrom: addDays(switchDate, 1),
        });
      } else {
        ownerships.push({
          id: nextId(),
          accountId: account.id,
          employeeId: firstOwner.id,
          ownershipRole: "owner",
          validFrom: account.createdAt,
        });
      }
    } else {
      ownerships.push({
        id: nextId(),
        accountId: account.id,
        employeeId: firstOwner.id,
        ownershipRole: "owner",
        validFrom: account.createdAt,
      });
    }

    // AE — optional, ~65% der Accounts (kann leer bleiben, s. Invariante).
    if (rng() < 0.65) {
      const aeStart = addDays(account.createdAt, randomInt(rng, 10, 150));
      const aePool = candidatesHiredBy(activeAes, aeStart);
      if (aePool.length > 0) {
        ownerships.push({
          id: nextId(),
          accountId: account.id,
          employeeId: pickWeightedByOverload(rng, aePool, overloadWeights).id,
          ownershipRole: "ae",
          validFrom: aeStart,
        });
      }
    }
  }

  // Handmodellierte Ownership-Historie für die zwei ausgesparten Accounts — beide
  // demonstrieren einen Wechsel infolge eines Mitarbeiteraustritts.
  ownerships.push(
    {
      id: nextId(),
      accountId: "account-0001",
      employeeId: "emp-merle-winkler",
      ownershipRole: "sdr",
      validFrom: "2021-03-01",
      validTo: "2022-08-15",
      reason: "Mitarbeiteraustritt",
    },
    {
      id: nextId(),
      accountId: "account-0001",
      employeeId: "emp-ole-jansen",
      ownershipRole: "sdr",
      validFrom: "2022-08-16",
    },
    {
      id: nextId(),
      accountId: "account-0001",
      employeeId: "emp-lukas-hansen",
      ownershipRole: "owner",
      validFrom: "2021-03-01",
    },
    {
      id: nextId(),
      accountId: "account-0002",
      employeeId: "emp-tobias-reuter",
      ownershipRole: "ae",
      validFrom: "2019-05-01",
      validTo: "2023-11-30",
      reason: "Mitarbeiteraustritt",
    },
    {
      id: nextId(),
      accountId: "account-0002",
      employeeId: "emp-robert-kuhn",
      ownershipRole: "ae",
      validFrom: "2023-12-01",
    },
    {
      id: nextId(),
      accountId: "account-0002",
      employeeId: "emp-svenja-brandt",
      ownershipRole: "owner",
      validFrom: "2019-05-01",
    },
    {
      id: nextId(),
      accountId: "account-0002",
      employeeId: "emp-sophie-renner",
      ownershipRole: "sdr",
      validFrom: "2019-05-01",
    },
  );

  return ownerships;
}

export const ACCOUNT_OWNERSHIPS: AccountOwnership[] = generateAccountOwnerships(
  WORLD_SEED + 3,
  EMPLOYEES,
  CUSTOMER_ACCOUNTS,
);
