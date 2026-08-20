import { describe, expect, it } from "vitest";
import { EMPLOYEES, type Employee } from "../world/employees";
import {
  EMPLOYEE_HIRED_EVENTS,
  EMPLOYEE_TERMINATED_EVENTS,
  generateEmployeeHiredEvents,
  generateEmployeeTerminatedEvents,
} from "../events/employee-lifecycle";
import {
  PEOPLE_OBSERVATIONS,
  evaluateTerminationForPeopleObservation,
} from "../observations/people-observations";
import { generateWorldSnapshot, type WorldSnapshotSource } from "../snapshot/snapshot";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { SCENARIO_WORLDS } from "../engine/generator";
import { PEOPLE_GROUND_TRUTH_SNAPSHOTS, generateGroundTruthSnapshot } from "../ground-truth/ground-truth";
import { generatePeopleBusinessStateSnapshot, type PeopleBusinessStateType } from "../business-state/people-business-state";
import type { Observation } from "../observations/observations";
import { WORLD_NOW } from "../timeline/world-clock";

const employeeById = new Map(EMPLOYEES.map((e) => [e.id, e]));

describe("Employee Lifecycle Events: Materialisierung 1:1 aus Employee-Stammdaten", () => {
  it("EmployeeHired: genau ein Event je Employee, Felder identisch zur Quelle", () => {
    expect(EMPLOYEE_HIRED_EVENTS.length).toBe(EMPLOYEES.length);
    for (const event of EMPLOYEE_HIRED_EVENTS) {
      const employee = employeeById.get(event.employeeId);
      expect(employee, `unbekannter Employee ${event.employeeId}`).toBeDefined();
      expect(event.roleId).toBe(employee!.roleId);
      expect(event.departmentId).toBe(employee!.departmentId);
      expect(event.hiredAt).toBe(employee!.hiredAt);
    }
  });

  it("EmployeeTerminated: genau ein Event je Employee mit terminatedAt, Felder identisch zur Quelle", () => {
    const terminatedEmployees = EMPLOYEES.filter((e) => e.terminatedAt !== undefined);
    expect(EMPLOYEE_TERMINATED_EVENTS.length).toBe(terminatedEmployees.length);
    for (const event of EMPLOYEE_TERMINATED_EVENTS) {
      const employee = employeeById.get(event.employeeId);
      expect(employee, `unbekannter Employee ${event.employeeId}`).toBeDefined();
      expect(event.roleId).toBe(employee!.roleId);
      expect(event.departmentId).toBe(employee!.departmentId);
      expect(event.managerId).toBe(employee!.managerId);
      expect(event.terminatedAt).toBe(employee!.terminatedAt);
    }
  });

  it("kein Event referenziert einen unbekannten Employee (auch mit isolierten Fixtures geprüft)", () => {
    const fixture: Employee[] = [
      { id: "fx-a", name: "Fixture A", departmentId: "dept-x", roleId: "role-x", hiredAt: "2024-01-01" },
      {
        id: "fx-b",
        name: "Fixture B",
        departmentId: "dept-x",
        roleId: "role-x",
        managerId: "fx-a",
        hiredAt: "2024-02-01",
        terminatedAt: "2024-06-01",
      },
    ];
    const hired = generateEmployeeHiredEvents(fixture);
    const terminated = generateEmployeeTerminatedEvents(fixture);
    const knownIds = new Set(fixture.map((e) => e.id));
    for (const event of [...hired, ...terminated]) {
      expect(knownIds.has(event.employeeId)).toBe(true);
    }
    expect(terminated).toHaveLength(1);
    expect(terminated[0]?.employeeId).toBe("fx-b");
  });
});

describe("People-Observation-Regel: event-getriebener Übergang (freigegebene Korrektur)", () => {
  it("Regression Tobias Reuter (AE, Team Timo Albrecht, terminatedAt 2023-11-30): 4→3, keine Observation", () => {
    const event = EMPLOYEE_TERMINATED_EVENTS.find((e) => e.employeeId === "emp-tobias-reuter");
    expect(event, "Tobias Reuter muss als EmployeeTerminated-Event existieren").toBeDefined();
    const result = evaluateTerminationForPeopleObservation(event!, EMPLOYEES);
    expect(result, "STOP — PEOPLE RULE REGRESSION: Tobias Reuter darf keine Observation auslösen").toBeUndefined();
  });

  it("Regression Merle Winkler (SDR, Team Timo Albrecht, terminatedAt 2022-08-15): 3→2, keine Observation", () => {
    const event = EMPLOYEE_TERMINATED_EVENTS.find((e) => e.employeeId === "emp-merle-winkler");
    expect(event, "Merle Winkler muss als EmployeeTerminated-Event existieren").toBeDefined();
    const result = evaluateTerminationForPeopleObservation(event!, EMPLOYEES);
    expect(result, "STOP — PEOPLE RULE REGRESSION: Merle Winkler darf keine Observation auslösen").toBeUndefined();
  });

  it("Fall A — synthetisch, 2→1: löst 'letzte Person verbleibt' mit severity mittel aus", () => {
    const fixture: Employee[] = [
      { id: "fx-mgr", name: "Manager", departmentId: "dept-x", roleId: "role-lead", hiredAt: "2020-01-01" },
      {
        id: "fx-1",
        name: "Person 1",
        departmentId: "dept-x",
        roleId: "role-peer",
        managerId: "fx-mgr",
        hiredAt: "2020-01-01",
      },
      {
        id: "fx-2",
        name: "Person 2",
        departmentId: "dept-x",
        roleId: "role-peer",
        managerId: "fx-mgr",
        hiredAt: "2020-01-01",
        terminatedAt: "2025-01-01",
      },
    ];
    const [terminated] = generateEmployeeTerminatedEvents(fixture);
    const result = evaluateTerminationForPeopleObservation(terminated!, fixture);
    expect(result).toBeDefined();
    expect(result!.beforeCount).toBe(2);
    expect(result!.afterCount).toBe(1);
    expect(result!.observation.kind).toBe("people-critical-role-last-person");
    expect(result!.observation.severity).toBe("mittel");
  });

  it("Fall B — synthetisch, 1→0: löst 'unbesetzt' mit severity hoch aus", () => {
    const fixture: Employee[] = [
      { id: "fx-mgr", name: "Manager", departmentId: "dept-x", roleId: "role-lead", hiredAt: "2020-01-01" },
      {
        id: "fx-1",
        name: "Person 1",
        departmentId: "dept-x",
        roleId: "role-peer",
        managerId: "fx-mgr",
        hiredAt: "2020-01-01",
        terminatedAt: "2025-01-01",
      },
    ];
    const [terminated] = generateEmployeeTerminatedEvents(fixture);
    const result = evaluateTerminationForPeopleObservation(terminated!, fixture);
    expect(result).toBeDefined();
    expect(result!.beforeCount).toBe(1);
    expect(result!.afterCount).toBe(0);
    expect(result!.observation.kind).toBe("people-critical-role-unstaffed");
    expect(result!.observation.severity).toBe("hoch");
  });

  it("Fall C — synthetisch, 3→2: keine Observation", () => {
    const fixture: Employee[] = [
      { id: "fx-mgr", name: "Manager", departmentId: "dept-x", roleId: "role-lead", hiredAt: "2020-01-01" },
      { id: "fx-1", name: "Person 1", departmentId: "dept-x", roleId: "role-peer", managerId: "fx-mgr", hiredAt: "2020-01-01" },
      { id: "fx-2", name: "Person 2", departmentId: "dept-x", roleId: "role-peer", managerId: "fx-mgr", hiredAt: "2020-01-01" },
      {
        id: "fx-3",
        name: "Person 3",
        departmentId: "dept-x",
        roleId: "role-peer",
        managerId: "fx-mgr",
        hiredAt: "2020-01-01",
        terminatedAt: "2025-01-01",
      },
    ];
    const [terminated] = generateEmployeeTerminatedEvents(fixture);
    const result = evaluateTerminationForPeopleObservation(terminated!, fixture);
    expect(result).toBeUndefined();
  });

  it("Fall D — Person ohne managerId: unternehmensweite Rollenprüfung, 2→1 löst aus", () => {
    const fixture: Employee[] = [
      { id: "fx-gf-1", name: "GF 1", departmentId: "dept-gf", roleId: "role-gf", hiredAt: "2013-01-01" },
      {
        id: "fx-gf-2",
        name: "GF 2",
        departmentId: "dept-gf",
        roleId: "role-gf",
        hiredAt: "2014-01-01",
        terminatedAt: "2025-01-01",
      },
    ];
    const [terminated] = generateEmployeeTerminatedEvents(fixture);
    expect(terminated!.managerId).toBeUndefined();
    const result = evaluateTerminationForPeopleObservation(terminated!, fixture);
    expect(result).toBeDefined();
    expect(result!.beforeCount).toBe(2);
    expect(result!.afterCount).toBe(1);
    expect(result!.observation.kind).toBe("people-critical-role-last-person");
    expect(result!.observation.severity).toBe("mittel");
  });

  it("isTopPerformer beeinflusst die Regel nicht (bewusst entfernt, Freigabe 'Verbindliche fachliche Regel')", () => {
    const fixture: Employee[] = [
      { id: "fx-mgr", name: "Manager", departmentId: "dept-x", roleId: "role-lead", hiredAt: "2020-01-01" },
      {
        id: "fx-1",
        name: "Person 1",
        departmentId: "dept-x",
        roleId: "role-peer",
        managerId: "fx-mgr",
        hiredAt: "2020-01-01",
      },
      {
        id: "fx-2",
        name: "Person 2 (Top Performer)",
        departmentId: "dept-x",
        roleId: "role-peer",
        managerId: "fx-mgr",
        hiredAt: "2020-01-01",
        isTopPerformer: true,
        terminatedAt: "2025-01-01",
      },
    ];
    const [terminated] = generateEmployeeTerminatedEvents(fixture);
    const result = evaluateTerminationForPeopleObservation(terminated!, fixture);
    // 2→1: löst aus, aber ausschließlich wegen der Kopfzahl, nicht wegen isTopPerformer
    // — durch den Vergleich mit Fall A (identische Struktur, kein isTopPerformer, s.o.)
    // mit demselben Ergebnis belegt.
    expect(result).toBeDefined();
    expect(result!.observation.severity).toBe("mittel");
  });
});

describe("Kandidatenteams (Phase 8): reale 2-Personen-Teams im aktuellen EMPLOYEES-Datensatz", () => {
  // Rein lesende Validierung gegen die echten Stammdaten — es wird keine produktive
  // Employee-Datei verändert. Das synthetische EmployeeTerminated-Event wird lokal
  // konstruiert und nirgends in EMPLOYEE_TERMINATED_EVENTS/EMPLOYEES eingetragen.
  const candidates: { label: string; employeeId: string; roleId: string; managerId: string }[] = [
    { label: "RevOps unter Jan-Philipp Suhr (Dennis Wulff)", employeeId: "emp-dennis-wulff", roleId: "role-revops-manager", managerId: "emp-jan-philipp-suhr" },
    { label: "Marketing unter Antonia Reetz (Laura Feddersen)", employeeId: "emp-laura-feddersen", roleId: "role-marketing-manager", managerId: "emp-antonia-reetz" },
    { label: "Operations unter Henrik Paulsen (Marc Oldenburg)", employeeId: "emp-marc-oldenburg", roleId: "role-operations-manager", managerId: "emp-henrik-paulsen" },
  ];

  for (const candidate of candidates) {
    it(`${candidate.label}: hypothetisches Austrittsevent erzeugt 2→1`, () => {
      const employee = employeeById.get(candidate.employeeId);
      expect(employee, `${candidate.employeeId} muss im echten Datensatz existieren`).toBeDefined();
      expect(employee!.roleId).toBe(candidate.roleId);
      expect(employee!.managerId).toBe(candidate.managerId);

      const syntheticEvent = {
        id: `test-only-terminated-${candidate.employeeId}`,
        employeeId: candidate.employeeId,
        roleId: candidate.roleId,
        departmentId: employee!.departmentId,
        managerId: candidate.managerId,
        terminatedAt: "2025-09-01",
      };
      const result = evaluateTerminationForPeopleObservation(syntheticEvent, EMPLOYEES);
      expect(result).toBeDefined();
      expect(result!.beforeCount).toBe(2);
      expect(result!.afterCount).toBe(1);
      expect(result!.observation.severity).toBe("mittel");
    });
  }

  it("kein Sales-AE-/SDR-Team qualifiziert sich (alle haben 3 aktive Mitglieder je Team+Rolle)", () => {
    const salesManagers = ["emp-fabian-krueger", "emp-svenja-brandt", "emp-timo-albrecht"];
    for (const managerId of salesManagers) {
      for (const roleId of ["role-account-executive", "role-sales-development-rep"]) {
        const activeInTeam = EMPLOYEES.filter(
          (e) => e.managerId === managerId && e.roleId === roleId && e.terminatedAt === undefined,
        );
        expect(activeInTeam.length, `${managerId}/${roleId}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("Baseline: keine statische Dauer-Observation, aktueller Datensatz erzeugt keine People-Observation", () => {
  it("PEOPLE_OBSERVATIONS ist bei WORLD_NOW/aktuellem Datensatz leer (Tobias/Merle feuern nicht)", () => {
    expect(PEOPLE_OBSERVATIONS).toEqual([]);
  });

  it("jede jemals erzeugte People-Observation referenziert ausschließlich ein echtes EmployeeTerminated-Event (kein Event ⇒ keine Observation)", () => {
    const terminatedEventIds = new Set(EMPLOYEE_TERMINATED_EVENTS.map((e) => e.id));
    for (const observation of PEOPLE_OBSERVATIONS) {
      const referencesTermination = observation.derivedFrom.some((id) => terminatedEventIds.has(id));
      expect(referencesTermination, `${observation.id} muss ein EmployeeTerminated-Event referenzieren`).toBe(true);
    }
  });
});

describe("Snapshot-Integration: keine Zukunftskenntnis (Prinzip 18)", () => {
  function toSource(): WorldSnapshotSource {
    const world = SCENARIO_WORLDS.baseline;
    return {
      employees: EMPLOYEES,
      employeeHiredEvents: EMPLOYEE_HIRED_EVENTS,
      employeeTerminatedEvents: EMPLOYEE_TERMINATED_EVENTS,
      deliveryUnits: world.deliveryUnits,
      customerAccounts: CUSTOMER_ACCOUNTS,
      contacts: CONTACTS,
      accountOwnerships: world.accountOwnerships,
      leads: world.leads,
      opportunities: world.opportunities,
      stageHistory: world.stageHistory,
      knowledgeObjects: world.knowledgeObjects,
      calls: world.calls,
      emails: world.emails,
      meetings: world.meetings,
      meetingTranscripts: world.meetingTranscripts,
      crmActivities: world.crmActivities,
      salesAppointmentBookedEvents: world.salesAppointmentBookedEvents,
      salesAppointmentHeldEvents: world.salesAppointmentHeldEvents,
      metaAdSpendRecords: world.metaAdSpendRecords,
      metaLeadGeneratedEvents: world.metaLeadGeneratedEvents,
      marketingCrmLeadIngestedEvents: world.marketingCrmLeadIngestedEvents,
      marketingLeadIdentityMatchedEvents: world.marketingLeadIdentityMatchedEvents,
    };
  }

  it("ein Snapshot VOR terminatedAt (Merle Winkler, 2022-08-15) kennt dieses Termination-Event nicht", () => {
    const snapshot = generateWorldSnapshot(toSource(), "2022-08-14");
    const ids = snapshot.employeeTerminatedEvents.map((e) => e.employeeId);
    expect(ids).not.toContain("emp-merle-winkler");
  });

  it("ein Snapshot EXAKT AM terminatedAt-Tag kennt das Event bereits (inklusiver Vergleich, wie bei allen anderen Events)", () => {
    const snapshot = generateWorldSnapshot(toSource(), "2022-08-15");
    const ids = snapshot.employeeTerminatedEvents.map((e) => e.employeeId);
    expect(ids).toContain("emp-merle-winkler");
  });

  it("ein Snapshot NACH terminatedAt kennt das Event", () => {
    const snapshot = generateWorldSnapshot(toSource(), "2025-09-01");
    const ids = snapshot.employeeTerminatedEvents.map((e) => e.employeeId);
    expect(ids).toContain("emp-merle-winkler");
    expect(ids).toContain("emp-tobias-reuter");
  });

  it("employeeHiredEvents folgt derselben Existenz-Filterung wie employees (hiredAt <= asOf)", () => {
    const snapshot = generateWorldSnapshot(toSource(), "2013-01-14");
    expect(snapshot.employeeHiredEvents).toEqual([]);
    const snapshotAfterFirstHire = generateWorldSnapshot(toSource(), "2013-01-15");
    expect(snapshotAfterFirstHire.employeeHiredEvents.map((e) => e.employeeId)).toContain("emp-jonas-reimers");
  });
});

const NORMATIVE_LANGUAGE_PATTERNS: RegExp[] = [
  /\bsollte\b/i,
  /\bsolltest\b/i,
  /\bmusst\b/i,
  /\bmüssen\b/i,
  /\bmuss der geschäftsführer\b/i,
  /\bpriorisier/i,
  /\bgreif(e|en) ein\b/i,
  /\bunterstütz/i,
  /\bentscheide jetzt\b/i,
  /\bempfehl/i,
  /\bhandlungsempfehlung/i,
];

describe("People Business State: Feldmodell, Baseline, Klassifikation (Prinzip 19/20-Analogie)", () => {
  it("Baseline (WORLD_NOW, aktueller EMPLOYEES-Stand): ausgeglichen, leere Evidenz", () => {
    const groundTruth = PEOPLE_GROUND_TRUTH_SNAPSHOTS[0]!;
    const businessState = generatePeopleBusinessStateSnapshot(groundTruth, PEOPLE_OBSERVATIONS);
    expect(businessState.type).toBe("ausgeglichen");
    expect(businessState.peopleGroundTruthSnapshotId).toBe(groundTruth.id);
    expect(businessState.supportingObservationIds).toEqual([]);
  });

  it("keine normative Sprache im statement (Prinzip 19/20-Analogie, wie bei Sales Business State geprüft)", () => {
    const cases: { type: PeopleBusinessStateType; observations: Observation[] }[] = [
      { type: "ausgeglichen", observations: [] },
      {
        type: "letzte-person-verbleibt",
        observations: [
          {
            id: "test-obs-1",
            kind: "people-critical-role-last-person",
            generatedAt: WORLD_NOW,
            statement: "x",
            category: "team-hinweis",
            severity: "mittel",
            confidence: "hoch",
            derivedFrom: [],
          },
        ],
      },
      {
        type: "rolle-unbesetzt",
        observations: [
          {
            id: "test-obs-2",
            kind: "people-critical-role-unstaffed",
            generatedAt: WORLD_NOW,
            statement: "x",
            category: "risiko",
            severity: "hoch",
            confidence: "hoch",
            derivedFrom: [],
          },
        ],
      },
    ];
    for (const { type, observations } of cases) {
      const groundTruth = generateGroundTruthSnapshot(observations, WORLD_NOW);
      const businessState = generatePeopleBusinessStateSnapshot(groundTruth, observations);
      expect(businessState.type).toBe(type);
      for (const pattern of NORMATIVE_LANGUAGE_PATTERNS) {
        expect(pattern.test(businessState.statement), `${type}: "${businessState.statement}" matched ${pattern}`).toBe(
          false,
        );
      }
    }
  });

  it("unstaffed dominiert last-person, wenn (hypothetisch) beide gleichzeitig aktiv wären", () => {
    const observations: Observation[] = [
      {
        id: "test-obs-last-person",
        kind: "people-critical-role-last-person",
        generatedAt: WORLD_NOW,
        statement: "x",
        category: "team-hinweis",
        severity: "mittel",
        confidence: "hoch",
        derivedFrom: [],
      },
      {
        id: "test-obs-unstaffed",
        kind: "people-critical-role-unstaffed",
        generatedAt: WORLD_NOW,
        statement: "x",
        category: "risiko",
        severity: "hoch",
        confidence: "hoch",
        derivedFrom: [],
      },
    ];
    const groundTruth = generateGroundTruthSnapshot(observations, WORLD_NOW);
    const businessState = generatePeopleBusinessStateSnapshot(groundTruth, observations);
    expect(businessState.type).toBe("rolle-unbesetzt");
    expect(businessState.supportingObservationIds).toEqual(["test-obs-unstaffed"]);
  });

  it("supportingObservationIds ist stets Teilmenge von groundTruth.activeObservationIds (Backward Explainability)", () => {
    const groundTruth = PEOPLE_GROUND_TRUTH_SNAPSHOTS[0]!;
    const businessState = generatePeopleBusinessStateSnapshot(groundTruth, PEOPLE_OBSERVATIONS);
    for (const id of businessState.supportingObservationIds) {
      expect(groundTruth.activeObservationIds).toContain(id);
    }
  });
});
