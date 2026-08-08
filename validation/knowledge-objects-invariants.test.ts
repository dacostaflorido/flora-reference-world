import { describe, expect, it } from "vitest";
import { EMPLOYEES } from "../world/employees";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY } from "../events/generate-sales-pipeline";
import { KNOWLEDGE_OBJECTS, generateKnowledgeObjects } from "../world/knowledge-objects";
import { WORLD_SEED } from "../engine/seed";
import {
  checkKnowledgeObjectAccountReference,
  checkKnowledgeObjectAuthorValid,
  checkKnowledgeObjectContentNotEmpty,
  checkKnowledgeObjectDates,
  checkKnowledgeObjectIdsUnique,
  checkKnowledgeObjectOpportunityReference,
} from "./invariants";

describe("KnowledgeObject", () => {
  it("hat eindeutige IDs", () => {
    expect(checkKnowledgeObjectIdsUnique(KNOWLEDGE_OBJECTS)).toEqual([]);
  });

  it("hat gültigen type, nicht-leeren title/content/tags", () => {
    expect(checkKnowledgeObjectContentNotEmpty(KNOWLEDGE_OBJECTS)).toEqual([]);
  });

  it("Autor existiert und ist zum Zeitpunkt createdAt aktiv", () => {
    expect(checkKnowledgeObjectAuthorValid(KNOWLEDGE_OBJECTS, EMPLOYEES)).toEqual([]);
  });

  it("updatedAt >= createdAt, beide <= WORLD_NOW", () => {
    expect(checkKnowledgeObjectDates(KNOWLEDGE_OBJECTS)).toEqual([]);
  });

  it("relatedAccountId ist gültig, falls gesetzt", () => {
    expect(checkKnowledgeObjectAccountReference(KNOWLEDGE_OBJECTS, CUSTOMER_ACCOUNTS)).toEqual([]);
  });

  it("relatedOpportunityId ist gültig, konsistent mit Account, nicht vor Opportunity.createdAt", () => {
    expect(checkKnowledgeObjectOpportunityReference(KNOWLEDGE_OBJECTS, OPPORTUNITIES)).toEqual([]);
  });

  it("liegt in der erwarteten Größenordnung (100–200)", () => {
    expect(KNOWLEDGE_OBJECTS.length).toBeGreaterThanOrEqual(100);
    expect(KNOWLEDGE_OBJECTS.length).toBeLessThanOrEqual(200);
  });
});

describe("Determinismus", () => {
  it("gleicher Seed erzeugt deep-identische Knowledge Objects", () => {
    const a = generateKnowledgeObjects(WORLD_SEED + 6, EMPLOYEES, CUSTOMER_ACCOUNTS, CONTACTS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY);
    const b = generateKnowledgeObjects(WORLD_SEED + 6, EMPLOYEES, CUSTOMER_ACCOUNTS, CONTACTS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY);
    expect(a).toEqual(b);
  });

  it("anderer Seed erzeugt abweichende Knowledge Objects", () => {
    const a = generateKnowledgeObjects(WORLD_SEED + 6, EMPLOYEES, CUSTOMER_ACCOUNTS, CONTACTS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY);
    const b = generateKnowledgeObjects(WORLD_SEED + 7, EMPLOYEES, CUSTOMER_ACCOUNTS, CONTACTS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY);
    expect(a).not.toEqual(b);
  });
});
