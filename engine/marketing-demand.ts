import type { Rng } from "./seed";
import { addDays, daysBetween, randomInt } from "./random";

// Marketing Demand Model (World Generation Layer) — beschreibt AUSSCHLIESSLICH,
// wie dicht Nachfrage (Lead-Entstehung) über die Zeit verteilt ist. Das ist
// World-Wahrheit, KEINE Bewertung: "elevated"/"suppressed" sind keine
// Leadership-State-Werte (frei/aufmerksam/operativ) — sie beschreiben nur, wie
// der Generator Nachfrage über die Zeitachse verteilt, exakt analog zu
// SalesScenarioConfig.leadCountMultiplier (ein Input-Parameter der
// Welterzeugung, keine Bewertung des Ergebnisses). Der Bewertungs-Layer
// (business-state/, company/) interpretiert diese Wahrheit später — falls
// überhaupt, und erst nach einem separaten, eigenen Auftrag (siehe Marketing
// Leadership State Domain Audit).
//
// Realistisches, domänenbegründetes Muster statt erfundener Werte: saisonale
// B2B-Nachfrageschwankungen (Jahresend-Kampagnendruck, Sommerflaute) sind ein
// anerkanntes, breit dokumentiertes Marketing-Phänomen — dieselbe redaktionelle
// Methode wie alle bestehenden Scenario-Parameter in diesem Repository (z. B.
// leadCountMultiplier für "wachstumsdruck"): konkrete Zahlen sind redaktionell
// gesetzt, aber an ein reales, benanntes Muster gebunden, nicht an ein
// gewünschtes Ergebnis zurückgerechnet.
export type MarketingDemandRegimeId = "elevated" | "suppressed";

export interface MarketingDemandRegime {
  id: MarketingDemandRegimeId;
  // Inklusive Grenzen, ISO-Kalenderdatum (YYYY-MM-DD) — dieselbe Konvention wie
  // überall sonst in diesem Repository (siehe WORLD_TIMELINE_START/WORLD_NOW).
  startsAt: string;
  endsAt: string;
  // Relativ zur impliziten Baseline-Rate 1 — außerhalb jedes konfigurierten
  // Regimes gilt implizit rate=1 ("normale Nachfrage").
  rateMultiplier: number;
}

export interface MarketingDemandModel {
  regimes: readonly MarketingDemandRegime[];
}

// Kein Regime konfiguriert = zeitlich gleichverteilte Nachfrage (identisch zum
// bisherigen Verhalten vor diesem Auftrag) — der "Nullzustand" dieses Modells.
export const NO_DEMAND_REGIMES: MarketingDemandModel = { regimes: [] };

// Reine Nachschlagefunktion, keine Zufallsquelle. Bewusst nur von `isoDate`
// abhängig (nicht von WORLD_NOW) — das macht sie asOf-sicher verwendbar: die
// Antwort für ein vergangenes Datum ändert sich nie, unabhängig davon, welche
// Regimes später im Kalender folgen (kein Blick auf "was als Nächstes kommt").
export function demandRateMultiplierAt(model: MarketingDemandModel, isoDate: string): number {
  const active = model.regimes.find((r) => r.startsAt <= isoDate && isoDate <= r.endsAt);
  return active?.rateMultiplier ?? 1;
}

// Nach so vielen erfolglosen Versuchen wird deterministisch der zuletzt
// gezogene Kandidat akzeptiert — verhindert einen unbegrenzten Loop bei sehr
// kleinen Zeitfenstern kombiniert mit niedriger Akzeptanzwahrscheinlichkeit,
// bleibt dabei vollständig reproduzierbar (der Fallback-Wert ist selbst eine
// deterministische Funktion der rng-Ziehungen).
const MAX_REJECTION_ATTEMPTS = 200;

// KRITISCH (asOf/Future-Knowledge-Sicherheit): fest, unabhängig vom jeweils
// übergebenen `model`. Eine ursprüngliche Fassung berechnete die
// Akzeptanzschwelle relativ zu `Math.max(1, ...model.regimes.map(...))` — das
// koppelte die Akzeptanzwahrscheinlichkeit JEDES Kandidaten (auch für Leads
// weit VOR einem später konfigurierten Regime) an das Vorhandensein *aller*
// Regimes im Modell, einschließlich zukünftiger. Da Rejection Sampling eine
// VARIABLE Anzahl von rng()-Aufrufen pro Lead verbraucht, verschob ein rein
// zukünftiges Regime dadurch den demandRng-Stream bereits für vergangene
// Leads — eine echte Form von Future-Knowledge-Leckage in den
// Generierungsprozess selbst (siehe validation/marketing-demand-model.test.ts,
// "ein Regime, das erst nach einem Cutoff T beginnt..."). Mit einer festen
// Obergrenze hängt die Akzeptanzwahrscheinlichkeit eines Kandidaten
// ausschließlich von dessen EIGENEM Datum ab, nie von anderen Regimes im
// selben Modell. 10 ist großzügig über jedem hier tatsächlich konfigurierten
// Multiplikator (siehe DEFAULT_MARKETING_DEMAND_MODEL unten) — keine an ein
// Ergebnis zurückgerechnete Zahl, sondern eine strukturelle, modellunabhängige
// Konstante.
const MAX_POSSIBLE_RATE_MULTIPLIER = 10;

// Zieht EIN Kalenderdatum im Intervall [earliestDate, latestDate] (beide
// inklusive), dessen Ziehungsdichte proportional zur jeweiligen Regime-Rate am
// gezogenen Tag ist (Rejection Sampling gegen eine Gleichverteilung als
// Vorschlagsverteilung — Standardmethode, keine neue Statistik-Bibliothek
// nötig).
//
// Nutzt ausschließlich den übergebenen `rng` — bewusst ein vom
// Haupt-Pipeline-Rng getrennter, unabhängiger Strom (siehe
// generate-sales-pipeline.ts: `demandRng`). Eine Änderung der
// Nachfrage-Verteilung darf die übrigen, fachlich unabhängigen
// Zufallsentscheidungen je Lead (Quelle, Status, Folgekontakt-Zeitpunkt) nicht
// verschieben — genau das würde eine gemeinsame RNG-Quelle unbeabsichtigt tun.
//
// Deterministisch: gleicher Rng-Zustand + gleiches Intervall + gleiches Modell
// erzeugen immer dasselbe Ergebnis. Terminiert garantiert.
export function sampleDemandDrivenDate(
  rng: Rng,
  model: MarketingDemandModel,
  earliestDate: string,
  latestDate: string,
): string {
  const spanDays = daysBetween(earliestDate, latestDate);
  if (spanDays <= 0) {
    return earliestDate;
  }

  let candidate = earliestDate;
  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
    candidate = addDays(earliestDate, randomInt(rng, 0, spanDays));
    const acceptanceThreshold = demandRateMultiplierAt(model, candidate) / MAX_POSSIBLE_RATE_MULTIPLIER;
    if (rng() < acceptanceThreshold) {
      return candidate;
    }
  }
  return candidate;
}

// Realistisches Baseline-Muster für die Haupt-Weltgenerierung (siehe
// scenario-profiles.ts): ein Sommer-Kampagnendruck vor dem Geschäftsjahresende
// (klassisches B2B-Muster) und eine Winter-/Frühjahrsflaute (Post-Feiertags-
// Ruhephase bis ins Frühjahr). Beide Fenster liegen vollständig innerhalb
// [WORLD_TIMELINE_START, WORLD_NOW] (2024-06-01 bis 2025-09-01). Multiplikatoren
// sind redaktionell gesetzt (wie leadCountMultiplier u. a.), aber an ein reales,
// benanntes saisonales Muster gebunden — keine an ein Ergebnis zurückgerechnete
// Zahl.
//
// AUFTRAG — Sales Ownership / Marketing Demand Decoupling (siehe
// events/generate-sales-pipeline.ts, MARKETING_DEMAND_SEED_OFFSET-Kommentar):
// 84 Tage/1.2x/0.6x statt vormals 31 Tage/1.2x/0.8x — validiert als kürzeste,
// schwächste unter allen empirisch geprüften Kombinationen, die GLEICHZEITIG (a)
// die Marketing-Separationskriterien erfüllt (elevated/suppressed jeweils >=2σ,
// Level-Metrik, 28-Tage-Fenster) UND (b) unter der jetzt entity-stabilen
// demandRng-Architektur alle 6 Sales-Scenario-Profile in ihrer erwarteten
// businessState.type-Klassifikation belässt (siehe
// validation/sales-ownership-decoupling.test.ts). Die vorherige 31-Tage/0.8x-
// Kalibrierung hielt unter der ALTEN, RNG-sequenz-gekoppelten Architektur nur
// zufällig — unter der neuen, entity-stabilen Architektur bricht sie Sales'
// baseline-Klassifikation ebenfalls, war also nie tatsächlich sicherer, nur
// durch eine andere Form von Zufall verdeckt.
export const DEFAULT_MARKETING_DEMAND_MODEL: MarketingDemandModel = {
  regimes: [
    { id: "elevated", startsAt: "2025-06-09", endsAt: "2025-08-31", rateMultiplier: 1.2 },
    { id: "suppressed", startsAt: "2025-02-16", endsAt: "2025-05-10", rateMultiplier: 0.6 },
  ],
};
