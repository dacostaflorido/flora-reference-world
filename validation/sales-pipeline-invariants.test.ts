import { describe, expect, it } from "vitest";
import { EMPLOYEES } from "../world/employees";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { ACCOUNT_OWNERSHIPS } from "../world/account-ownership";
import {
  generateSalesPipeline,
  LEADS,
  OPPORTUNITIES,
  OPPORTUNITY_STAGE_HISTORY,
} from "../events/generate-sales-pipeline";
import { WORLD_SEED } from "../engine/seed";
import { WORLD_TIMELINE_START } from "../timeline/world-clock";
import {
  checkAllDynamicDatesWithinWorldNow,
  checkConvertedLeadHasExactlyOneOpportunity,
  checkLeadAccountReferences,
  checkLeadContactBelongsToAccount,
  checkLeadCreatedAfterAccountAndContact,
  checkLeadLastContactedAfterCreated,
  checkLeadOwnerValidAtCreation,
  checkLostLeadHasNoOpportunityLink,
  checkOpenOpportunityStageAgeNotDrivenByCreationDate,
  checkOpportunityClosedAtConsistency,
  checkOpportunityLeadReferences,
  checkOpportunityNoDuplicateLeads,
  checkOpportunityResponsibleEmployeeValid,
  checkOpportunityValueAndProbability,
  checkStageHistoryContiguity,
  checkStageHistoryExistsForEveryOpportunity,
  checkStageHistoryResponsibleEmployeeValidity,
} from "./invariants";

describe("Lead", () => {
  it("referenziert nur existierende Accounts", () => {
    expect(checkLeadAccountReferences(LEADS, CUSTOMER_ACCOUNTS)).toEqual([]);
  });

  it("Contact gehört zum selben Account", () => {
    expect(checkLeadContactBelongsToAccount(LEADS, CONTACTS)).toEqual([]);
  });

  it("entsteht nie vor Account/Contact", () => {
    expect(checkLeadCreatedAfterAccountAndContact(LEADS, CUSTOMER_ACCOUNTS, CONTACTS)).toEqual([]);
  });

  it("hat einen zum Zeitpunkt gültigen Owner", () => {
    expect(checkLeadOwnerValidAtCreation(LEADS, EMPLOYEES)).toEqual([]);
  });

  it("lastContactedAt liegt nie vor createdAt", () => {
    expect(checkLeadLastContactedAfterCreated(LEADS)).toEqual([]);
  });

  it("verlorene Leads haben keinen Opportunity-Link", () => {
    expect(checkLostLeadHasNoOpportunityLink(LEADS)).toEqual([]);
  });

  it("konvertierte Leads haben genau eine zurückverlinkte Opportunity", () => {
    expect(checkConvertedLeadHasExactlyOneOpportunity(LEADS, OPPORTUNITIES)).toEqual([]);
  });

  it("liegt in der erwarteten Größenordnung (800–1.500)", () => {
    expect(LEADS.length).toBeGreaterThanOrEqual(800);
    expect(LEADS.length).toBeLessThanOrEqual(1500);
  });
});

describe("Opportunity", () => {
  it("referenziert einen gültigen Lead mit konsistentem Account/Zeitpunkt", () => {
    expect(checkOpportunityLeadReferences(OPPORTUNITIES, LEADS)).toEqual([]);
  });

  it("ein Lead erzeugt nie mehr als eine Opportunity", () => {
    expect(checkOpportunityNoDuplicateLeads(OPPORTUNITIES)).toEqual([]);
  });

  it("hat einen zum Zeitpunkt gültigen verantwortlichen Employee", () => {
    expect(checkOpportunityResponsibleEmployeeValid(OPPORTUNITIES, EMPLOYEES)).toEqual([]);
  });

  it("value > 0 und probability in [0, 100]", () => {
    expect(checkOpportunityValueAndProbability(OPPORTUNITIES)).toEqual([]);
  });

  it("closedAt/lostReason nur bei geschlossenen Stages", () => {
    expect(checkOpportunityClosedAtConsistency(OPPORTUNITIES)).toEqual([]);
  });
});

describe("OpportunityStageHistory", () => {
  it("existiert für jede Opportunity", () => {
    expect(checkStageHistoryExistsForEveryOpportunity(OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY)).toEqual([]);
  });

  it("ist lückenlos, überlappungsfrei und endet korrekt", () => {
    expect(checkStageHistoryContiguity(OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY)).toEqual([]);
  });

  it("historische Owner sind im jeweiligen Zeitraum gültig", () => {
    expect(checkStageHistoryResponsibleEmployeeValidity(OPPORTUNITY_STAGE_HISTORY, EMPLOYEES)).toEqual([]);
  });

  it("Stagnation offener Opportunities ist nicht durch Generatorstillstand getrieben (Korrelation mit Erstellungsdatum)", () => {
    expect(checkOpenOpportunityStageAgeNotDrivenByCreationDate(OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY, WORLD_TIMELINE_START)).toEqual([]);
  });
});

describe("Timeline", () => {
  it("keine dynamische Entität entsteht nach WORLD_NOW", () => {
    expect(checkAllDynamicDatesWithinWorldNow(LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY)).toEqual([]);
  });
});

describe("Determinismus", () => {
  it("gleicher Seed erzeugt eine deep-identische Pipeline", () => {
    const a = generateSalesPipeline(WORLD_SEED + 4, CUSTOMER_ACCOUNTS, CONTACTS, EMPLOYEES, ACCOUNT_OWNERSHIPS);
    const b = generateSalesPipeline(WORLD_SEED + 4, CUSTOMER_ACCOUNTS, CONTACTS, EMPLOYEES, ACCOUNT_OWNERSHIPS);
    expect(a).toEqual(b);
  });

  it("anderer Seed erzeugt eine abweichende Pipeline", () => {
    const a = generateSalesPipeline(WORLD_SEED + 4, CUSTOMER_ACCOUNTS, CONTACTS, EMPLOYEES, ACCOUNT_OWNERSHIPS);
    const b = generateSalesPipeline(WORLD_SEED + 5, CUSTOMER_ACCOUNTS, CONTACTS, EMPLOYEES, ACCOUNT_OWNERSHIPS);
    expect(a).not.toEqual(b);
  });
});
