import type { Observation, ObservationKind } from "./observations";
import { activeDeliveryUnitsAt, type DeliveryUnit } from "../world/delivery-units";
import type { Employee } from "../world/employees";

// Bewusst KEIN Import von engine/generator.ts (SCENARIO_WORLDS) hier: generator.ts
// importiert bereits generateGroundTruthSnapshot aus ground-truth.ts, und
// ground-truth.ts würde — falls es umgekehrt einen hier definierten
// Operations-Singleton importierte — einen Zirkelbezug
// generator.ts → ground-truth.ts → operations-observations.ts → generator.ts
// schließen. Deshalb bleibt diese Datei eine reine Funktionsbibliothek ohne eigenen,
// bei Modul-Load berechneten Singleton; Aufrufer (Tests, künftig Snapshot-Integration)
// übergeben deliveryUnits/employees/asOf explizit, exakt wie
// generateBusinessStateSnapshot bereits heute ohne eigenen Singleton auskommt.

// Phase 9 (Severity-/Confidence-Typfrage) — Ergebnis der Prüfung:
//
// A. Eine vorhandene neutrale Severity verwenden? Verworfen — severity kennt nur
//    "niedrig"/"mittel"/"hoch", alle drei sind inhärent wertend. "niedrig" wäre kein
//    neutraler Nichtbefund, sondern eine implizite, unbelegte Behauptung
//    ("unbedenklich geprüft") — genau die künstliche Bewertung, die die freigegebene
//    Domain Decision 5 ausschließt.
// B. severity additiv optional machen? Technisch möglich, aber teurer als es
//    aussieht: validation/invariants.ts prüft heute mit
//    checkObservationFieldsValid/OBSERVATION_SEVERITIES, dass JEDE Observation eine
//    gültige severity trägt — ein Set<string>.has(obs.severity) unter strict:true
//    würde bei optionalem severity selbst brechen und müsste angepasst werden. Das
//    würde eine heute für alle 19 Sales-/People-Kinds geltende Garantie dauerhaft
//    aufweichen, nur um einer einzigen, bewusst andersartigen Domäne
//    entgegenzukommen — mehr Eingriff, als es zunächst scheint.
// C. Eine separate Observation-Struktur? Gewählt. OperationsObservation unten ist
//    KEIN Observation (keine severity, keine category) — sie behauptet nicht,
//    severity-bewertet zu sein, weil sie es laut Domain Decision nicht ist.
//    confidence bleibt trotzdem dieselbe, bereits bestehende Skala
//    (Observation["confidence"]) — keine neue Confidence-Skala; hier ausschließlich
//    "unzureichend" verwendet (Domain Decision 7). kind nutzt weiterhin denselben,
//    additiv erweiterten ObservationKind, damit derselbe generische
//    Ground-Truth-Generator (ground-truth.ts, ObservationLike — liest ohnehin nur
//    id/kind) unverändert wiederverwendet werden kann, ohne Observation selbst
//    anzufassen.
// D. Präzedenzfall für unbewertete Observations? Keiner gefunden — alle 17
//    bestehenden Sales-Kinds setzen severity durchgehend. Kein bestehendes Muster
//    wurde also gebrochen oder umgangen, sondern bewusst nicht künstlich imitiert.
//
// Ergebnis: kleinste tragfähige additive Lösung ohne neue fachliche Semantik und
// ohne Aufweichung bestehender Invarianten — kein STOP nötig.
export interface OperationsObservation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  area: "Delivery";
  statement: string;
  confidence: Observation["confidence"];
  activeDeliveryUnitsTotal: number;
  activeUnitsByEmployeeId: Record<string, number>;
  fairShare: number;
  maxAssignedCount: number;
  maxAssignedEmployeeId: string;
  maxShare: number;
  fairShareRatio: number;
  derivedFrom: string[];
}

// Rein deskriptiv (Domain Decisions 5-8): berichtet Ist-Verteilung und rechnerischen
// Fair Share als Fakt, klassifiziert nichts als kritisch/überlastet/problematisch,
// spricht keine Handlungsempfehlung aus. derivedFrom referenziert exakt die zum
// Zeitpunkt asOf aktiven DeliveryUnit-IDs (Backward Explainability, Prinzip 18) —
// über DeliveryUnit.opportunityId/accountId von dort aus vollständig bis zu
// Opportunity/OpportunityStageHistory/closedAt zurückverfolgbar.
//
// Zero-Active-Explainability-Fix (Operations Evidence Audit, Phase C, bestätigt an
// realen Baseline-Tagen 2025-03-29 bis 2025-04-01): "0 aktive DeliveryUnits" ist
// zweideutig, solange derivedFrom in jedem Fall [] ist — Prinzip 8 (Evidence
// Required) verlangt eine unterscheidbare Referenz zwischen "es existiert noch
// keine geprüfte Population" (vor der ersten DeliveryUnit) und "eine Population
// wurde geprüft, keine Einheit war aktiv" (bereits gestartete, inzwischen
// abgeschlossene Einheiten). derivedFrom referenziert deshalb bei 0 aktiven
// Einheiten ersatzweise die bereits gestartete Population (startDate <= asOf,
// dieselbe Zukunftswissen-Grenze wie activeDeliveryUnitsAt) — bei aktiven Einheiten
// bleibt das bisherige, bereits getestete Verhalten (exakt die aktiven IDs)
// unverändert.
export function generateOperationsDeliveryFairShareObservation(
  deliveryUnits: readonly DeliveryUnit[],
  employees: readonly Employee[],
  asOf: string,
): OperationsObservation | undefined {
  const operationsEmployeeIds = employees
    .filter((e) => e.departmentId === "dept-operations" && e.terminatedAt === undefined)
    .map((e) => e.id)
    .sort();

  if (operationsEmployeeIds.length === 0) {
    return undefined;
  }

  const active = activeDeliveryUnitsAt(deliveryUnits, asOf);

  const activeUnitsByEmployeeId: Record<string, number> = {};
  for (const id of operationsEmployeeIds) activeUnitsByEmployeeId[id] = 0;
  for (const unit of active) {
    activeUnitsByEmployeeId[unit.assignedEmployeeId] = (activeUnitsByEmployeeId[unit.assignedEmployeeId] ?? 0) + 1;
  }

  const fairShare = active.length / operationsEmployeeIds.length;

  // Tie-break bei gleichem Maximalwert: deterministisch über die bereits
  // alphabetisch nach employeeId sortierte operationsEmployeeIds-Liste — die erste
  // Person mit dem Maximalwert wird berichtet. Eine rein technische
  // Determinismus-Entscheidung (Reproduzierbarkeit, Prinzip 3), keine fachliche
  // Aussage über die betroffenen Personen.
  let maxAssignedCount = 0;
  let maxAssignedEmployeeId = operationsEmployeeIds[0]!;
  for (const id of operationsEmployeeIds) {
    const count = activeUnitsByEmployeeId[id] ?? 0;
    if (count > maxAssignedCount) {
      maxAssignedCount = count;
      maxAssignedEmployeeId = id;
    }
  }

  const maxShare = active.length > 0 ? maxAssignedCount / active.length : 0;
  const fairShareRatio = fairShare > 0 ? maxAssignedCount / fairShare : 0;

  const statement =
    active.length === 0
      ? `Zum ${asOf} sind keine DeliveryUnits aktiv.`
      : `Von ${active.length} laufenden DeliveryUnits ${active.length === 1 ? "ist" : "sind"} ${maxAssignedCount} ` +
        `einer Person zugeordnet; bei Gleichverteilung über ${operationsEmployeeIds.length} Personen entsprächen ` +
        `${fairShare.toFixed(1)} je Person.`;

  return {
    id: `operations-obs-fair-share-${asOf}`,
    kind: "operations-delivery-fair-share",
    generatedAt: asOf,
    area: "Delivery",
    statement,
    confidence: "unzureichend",
    activeDeliveryUnitsTotal: active.length,
    activeUnitsByEmployeeId,
    fairShare,
    maxAssignedCount,
    maxAssignedEmployeeId,
    maxShare,
    fairShareRatio,
    derivedFrom:
      active.length > 0
        ? active.map((u) => u.id)
        : deliveryUnits.filter((u) => u.startDate <= asOf).map((u) => u.id),
  };
}

// Kein Modul-Load-Singleton (s. Import-Kommentar oben, Zirkelbezug-Vermeidung).
// Aufrufer bilden die Ein-Element-/Leer-Liste bei Bedarf selbst:
// const obs = generateOperationsDeliveryFairShareObservation(...);
// const observations = obs ? [obs] : [];
