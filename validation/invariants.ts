import type { Employee } from "../world/employees";
import type { CustomerAccount } from "../world/customer-accounts";
import type { Contact } from "../world/contacts";
import type { AccountOwnership } from "../world/account-ownership";
import type { Department } from "../world/departments";
import type { Role } from "../world/roles";
import type { Lead } from "../events/leads";
import type { Opportunity } from "../events/opportunities";
import type { OpportunityStageHistory } from "../events/opportunity-stage-history";
import type { InteractionBase } from "../events/interaction-base";
import type { Call } from "../events/calls";
import type { Email } from "../events/emails";
import type { Meeting } from "../events/meetings";
import type { MeetingTranscript } from "../events/meeting-transcripts";
import type { CrmActivity } from "../events/crm-activities";
import type { KnowledgeObject } from "../world/knowledge-objects";
import type { Observation } from "../observations/observations";
import type { GroundTruthSnapshot } from "../ground-truth/ground-truth";
import { WORLD_NOW } from "../timeline/world-clock";

// Reine, generische Invarianten-Prüffunktionen (validation/, Teil der eingefrorenen
// Architektur). Jede Funktion gibt eine Liste menschenlesbarer Verletzungen zurück —
// leeres Array = gültig. Keine neue Architektur, nur die erste Befüllung des bereits
// vorgesehenen Ordners.

export function checkEmployeeDepartmentReferences(
  employees: readonly Employee[],
  departments: readonly Department[],
): string[] {
  const departmentIds = new Set(departments.map((d) => d.id));
  return employees
    .filter((e) => !departmentIds.has(e.departmentId))
    .map((e) => `Employee ${e.id}: unbekannte departmentId "${e.departmentId}"`);
}

export function checkEmployeeRoleReferences(
  employees: readonly Employee[],
  roles: readonly Role[],
): string[] {
  const roleIds = new Set(roles.map((r) => r.id));
  return employees
    .filter((e) => !roleIds.has(e.roleId))
    .map((e) => `Employee ${e.id}: unbekannte roleId "${e.roleId}"`);
}

export function checkEmployeeManagerReferences(employees: readonly Employee[]): string[] {
  const employeeIds = new Set(employees.map((e) => e.id));
  return employees
    .filter((e) => e.managerId !== undefined && !employeeIds.has(e.managerId))
    .map((e) => `Employee ${e.id}: unbekannte managerId "${e.managerId}"`);
}

export function checkNoManagerCycles(employees: readonly Employee[]): string[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];

  for (const employee of employees) {
    const visited = new Set<string>([employee.id]);
    let current = employee.managerId;
    while (current !== undefined) {
      if (visited.has(current)) {
        violations.push(`Employee ${employee.id}: Manager-Zyklus über "${current}"`);
        break;
      }
      visited.add(current);
      current = byId.get(current)?.managerId;
    }
  }
  return violations;
}

export function checkEmployeeValidityIntervals(employees: readonly Employee[]): string[] {
  const violations: string[] = [];
  for (const employee of employees) {
    if (Number.isNaN(Date.parse(employee.hiredAt))) {
      violations.push(`Employee ${employee.id}: hiredAt "${employee.hiredAt}" ist kein gültiges Datum`);
      continue;
    }
    if (employee.terminatedAt !== undefined) {
      if (Number.isNaN(Date.parse(employee.terminatedAt))) {
        violations.push(
          `Employee ${employee.id}: terminatedAt "${employee.terminatedAt}" ist kein gültiges Datum`,
        );
      } else if (employee.terminatedAt <= employee.hiredAt) {
        violations.push(`Employee ${employee.id}: terminatedAt liegt nicht nach hiredAt`);
      }
    }
  }
  return violations;
}

export function checkContactAccountReferences(
  contacts: readonly Contact[],
  accounts: readonly CustomerAccount[],
): string[] {
  const accountIds = new Set(accounts.map((a) => a.id));
  return contacts
    .filter((c) => !accountIds.has(c.accountId))
    .map((c) => `Contact ${c.id}: unbekannte accountId "${c.accountId}"`);
}

export function checkContactCreatedAfterAccount(
  contacts: readonly Contact[],
  accounts: readonly CustomerAccount[],
): string[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const violations: string[] = [];
  for (const contact of contacts) {
    const account = accountById.get(contact.accountId);
    if (account && contact.createdAt < account.createdAt) {
      violations.push(
        `Contact ${contact.id}: createdAt (${contact.createdAt}) liegt vor Account.createdAt (${account.createdAt})`,
      );
    }
  }
  return violations;
}

export function checkOwnershipAccountReferences(
  ownerships: readonly AccountOwnership[],
  accounts: readonly CustomerAccount[],
): string[] {
  const accountIds = new Set(accounts.map((a) => a.id));
  return ownerships
    .filter((o) => !accountIds.has(o.accountId))
    .map((o) => `AccountOwnership ${o.id}: unbekannte accountId "${o.accountId}"`);
}

export function checkOwnershipEmployeeReferences(
  ownerships: readonly AccountOwnership[],
  employees: readonly Employee[],
): string[] {
  const employeeIds = new Set(employees.map((e) => e.id));
  return ownerships
    .filter((o) => !employeeIds.has(o.employeeId))
    .map((o) => `AccountOwnership ${o.id}: unbekannte employeeId "${o.employeeId}"`);
}

// Der zugewiesene Employee muss während des gesamten Ownership-Intervalls gültig
// sein: validFrom darf nicht vor hiredAt liegen; ist der Employee ausgeschieden, muss
// das Intervall spätestens mit terminatedAt enden (keine offene Zuordnung über das
// Austrittsdatum hinaus).
export function checkOwnershipEmployeeValidity(
  ownerships: readonly AccountOwnership[],
  employees: readonly Employee[],
): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];
  for (const ownership of ownerships) {
    const employee = employeeById.get(ownership.employeeId);
    if (!employee) {
      continue;
    }
    if (ownership.validFrom < employee.hiredAt) {
      violations.push(
        `AccountOwnership ${ownership.id}: validFrom (${ownership.validFrom}) liegt vor hiredAt (${employee.hiredAt}) von ${employee.id}`,
      );
    }
    if (employee.terminatedAt !== undefined) {
      if (ownership.validTo === undefined) {
        violations.push(
          `AccountOwnership ${ownership.id}: offenes Intervall für ausgeschiedenen Employee ${employee.id} (terminatedAt ${employee.terminatedAt})`,
        );
      } else if (ownership.validTo > employee.terminatedAt) {
        violations.push(
          `AccountOwnership ${ownership.id}: validTo (${ownership.validTo}) liegt nach terminatedAt (${employee.terminatedAt}) von ${employee.id}`,
        );
      }
    }
  }
  return violations;
}

// Für dasselbe (accountId, ownershipRole) dürfen sich Gültigkeitsintervalle nie
// überlappen (frozen invariant).
export function checkOwnershipNoOverlap(ownerships: readonly AccountOwnership[]): string[] {
  const groups = new Map<string, AccountOwnership[]>();
  for (const ownership of ownerships) {
    const key = `${ownership.accountId}::${ownership.ownershipRole}`;
    const group = groups.get(key) ?? [];
    group.push(ownership);
    groups.set(key, group);
  }

  const violations: string[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1));
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]!;
      const next = sorted[i + 1]!;
      if (current.validTo === undefined) {
        violations.push(
          `Ownership-Gruppe ${key}: offenes Intervall (${current.id}) wird von weiterem Eintrag (${next.id}) gefolgt`,
        );
      } else if (current.validTo >= next.validFrom) {
        violations.push(
          `Ownership-Gruppe ${key}: Überlappung zwischen ${current.id} (bis ${current.validTo}) und ${next.id} (ab ${next.validFrom})`,
        );
      }
    }
  }
  return violations;
}

function isEmployeeValidAt(employee: Employee, isoDate: string): boolean {
  return employee.hiredAt <= isoDate && (employee.terminatedAt === undefined || isoDate <= employee.terminatedAt);
}

// --- Lead ---------------------------------------------------------------

export function checkLeadAccountReferences(
  leads: readonly Lead[],
  accounts: readonly CustomerAccount[],
): string[] {
  const accountIds = new Set(accounts.map((a) => a.id));
  return leads
    .filter((l) => !accountIds.has(l.accountId))
    .map((l) => `Lead ${l.id}: unbekannte accountId "${l.accountId}"`);
}

export function checkLeadContactBelongsToAccount(
  leads: readonly Lead[],
  contacts: readonly Contact[],
): string[] {
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const violations: string[] = [];
  for (const lead of leads) {
    const contact = contactById.get(lead.contactId);
    if (!contact) {
      violations.push(`Lead ${lead.id}: unbekannte contactId "${lead.contactId}"`);
    } else if (contact.accountId !== lead.accountId) {
      violations.push(`Lead ${lead.id}: Contact ${contact.id} gehört zu Account ${contact.accountId}, nicht zu ${lead.accountId}`);
    }
  }
  return violations;
}

export function checkLeadCreatedAfterAccountAndContact(
  leads: readonly Lead[],
  accounts: readonly CustomerAccount[],
  contacts: readonly Contact[],
): string[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const violations: string[] = [];
  for (const lead of leads) {
    const account = accountById.get(lead.accountId);
    const contact = contactById.get(lead.contactId);
    if (account && lead.createdAt < account.createdAt) {
      violations.push(`Lead ${lead.id}: createdAt (${lead.createdAt}) liegt vor Account.createdAt (${account.createdAt})`);
    }
    if (contact && lead.createdAt < contact.createdAt) {
      violations.push(`Lead ${lead.id}: createdAt (${lead.createdAt}) liegt vor Contact.createdAt (${contact.createdAt})`);
    }
  }
  return violations;
}

export function checkLeadOwnerValidAtCreation(
  leads: readonly Lead[],
  employees: readonly Employee[],
): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];
  for (const lead of leads) {
    const owner = employeeById.get(lead.ownerEmployeeId);
    if (!owner) {
      violations.push(`Lead ${lead.id}: unbekannte ownerEmployeeId "${lead.ownerEmployeeId}"`);
    } else if (!isEmployeeValidAt(owner, lead.createdAt)) {
      violations.push(`Lead ${lead.id}: Owner ${owner.id} ist zum Zeitpunkt ${lead.createdAt} nicht gültig`);
    }
  }
  return violations;
}

export function checkLeadLastContactedAfterCreated(leads: readonly Lead[]): string[] {
  return leads
    .filter((l) => l.lastContactedAt !== undefined && l.lastContactedAt < l.createdAt)
    .map((l) => `Lead ${l.id}: lastContactedAt (${l.lastContactedAt}) liegt vor createdAt (${l.createdAt})`);
}

export function checkLostLeadHasNoOpportunityLink(leads: readonly Lead[]): string[] {
  return leads
    .filter((l) => l.status === "verloren" && l.convertedToOpportunityId !== undefined)
    .map((l) => `Lead ${l.id}: status "verloren" aber convertedToOpportunityId gesetzt`);
}

export function checkConvertedLeadHasExactlyOneOpportunity(
  leads: readonly Lead[],
  opportunities: readonly Opportunity[],
): string[] {
  const opportunitiesByLeadId = new Map<string, Opportunity[]>();
  for (const opportunity of opportunities) {
    const list = opportunitiesByLeadId.get(opportunity.leadId) ?? [];
    list.push(opportunity);
    opportunitiesByLeadId.set(opportunity.leadId, list);
  }

  const violations: string[] = [];
  for (const lead of leads) {
    const linkedOpportunities = opportunitiesByLeadId.get(lead.id) ?? [];
    if (lead.status === "konvertiert") {
      if (lead.convertedToOpportunityId === undefined) {
        violations.push(`Lead ${lead.id}: status "konvertiert" aber convertedToOpportunityId fehlt`);
      }
      if (linkedOpportunities.length !== 1) {
        violations.push(`Lead ${lead.id}: erwartet genau 1 Opportunity, gefunden ${linkedOpportunities.length}`);
      } else if (linkedOpportunities[0]!.id !== lead.convertedToOpportunityId) {
        violations.push(`Lead ${lead.id}: convertedToOpportunityId zeigt nicht auf die zurückverlinkte Opportunity`);
      }
    } else if (linkedOpportunities.length > 0) {
      violations.push(`Lead ${lead.id}: status "${lead.status}" besitzt dennoch ${linkedOpportunities.length} Opportunity/Opportunities`);
    }
  }
  return violations;
}

// --- Opportunity ----------------------------------------------------------

export function checkOpportunityLeadReferences(
  opportunities: readonly Opportunity[],
  leads: readonly Lead[],
): string[] {
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const violations: string[] = [];
  for (const opportunity of opportunities) {
    const lead = leadById.get(opportunity.leadId);
    if (!lead) {
      violations.push(`Opportunity ${opportunity.id}: unbekannte leadId "${opportunity.leadId}"`);
    } else if (lead.accountId !== opportunity.accountId) {
      violations.push(`Opportunity ${opportunity.id}: accountId weicht von Lead.accountId ab`);
    } else if (opportunity.createdAt < lead.createdAt) {
      violations.push(`Opportunity ${opportunity.id}: createdAt (${opportunity.createdAt}) liegt vor Lead.createdAt (${lead.createdAt})`);
    }
  }
  return violations;
}

export function checkOpportunityNoDuplicateLeads(opportunities: readonly Opportunity[]): string[] {
  const seen = new Map<string, string>();
  const violations: string[] = [];
  for (const opportunity of opportunities) {
    const existing = seen.get(opportunity.leadId);
    if (existing) {
      violations.push(`Lead ${opportunity.leadId}: erzeugt mehrere Opportunities (${existing}, ${opportunity.id})`);
    } else {
      seen.set(opportunity.leadId, opportunity.id);
    }
  }
  return violations;
}

export function checkOpportunityResponsibleEmployeeValid(
  opportunities: readonly Opportunity[],
  employees: readonly Employee[],
): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];
  for (const opportunity of opportunities) {
    const employee = employeeById.get(opportunity.responsibleEmployeeId);
    if (!employee) {
      violations.push(`Opportunity ${opportunity.id}: unbekannte responsibleEmployeeId "${opportunity.responsibleEmployeeId}"`);
    } else if (!isEmployeeValidAt(employee, opportunity.createdAt)) {
      violations.push(`Opportunity ${opportunity.id}: responsibleEmployeeId ${employee.id} zum Zeitpunkt createdAt nicht gültig`);
    }
  }
  return violations;
}

export function checkOpportunityValueAndProbability(opportunities: readonly Opportunity[]): string[] {
  const violations: string[] = [];
  for (const opportunity of opportunities) {
    if (!(opportunity.value > 0)) {
      violations.push(`Opportunity ${opportunity.id}: value (${opportunity.value}) ist nicht > 0`);
    }
    if (opportunity.probability < 0 || opportunity.probability > 100) {
      violations.push(`Opportunity ${opportunity.id}: probability (${opportunity.probability}) außerhalb [0, 100]`);
    }
  }
  return violations;
}

export function checkOpportunityClosedAtConsistency(opportunities: readonly Opportunity[]): string[] {
  const violations: string[] = [];
  for (const opportunity of opportunities) {
    const isClosed = opportunity.currentStage === "gewonnen" || opportunity.currentStage === "verloren";
    if (isClosed && opportunity.closedAt === undefined) {
      violations.push(`Opportunity ${opportunity.id}: Stage "${opportunity.currentStage}" aber closedAt fehlt`);
    }
    if (!isClosed && opportunity.closedAt !== undefined) {
      violations.push(`Opportunity ${opportunity.id}: closedAt gesetzt trotz offener Stage "${opportunity.currentStage}"`);
    }
    if (opportunity.currentStage === "verloren" && !opportunity.lostReason) {
      violations.push(`Opportunity ${opportunity.id}: Stage "verloren" ohne lostReason`);
    }
    if (opportunity.currentStage !== "verloren" && opportunity.lostReason !== undefined) {
      violations.push(`Opportunity ${opportunity.id}: lostReason gesetzt trotz Stage "${opportunity.currentStage}"`);
    }
  }
  return violations;
}

// --- OpportunityStageHistory ----------------------------------------------

export function checkStageHistoryExistsForEveryOpportunity(
  opportunities: readonly Opportunity[],
  stageHistory: readonly OpportunityStageHistory[],
): string[] {
  const countByOpportunity = new Map<string, number>();
  for (const entry of stageHistory) {
    countByOpportunity.set(entry.opportunityId, (countByOpportunity.get(entry.opportunityId) ?? 0) + 1);
  }
  return opportunities
    .filter((o) => (countByOpportunity.get(o.id) ?? 0) === 0)
    .map((o) => `Opportunity ${o.id}: keine Stage-History-Einträge`);
}

// Prüft Lückenlosigkeit, Überlappungsfreiheit, korrekten Start/Ende und dass der
// offene Eintrag exakt currentStage entspricht (frozen invariant).
export function checkStageHistoryContiguity(
  opportunities: readonly Opportunity[],
  stageHistory: readonly OpportunityStageHistory[],
): string[] {
  const entriesByOpportunity = new Map<string, OpportunityStageHistory[]>();
  for (const entry of stageHistory) {
    const list = entriesByOpportunity.get(entry.opportunityId) ?? [];
    list.push(entry);
    entriesByOpportunity.set(entry.opportunityId, list);
  }

  const violations: string[] = [];
  for (const opportunity of opportunities) {
    const entries = [...(entriesByOpportunity.get(opportunity.id) ?? [])].sort((a, b) =>
      a.enteredAt < b.enteredAt ? -1 : 1,
    );
    if (entries.length === 0) {
      continue;
    }

    const first = entries[0]!;
    if (first.enteredAt !== opportunity.createdAt) {
      violations.push(
        `Opportunity ${opportunity.id}: erster Stage-Eintrag beginnt bei ${first.enteredAt}, nicht bei createdAt (${opportunity.createdAt})`,
      );
    }

    for (let i = 0; i < entries.length - 1; i++) {
      const current = entries[i]!;
      const next = entries[i + 1]!;
      if (current.exitedAt === undefined) {
        violations.push(`Opportunity ${opportunity.id}: Eintrag ${current.id} hat kein exitedAt, ist aber nicht der letzte Eintrag`);
      } else if (current.exitedAt !== next.enteredAt) {
        violations.push(
          `Opportunity ${opportunity.id}: Lücke/Überlappung zwischen ${current.id} (exitedAt ${current.exitedAt}) und ${next.id} (enteredAt ${next.enteredAt})`,
        );
      }
    }

    const last = entries[entries.length - 1]!;
    if (last.exitedAt !== undefined) {
      violations.push(`Opportunity ${opportunity.id}: letzter Eintrag ${last.id} hat ein exitedAt, ist also nicht offen`);
    }
    if (last.stage !== opportunity.currentStage) {
      violations.push(`Opportunity ${opportunity.id}: letzter Stage-Eintrag (${last.stage}) entspricht nicht currentStage (${opportunity.currentStage})`);
    }
    if (opportunity.closedAt !== undefined && last.enteredAt !== opportunity.closedAt) {
      violations.push(`Opportunity ${opportunity.id}: letzter Eintrag beginnt nicht bei closedAt (${opportunity.closedAt})`);
    }
  }
  return violations;
}

export function checkStageHistoryResponsibleEmployeeValidity(
  stageHistory: readonly OpportunityStageHistory[],
  employees: readonly Employee[],
): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];
  for (const entry of stageHistory) {
    const employee = employeeById.get(entry.responsibleEmployeeId);
    if (!employee) {
      violations.push(`OpportunityStageHistory ${entry.id}: unbekannte responsibleEmployeeId "${entry.responsibleEmployeeId}"`);
      continue;
    }
    if (!isEmployeeValidAt(employee, entry.enteredAt)) {
      violations.push(`OpportunityStageHistory ${entry.id}: ${employee.id} zum Zeitpunkt enteredAt nicht gültig`);
    }
    if (entry.exitedAt !== undefined && !isEmployeeValidAt(employee, entry.exitedAt)) {
      violations.push(`OpportunityStageHistory ${entry.id}: ${employee.id} zum Zeitpunkt exitedAt nicht gültig`);
    }
  }
  return violations;
}

// --- Timeline ---------------------------------------------------------------

// Keine dynamische Entität darf nach WORLD_NOW entstehen (frozen invariant).
export function checkAllDynamicDatesWithinWorldNow(
  leads: readonly Lead[],
  opportunities: readonly Opportunity[],
  stageHistory: readonly OpportunityStageHistory[],
): string[] {
  const violations: string[] = [];
  for (const lead of leads) {
    if (lead.createdAt > WORLD_NOW) {
      violations.push(`Lead ${lead.id}: createdAt (${lead.createdAt}) liegt nach WORLD_NOW (${WORLD_NOW})`);
    }
    if (lead.lastContactedAt !== undefined && lead.lastContactedAt > WORLD_NOW) {
      violations.push(`Lead ${lead.id}: lastContactedAt (${lead.lastContactedAt}) liegt nach WORLD_NOW (${WORLD_NOW})`);
    }
  }
  for (const opportunity of opportunities) {
    if (opportunity.createdAt > WORLD_NOW) {
      violations.push(`Opportunity ${opportunity.id}: createdAt (${opportunity.createdAt}) liegt nach WORLD_NOW (${WORLD_NOW})`);
    }
    if (opportunity.closedAt !== undefined && opportunity.closedAt > WORLD_NOW) {
      violations.push(`Opportunity ${opportunity.id}: closedAt (${opportunity.closedAt}) liegt nach WORLD_NOW (${WORLD_NOW})`);
    }
  }
  for (const entry of stageHistory) {
    if (entry.enteredAt > WORLD_NOW) {
      violations.push(`OpportunityStageHistory ${entry.id}: enteredAt (${entry.enteredAt}) liegt nach WORLD_NOW (${WORLD_NOW})`);
    }
    if (entry.exitedAt !== undefined && entry.exitedAt > WORLD_NOW) {
      violations.push(`OpportunityStageHistory ${entry.id}: exitedAt (${entry.exitedAt}) liegt nach WORLD_NOW (${WORLD_NOW})`);
    }
  }
  return violations;
}

// --- InteractionBase (gemeinsam für Call/Email/Meeting) --------------------

export function checkInteractionEmployeeValid(
  interactions: readonly InteractionBase[],
  employees: readonly Employee[],
  label: string,
): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];
  for (const interaction of interactions) {
    const employee = employeeById.get(interaction.employeeId);
    if (!employee) {
      violations.push(`${label} ${interaction.id}: unbekannte employeeId "${interaction.employeeId}"`);
    } else if (!isEmployeeValidAt(employee, interaction.timestamp)) {
      violations.push(`${label} ${interaction.id}: Employee ${employee.id} zum Zeitpunkt timestamp nicht gültig`);
    }
  }
  return violations;
}

export function checkInteractionReferences(
  interactions: readonly InteractionBase[],
  accounts: readonly CustomerAccount[],
  contacts: readonly Contact[],
  leads: readonly Lead[],
  opportunities: readonly Opportunity[],
  label: string,
): string[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const opportunityById = new Map(opportunities.map((o) => [o.id, o]));
  const violations: string[] = [];

  for (const interaction of interactions) {
    if (interaction.accountId !== undefined && !accountById.has(interaction.accountId)) {
      violations.push(`${label} ${interaction.id}: unbekannte accountId "${interaction.accountId}"`);
    }
    const contact = interaction.contactId !== undefined ? contactById.get(interaction.contactId) : undefined;
    if (interaction.contactId !== undefined) {
      if (!contact) {
        violations.push(`${label} ${interaction.id}: unbekannte contactId "${interaction.contactId}"`);
      } else if (interaction.accountId !== undefined && contact.accountId !== interaction.accountId) {
        violations.push(`${label} ${interaction.id}: Contact ${contact.id} gehört nicht zu accountId "${interaction.accountId}"`);
      }
    }
    const lead = interaction.leadId !== undefined ? leadById.get(interaction.leadId) : undefined;
    if (interaction.leadId !== undefined) {
      if (!lead) {
        violations.push(`${label} ${interaction.id}: unbekannte leadId "${interaction.leadId}"`);
      } else if (interaction.accountId !== undefined && lead.accountId !== interaction.accountId) {
        violations.push(`${label} ${interaction.id}: Lead ${lead.id} gehört nicht zu accountId "${interaction.accountId}"`);
      }
    }
    const opportunity = interaction.opportunityId !== undefined ? opportunityById.get(interaction.opportunityId) : undefined;
    if (interaction.opportunityId !== undefined) {
      if (!opportunity) {
        violations.push(`${label} ${interaction.id}: unbekannte opportunityId "${interaction.opportunityId}"`);
      } else if (interaction.accountId !== undefined && opportunity.accountId !== interaction.accountId) {
        violations.push(`${label} ${interaction.id}: Opportunity ${opportunity.id} gehört nicht zu accountId "${interaction.accountId}"`);
      }
    }
  }
  return violations;
}

// direction="intern" OHNE Kundenbezug, ODER mindestens eines von
// contactId/leadId/opportunityId gesetzt (frozen invariant).
export function checkInteractionAssignment(interactions: readonly InteractionBase[], label: string): string[] {
  const violations: string[] = [];
  for (const interaction of interactions) {
    const hasCustomerRef =
      interaction.contactId !== undefined || interaction.leadId !== undefined || interaction.opportunityId !== undefined;
    if (interaction.direction !== "intern" && !hasCustomerRef) {
      violations.push(`${label} ${interaction.id}: externe Interaction ohne Kunden-/Lead-/Opportunity-Bezug`);
    }
  }
  return violations;
}

// --- Call --------------------------------------------------------------

export function checkCallDuration(calls: readonly Call[]): string[] {
  return calls.filter((c) => !(c.durationMinutes > 0)).map((c) => `Call ${c.id}: durationMinutes (${c.durationMinutes}) ist nicht > 0`);
}

// Keine aktiven Calls nach Opportunity.closedAt, außer dem Abschluss-Call selbst
// (timestamp === closedAt).
export function checkCallTimingWithinOpportunity(
  calls: readonly Call[],
  opportunities: readonly Opportunity[],
): string[] {
  const opportunityById = new Map(opportunities.map((o) => [o.id, o]));
  const violations: string[] = [];
  for (const call of calls) {
    if (call.opportunityId === undefined) continue;
    const opportunity = opportunityById.get(call.opportunityId);
    if (!opportunity) continue;
    if (call.timestamp < opportunity.createdAt) {
      violations.push(`Call ${call.id}: timestamp (${call.timestamp}) liegt vor Opportunity.createdAt (${opportunity.createdAt})`);
    }
    if (opportunity.closedAt !== undefined && call.timestamp > opportunity.closedAt) {
      violations.push(`Call ${call.id}: timestamp (${call.timestamp}) liegt nach Opportunity.closedAt (${opportunity.closedAt})`);
    }
  }
  return violations;
}

// --- Email ---------------------------------------------------------------

export function checkEmailContentNotEmpty(emails: readonly Email[]): string[] {
  const violations: string[] = [];
  for (const email of emails) {
    if (!email.subject.trim()) violations.push(`Email ${email.id}: subject ist leer`);
    if (!email.bodySummary.trim()) violations.push(`Email ${email.id}: bodySummary ist leer`);
  }
  return violations;
}

export function checkEmailParticipantsValid(emails: readonly Email[], employees: readonly Employee[]): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];
  for (const email of emails) {
    for (const participantId of email.participantEmployeeIds ?? []) {
      const participant = employeeById.get(participantId);
      if (!participant) {
        violations.push(`Email ${email.id}: unbekannte participantEmployeeId "${participantId}"`);
      } else if (!isEmployeeValidAt(participant, email.timestamp)) {
        violations.push(`Email ${email.id}: Teilnehmer ${participant.id} zum Zeitpunkt timestamp nicht gültig`);
      }
    }
  }
  return violations;
}

// --- Meeting -------------------------------------------------------------

export function checkMeetingDuration(meetings: readonly Meeting[]): string[] {
  return meetings
    .filter((m) => !(m.durationMinutes > 0))
    .map((m) => `Meeting ${m.id}: durationMinutes (${m.durationMinutes}) ist nicht > 0`);
}

const INTERNAL_MEETING_TYPES = new Set(["internes-teammeeting", "coaching", "pipeline-review"]);

export function checkInternalMeetingsHaveParticipants(meetings: readonly Meeting[]): string[] {
  return meetings
    .filter((m) => INTERNAL_MEETING_TYPES.has(m.meetingType) && (!m.participantEmployeeIds || m.participantEmployeeIds.length === 0))
    .map((m) => `Meeting ${m.id}: interner Meeting-Typ "${m.meetingType}" ohne participantEmployeeIds`);
}

export function checkMeetingParticipantsValid(meetings: readonly Meeting[], employees: readonly Employee[]): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];
  for (const meeting of meetings) {
    for (const participantId of meeting.participantEmployeeIds ?? []) {
      const participant = employeeById.get(participantId);
      if (!participant) {
        violations.push(`Meeting ${meeting.id}: unbekannte participantEmployeeId "${participantId}"`);
      } else if (!isEmployeeValidAt(participant, meeting.timestamp)) {
        violations.push(`Meeting ${meeting.id}: Teilnehmer ${participant.id} zum Zeitpunkt timestamp nicht gültig`);
      }
    }
  }
  return violations;
}

export function checkKundenterminHasCustomerReference(meetings: readonly Meeting[]): string[] {
  return meetings
    .filter(
      (m) =>
        m.meetingType === "kundentermin" &&
        m.contactId === undefined &&
        m.leadId === undefined &&
        m.opportunityId === undefined,
    )
    .map((m) => `Meeting ${m.id}: meetingType "kundentermin" ohne Kundenbezug`);
}

// --- MeetingTranscript -----------------------------------------------------

export function checkTranscriptMeetingReferences(
  transcripts: readonly MeetingTranscript[],
  meetings: readonly Meeting[],
): string[] {
  const meetingIds = new Set(meetings.map((m) => m.id));
  return transcripts
    .filter((t) => !meetingIds.has(t.meetingId))
    .map((t) => `MeetingTranscript ${t.id}: unbekannte meetingId "${t.meetingId}"`);
}

export function checkTranscriptUniquePerMeeting(transcripts: readonly MeetingTranscript[]): string[] {
  const seen = new Map<string, string>();
  const violations: string[] = [];
  for (const transcript of transcripts) {
    const existing = seen.get(transcript.meetingId);
    if (existing) {
      violations.push(`Meeting ${transcript.meetingId}: mehrere Transcripts (${existing}, ${transcript.id})`);
    } else {
      seen.set(transcript.meetingId, transcript.id);
    }
  }
  return violations;
}

// --- CrmActivity -----------------------------------------------------------

export function checkCrmActivityExactlyOneReference(activities: readonly CrmActivity[]): string[] {
  return activities
    .filter((a) => (a.leadId !== undefined) === (a.opportunityId !== undefined))
    .map((a) => `CrmActivity ${a.id}: erwartet genau eines von leadId/opportunityId, gefunden leadId=${a.leadId ?? "–"} opportunityId=${a.opportunityId ?? "–"}`);
}

export function checkCrmActivityEmployeeValid(activities: readonly CrmActivity[], employees: readonly Employee[]): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];
  for (const activity of activities) {
    const employee = employeeById.get(activity.employeeId);
    if (!employee) {
      violations.push(`CrmActivity ${activity.id}: unbekannte employeeId "${activity.employeeId}"`);
    } else if (!isEmployeeValidAt(employee, activity.timestamp)) {
      violations.push(`CrmActivity ${activity.id}: Employee ${employee.id} zum Zeitpunkt timestamp nicht gültig`);
    }
  }
  return violations;
}

export function checkCrmActivityTimingWithinEntity(
  activities: readonly CrmActivity[],
  leads: readonly Lead[],
  opportunities: readonly Opportunity[],
): string[] {
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const opportunityById = new Map(opportunities.map((o) => [o.id, o]));
  const violations: string[] = [];
  for (const activity of activities) {
    if (activity.leadId !== undefined) {
      const lead = leadById.get(activity.leadId);
      if (!lead) {
        violations.push(`CrmActivity ${activity.id}: unbekannte leadId "${activity.leadId}"`);
      } else if (activity.timestamp < lead.createdAt) {
        violations.push(`CrmActivity ${activity.id}: timestamp liegt vor Lead.createdAt`);
      }
    }
    if (activity.opportunityId !== undefined) {
      const opportunity = opportunityById.get(activity.opportunityId);
      if (!opportunity) {
        violations.push(`CrmActivity ${activity.id}: unbekannte opportunityId "${activity.opportunityId}"`);
      } else {
        if (activity.timestamp < opportunity.createdAt) {
          violations.push(`CrmActivity ${activity.id}: timestamp liegt vor Opportunity.createdAt`);
        }
        if (opportunity.closedAt !== undefined && activity.timestamp > opportunity.closedAt) {
          violations.push(`CrmActivity ${activity.id}: timestamp liegt nach Opportunity.closedAt`);
        }
      }
    }
  }
  return violations;
}

// --- Timeline (Interactions) ------------------------------------------------

export function checkInteractionsWithinWorldNow(interactions: readonly InteractionBase[], label: string): string[] {
  return interactions
    .filter((i) => i.timestamp > WORLD_NOW)
    .map((i) => `${label} ${i.id}: timestamp (${i.timestamp}) liegt nach WORLD_NOW (${WORLD_NOW})`);
}

// Cross-Source-Konsistenz (Schritt-4-Auftrag §7): sobald ein Lead konvertiert ist,
// darf keine Lead-seitige Interaction mehr NACH dem tatsächlichen Konversions­
// zeitpunkt (Opportunity.createdAt) liegen — sonst widerspricht die Lead-Historie
// der Opportunity-Historie. Ausnahme: genau am Konversionstag selbst ist erlaubt
// (die SDR→AE-Übergabe-Mail entsteht im selben Moment wie die Konversion).
export function checkLeadInteractionsBeforeConversion(
  leadTaggedInteractions: readonly { id: string; leadId?: string; timestamp: string }[],
  leads: readonly Lead[],
  opportunities: readonly Opportunity[],
  label: string,
): string[] {
  const opportunityByLeadId = new Map(opportunities.map((o) => [o.leadId, o]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const violations: string[] = [];
  for (const interaction of leadTaggedInteractions) {
    if (interaction.leadId === undefined) continue;
    const lead = leadById.get(interaction.leadId);
    if (!lead || lead.status !== "konvertiert") continue;
    const opportunity = opportunityByLeadId.get(lead.id);
    if (!opportunity) continue;
    if (interaction.timestamp > opportunity.createdAt) {
      violations.push(
        `${label} ${interaction.id}: timestamp (${interaction.timestamp}) liegt nach Opportunity.createdAt (${opportunity.createdAt}) des konvertierten Lead ${lead.id}`,
      );
    }
  }
  return violations;
}

// --- KnowledgeObject ---------------------------------------------------------

const KNOWLEDGE_OBJECT_TYPES = new Set([
  "angebotsdokument",
  "gespraechsleitfaden",
  "preisliste",
  "sop",
  "interne-dokumentation",
  "produktblatt",
]);

export function checkKnowledgeObjectIdsUnique(objects: readonly KnowledgeObject[]): string[] {
  const seen = new Set<string>();
  const violations: string[] = [];
  for (const obj of objects) {
    if (seen.has(obj.id)) {
      violations.push(`KnowledgeObject ${obj.id}: doppelte ID`);
    }
    seen.add(obj.id);
  }
  return violations;
}

export function checkKnowledgeObjectContentNotEmpty(objects: readonly KnowledgeObject[]): string[] {
  const violations: string[] = [];
  for (const obj of objects) {
    if (!KNOWLEDGE_OBJECT_TYPES.has(obj.type)) {
      violations.push(`KnowledgeObject ${obj.id}: unbekannter type "${obj.type}"`);
    }
    if (!obj.title.trim()) violations.push(`KnowledgeObject ${obj.id}: title ist leer`);
    if (!obj.content.trim()) violations.push(`KnowledgeObject ${obj.id}: content ist leer`);
    if (obj.tags.length === 0) violations.push(`KnowledgeObject ${obj.id}: tags ist leer`);
  }
  return violations;
}

export function checkKnowledgeObjectAuthorValid(objects: readonly KnowledgeObject[], employees: readonly Employee[]): string[] {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const violations: string[] = [];
  for (const obj of objects) {
    const author = employeeById.get(obj.authorEmployeeId);
    if (!author) {
      violations.push(`KnowledgeObject ${obj.id}: unbekannte authorEmployeeId "${obj.authorEmployeeId}"`);
    } else if (!isEmployeeValidAt(author, obj.createdAt)) {
      violations.push(`KnowledgeObject ${obj.id}: Autor ${author.id} zum Zeitpunkt createdAt nicht aktiv`);
    }
  }
  return violations;
}

export function checkKnowledgeObjectDates(objects: readonly KnowledgeObject[]): string[] {
  const violations: string[] = [];
  for (const obj of objects) {
    if (obj.updatedAt < obj.createdAt) {
      violations.push(`KnowledgeObject ${obj.id}: updatedAt (${obj.updatedAt}) liegt vor createdAt (${obj.createdAt})`);
    }
    if (obj.createdAt > WORLD_NOW) {
      violations.push(`KnowledgeObject ${obj.id}: createdAt (${obj.createdAt}) liegt nach WORLD_NOW (${WORLD_NOW})`);
    }
    if (obj.updatedAt > WORLD_NOW) {
      violations.push(`KnowledgeObject ${obj.id}: updatedAt (${obj.updatedAt}) liegt nach WORLD_NOW (${WORLD_NOW})`);
    }
  }
  return violations;
}

export function checkKnowledgeObjectAccountReference(
  objects: readonly KnowledgeObject[],
  accounts: readonly CustomerAccount[],
): string[] {
  const accountIds = new Set(accounts.map((a) => a.id));
  return objects
    .filter((o) => o.relatedAccountId !== undefined && !accountIds.has(o.relatedAccountId))
    .map((o) => `KnowledgeObject ${o.id}: unbekannte relatedAccountId "${o.relatedAccountId}"`);
}

export function checkKnowledgeObjectOpportunityReference(
  objects: readonly KnowledgeObject[],
  opportunities: readonly Opportunity[],
): string[] {
  const opportunityById = new Map(opportunities.map((o) => [o.id, o]));
  const violations: string[] = [];
  for (const obj of objects) {
    if (obj.relatedOpportunityId === undefined) continue;
    const opportunity = opportunityById.get(obj.relatedOpportunityId);
    if (!opportunity) {
      violations.push(`KnowledgeObject ${obj.id}: unbekannte relatedOpportunityId "${obj.relatedOpportunityId}"`);
      continue;
    }
    if (obj.relatedAccountId !== undefined && opportunity.accountId !== obj.relatedAccountId) {
      violations.push(`KnowledgeObject ${obj.id}: relatedAccountId weicht von Opportunity.accountId ab`);
    }
    if (obj.createdAt < opportunity.createdAt) {
      violations.push(`KnowledgeObject ${obj.id}: createdAt (${obj.createdAt}) liegt vor Opportunity.createdAt (${opportunity.createdAt})`);
    }
  }
  return violations;
}

// --- Observation -------------------------------------------------------------

const OBSERVATION_CATEGORIES = new Set(["risiko", "chance", "team-hinweis", "stabil"]);
const OBSERVATION_SEVERITIES = new Set(["niedrig", "mittel", "hoch"]);
const OBSERVATION_CONFIDENCES = new Set(["niedrig", "mittel", "hoch", "unzureichend"]);

export function checkObservationIdsUnique(observations: readonly Observation[]): string[] {
  const seen = new Set<string>();
  const violations: string[] = [];
  for (const obs of observations) {
    if (seen.has(obs.id)) violations.push(`Observation ${obs.id}: doppelte ID`);
    seen.add(obs.id);
  }
  return violations;
}

export function checkObservationFieldsValid(observations: readonly Observation[]): string[] {
  const violations: string[] = [];
  for (const obs of observations) {
    if (!obs.statement.trim()) violations.push(`Observation ${obs.id}: statement ist leer`);
    if (obs.derivedFrom.length === 0) violations.push(`Observation ${obs.id}: derivedFrom ist leer`);
    if (!OBSERVATION_CATEGORIES.has(obs.category)) violations.push(`Observation ${obs.id}: unbekannte category "${obs.category}"`);
    if (!OBSERVATION_SEVERITIES.has(obs.severity)) violations.push(`Observation ${obs.id}: unbekannte severity "${obs.severity}"`);
    if (!OBSERVATION_CONFIDENCES.has(obs.confidence)) violations.push(`Observation ${obs.id}: unbekannte confidence "${obs.confidence}"`);
  }
  return violations;
}

export function checkObservationNoSelfReference(observations: readonly Observation[]): string[] {
  return observations
    .filter((obs) => obs.derivedFrom.includes(obs.id))
    .map((obs) => `Observation ${obs.id}: referenziert sich selbst in derivedFrom`);
}

export function checkObservationGeneratedAtWithinWorldNow(observations: readonly Observation[]): string[] {
  return observations
    .filter((obs) => obs.generatedAt > WORLD_NOW)
    .map((obs) => `Observation ${obs.id}: generatedAt (${obs.generatedAt}) liegt nach WORLD_NOW (${WORLD_NOW})`);
}

export function checkObservationNoCycles(observations: readonly Observation[]): string[] {
  const byId = new Map(observations.map((o) => [o.id, o]));
  const violations: string[] = [];
  for (const obs of observations) {
    const visited = new Set<string>([obs.id]);
    const stack = obs.derivedFrom.filter((id) => id.startsWith("obs-"));
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) {
        violations.push(`Observation ${obs.id}: Zyklus über "${current}"`);
        break;
      }
      visited.add(current);
      const ref = byId.get(current);
      if (ref) {
        stack.push(...ref.derivedFrom.filter((id) => id.startsWith("obs-")));
      }
    }
  }
  return violations;
}

export interface ObservationEvidenceSources {
  leads: readonly Lead[];
  opportunities: readonly Opportunity[];
  stageHistory: readonly OpportunityStageHistory[];
  calls: readonly Call[];
  emails: readonly Email[];
  meetings: readonly Meeting[];
  meetingTranscripts: readonly MeetingTranscript[];
  crmActivities: readonly CrmActivity[];
  knowledgeObjects: readonly KnowledgeObject[];
  observations: readonly Observation[];
}

function resolveEvidenceTimestamp(id: string, sources: ObservationEvidenceSources): string | undefined {
  if (id.startsWith("lead-")) return sources.leads.find((l) => l.id === id)?.createdAt;
  if (id.startsWith("opp-")) return sources.opportunities.find((o) => o.id === id)?.createdAt;
  if (id.startsWith("stage-")) return sources.stageHistory.find((s) => s.id === id)?.enteredAt;
  if (id.startsWith("call-")) return sources.calls.find((c) => c.id === id)?.timestamp;
  if (id.startsWith("email-")) return sources.emails.find((e) => e.id === id)?.timestamp;
  if (id.startsWith("meeting-")) return sources.meetings.find((m) => m.id === id)?.timestamp;
  if (id.startsWith("transcript-")) {
    const transcript = sources.meetingTranscripts.find((t) => t.id === id);
    return transcript ? sources.meetings.find((m) => m.id === transcript.meetingId)?.timestamp : undefined;
  }
  if (id.startsWith("activity-")) return sources.crmActivities.find((a) => a.id === id)?.timestamp;
  if (id.startsWith("kobj-")) return sources.knowledgeObjects.find((k) => k.id === id)?.createdAt;
  if (id.startsWith("obs-")) return sources.observations.find((o) => o.id === id)?.generatedAt;
  return undefined;
}

// Prüft in einem Zug: jede derivedFrom-ID existiert, und generatedAt liegt nicht vor
// dem spätesten Zeitstempel der referenzierten Evidenz (keine Observation darf
// früher existieren als ihre Evidenz).
export function checkObservationDerivedFromResolvesAndOrdered(
  observations: readonly Observation[],
  sources: ObservationEvidenceSources,
): string[] {
  const violations: string[] = [];
  for (const obs of observations) {
    for (const refId of obs.derivedFrom) {
      const timestamp = resolveEvidenceTimestamp(refId, sources);
      if (timestamp === undefined) {
        violations.push(`Observation ${obs.id}: derivedFrom-ID "${refId}" existiert nicht`);
        continue;
      }
      if (timestamp > obs.generatedAt) {
        violations.push(
          `Observation ${obs.id}: derivedFrom-ID "${refId}" (${timestamp}) liegt nach generatedAt (${obs.generatedAt})`,
        );
      }
    }
  }
  return violations;
}

// --- Generatorstillstand vs. echte Stagnation (Pipeline-Stagnation-Fix) ------

// Unterscheidet "der Generator modelliert nach der Ersterzeugung keine weitere
// Entwicklung" (Bug, gefunden in der Reference-World-Validation) von "diese
// Opportunity ist tatsächlich, individuell stehen geblieben" (erlaubt). Bewusst
// keine starre Regel wie "maximal 90 Tage in derselben Stage" — einzelne, auch
// lange Stalls sind erwünscht (PRINCIPLES.md, "leichte natürliche Unterschiede").
// Stattdessen ein populationsweites Signal: der ursprüngliche Bug erzeugte eine
// nahezu deterministische Korrelation zwischen Opportunity-Erstellungsdatum und
// "Tage in aktueller Stage" (je früher erstellt, desto länger "stagniert" — weil
// schlicht nie eine weitere Transition simuliert wurde). Echte, individuelle
// Stalls sind dagegen unabhängig vom Erstellungsdatum verteilt. Ein einzelner
// alter, tatsächlich stehender Deal schlägt hier nicht an — nur ein
// populationsweites Muster, das auf fehlende Generator-Fortschrittslogik hindeutet.
function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return 0;
  return covariance / Math.sqrt(varianceX * varianceY);
}

function daysBetweenIso(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24));
}

// Kalibriert gegen die Baseline-Welt: vor dem Fix lag die Korrelation bei ca.
// -0.9 bis -0.95 (nahezu deterministisch), danach bei ca. -0.3 (Rauschen). 0.6
// liegt klar dazwischen und lässt echte, unkorrelierte Streuung zu.
const MAX_PLAUSIBLE_STAGE_AGE_CREATION_CORRELATION = 0.6;

export function checkOpenOpportunityStageAgeNotDrivenByCreationDate(
  opportunities: readonly Opportunity[],
  stageHistory: readonly OpportunityStageHistory[],
  worldTimelineStart: string,
): string[] {
  const open = opportunities.filter((o) => o.closedAt === undefined);
  const creationOffsets: number[] = [];
  const stageAges: number[] = [];
  for (const opportunity of open) {
    const entry = stageHistory.find((s) => s.opportunityId === opportunity.id && s.exitedAt === undefined);
    if (!entry) continue;
    creationOffsets.push(daysBetweenIso(worldTimelineStart, opportunity.createdAt));
    stageAges.push(daysBetweenIso(entry.enteredAt, WORLD_NOW));
  }
  if (creationOffsets.length < 10) {
    return [];
  }
  const correlation = pearsonCorrelation(creationOffsets, stageAges);
  if (Math.abs(correlation) > MAX_PLAUSIBLE_STAGE_AGE_CREATION_CORRELATION) {
    return [
      `Offene Opportunities: Korrelation zwischen Erstellungsdatum und Tagen in aktueller Stage ist ${correlation.toFixed(2)} ` +
        `(Schwelle: ±${MAX_PLAUSIBLE_STAGE_AGE_CREATION_CORRELATION}) — deutet auf Generatorstillstand statt echter, ` +
        "individuell verteilter Stagnation hin.",
    ];
  }
  return [];
}

// --- GroundTruthSnapshot -----------------------------------------------------

export function checkGroundTruthObservationsExist(
  snapshots: readonly GroundTruthSnapshot[],
  observations: readonly Observation[],
): string[] {
  const observationIds = new Set(observations.map((o) => o.id));
  const violations: string[] = [];
  for (const snapshot of snapshots) {
    for (const id of snapshot.activeObservationIds) {
      if (!observationIds.has(id)) {
        violations.push(`GroundTruthSnapshot ${snapshot.id}: unbekannte Observation "${id}" in activeObservationIds`);
      }
    }
    for (const priority of snapshot.priorities) {
      if (!observationIds.has(priority.observationId)) {
        violations.push(`GroundTruthSnapshot ${snapshot.id}: unbekannte Observation "${priority.observationId}" in priorities`);
      }
    }
    for (const group of snapshot.observationGroups) {
      for (const id of group.observationIds) {
        if (!observationIds.has(id)) {
          violations.push(`GroundTruthSnapshot ${snapshot.id}: unbekannte Observation "${id}" in Gruppe ${group.id}`);
        }
      }
    }
  }
  return violations;
}

// Jede in priorities/observationGroups referenzierte Observation muss auch Teil von
// activeObservationIds desselben Snapshots sein ("Observation gehört zum Snapshot").
export function checkGroundTruthReferencesBelongToSnapshot(snapshots: readonly GroundTruthSnapshot[]): string[] {
  const violations: string[] = [];
  for (const snapshot of snapshots) {
    const active = new Set(snapshot.activeObservationIds);
    for (const priority of snapshot.priorities) {
      if (!active.has(priority.observationId)) {
        violations.push(
          `GroundTruthSnapshot ${snapshot.id}: priorities referenziert "${priority.observationId}", nicht in activeObservationIds enthalten`,
        );
      }
    }
    for (const group of snapshot.observationGroups) {
      for (const id of group.observationIds) {
        if (!active.has(id)) {
          violations.push(
            `GroundTruthSnapshot ${snapshot.id}: Gruppe ${group.id} referenziert "${id}", nicht in activeObservationIds enthalten`,
          );
        }
      }
    }
  }
  return violations;
}

export function checkGroundTruthNoDuplicates(snapshots: readonly GroundTruthSnapshot[]): string[] {
  const violations: string[] = [];
  for (const snapshot of snapshots) {
    const seenActive = new Set<string>();
    for (const id of snapshot.activeObservationIds) {
      if (seenActive.has(id)) violations.push(`GroundTruthSnapshot ${snapshot.id}: doppelte activeObservationId "${id}"`);
      seenActive.add(id);
    }
    const seenGroupIds = new Set<string>();
    for (const group of snapshot.observationGroups) {
      if (seenGroupIds.has(group.id)) violations.push(`GroundTruthSnapshot ${snapshot.id}: doppelte Gruppen-ID "${group.id}"`);
      seenGroupIds.add(group.id);
      const seenInGroup = new Set<string>();
      for (const id of group.observationIds) {
        if (seenInGroup.has(id)) violations.push(`GroundTruthSnapshot ${snapshot.id}: Gruppe ${group.id} enthält "${id}" mehrfach`);
        seenInGroup.add(id);
      }
    }
  }
  return violations;
}

// Groups referenzieren nur Observations, nie andere Gruppen — verhindert
// strukturell jeden Gruppen-Zyklus. Diese Prüfung fängt eine versehentliche
// Gruppen-in-Gruppen-Referenz ab.
export function checkGroundTruthGroupsNoCycles(snapshots: readonly GroundTruthSnapshot[]): string[] {
  const violations: string[] = [];
  for (const snapshot of snapshots) {
    const groupIds = new Set(snapshot.observationGroups.map((g) => g.id));
    for (const group of snapshot.observationGroups) {
      for (const id of group.observationIds) {
        if (groupIds.has(id)) {
          violations.push(
            `GroundTruthSnapshot ${snapshot.id}: Gruppe ${group.id} referenziert die Gruppen-ID "${id}" statt einer Observation — potenzieller Zyklus`,
          );
        }
      }
    }
  }
  return violations;
}

// Jede aktive Observation besitzt genau eine Prioritätsstufe — nicht keine, nicht
// mehrere.
export function checkGroundTruthPrioritiesUnique(snapshots: readonly GroundTruthSnapshot[]): string[] {
  const violations: string[] = [];
  for (const snapshot of snapshots) {
    const counts = new Map<string, number>();
    for (const priority of snapshot.priorities) {
      counts.set(priority.observationId, (counts.get(priority.observationId) ?? 0) + 1);
    }
    for (const id of snapshot.activeObservationIds) {
      const count = counts.get(id) ?? 0;
      if (count === 0) violations.push(`GroundTruthSnapshot ${snapshot.id}: Observation "${id}" hat keine Priorität`);
      if (count > 1) violations.push(`GroundTruthSnapshot ${snapshot.id}: Observation "${id}" hat ${count} Prioritäten`);
    }
  }
  return violations;
}

export function checkGroundTruthTimestampValid(
  snapshots: readonly GroundTruthSnapshot[],
  observations: readonly Observation[],
): string[] {
  const observationById = new Map(observations.map((o) => [o.id, o]));
  const violations: string[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.timestamp > WORLD_NOW) {
      violations.push(`GroundTruthSnapshot ${snapshot.id}: timestamp (${snapshot.timestamp}) liegt nach WORLD_NOW (${WORLD_NOW})`);
    }
    for (const id of snapshot.activeObservationIds) {
      const observation = observationById.get(id);
      if (observation && observation.generatedAt > snapshot.timestamp) {
        violations.push(
          `GroundTruthSnapshot ${snapshot.id}: timestamp (${snapshot.timestamp}) liegt vor generatedAt (${observation.generatedAt}) von Observation ${id}`,
        );
      }
    }
  }
  return violations;
}
