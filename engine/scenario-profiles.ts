import { DEFAULT_MARKETING_DEMAND_MODEL, type MarketingDemandModel } from "./marketing-demand";

// Ein Scenario Profile ist KEINE zweite Welt und KEIN separater Datensatz. Es
// verschiebt ausschließlich Wahrscheinlichkeiten, Verteilungen, Zeitfenster und
// Aktivitätsmuster im bestehenden Generator — dieselbe Firma, dieselben Mitarbeiter,
// dieselbe Kundenstruktur, andere Parameter. Danach wird die vollständige Welt ganz
// normal generiert; Observations und Ground Truth entstehen ausschließlich aus dem
// tatsächlich erzeugten Zustand, nie aus dem Profilnamen selbst.
//
// `baseline` trägt exakt dieselben Zahlenwerte, die vorher als Literale im Code
// standen (LEAD_COUNT=1100, die 0.15/0.35/0.5/0.75-Statusgrenzen, 0.35/0.65-
// Opportunity-Outcome-Grenzen, 0.55/0.7/0.65/0.25-Stage-Bewegungswahrscheinlichkeiten,
// Cap 20 Tage für lastContactedAt) — dadurch bleibt WORLD_SEED + baseline
// byte-identisch zur bisherigen, validierten Welt.
//
// Struktur (Architektur-Review-Folgeauftrag "Scenario Profile Architektur"): die
// Sales-spezifischen Stellhebel liegen gebündelt unter `sales`, getrennt von der
// domänenneutralen Profil-Identität (id/label/description). Das ist ausdrücklich
// KEINE Multi-Domain-Abstraktion — es gibt heute nur `sales`, keine generische
// Registry, kein Platzhalter für andere Domänen. Der einzige Zweck dieser Trennung:
// falls perspektivisch eine zweite Unternehmensart (nicht Sales-spezifisch) einen
// eigenen Konfigurationsblock braucht, kann er als weiteres, eigenständig benanntes
// Feld ergänzt werden (z. B. `marketing: MarketingScenarioConfig`), ohne `sales`
// anzufassen oder ScenarioProfile grundlegend umzubauen. Bis dahin bleibt `sales` die
// einzige existierende Domänen-Konfiguration — keine Spekulation über eine Form, die
// noch niemand gebraucht hat.
export interface ScenarioProfile {
  id: "baseline" | "operativer-fokus" | "strategischer-tag" | "wachstumsdruck" | "team-engpass" | "pipeline-risiko";
  label: string;
  description: string;

  sales: SalesScenarioConfig;

  // Operations Foundation (Reference World v2, Schritt 2, Phase 12): erstes
  // tatsächlich genutztes Beispiel des oben beschriebenen Erweiterungspunkts — ein
  // weiteres, eigenständig benanntes Feld, ohne `sales` anzufassen oder
  // ScenarioProfile grundlegend umzubauen.
  operations: OperationsScenarioConfig;

  // Marketing Demand Model (Marketing Demand Model — World Generation First):
  // zweites Beispiel desselben Erweiterungspunkts, exakt wie `operations` oben
  // ohne `sales`/`operations` anzufassen ergänzt. Beschreibt ausschließlich, wie
  // Marketing-Nachfrage (Lead-Entstehung) über die Zeit verteilt ist — World-
  // Wahrheit, keine Bewertung (siehe marketing-demand.ts).
  marketing: MarketingScenarioConfig;
}

// Analog zu SalesScenarioConfig.overloadedEmployeeIds/overloadWeightMultiplier
// (team-engpass) — bewusst dieselbe, bereits validierte Mechanik wiederverwendet
// statt einer neuen erfunden: ein zusätzliches Gewicht bei der ohnehin bereits
// lastgewichteten Zuteilung (world/delivery-units.ts, pickByInverseLoad), keine neue
// Architektur, keine Zufallsquote, kein verstecktes Magic-Number. assignmentStrategy
// ist die benannte, lesbare Außenschicht darüber ("balanced" = wirkungslos, leere
// concentratedEmployeeIds/Multiplier 1 — identisch zum bisherigen Verhalten;
// "concentrated" = dieselbe Gewichtungs-Mechanik, jetzt mit Wirkung).
// Marketing Demand Model — World Generation First: wrapt ausschließlich das
// bereits in marketing-demand.ts definierte MarketingDemandModel als
// eigenständig benanntes Scenario-Config-Feld, exakt demselben
// Erweiterungsmuster wie OperationsScenarioConfig oben folgend. Marketing-
// Nachfrage ist bewusst NICHT an ein Sales-Scenario-Narrativ gekoppelt (dieselbe
// Grenzziehung wie im Marketing Evidence Audit: "Marketing darf nicht Sales mit
// anderem Namen sein") — alle sechs Profile teilen sich dasselbe reale,
// saisonal begründete Demand Model (siehe DEFAULT_MARKETING_DEMAND_MODEL).
export interface MarketingScenarioConfig {
  demandModel: MarketingDemandModel;
}

export interface OperationsScenarioConfig {
  assignmentStrategy: "balanced" | "concentrated";
  concentratedEmployeeIds: readonly string[];
  concentrationWeightMultiplier: number;
}

// Alle Stellhebel dieses Blocks sind Sales-Pipeline-Vokabular (Leads, Opportunities,
// Stage-Bewegung, Account-Ownership) — bewusst benannt statt generisch, siehe oben.
export interface SalesScenarioConfig {
  // Lead-Volumen — Multiplikator auf die bisherige Basiszahl (1100).
  leadCountMultiplier: number;

  // Lead-Status-Verteilung: kumulative Grenzen für den Status-Wurf. "verloren" ist
  // der verbleibende Rest bis 1.0. Muss streng aufsteigend und < 1 sein.
  leadStatusThresholds: {
    neu: number;
    kontaktiert: number;
    qualifiziert: number;
    konvertiert: number;
  };

  // Follow-up-Geschwindigkeit — Multiplikator auf das bisherige 20-Tage-Zeitfenster
  // für lastContactedAt. >1 = langsamer.
  followUpDelayMultiplier: number;

  // Aktivitätsdichte in Calls/Emails/Meetings/CrmActivities — Multiplikator, der mit
  // dem bereits bestehenden, mitarbeiterindividuellen Stilprofil (activityMultiplier)
  // multipliziert wird.
  activityDensityMultiplier: number;

  // Opportunity-Outcome-Verteilung: kumulative Grenzen für den Outcome-Wurf.
  // "verloren" ist der verbleibende Rest.
  opportunityOutcomeThresholds: {
    open: number;
    gewonnen: number;
  };

  // Stage-Dauer (qualifizierung/angebot/verhandlung) — Multiplikator auf die
  // bisherigen Tagesspannen.
  stageDurationMultiplier: number;

  // Stage-Bewegung bei offenen Opportunities: dieselben drei Fälle wie im
  // bestehenden Generator (nur vorwärts möglich / vorwärts+rückwärts möglich / nur
  // rückwärts möglich), jetzt profilabhängig statt fest kodiert. Muss weiterhin eine
  // reale Vorwärtschance in den ersten beiden Fällen besitzen (kein erneuter
  // Generatorstillstand).
  stageMovement: {
    advanceOnly: number;
    bothAdvance: number;
    bothRegress: number;
    regressOnly: number;
  };

  // Gezielte, dokumentierte Lastkonzentration bei bestimmten Mitarbeitenden
  // (team-engpass). Leer = keine Konzentration (Standard). Wird ausschließlich in
  // world/account-ownership.ts als zusätzliches Gewicht bei der Territory-
  // Neuzuweisung verwendet — keine neue Architektur, nur ein Parameter für die
  // bereits bestehende lastgewichtete Auswahl.
  overloadedEmployeeIds: readonly string[];
  overloadWeightMultiplier: number;
}

export const BASELINE_PROFILE: ScenarioProfile = {
  id: "baseline",
  label: "Baseline",
  description:
    "Die validierte, bestehende Welt. Keine künstliche Storyline, natürliche Streuung, keine absichtlich dominante Krise.",
  sales: {
    leadCountMultiplier: 1,
    leadStatusThresholds: { neu: 0.15, kontaktiert: 0.35, qualifiziert: 0.5, konvertiert: 0.75 },
    followUpDelayMultiplier: 1,
    activityDensityMultiplier: 1,
    opportunityOutcomeThresholds: { open: 0.35, gewonnen: 0.65 },
    stageDurationMultiplier: 1,
    stageMovement: { advanceOnly: 0.65, bothAdvance: 0.55, bothRegress: 0.15, regressOnly: 0.25 },
    overloadedEmployeeIds: [],
    overloadWeightMultiplier: 1,
  },
  operations: { assignmentStrategy: "balanced", concentratedEmployeeIds: [], concentrationWeightMultiplier: 1 },
  marketing: { demandModel: DEFAULT_MARKETING_DEMAND_MODEL },
};

export const OPERATIVER_FOKUS_PROFILE: ScenarioProfile = {
  id: "operativer-fokus",
  label: "Operativer Fokus",
  description:
    "Mehrere operative Probleme benötigen kurzfristig Aufmerksamkeit: langsamere Lead-Bearbeitung, mehr verspätete " +
    "Follow-ups, mehr Opportunities ohne zeitnahen nächsten Schritt. Kein Flächenbrand — das Unternehmen funktioniert " +
    "grundsätzlich, braucht heute aber operative Führung.",
  sales: {
    leadCountMultiplier: 1,
    // Näher an baseline als eine erste Version (die die Konversionsrate fast halbierte
    // — das ist eher ein Qualitätsproblem als operative Reibung). Der Engpass soll sich
    // primär über Follow-up-Tempo und Stage-Bewegung zeigen, nicht über den Funnel.
    leadStatusThresholds: { neu: 0.16, kontaktiert: 0.38, qualifiziert: 0.52, konvertiert: 0.72 },
    followUpDelayMultiplier: 1.6,
    activityDensityMultiplier: 0.85,
    opportunityOutcomeThresholds: { open: 0.42, gewonnen: 0.6 },
    stageDurationMultiplier: 1,
    // Echte Stagnation braucht eine hohe "stay"-Wahrscheinlichkeit, nicht nur eine
    // niedrige Advance-Wahrscheinlichkeit: ein Regress-Ausgang setzt den Stall-Zähler
    // zurück (entryStart springt auf "jetzt"), verkürzt also "Tage in aktueller Stage"
    // eher, statt sie zu verlängern. Eine erste Version mit hohem bothRegress/regressOnly
    // erzeugte dadurch WENIGER Stagnation als baseline, das Gegenteil der Absicht.
    // Deshalb hier: niedrige Advance- UND niedrige Regress-Wahrscheinlichkeit, damit
    // "stay" dominiert.
    stageMovement: { advanceOnly: 0.35, bothAdvance: 0.25, bothRegress: 0.1, regressOnly: 0.15 },
    overloadedEmployeeIds: [],
    overloadWeightMultiplier: 1,
  },
  operations: { assignmentStrategy: "balanced", concentratedEmployeeIds: [], concentrationWeightMultiplier: 1 },
  marketing: { demandModel: DEFAULT_MARKETING_DEMAND_MODEL },
};

export const STRATEGISCHER_TAG_PROFILE: ScenarioProfile = {
  id: "strategischer-tag",
  label: "Strategischer Tag",
  description:
    "Keine akute operative Krise: gesunde Lead-Reaktionszeiten, geringe Stagnation, stabile Win Rate. Nicht künstlich " +
    "perfekt — auch hier existieren kleinere Beobachtungen, nur erzwingt nichts unmittelbare Feuerwehrarbeit.",
  sales: {
    leadCountMultiplier: 1,
    leadStatusThresholds: { neu: 0.12, kontaktiert: 0.3, qualifiziert: 0.42, konvertiert: 0.8 },
    followUpDelayMultiplier: 0.7,
    activityDensityMultiplier: 1.1,
    // Ein gesunder Tag schließt Deals entschieden (mehr davon gewonnen), statt sie im
    // offenen Bestand aufzuhäufen — das hält die stehende Pipeline schlank.
    opportunityOutcomeThresholds: { open: 0.22, gewonnen: 0.78 },
    stageDurationMultiplier: 1,
    // regressOnly deutlich höher als baseline: "verhandlung" darf auch an einem guten
    // Tag kein Endzustand ohne Bewegung werden — sonst sammeln sich dort gerade wegen
    // der hohen Vorwärtswahrscheinlichkeit besonders viele Opportunities an (geprüft:
    // eine frühere Version mit regressOnly=0.15 erzeugte dadurch MEHR Stagnation als
    // baseline, das Gegenteil des beabsichtigten Zustands).
    stageMovement: { advanceOnly: 0.68, bothAdvance: 0.55, bothRegress: 0.12, regressOnly: 0.4 },
    overloadedEmployeeIds: [],
    overloadWeightMultiplier: 1,
  },
  operations: { assignmentStrategy: "balanced", concentratedEmployeeIds: [], concentrationWeightMultiplier: 1 },
  marketing: { demandModel: DEFAULT_MARKETING_DEMAND_MODEL },
};

export const WACHSTUMSDRUCK_PROFILE: ScenarioProfile = {
  id: "wachstumsdruck",
  label: "Wachstumsdruck",
  description:
    "Das Unternehmen wächst, das System beginnt unter dem zusätzlichen Volumen zu spannen: mehr Leads, mehr " +
    "qualifizierte Nachfrage (Chance), aber punktuell langsamere Reaktionszeiten, weil die Bearbeitungskapazität " +
    "langsamer wächst als das Volumen (Risiko).",
  sales: {
    leadCountMultiplier: 1.45,
    leadStatusThresholds: { neu: 0.13, kontaktiert: 0.3, qualifiziert: 0.4, konvertiert: 0.78 },
    followUpDelayMultiplier: 1.25,
    activityDensityMultiplier: 1.2,
    opportunityOutcomeThresholds: { open: 0.4, gewonnen: 0.68 },
    stageDurationMultiplier: 1,
    stageMovement: { advanceOnly: 0.6, bothAdvance: 0.5, bothRegress: 0.17, regressOnly: 0.27 },
    overloadedEmployeeIds: [],
    overloadWeightMultiplier: 1,
  },
  operations: { assignmentStrategy: "balanced", concentratedEmployeeIds: [], concentrationWeightMultiplier: 1 },
  marketing: { demandModel: DEFAULT_MARKETING_DEMAND_MODEL },
};

// Bewusst konkrete, real existierende Employee-IDs — eine dokumentierte, gezielte
// Konzentration (Scenario-Muster), kein mathematischer Zufall wie beim früher
// behobenen SDR-Tenure-Bias. emp-ole-jansen und emp-lukas-hansen sind ein SDR und
// ein AE aus unterschiedlichen Teams, damit die Konzentration nicht mit einer
// bestehenden Team-Zugehörigkeit verwechselt werden kann.
export const TEAM_ENGPASS_PROFILE: ScenarioProfile = {
  id: "team-engpass",
  label: "Team-Engpass",
  description:
    "Das zentrale Problem liegt nicht im gesamten Vertrieb, sondern konzentriert sich glaubwürdig auf zwei Personen " +
    "mit unterschiedlichen Rollen: emp-ole-jansen (SDR) trägt spürbar mehr zugewiesene Leads, emp-lukas-hansen (AE) " +
    "spürbar mehr Opportunities — jede Rolle zeigt die Überlastung dort, wo sie tatsächlich anfällt (Ownership-" +
    "Resolution: Opportunity.responsibleEmployeeId stammt ausschließlich aus \"ae\"/\"owner\"-Rollen, nie von SDRs). " +
    "Andere Teams bleiben vergleichsweise stabil.",
  sales: {
    leadCountMultiplier: 1,
    leadStatusThresholds: BASELINE_PROFILE.sales.leadStatusThresholds,
    followUpDelayMultiplier: 1,
    activityDensityMultiplier: 1,
    opportunityOutcomeThresholds: BASELINE_PROFILE.sales.opportunityOutcomeThresholds,
    stageDurationMultiplier: 1,
    stageMovement: BASELINE_PROFILE.sales.stageMovement,
    overloadedEmployeeIds: ["emp-ole-jansen", "emp-lukas-hansen"],
    overloadWeightMultiplier: 4,
  },
  operations: { assignmentStrategy: "balanced", concentratedEmployeeIds: [], concentrationWeightMultiplier: 1 },
  marketing: { demandModel: DEFAULT_MARKETING_DEMAND_MODEL },
};

export const PIPELINE_RISIKO_PROFILE: ScenarioProfile = {
  id: "pipeline-risiko",
  label: "Pipeline-Risiko",
  description:
    "Ausreichend Pipeline, aber relevante Opportunities bewegen sich zu langsam: längere Stage-Dauer, mehr echte " +
    "Stalls, mehr offene Angebote/Verhandlungen. Offene Opportunities behalten weiterhin eine reale Fortschritts- " +
    "chance — kein erneuter Generatorstillstand.",
  sales: {
    leadCountMultiplier: 1,
    leadStatusThresholds: BASELINE_PROFILE.sales.leadStatusThresholds,
    followUpDelayMultiplier: 1,
    activityDensityMultiplier: 1,
    opportunityOutcomeThresholds: { open: 0.5, gewonnen: 0.75 },
    stageDurationMultiplier: 1.6,
    // Niedrige Advance- UND niedrige Regress-Wahrscheinlichkeit, damit "stay"
    // dominiert (echte Stalls) — ein Regress-Ausgang setzt den Stall-Zähler zurück und
    // wirkt damit gegen "mehr echte Stalls" (siehe operativer-fokus). advanceOnly bleibt
    // deutlich über 0, damit offene Opportunities weiterhin eine reale
    // Fortschrittschance behalten (kein erneuter Generatorstillstand).
    stageMovement: { advanceOnly: 0.35, bothAdvance: 0.25, bothRegress: 0.08, regressOnly: 0.12 },
    overloadedEmployeeIds: [],
    overloadWeightMultiplier: 1,
  },
  operations: { assignmentStrategy: "balanced", concentratedEmployeeIds: [], concentrationWeightMultiplier: 1 },
  marketing: { demandModel: DEFAULT_MARKETING_DEMAND_MODEL },
};

export const SCENARIO_PROFILES: readonly ScenarioProfile[] = [
  BASELINE_PROFILE,
  OPERATIVER_FOKUS_PROFILE,
  STRATEGISCHER_TAG_PROFILE,
  WACHSTUMSDRUCK_PROFILE,
  TEAM_ENGPASS_PROFILE,
  PIPELINE_RISIKO_PROFILE,
];

// Jedes Profil erhält einen eigenen, großen Seed-Offset, damit unterschiedliche
// Profile vollständig unabhängige Zufallsströme verwenden (kein zufälliges
// Überlappen), während `baseline` mit Offset 0 exakt die bisherigen Seeds
// (WORLD_SEED + 1..9) unverändert weiterverwendet.
const SCENARIO_SEED_OFFSETS: Record<ScenarioProfile["id"], number> = {
  baseline: 0,
  "operativer-fokus": 100_000,
  "strategischer-tag": 200_000,
  wachstumsdruck: 300_000,
  "team-engpass": 400_000,
  "pipeline-risiko": 500_000,
};

export function scenarioSeedOffset(profile: ScenarioProfile): number {
  return SCENARIO_SEED_OFFSETS[profile.id];
}
