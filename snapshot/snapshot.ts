import type { Employee } from "../world/employees";
import type { EmployeeHired, EmployeeTerminated } from "../events/employee-lifecycle";
import { activeDeliveryUnitsAt, type DeliveryUnit } from "../world/delivery-units";
import {
  generateOperationsDeliveryFairShareObservation,
  generateOperationsCompletedDeliveryDurationObservation,
  generateOperationsQueueDurationObservation,
  generateOperationsCurrentDeliveryQueueSnapshotObservation,
  generateOperationsQueueDurationSignalObservation,
  generateOperationsDeliveryDurationSignalObservation,
  type OperationsObservation,
  type CompletedDeliveryDurationObservation,
  type QueueDurationObservation,
  type QueueDurationSignalObservation,
  type DeliveryDurationSignalObservation,
  type CurrentDeliveryQueueSnapshotObservation,
} from "../observations/operations-observations";
import {
  generateMarketingDemandGenerationObservation,
  generateMarketingDemandRegimeSignalObservation,
  type MarketingObservation,
  type MarketingDemandSignalObservation,
} from "../observations/marketing-observations";
import { WORLD_TIMELINE_START } from "../timeline/world-clock";
import type { CustomerAccount } from "../world/customer-accounts";
import type { Contact } from "../world/contacts";
import type { AccountOwnership } from "../world/account-ownership";
import type { KnowledgeObject } from "../world/knowledge-objects";
import type { Lead } from "../events/leads";
import type { Opportunity } from "../events/opportunities";
import type { OpportunityStageHistory } from "../events/opportunity-stage-history";
import type { Call } from "../events/calls";
import type { Email } from "../events/emails";
import type { Meeting } from "../events/meetings";
import type { MeetingTranscript } from "../events/meeting-transcripts";
import type { CrmActivity } from "../events/crm-activities";
import type { SalesAppointmentBooked, SalesAppointmentHeld } from "../events/sales-appointment-lifecycle";
import { generateSalesPeriodMetrics, type SalesPeriodMetricsSnapshot } from "../company/sales-period-metrics";

// Snapshot ist die zeitliche Projektion der Event-Historie: der vollständige
// Weltzustand zu einem beliebigen Zeitpunkt `asOf`, nicht nur zu WORLD_NOW. Snapshot
// erzeugt KEINE neue Erkenntnis — er analysiert nichts, priorisiert nichts, bewertet
// nichts. Er beantwortet ausschließlich eine strukturelle Frage: "was existierte
// bereits, und in welchem Zustand, zum Zeitpunkt asOf?" Dieselbe redaktionsfreie
// Methode wie bei jeder anderen reinen Rekonstruktion im System (z. B.
// findOwnershipAt() in generate-sales-pipeline.ts oder openStageEntries() in
// observations.ts) — Snapshot generalisiert genau dieses bereits bestehende,
// bislang jeweils lokal auf WORLD_NOW hartkodierte Muster zu einer wiederverwendbaren,
// T-parametrisierten Funktion. Keine neue Fachlogik, keine neue Zeitsemantik.
//
// Zwei grundverschiedene Projektionsarten, klar auseinandergehalten:
//
// 1) Existenz-Filterung (Employee, CustomerAccount, Contact, Lead, KnowledgeObject,
//    Call, Email, Meeting, MeetingTranscript, CrmActivity): "existierte diese Entität
//    bereits zu asOf?" — ein reiner Filter auf createdAt/hiredAt/timestamp. Der
//    zurückgegebene Datensatz selbst trägt keinen weiteren zeitlich veränderlichen
//    Kernzustand, den es zu rekonstruieren gäbe.
//
// 2) Zustandsprojektion (Opportunity über OpportunityStageHistory, AccountOwnership
//    über validFrom/validTo): die "wahre" Aussage zu asOf hängt vom historischen
//    Verlauf ab, nicht nur von der Existenz. Eine Opportunity, die zu WORLD_NOW in
//    "verhandlung" steht, kann zu einem früheren asOf noch in "qualifizierung"
//    gewesen sein — das ist über die bereits bestehenden, lückenlosen
//    OpportunityStageHistory-Intervalle exakt rekonstruierbar (Invariante:
//    checkStageHistoryContiguity in validation/invariants.ts).
//
// Bekannte, bewusst nicht gelöste Grenze: Lead besitzt keine Status-Historie (der
// Generator würfelt einen einzigen, finalen status ohne Übergangs-Zeitstempel je
// Zwischenstatus — siehe events/generate-sales-pipeline.ts). Ein Lead erscheint im
// Snapshot daher bereits ab seinem createdAt mit seinem finalen status; "welchen
// status hatte dieser Lead exakt am Tag X" lässt sich aus den vorhandenen Daten
// ehrlich nicht rekonstruieren. Das hier zu erfinden wäre neue Fachlogik in Events —
// ausdrücklich nicht Teil dieses Layers. Einzige Korrektur: convertedToOpportunityId
// wird entfernt, falls die verlinkte Opportunity zu asOf noch nicht existiert (Prinzip
// 5, Temporal Consistency — sonst würde der Snapshot auf eine Entität verweisen, die
// er selbst nicht enthält).
export interface OpportunityAtSnapshot {
  opportunity: Opportunity;
  stageAsOf: OpportunityStageHistory;
}

export interface WorldSnapshot {
  asOf: string;

  employees: Employee[];
  // People Foundation (Reference World v2, Schritt 1): reine Existenz-Filterung wie
  // bei jeder anderen dynamischen Entität in Kategorie 1 oben — ein
  // EmployeeTerminated-Event mit terminatedAt > asOf ist zu asOf noch nicht
  // eingetreten und darf im Snapshot nicht erscheinen (Backward Explainability,
  // Prinzip 18: kein Snapshot darf ein Ereignis kennen, das noch nicht existiert).
  employeeHiredEvents: EmployeeHired[];
  employeeTerminatedEvents: EmployeeTerminated[];
  // Operations Foundation (Reference World v2, Schritt 2, Phase 14): dieselbe
  // Existenz-Filterung wie oben — eine DeliveryUnit mit startDate (=
  // Opportunity.closedAt) > asOf ist zu asOf noch nicht entstanden (keine
  // zukünftigen Won-Deals/Abschlüsse im Snapshot sichtbar).
  deliveryUnits: DeliveryUnit[];
  // Abgeleitete, zeitpunktbezogene Sicht (Phase 6, isDeliveryUnitActiveAt) — stets
  // eine Teilmenge von deliveryUnits oben, keine zusätzliche Erkenntnis.
  activeDeliveryUnits: DeliveryUnit[];
  // Operations-Fair-Share-Fakt zu asOf, ausschließlich aus activeDeliveryUnits
  // abgeleitet (Backward Explainability) — undefined nur, wenn zu asOf keine aktiven
  // Operations-Mitarbeiter existieren.
  operationsObservation: OperationsObservation | undefined;
  // Completed Delivery Duration Observation V1: tatsächliche Dauer (Start bis
  // Abschluss) der bis zu asOf bereits abgeschlossenen DeliveryUnits — ausschließlich
  // aus den bereits asOf-gefilterten deliveryUnits abgeleitet (Backward
  // Explainability) — undefined nur, wenn zu asOf noch keine DeliveryUnit
  // abgeschlossen ist (keine erfundene leere Verteilung, siehe
  // observations/operations-observations.ts).
  completedDeliveryDurationObservation: CompletedDeliveryDurationObservation | undefined;
  // Queue Duration Observation V1: Wartezeit (Queue bis tatsächlicher Start) der
  // bis zu asOf bereits gestarteten DeliveryUnits — ausschließlich aus den bereits
  // asOf-gefilterten deliveryUnits abgeleitet (Backward Explainability) —
  // undefined nur, wenn zu asOf noch keine DeliveryUnit tatsächlich gestartet ist.
  queueDurationObservation: QueueDurationObservation | undefined;
  // Current Delivery Queue Snapshot V1: reiner Stichtags-Snapshot, wie viele bis
  // asOf entstandene Lieferverpflichtungen zu asOf noch auf ihren tatsächlichen
  // Start warten. Anders als die übrigen Operations-Observation-Felder NICHT
  // optional — die Funktion liefert immer ein definiertes Ergebnis, auch bei 0
  // entstandenen Lieferverpflichtungen (ein wahrer, informativer Fakt, siehe
  // observations/operations-observations.ts).
  currentDeliveryQueueSnapshotObservation: CurrentDeliveryQueueSnapshotObservation;
  // Queue/Delivery Duration Signal Observation (Auftrag "Operations Delivery
  // Flow Signal Design"): zensierungskorrekte, persistente Richtungsaussage
  // (Kaplan-Meier/RMST über zwei bestätigende Zeitfenster gegen eine
  // historische Referenz) — ausschließlich aus den bereits asOf-gefilterten
  // deliveryUnits abgeleitet (Backward Explainability). undefined, solange
  // nicht genug historische Evidenz für eine belastbare Referenz vorliegt
  // (dieselbe Mindest-Evidenz-Logik wie marketingDemandSignal).
  queueDurationSignalObservation: QueueDurationSignalObservation | undefined;
  deliveryDurationSignalObservation: DeliveryDurationSignalObservation | undefined;
  // Marketing-Demand-Generation-Fakt zu asOf, ausschließlich aus den bereits
  // asOf-gefilterten leads/opportunities abgeleitet (Backward Explainability) —
  // undefined nur, wenn zu asOf noch keine Leads existieren.
  marketingObservation: MarketingObservation | undefined;
  // Marketing Leadership State: Demand-Regime-Signal zu asOf, ausschließlich aus
  // den bereits asOf-gefilterten leads abgeleitet — undefined, solange nicht
  // genug historische Evidenz für eine belastbare Referenzdichte vorliegt (siehe
  // observations/marketing-observations.ts).
  marketingDemandSignal: MarketingDemandSignalObservation | undefined;
  customerAccounts: CustomerAccount[];
  contacts: Contact[];
  accountOwnerships: AccountOwnership[];
  leads: Lead[];
  opportunities: OpportunityAtSnapshot[];
  knowledgeObjects: KnowledgeObject[];
  calls: Call[];
  emails: Email[];
  meetings: Meeting[];
  meetingTranscripts: MeetingTranscript[];
  crmActivities: CrmActivity[];
  // Sales Period KPI Foundation V1 (Korrekturauftrag "Sales Period Metrics
  // Snapshot Integration"): kanonische Einmalberechnung der drei
  // Sales-Zeiträume (Yesterday/WTD/MTD) exakt an diesem asOf — siehe
  // company/sales-period-metrics.ts für die vollständige Zählsemantik-
  // Begründung. Verwendet ausschließlich bereits vorhandene, an anderer
  // Stelle generierte Booked-/Held-Events sowie die bereits im Snapshot
  // verfügbaren, roh übergebenen Opportunities (world.opportunities, NICHT
  // die bereits gewrappten opportunities oben) — reine Filterung/Zählung
  // nach dem asOf dieses Snapshots, kein zweiter Berechnungsweg, keine
  // Observation, keine Bewertung. Rein deskriptiv (Ebene 1 der Executive-
  // Capability-Architektur) — bewusst NICHT Teil des Public Contracts (siehe
  // company/sales-period-metrics.ts für die vollständige Begründung, warum
  // keine Erweiterung von CompanyExecutiveKpiData/index.ts erfolgt ist).
  salesPeriodMetrics: SalesPeriodMetricsSnapshot;
}

// Eingabeform bewusst als eigenständiges Interface definiert, nicht aus
// engine/generator.ts importiert: Snapshot darf nicht von der Orchestrierungsebene
// abhängen (sonst entstünde eine versteckte Kopplung in die falsche Richtung). Ein
// ScenarioWorld (bzw. ScenarioWorldTruth) erfüllt diese Form strukturell bereits
// vollständig — Employees/CustomerAccounts/Contacts müssen als scenario-unabhängige
// Stammdaten separat übergeben werden, da sie kein Teil von ScenarioWorld sind.
export interface WorldSnapshotSource {
  employees: readonly Employee[];
  employeeHiredEvents: readonly EmployeeHired[];
  employeeTerminatedEvents: readonly EmployeeTerminated[];
  deliveryUnits: readonly DeliveryUnit[];
  customerAccounts: readonly CustomerAccount[];
  contacts: readonly Contact[];
  accountOwnerships: readonly AccountOwnership[];
  leads: readonly Lead[];
  opportunities: readonly Opportunity[];
  stageHistory: readonly OpportunityStageHistory[];
  knowledgeObjects: readonly KnowledgeObject[];
  calls: readonly Call[];
  emails: readonly Email[];
  meetings: readonly Meeting[];
  meetingTranscripts: readonly MeetingTranscript[];
  crmActivities: readonly CrmActivity[];
  salesAppointmentBookedEvents: readonly SalesAppointmentBooked[];
  salesAppointmentHeldEvents: readonly SalesAppointmentHeld[];
}

export function generateWorldSnapshot(world: WorldSnapshotSource, asOf: string): WorldSnapshot {
  const employees = world.employees.filter((e) => e.hiredAt <= asOf);
  const employeeHiredEvents = world.employeeHiredEvents.filter((e) => e.hiredAt <= asOf);
  const employeeTerminatedEvents = world.employeeTerminatedEvents.filter((e) => e.terminatedAt <= asOf);
  const deliveryUnits = world.deliveryUnits.filter((u) => u.startDate <= asOf);
  const activeDeliveryUnits = activeDeliveryUnitsAt(deliveryUnits, asOf);
  const operationsObservation = generateOperationsDeliveryFairShareObservation(deliveryUnits, world.employees, asOf);
  const completedDeliveryDurationObservation = generateOperationsCompletedDeliveryDurationObservation(deliveryUnits, asOf);
  const queueDurationObservation = generateOperationsQueueDurationObservation(deliveryUnits, asOf);
  const currentDeliveryQueueSnapshotObservation = generateOperationsCurrentDeliveryQueueSnapshotObservation(deliveryUnits, asOf);
  const queueDurationSignalObservation = generateOperationsQueueDurationSignalObservation(deliveryUnits, asOf, WORLD_TIMELINE_START);
  const deliveryDurationSignalObservation = generateOperationsDeliveryDurationSignalObservation(deliveryUnits, asOf, WORLD_TIMELINE_START);
  const customerAccounts = world.customerAccounts.filter((a) => a.createdAt <= asOf);
  const contacts = world.contacts.filter((c) => c.createdAt <= asOf);

  const accountOwnerships = world.accountOwnerships.filter(
    (o) => o.validFrom <= asOf && (o.validTo === undefined || asOf <= o.validTo),
  );

  const stageEntriesByOpportunity = new Map<string, OpportunityStageHistory[]>();
  for (const entry of world.stageHistory) {
    const list = stageEntriesByOpportunity.get(entry.opportunityId) ?? [];
    list.push(entry);
    stageEntriesByOpportunity.set(entry.opportunityId, list);
  }

  const opportunities: OpportunityAtSnapshot[] = [];
  for (const opportunity of world.opportunities) {
    if (opportunity.createdAt > asOf) {
      continue;
    }
    const entries = stageEntriesByOpportunity.get(opportunity.id) ?? [];
    const stageAsOf = entries.find((e) => e.enteredAt <= asOf && (e.exitedAt === undefined || asOf < e.exitedAt));
    if (!stageAsOf) {
      // Sollte laut checkStageHistoryContiguity nie auftreten (lückenlose Historie
      // von createdAt bis closedAt ?? WORLD_NOW) — kein Wurf, keine Annahme, einfach
      // ausgeschlossen, falls die Invariante doch einmal verletzt wäre.
      continue;
    }
    opportunities.push({ opportunity, stageAsOf });
  }

  const includedOpportunityIds = new Set(opportunities.map((entry) => entry.opportunity.id));
  const leads = world.leads
    .filter((lead) => lead.createdAt <= asOf)
    .map((lead): Lead => {
      if (lead.convertedToOpportunityId && !includedOpportunityIds.has(lead.convertedToOpportunityId)) {
        const { convertedToOpportunityId: _omitted, ...rest } = lead;
        return rest;
      }
      return lead;
    });

  // Marketing as First-Class Company Area: exakt dieselbe Existenz-Filterung wie
  // operationsObservation oben — einmalig pro Snapshot aus den bereits asOf-
  // gefilterten leads/opportunities berechnet, keine zweite Filterung.
  const marketingObservation = generateMarketingDemandGenerationObservation(
    leads,
    opportunities.map((entry) => entry.opportunity),
    asOf,
  );
  // Marketing Leadership State: dieselbe Existenz-/Zeitfilterung, ausschließlich
  // aus den bereits asOf-gefilterten leads berechnet (siehe
  // observations/marketing-observations.ts für die vollständige Methodik-
  // Begründung).
  const marketingDemandSignal = generateMarketingDemandRegimeSignalObservation(leads, asOf, WORLD_TIMELINE_START);

  const knowledgeObjects = world.knowledgeObjects.filter((k) => k.createdAt <= asOf);
  const calls = world.calls.filter((c) => c.timestamp <= asOf);
  const emails = world.emails.filter((e) => e.timestamp <= asOf);
  const meetings = world.meetings.filter((m) => m.timestamp <= asOf);
  const includedMeetingIds = new Set(meetings.map((m) => m.id));
  const meetingTranscripts = world.meetingTranscripts.filter((t) => includedMeetingIds.has(t.meetingId));
  const crmActivities = world.crmActivities.filter((a) => a.timestamp <= asOf);

  // Sales Period KPI Foundation V1: einziger kanonischer Berechnungspunkt für
  // Yesterday/WTD/MTD — verwendet ausdrücklich `asOf` (das asOf DIESES
  // Snapshots), niemals WORLD_NOW. world.opportunities ist bewusst die rohe,
  // ungewrappte Eingabe (nicht das unten stehende, bereits auf
  // OpportunityAtSnapshot projizierte `opportunities`) — generateSalesPeriodMetrics
  // filtert selbst und ausschließlich nach dem eigenen closedAt jeder
  // Opportunity gegen die asOf-begrenzten Periodengrenzen, exakt dieselbe
  // Garantie wie bei jeder anderen Existenz-Filterung in dieser Datei.
  const salesPeriodMetrics = generateSalesPeriodMetrics(
    asOf,
    world.salesAppointmentBookedEvents,
    world.salesAppointmentHeldEvents,
    world.opportunities,
  );

  return {
    asOf,
    employees,
    employeeHiredEvents,
    employeeTerminatedEvents,
    deliveryUnits,
    activeDeliveryUnits,
    operationsObservation,
    completedDeliveryDurationObservation,
    queueDurationObservation,
    currentDeliveryQueueSnapshotObservation,
    queueDurationSignalObservation,
    deliveryDurationSignalObservation,
    marketingObservation,
    marketingDemandSignal,
    customerAccounts,
    contacts,
    accountOwnerships,
    leads,
    opportunities,
    knowledgeObjects,
    calls,
    emails,
    meetings,
    meetingTranscripts,
    crmActivities,
    salesPeriodMetrics,
  };
}
