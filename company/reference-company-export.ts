import { WORLD_SEED } from "../engine/seed";
import { generateScenarioWorld } from "../engine/generator";
import { BASELINE_PROFILE, type ScenarioProfile } from "../engine/scenario-profiles";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { WORLD_NOW } from "../timeline/world-clock";
import { EMPLOYEES } from "../world/employees";
import { EMPLOYEE_HIRED_EVENTS, EMPLOYEE_TERMINATED_EVENTS } from "../events/employee-lifecycle";
import { CUSTOMER_ACCOUNTS, type CustomerAccount } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { COMPANY, type Company } from "../world/company";
import { ROLES, type Role } from "../world/roles";
import { DEPARTMENTS, type Department } from "../world/departments";
import { MARKETING_CAMPAIGNS, type MarketingCampaign } from "../world/marketing-campaigns";
import type { Lead } from "../events/leads";
import type { Opportunity } from "../events/opportunities";
import type { DeliveryUnit } from "../world/delivery-units";
import type { MetaAdSpendRecord } from "../events/marketing-meta-ad-spend";
import type {
  MetaLeadGenerated,
  MarketingCrmLeadIngested,
  MarketingLeadIdentityMatched,
} from "../events/marketing-meta-crm-source";
import { appointmentStatusAt, type SalesAppointmentStatus, type SalesAppointmentType } from "../world/sales-appointments";
import {
  generateCustomerAcquisitionLifecycle,
  type CustomerAcquired,
  type CustomerRelationship,
  type WonOpportunityClassification,
} from "./customer-acquisition-lifecycle";

// Reference Company Public Export Contract V1 (Auftrag "Flora Reference World
// Public Export Contract V1", CEO-Korrektur "CEO-Review — Public Export
// Contract V1: Korrektur und Checkpoint").
//
// Zweck: eine dünne, additive Orchestrierungsschicht — analog zu
// full-company-context.ts und area-workspace-data.ts — die ausschließlich
// bereits bestehende, an anderer Stelle geprüfte Generatoren aufruft
// (World/Scenario → Snapshot → Customer Acquisition Lifecycle →
// appointmentStatusAt) und deren bereits kanonische Ergebnisse als stabile,
// eingefrorene Export-DTOs zurückgibt. Keine eigene Zufallsgenerierung, keine
// zweite Berechnung bereits vorhandener Fakten, keine neue Geschäftsregel.
//
// Privacy-Grenze (PRINCIPLES.md, Prinzip 1/Isolationsregeln; Auftrag Phase 1):
// `Contact[]` (world/contacts.ts) wird bewusst NICHT exportiert — Contact.name
// ist eine synthetische Personenbezeichnung. Kein exportiertes Feld referenziert
// Contact-Inhalte über die reine ID hinaus. `Employee.name` und
// `Employee.isTopPerformer` (Performance-Markierung) werden ebenfalls bewusst
// nicht in `ReferenceCompanyExportEmployee` übernommen — nur strukturelle,
// nicht-personenbezogene Felder (siehe dort).
//
// Appointment-As-of-Korrektur (CEO-Review): `SalesAppointment.currentStatus`
// selbst ist eine vom Generator auf WORLD_NOW zensierte Endwahrheit (siehe
// dortiger Kopfkommentar) und wird hier NICHT direkt exportiert — das wäre bei
// asOf < WORLD_NOW eine Future Leakage. Stattdessen wird für jedes Appointment
// die bereits bestehende, kanonische As-of-Ableitung `appointmentStatusAt`
// (world/sales-appointments.ts, B17: "rekonstruiert den Zustand eines
// Appointments zu einem beliebigen historischen asOf ausschließlich aus
// bereits vorhandenen, eventbasierten Zeitstempeln — keine zweite Berechnung,
// kein neuer Zufall") aufgerufen. Ein Appointment, das erst nach `asOf`
// gebucht wurde, liefert `undefined` und erscheint im Export nicht. `heldAt`
// wird nur dann übernommen, wenn `appointmentStatusAt` den Status "held" zu
// `asOf` bereits bestätigt. Strukturelle, zeitinvariante Identitätsfelder
// (leadId/contactId/accountId/opportunityId/bookingSeriesId/
// rebookedFromAppointmentId/assignedEmployeeId/bookedByEmployeeId/bookedAt)
// ändern sich nach Buchung nie und werden unverändert von der World-Entity
// übernommen — keine Future Leakage, da zeitlich konstant.
export interface ReferenceCompanyExportEmployee {
  id: string;
  departmentId: string;
  roleId: string;
  managerId?: string;
  hiredAt: string;
  terminatedAt?: string;
  activeAsOf: boolean;
}

export interface ReferenceCompanyExportAppointment {
  id: string;
  appointmentType: SalesAppointmentType;
  leadId?: string;
  contactId: string;
  accountId: string;
  opportunityId?: string;
  bookingSeriesId: string;
  rebookedFromAppointmentId?: string;
  assignedEmployeeId: string;
  bookedByEmployeeId?: string;
  bookedAt: string;
  scheduledForAsOf: string;
  statusAsOf: SalesAppointmentStatus;
  heldAt?: string;
}

export interface ReferenceCompanyExportSnapshot {
  asOf: string;
  worldSeed: number;
  profileId: ScenarioProfile["id"];
  company: Company;
  roles: readonly Role[];
  departments: readonly Department[];
  employees: readonly ReferenceCompanyExportEmployee[];
  marketingCampaigns: readonly MarketingCampaign[];
  metaAdSpendRecords: readonly MetaAdSpendRecord[];
  metaLeadGeneratedEvents: readonly MetaLeadGenerated[];
  marketingCrmLeadIngestedEvents: readonly MarketingCrmLeadIngested[];
  marketingLeadIdentityMatchedEvents: readonly MarketingLeadIdentityMatched[];
  leads: readonly Lead[];
  customerAccounts: readonly CustomerAccount[];
  appointments: readonly ReferenceCompanyExportAppointment[];
  opportunities: readonly Opportunity[];
  customerAcquiredEvents: readonly CustomerAcquired[];
  customerRelationships: readonly CustomerRelationship[];
  wonOpportunityClassifications: readonly WonOpportunityClassification[];
  deliveryUnits: readonly DeliveryUnit[];
}

function cloneArray<T extends object>(items: readonly T[]): T[] {
  return items.map((item) => ({ ...item }));
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

// Freeze-Tiefe genügt für alle hier exportierten Typen (ein Objekt-Level plus
// höchstens ein Array-of-primitives-Feld, z. B. CustomerRelationship.wonOpportunityIds) —
// keine tiefer verschachtelten mutierbaren Strukturen im Export-Contract.
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value) as T;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as object)) deepFreeze(v);
    return Object.freeze(value);
  }
  return value;
}

export function generateReferenceCompanyExportSnapshot(
  worldSeed: number = WORLD_SEED,
  profile: ScenarioProfile = BASELINE_PROFILE,
  asOf: string = WORLD_NOW,
): ReferenceCompanyExportSnapshot {
  const scenarioWorld = generateScenarioWorld(worldSeed, profile);

  const snapshotSource: WorldSnapshotSource = {
    employees: EMPLOYEES,
    employeeHiredEvents: EMPLOYEE_HIRED_EVENTS,
    employeeTerminatedEvents: EMPLOYEE_TERMINATED_EVENTS,
    deliveryUnits: scenarioWorld.deliveryUnits,
    customerAccounts: CUSTOMER_ACCOUNTS,
    contacts: CONTACTS,
    accountOwnerships: scenarioWorld.accountOwnerships,
    leads: scenarioWorld.leads,
    opportunities: scenarioWorld.opportunities,
    stageHistory: scenarioWorld.stageHistory,
    knowledgeObjects: scenarioWorld.knowledgeObjects,
    calls: scenarioWorld.calls,
    emails: scenarioWorld.emails,
    meetings: scenarioWorld.meetings,
    meetingTranscripts: scenarioWorld.meetingTranscripts,
    crmActivities: scenarioWorld.crmActivities,
    salesAppointmentBookedEvents: scenarioWorld.salesAppointmentBookedEvents,
    salesAppointmentHeldEvents: scenarioWorld.salesAppointmentHeldEvents,
    metaAdSpendRecords: scenarioWorld.metaAdSpendRecords,
    metaLeadGeneratedEvents: scenarioWorld.metaLeadGeneratedEvents,
    marketingCrmLeadIngestedEvents: scenarioWorld.marketingCrmLeadIngestedEvents,
    marketingLeadIdentityMatchedEvents: scenarioWorld.marketingLeadIdentityMatchedEvents,
  };
  const snapshot = generateWorldSnapshot(snapshotSource, asOf);

  const opportunities = snapshot.opportunities.map((o) => o.opportunity);

  const employees: ReferenceCompanyExportEmployee[] = snapshot.employees
    .map((e) => ({
      id: e.id,
      departmentId: e.departmentId,
      roleId: e.roleId,
      managerId: e.managerId,
      hiredAt: e.hiredAt,
      terminatedAt: e.terminatedAt,
      activeAsOf: e.hiredAt <= asOf && (e.terminatedAt === undefined || e.terminatedAt > asOf),
    }))
    .sort(byId);

  const acquisitionLifecycle = generateCustomerAcquisitionLifecycle(opportunities, asOf);

  // As-of-sichere Appointment-Projektion — siehe Kopfkommentar. Ruft
  // ausschließlich die bereits bestehende, kanonische Ableitung
  // appointmentStatusAt auf; keine eigene Statuslogik.
  const appointments: ReferenceCompanyExportAppointment[] = [];
  for (const appointment of scenarioWorld.salesAppointments) {
    const stateAt = appointmentStatusAt(appointment, asOf);
    if (stateAt === undefined) continue;
    appointments.push({
      id: appointment.id,
      appointmentType: appointment.appointmentType,
      leadId: appointment.leadId,
      contactId: appointment.contactId,
      accountId: appointment.accountId,
      opportunityId: appointment.opportunityId,
      bookingSeriesId: appointment.bookingSeriesId,
      rebookedFromAppointmentId: appointment.rebookedFromAppointmentId,
      assignedEmployeeId: appointment.assignedEmployeeId,
      bookedByEmployeeId: appointment.bookedByEmployeeId,
      bookedAt: appointment.bookedAt,
      scheduledForAsOf: stateAt.scheduledFor,
      statusAsOf: stateAt.status,
      heldAt: stateAt.status === "held" ? appointment.heldAt : undefined,
    });
  }
  appointments.sort(byId);

  const result: ReferenceCompanyExportSnapshot = {
    asOf,
    worldSeed,
    profileId: profile.id,
    company: { ...COMPANY },
    roles: cloneArray(ROLES).sort(byId),
    departments: cloneArray(DEPARTMENTS).sort(byId),
    employees,
    marketingCampaigns: cloneArray(MARKETING_CAMPAIGNS).sort(byId),
    metaAdSpendRecords: cloneArray(snapshot.metaAdSpendRecords).sort(byId),
    metaLeadGeneratedEvents: cloneArray(snapshot.metaLeadGeneratedEvents).sort(byId),
    marketingCrmLeadIngestedEvents: cloneArray(snapshot.marketingCrmLeadIngestedEvents).sort(byId),
    marketingLeadIdentityMatchedEvents: cloneArray(snapshot.marketingLeadIdentityMatchedEvents).sort(byId),
    leads: cloneArray(snapshot.leads).sort(byId),
    customerAccounts: cloneArray(snapshot.customerAccounts).sort(byId),
    appointments,
    opportunities: cloneArray(opportunities).sort(byId),
    customerAcquiredEvents: cloneArray(acquisitionLifecycle.customerAcquiredEvents).sort(byId),
    customerRelationships: cloneArray(acquisitionLifecycle.customerRelationships).sort(byId),
    wonOpportunityClassifications: cloneArray(acquisitionLifecycle.wonOpportunityClassifications).sort((a, b) =>
      a.opportunityId.localeCompare(b.opportunityId),
    ),
    deliveryUnits: cloneArray(snapshot.deliveryUnits).sort(byId),
  };

  return deepFreeze(result);
}
