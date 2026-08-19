// Operations Lifecycle Regime Foundation (Auftrag "Current Queue Checkpoint +
// Operations Regime Foundation", Phase B): beschreibt AUSSCHLIESSLICH, wie sich
// die TATSÄCHLICHEN Zeiten zweier unabhängiger Operations-Dimensionen über die
// Zeitachse verändern — Queue-Dauer (Commitment/queuedAt → tatsächlicher Start)
// und Delivery-Dauer (tatsächlicher Start → tatsächlicher Abschluss). Reine
// World-Wahrheit, KEINE Bewertung (PRINCIPLES.md, Prinzip 19/20): "elevated-
// duration"/"reduced-duration" sind keine Leadership-/Business-State-Werte,
// genau wie MarketingDemandRegime.id ("elevated"/"suppressed") keine Bewertung
// ist — sie beschreiben nur, wie der Generator tatsächliche Dauern über die Zeit
// verteilt (siehe engine/marketing-demand.ts, dasselbe Muster).
//
// Bewusste Abweichung vom Marketing-Demand-Modell-MECHANISMUS (nicht von seiner
// Zeitfenster-Struktur): Marketing zieht Nachfrage über Rejection Sampling auf
// einem GETEILTEN, variabel konsumierten demandRng-Strom (siehe
// sampleDemandDrivenDate) — für Leads unproblematisch, weil kein Lead eine
// entity-stabile 1:1-RNG-Zuordnung benötigt. DeliveryUnits sind anders: jede
// Unit zieht bereits einen vollständig isolierten, entity-stabilen
// Lifecycle-Teilstrom (world/delivery-units.ts, DELIVERY_LIFECYCLE_SEED_OFFSET +
// opportunityNumericKey). Ein Regime darf diese Isolation nicht aufheben — kein
// geteilter variabel konsumierter Strom, kein Rejection Sampling, keine
// Kopplung an Iterationsreihenfolge (siehe Auftrag, B9). Deshalb wirkt ein
// Operations-Regime rein deterministisch über die Ziehungsgrenzen (min/max
// Tage) EINER bereits vorhandenen, bereits entity-stabilen Ziehung — exakt
// dieselbe Anzahl rng()-Aufrufe pro Unit, in derselben Reihenfolge, unabhängig
// davon, ob und welches Regime greift.
export type OperationsRegimeDirection = "baseline" | "elevated-duration" | "reduced-duration";

export interface OperationsDurationRegime {
  // Rein deskriptive Kennzeichnung, keine Bewertung — siehe oben. Wird an keiner
  // Stelle in Statement-/Observation-Text verwendet (Observations bleiben in
  // dieser Phase B unverändert, siehe engine/operations-lifecycle.test.ts).
  direction: OperationsRegimeDirection;
  // Inklusive Grenzen, ISO-Kalenderdatum (YYYY-MM-DD) — dieselbe Konvention wie
  // MarketingDemandRegime.startsAt/endsAt.
  startsAt: string;
  endsAt: string;
  // Ersetzt für eine Unit, die innerhalb dieses Fensters verankert ist, direkt
  // die Baseline-Ziehungsgrenzen (QUEUE_DELAY_MIN/MAX_DAYS bzw.
  // ACTUAL_DELIVERY_DURATION_MIN/MAX_DAYS in world/delivery-units.ts) — explizite
  // Tagesgrenzen statt Multiplikator oder additiver Verschiebung. Multiplikator-
  // und additive Kandidaten wurden als Kalibrierungs-Mechanismus geprüft (siehe
  // Abschlussbericht, B11) und zugunsten expliziter Grenzen verworfen: direkt
  // auditierbar, keine Rundungs-/Kompositions-Überraschung bei kleinen
  // Basiswerten (QUEUE_DELAY_MIN_DAYS=0 macht einen reinen Multiplikator auf die
  // Untergrenze wirkungslos), dieselbe Konvention wie die bestehenden
  // BASELINE-Konstanten selbst.
  minDays: number;
  maxDays: number;
}

export interface OperationsLifecycleModel {
  queueRegimes: readonly OperationsDurationRegime[];
  deliveryRegimes: readonly OperationsDurationRegime[];
}

// Kein Regime konfiguriert = exakt die bisherigen festen Grenzen (Nullzustand,
// identisch zum Verhalten vor diesem Auftrag) — siehe Auftrag B8,
// Default-Bit-Identität.
export const NO_OPERATIONS_REGIMES: OperationsLifecycleModel = { queueRegimes: [], deliveryRegimes: [] };

function validateRegime(regime: OperationsDurationRegime, label: string): void {
  if (regime.startsAt > regime.endsAt) {
    throw new Error(`${label}: ungültiges Intervall (startsAt > endsAt): ${regime.startsAt}..${regime.endsAt}`);
  }
  if (regime.minDays < 0 || regime.maxDays < regime.minDays) {
    throw new Error(`${label}: ungültige Tagesgrenzen (minDays=${regime.minDays}, maxDays=${regime.maxDays})`);
  }
}

function findOverlap(
  regimes: readonly OperationsDurationRegime[],
): [OperationsDurationRegime, OperationsDurationRegime] | undefined {
  for (let i = 0; i < regimes.length; i++) {
    for (let j = i + 1; j < regimes.length; j++) {
      const a = regimes[i]!;
      const b = regimes[j]!;
      if (a.startsAt <= b.endsAt && b.startsAt <= a.endsAt) {
        return [a, b];
      }
    }
  }
  return undefined;
}

// Wirft bei ungültigen Intervallen oder widersprüchlich überlappenden Regimen
// derselben Dimension — bewusst beim Modellaufbau geprüft, nicht erst tief in
// der Ziehungslogik (frühestmöglicher, klarster Fehlerpunkt). Zwei Regime
// unterschiedlicher Dimensionen (queueRegimes vs. deliveryRegimes) dürfen sich
// zeitlich frei überlappen — sie wirken auf unterschiedliche Anker
// (queuedAt vs. actualStartDate) und sind laut Auftrag B4.3 unabhängig
// konfigurierbar.
export function validateOperationsLifecycleModel(model: OperationsLifecycleModel): void {
  for (const r of model.queueRegimes) validateRegime(r, "queueRegimes");
  for (const r of model.deliveryRegimes) validateRegime(r, "deliveryRegimes");

  const queueOverlap = findOverlap(model.queueRegimes);
  if (queueOverlap) {
    throw new Error(
      `queueRegimes: widersprüchliche Überlappung zwischen "${queueOverlap[0].direction}" (${queueOverlap[0].startsAt}..${queueOverlap[0].endsAt}) und "${queueOverlap[1].direction}" (${queueOverlap[1].startsAt}..${queueOverlap[1].endsAt})`,
    );
  }
  const deliveryOverlap = findOverlap(model.deliveryRegimes);
  if (deliveryOverlap) {
    throw new Error(
      `deliveryRegimes: widersprüchliche Überlappung zwischen "${deliveryOverlap[0].direction}" (${deliveryOverlap[0].startsAt}..${deliveryOverlap[0].endsAt}) und "${deliveryOverlap[1].direction}" (${deliveryOverlap[1].startsAt}..${deliveryOverlap[1].endsAt})`,
    );
  }
}

// Reine Nachschlagefunktionen, keine Zufallsquelle — exakt analog zu
// demandRateMultiplierAt (engine/marketing-demand.ts). Nur vom übergebenen
// Anker-Datum abhängig, niemals von WORLD_NOW: ein später im Kalender
// hinzugefügtes Regime verändert nie die Auflösung für ein bereits verankertes,
// vergangenes Datum (dieselbe historische Stabilität wie Marketing).
export function queueRegimeAt(model: OperationsLifecycleModel, isoDate: string): OperationsDurationRegime | undefined {
  return model.queueRegimes.find((r) => r.startsAt <= isoDate && isoDate <= r.endsAt);
}

export function deliveryRegimeAt(
  model: OperationsLifecycleModel,
  isoDate: string,
): OperationsDurationRegime | undefined {
  return model.deliveryRegimes.find((r) => r.startsAt <= isoDate && isoDate <= r.endsAt);
}
