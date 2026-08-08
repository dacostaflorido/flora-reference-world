import { describe, expect, it } from "vitest";
import { EMPLOYEES } from "../world/employees";
import { DEPARTMENTS } from "../world/departments";
import { ROLES } from "../world/roles";
import { CUSTOMER_ACCOUNTS, generateCustomerAccounts } from "../world/customer-accounts";
import { CONTACTS, generateContacts } from "../world/contacts";
import { ACCOUNT_OWNERSHIPS, generateAccountOwnerships } from "../world/account-ownership";
import { WORLD_SEED } from "../engine/seed";
import {
  checkContactAccountReferences,
  checkContactCreatedAfterAccount,
  checkEmployeeDepartmentReferences,
  checkEmployeeManagerReferences,
  checkEmployeeRoleReferences,
  checkEmployeeValidityIntervals,
  checkNoManagerCycles,
  checkOwnershipAccountReferences,
  checkOwnershipEmployeeReferences,
  checkOwnershipEmployeeValidity,
  checkOwnershipNoOverlap,
} from "./invariants";

describe("Employee", () => {
  it("referenziert nur existierende Departments", () => {
    expect(checkEmployeeDepartmentReferences(EMPLOYEES, DEPARTMENTS)).toEqual([]);
  });

  it("referenziert nur existierende Roles", () => {
    expect(checkEmployeeRoleReferences(EMPLOYEES, ROLES)).toEqual([]);
  });

  it("referenziert nur existierende Manager", () => {
    expect(checkEmployeeManagerReferences(EMPLOYEES)).toEqual([]);
  });

  it("enthält keine Manager-Zyklen", () => {
    expect(checkNoManagerCycles(EMPLOYEES)).toEqual([]);
  });

  it("hat valide Gültigkeitsintervalle (hiredAt/terminatedAt)", () => {
    expect(checkEmployeeValidityIntervals(EMPLOYEES)).toEqual([]);
  });

  it("liegt in der erwarteten Headcount-Bandbreite (35–50 aktive Mitarbeiter)", () => {
    const activeCount = EMPLOYEES.filter((e) => e.terminatedAt === undefined).length;
    expect(activeCount).toBeGreaterThanOrEqual(35);
    expect(activeCount).toBeLessThanOrEqual(50);
  });
});

describe("Contact", () => {
  it("referenziert nur existierende Accounts", () => {
    expect(checkContactAccountReferences(CONTACTS, CUSTOMER_ACCOUNTS)).toEqual([]);
  });

  it("wird nie vor dem zugehörigen Account angelegt", () => {
    expect(checkContactCreatedAfterAccount(CONTACTS, CUSTOMER_ACCOUNTS)).toEqual([]);
  });

  it("hat 1–4 Kontakte pro Account", () => {
    const countByAccount = new Map<string, number>();
    for (const contact of CONTACTS) {
      countByAccount.set(contact.accountId, (countByAccount.get(contact.accountId) ?? 0) + 1);
    }
    for (const account of CUSTOMER_ACCOUNTS) {
      const count = countByAccount.get(account.id) ?? 0;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(4);
    }
  });
});

describe("AccountOwnership", () => {
  it("referenziert nur existierende Accounts", () => {
    expect(checkOwnershipAccountReferences(ACCOUNT_OWNERSHIPS, CUSTOMER_ACCOUNTS)).toEqual([]);
  });

  it("referenziert nur existierende Employees", () => {
    expect(checkOwnershipEmployeeReferences(ACCOUNT_OWNERSHIPS, EMPLOYEES)).toEqual([]);
  });

  it("weist Ownership nur während der Employee-Gültigkeit zu", () => {
    expect(checkOwnershipEmployeeValidity(ACCOUNT_OWNERSHIPS, EMPLOYEES)).toEqual([]);
  });

  it("überlappt keine Intervalle innerhalb (accountId, ownershipRole)", () => {
    expect(checkOwnershipNoOverlap(ACCOUNT_OWNERSHIPS)).toEqual([]);
  });

  it("hat für jeden Account einen SDR und einen Owner", () => {
    const rolesByAccount = new Map<string, Set<string>>();
    for (const ownership of ACCOUNT_OWNERSHIPS) {
      const roles = rolesByAccount.get(ownership.accountId) ?? new Set<string>();
      roles.add(ownership.ownershipRole);
      rolesByAccount.set(ownership.accountId, roles);
    }
    for (const account of CUSTOMER_ACCOUNTS) {
      const roles = rolesByAccount.get(account.id) ?? new Set<string>();
      expect(roles.has("sdr")).toBe(true);
      expect(roles.has("owner")).toBe(true);
    }
  });
});

describe("Determinismus", () => {
  it("generateCustomerAccounts ist reproduzierbar für denselben Seed", () => {
    const a = generateCustomerAccounts(WORLD_SEED + 1);
    const b = generateCustomerAccounts(WORLD_SEED + 1);
    expect(a).toEqual(b);
  });

  it("generateContacts ist reproduzierbar für denselben Seed", () => {
    const a = generateContacts(WORLD_SEED + 2, CUSTOMER_ACCOUNTS);
    const b = generateContacts(WORLD_SEED + 2, CUSTOMER_ACCOUNTS);
    expect(a).toEqual(b);
  });

  it("generateAccountOwnerships ist reproduzierbar für denselben Seed", () => {
    const a = generateAccountOwnerships(WORLD_SEED + 3, EMPLOYEES, CUSTOMER_ACCOUNTS);
    const b = generateAccountOwnerships(WORLD_SEED + 3, EMPLOYEES, CUSTOMER_ACCOUNTS);
    expect(a).toEqual(b);
  });
});
