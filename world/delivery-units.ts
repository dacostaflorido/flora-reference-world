import { createRng, type Rng } from "../engine/seed";
import { addDays } from "../engine/random";
import { WORLD_NOW } from "../timeline/world-clock";
import type { Employee } from "./employees";
import type { Opportunity } from "../events/opportunities";
import type { OperationsScenarioConfig } from "../engine/scenario-profiles";

// Operations = Customer Onboarding / Implementation / Delivery nach gewonnenem Deal
// (freigegebene Domain Decision, Reference World v2 / Operations Foundation). Jede
// DeliveryUnit ist zwingend auf eine real existierende, tatsächlich gewonnene
// Opportunity zurückführbar — opportunityId ist Pflichtfeld, niemals eine frei
// erfundene Zuordnung. accountId ist bewusst 1:1 von opportunity.accountId
// übernommen, nicht neu nachgeschlagen (dieselbe Redundanz-Begründung wie bei
// Opportunity.accountId selbst: bewusste, invariantengeprüfte Redundanz für
// Queries). startDate ist exakt opportunity.closedAt (Backward Explainability,
// Prinzip 18) — nicht aus der Stage-History neu hergeleitet, da closedAt bereits die
// invariantengeprüfte (checkOpportunityClosedAtConsistency), alleinige
// Won-Datumsquelle ist.
export interface DeliveryUnit {
  id: string;
  opportunityId: string;
  accountId: string;
  assignedEmployeeId: string;
  startDate: string;
  plannedEndDate: string;
  actualEndDate?: string;
  status: "laufend" | "abgeschlossen";
}

// Zentral benannter Demo-/Scenario-Parameter (freigegebene Domain Decision) — kein
// Branchenstandard, keine Kalibrierung. Einzige Stelle, an der dieser Wert vorkommt;
// austauschbar ohne strukturelle Modelländerung.
export const DELIVERY_ONBOARDING_DURATION_DAYS = 30;

function isActiveOperationsEmployee(employee: Employee): boolean {
  return employee.departmentId === "dept-operations" && employee.terminatedAt === undefined;
}

// Dieselbe Fair-Share-mit-realistischer-Schieflage-Methode wie
// pickWeightedByInverseLoad in world/account-ownership.ts (dort ausführlich
// begründet: reine Gleichverteilung wäre ein unrealistisches Generierungsartefakt,
// vollständig zufällige Zuteilung würde die spätere Fair-Share-Observation trivial
// machen). Lokal dupliziert statt importiert — dieselbe, bereits etablierte
// Konvention kleiner, dateilokaler Duplikate statt einer neuen geteilten
// Utility-Datei (siehe z. B. isEmployeeActiveAt in mehreren events/-/world/-Dateien).
// overloadWeights (Phase 12, "concentrated"-Modus): exakt dieselbe Mechanik wie
// overloadWeights in pickWeightedByInverseLoad (account-ownership.ts) — Standard 1
// (keine Wirkung), entspricht bei "balanced" unverändert der bisherigen Logik.
function pickByInverseLoad(
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

// Vereinfachende, redaktionell bewusste v1-Annahme (nicht Teil der freigegebenen
// Domain Decisions, hier explizit benannt statt stillschweigend eingeführt): jede
// DeliveryUnit schließt exakt an plannedEndDate ab, keine zusätzliche
// Verzögerungs-/Beschleunigungs-Zufallsvariable. Eine Einführung von Terminvarianz
// wäre eine neue, hier nicht beauftragte fachliche Erfindung (zusätzliche
// Zufallsverteilung ohne Grundlage) — bewusst unterlassen, nicht vergessen.
const DEFAULT_OPERATIONS_SCENARIO_CONFIG: OperationsScenarioConfig = {
  assignmentStrategy: "balanced",
  concentratedEmployeeIds: [],
  concentrationWeightMultiplier: 1,
};

export function generateDeliveryUnits(
  seed: number,
  opportunities: readonly Opportunity[],
  employees: readonly Employee[],
  config: OperationsScenarioConfig = DEFAULT_OPERATIONS_SCENARIO_CONFIG,
): DeliveryUnit[] {
  const rng = createRng(seed);
  const operationsEmployees = employees.filter(isActiveOperationsEmployee);
  const load = new Map<string, number>();
  const units: DeliveryUnit[] = [];

  if (operationsEmployees.length === 0) {
    return units;
  }

  // "balanced" (Standard, alle 6 bestehenden Scenario Profiles): leere Map, jedes
  // Gewicht defaultet über "?? 1" auf 1 — identisch zum bisherigen Verhalten vor
  // Phase 12. "concentrated": dieselbe Mechanik wie overloadedEmployeeIds/
  // overloadWeightMultiplier bei Sales (team-engpass), hier auf die konfigurierten
  // Operations-Mitarbeiter angewendet.
  const overloadWeights = new Map<string, number>(
    config.assignmentStrategy === "concentrated"
      ? config.concentratedEmployeeIds.map((id) => [id, config.concentrationWeightMultiplier])
      : [],
  );

  let counter = 1;
  const nextId = () => `delivery-${String(counter++).padStart(5, "0")}`;

  const wonOpportunities = opportunities.filter(
    (o): o is Opportunity & { closedAt: string } => o.currentStage === "gewonnen" && o.closedAt !== undefined,
  );

  for (const opportunity of wonOpportunities) {
    const assignee = pickByInverseLoad(rng, operationsEmployees, load, overloadWeights);
    load.set(assignee.id, (load.get(assignee.id) ?? 0) + 1);

    const startDate = opportunity.closedAt;
    const plannedEndDate = addDays(startDate, DELIVERY_ONBOARDING_DURATION_DAYS);
    const isCompleted = plannedEndDate <= WORLD_NOW;

    units.push({
      id: nextId(),
      opportunityId: opportunity.id,
      accountId: opportunity.accountId,
      assignedEmployeeId: assignee.id,
      startDate,
      plannedEndDate,
      actualEndDate: isCompleted ? plannedEndDate : undefined,
      status: isCompleted ? "abgeschlossen" : "laufend",
    });
  }

  return units;
}

// Zeitpunktbezogene Aktivitäts-Prüfung (Operations Foundation, Schritt 2, Phase 6):
// dieselbe exklusive Enddatums-Konvention wie bei OpportunityStageHistory in
// snapshot/snapshot.ts ("e.exitedAt === undefined || asOf < e.exitedAt"), nicht die
// inklusive Gültigkeitsintervall-Konvention von AccountOwnership
// ("asOf <= validTo"). Begründung für die Konsistenzwahl: eine DeliveryUnit ist wie
// eine Stage ein Zustand, der an actualEndDate endet und in einen neuen Zustand
// ("abgeschlossen") übergeht — am Tag von actualEndDate selbst ist sie bereits
// abgeschlossen, nicht mehr aktiv, exakt wie eine Opportunity am Tag ihres exitedAt
// bereits die nächste Stage erreicht hat, nicht mehr die vorherige.
export function isDeliveryUnitActiveAt(unit: DeliveryUnit, asOf: string): boolean {
  return unit.startDate <= asOf && (unit.actualEndDate === undefined || asOf < unit.actualEndDate);
}

export function activeDeliveryUnitsAt(units: readonly DeliveryUnit[], asOf: string): DeliveryUnit[] {
  return units.filter((u) => isDeliveryUnitActiveAt(u, asOf));
}
