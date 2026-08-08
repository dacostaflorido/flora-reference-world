import type { ScenarioWorld } from "../engine/generator";

// Ein sehr kleiner, rein validierender Erwartungsvertrag je Scenario Profile — dient
// ausschließlich Tests, keine Produktlogik, keine Decision Logic. Beschreibt bewusst
// nur grobe Eigenschaften, NICHT konkrete Observation-IDs oder -Texte (§12 des
// Auftrags): "erzeugt das Profil tatsächlich den beabsichtigten Unternehmenszustand?"

export interface ContractResult {
  passed: boolean;
  violations: string[];
}

function check(condition: boolean, message: string, violations: string[]): void {
  if (!condition) violations.push(message);
}

export function checkBaselineContract(baseline: ScenarioWorld): ContractResult {
  const violations: string[] = [];
  check(baseline.observations.length > 0, "baseline sollte mindestens eine Observation besitzen", violations);
  check(
    baseline.observations.filter((o) => o.severity === "hoch").length <= 2,
    "baseline sollte keine von hoch-severity-Funden dominierte Lage zeigen",
    violations,
  );
  return { passed: violations.length === 0, violations };
}

export function checkOperativerFokusContract(scenario: ScenarioWorld, baseline: ScenarioWorld): ContractResult {
  const violations: string[] = [];
  const riskObs = scenario.observations.filter((o) => o.category === "risiko");
  check(
    scenario.groundTruth.priorities.some(
      (p) => (p.tier === "primaer" || p.tier === "sekundaer") && riskObs.some((o) => o.id === p.observationId),
    ),
    "operativer-fokus: mindestens eine primäre oder sekundäre Risiko-Observation erwartet",
    violations,
  );

  const openScenario = scenario.opportunities.filter((o) => o.closedAt === undefined);
  const openBaseline = baseline.opportunities.filter((o) => o.closedAt === undefined);
  const stagnantShare = (opps: typeof openScenario, world: ScenarioWorld) => {
    if (opps.length === 0) return 0;
    const stagnant = opps.filter((o) => {
      const entry = world.stageHistory.find((s) => s.opportunityId === o.id && s.exitedAt === undefined);
      if (!entry) return false;
      const days = Math.round((new Date(world.groundTruth.timestamp).getTime() - new Date(entry.enteredAt).getTime()) / 86400000);
      return days > 90;
    }).length;
    return stagnant / opps.length;
  };
  check(
    stagnantShare(openScenario, scenario) > stagnantShare(openBaseline, baseline),
    "operativer-fokus: operative Belastung (Stagnationsanteil) sollte höher als baseline sein",
    violations,
  );

  const stableObsCount = scenario.observations.filter((o) => o.category === "stabil").length;
  check(stableObsCount > 0, "operativer-fokus: keine vollständige Destabilisierung — mindestens ein stabiler Befund erwartet", violations);

  return { passed: violations.length === 0, violations };
}

export function checkStrategischerTagContract(scenario: ScenarioWorld): ContractResult {
  const violations: string[] = [];
  const hochCount = scenario.observations.filter((o) => o.severity === "hoch").length;
  check(hochCount <= 1, "strategischer-tag: keine hoch-severity-dominierte operative Krise erwartet (höchstens 1 hoch-Fund)", violations);

  const nonCritical = scenario.observations.filter((o) => o.severity !== "hoch").length;
  check(
    nonCritical >= scenario.observations.length / 2,
    "strategischer-tag: Mehrheit der Observations sollte nicht hoch-severity sein",
    violations,
  );

  check(
    scenario.observations.some((o) => o.category === "stabil"),
    "strategischer-tag: mindestens ein stabiler Befund erwartet",
    violations,
  );

  return { passed: violations.length === 0, violations };
}

export function checkWachstumsdruckContract(scenario: ScenarioWorld, baseline: ScenarioWorld): ContractResult {
  const violations: string[] = [];
  check(scenario.leads.length > baseline.leads.length, "wachstumsdruck: höheres Lead-Volumen als baseline erwartet", violations);
  check(
    scenario.opportunities.length > baseline.opportunities.length,
    "wachstumsdruck: höheres Opportunity-Volumen als baseline erwartet",
    violations,
  );
  check(
    scenario.observations.some((o) => o.category === "chance" || o.category === "stabil"),
    "wachstumsdruck: mindestens eine positive Observation (chance/stabil) erwartet",
    violations,
  );
  // "möglich", nicht zwingend — hier nur strukturell geprüft, dass die Belastungsebene
  // (Follow-up-Geschwindigkeit) tatsächlich langsamer ist als baseline, als Beleg für
  // die reale Möglichkeit eines belastungsbezogenen Risikos.
  const medianContactDays = (world: ScenarioWorld) => {
    const days = world.leads.filter((l) => l.lastContactedAt).map((l) => {
      return Math.round((new Date(l.lastContactedAt!).getTime() - new Date(l.createdAt).getTime()) / 86400000);
    });
    if (days.length === 0) return 0;
    const sorted = [...days].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  check(
    medianContactDays(scenario) >= medianContactDays(baseline),
    "wachstumsdruck: Follow-up-Geschwindigkeit sollte nicht schneller als baseline sein (Kapazitätsdruck-Signal)",
    violations,
  );

  return { passed: violations.length === 0, violations };
}

export function checkTeamEngpassContract(scenario: ScenarioWorld, baseline: ScenarioWorld): ContractResult {
  const violations: string[] = [];

  const leadCountByOwner = new Map<string, number>();
  for (const lead of scenario.leads) leadCountByOwner.set(lead.ownerEmployeeId, (leadCountByOwner.get(lead.ownerEmployeeId) ?? 0) + 1);
  const baselineLeadCountByOwner = new Map<string, number>();
  for (const lead of baseline.leads) baselineLeadCountByOwner.set(lead.ownerEmployeeId, (baselineLeadCountByOwner.get(lead.ownerEmployeeId) ?? 0) + 1);
  check(
    (leadCountByOwner.get("emp-ole-jansen") ?? 0) > (baselineLeadCountByOwner.get("emp-ole-jansen") ?? 0),
    "team-engpass: emp-ole-jansen sollte mehr Leads tragen als in baseline",
    violations,
  );

  const oppCountByOwner = new Map<string, number>();
  for (const o of scenario.opportunities) oppCountByOwner.set(o.responsibleEmployeeId, (oppCountByOwner.get(o.responsibleEmployeeId) ?? 0) + 1);
  const baselineOppCountByOwner = new Map<string, number>();
  for (const o of baseline.opportunities) baselineOppCountByOwner.set(o.responsibleEmployeeId, (baselineOppCountByOwner.get(o.responsibleEmployeeId) ?? 0) + 1);
  check(
    (oppCountByOwner.get("emp-lukas-hansen") ?? 0) > (baselineOppCountByOwner.get("emp-lukas-hansen") ?? 0),
    "team-engpass: emp-lukas-hansen sollte mehr Opportunities tragen als in baseline",
    violations,
  );

  // Andere Teams bleiben vergleichsweise stabil: die überwiegende Mehrheit der
  // übrigen Employees darf sich nicht ebenfalls extrem verschieben.
  const others = [...oppCountByOwner.entries()].filter(([id]) => id !== "emp-lukas-hansen" && id !== "emp-ole-jansen");
  const baselineOthers = [...baselineOppCountByOwner.entries()].filter(([id]) => id !== "emp-lukas-hansen" && id !== "emp-ole-jansen");
  const avg = (entries: [string, number][]) => entries.reduce((sum, [, c]) => sum + c, 0) / Math.max(1, entries.length);
  check(
    Math.abs(avg(others) - avg(baselineOthers)) < avg(baselineOthers) * 0.5,
    "team-engpass: übrige Employees sollten vergleichsweise stabil bleiben (keine flächendeckende Verschiebung)",
    violations,
  );

  return { passed: violations.length === 0, violations };
}

export function checkPipelineRisikoContract(scenario: ScenarioWorld, baseline: ScenarioWorld): ContractResult {
  const violations: string[] = [];

  const stagnantShare = (world: ScenarioWorld) => {
    const open = world.opportunities.filter((o) => o.closedAt === undefined);
    if (open.length === 0) return 0;
    const stagnant = open.filter((o) => {
      const entry = world.stageHistory.find((s) => s.opportunityId === o.id && s.exitedAt === undefined);
      if (!entry) return false;
      const days = Math.round((new Date(world.groundTruth.timestamp).getTime() - new Date(entry.enteredAt).getTime()) / 86400000);
      return days > 90;
    }).length;
    return stagnant / open.length;
  };
  check(stagnantShare(scenario) > stagnantShare(baseline), "pipeline-risiko: Stagnationsanteil sollte höher als baseline sein", violations);

  // Kein erneuter Generatorstillstand: offene Opportunities müssen weiterhin
  // mehrheitlich eine reale Fortschrittschance zeigen (mindestens ein Stage-Wechsel
  // simuliert, nicht nur der initiale Eintrag).
  const open = scenario.opportunities.filter((o) => o.closedAt === undefined);
  const withMovement = open.filter((o) => scenario.stageHistory.filter((s) => s.opportunityId === o.id).length > 1);
  check(
    open.length === 0 || withMovement.length / open.length > 0.3,
    "pipeline-risiko: ein relevanter Anteil offener Opportunities muss weiterhin echte Stage-Bewegung zeigen (kein Generatorstillstand)",
    violations,
  );

  return { passed: violations.length === 0, violations };
}
