import { describe, expect, it } from "vitest";
import { generatePeoplePeriodMetrics } from "../company/people-period-metrics";
import { EMPLOYEES, type Employee } from "../world/employees";
import { WORLD_NOW } from "../timeline/world-clock";

// People Period Metrics V1 (Auftrag "People Intelligence Governance +
// Evidence Audit + Workspace V1", D053) — Pflichttests laut Auftrag Phase 5.
// Verbindliche fachliche Grenze, überall geprüft: keine personenbezogene
// Bewertung, kein Ranking, kein Performance-/Produktivitätsscore, keine
// erfundene Verfügbarkeit/Abwesenheit — diese Begriffe/Konzepte dürfen an
// keiner Stelle in dieser Datei oder im geprüften Code vorkommen.

function employee(overrides: Partial<Employee> & { id: string }): Employee {
  return {
    name: `Test ${overrides.id}`,
    departmentId: "dept-test",
    roleId: "role-test",
    hiredAt: "2020-01-01",
    ...overrides,
  };
}

describe("People Period Metrics — Periodengrenzen", () => {
  it("1. Yesterday ist genau der Kalendertag vor asOf", () => {
    const snap = generatePeoplePeriodMetrics("2025-03-15", []);
    expect(snap.yesterday.bounds).toEqual({ from: "2025-03-14", through: "2025-03-14" });
  });

  it("2. Week-to-Date beginnt am Montag der laufenden Woche", () => {
    // 2025-03-15 ist ein Samstag -> Montag dieser Woche ist 2025-03-10
    const snap = generatePeoplePeriodMetrics("2025-03-15", []);
    expect(snap.weekToDate.bounds).toEqual({ from: "2025-03-10", through: "2025-03-15" });
  });

  it("3. Month-to-Date beginnt am ersten Kalendertag des Monats", () => {
    const snap = generatePeoplePeriodMetrics("2025-03-15", []);
    expect(snap.monthToDate.bounds).toEqual({ from: "2025-03-01", through: "2025-03-15" });
  });

  it("4. Monatswechsel: asOf am 1. eines Monats liefert MTD = genau dieser eine Tag", () => {
    const snap = generatePeoplePeriodMetrics("2025-04-01", []);
    expect(snap.monthToDate.bounds).toEqual({ from: "2025-04-01", through: "2025-04-01" });
    expect(snap.yesterday.bounds).toEqual({ from: "2025-03-31", through: "2025-03-31" });
  });

  it("5. Jahreswechsel: Yesterday über den Jahreswechsel hinweg korrekt", () => {
    const snap = generatePeoplePeriodMetrics("2025-01-01", []);
    expect(snap.yesterday.bounds).toEqual({ from: "2024-12-31", through: "2024-12-31" });
  });

  it("6. Date-only: bounds enthalten keine Uhrzeit-/Zeitzonenkomponente", () => {
    const snap = generatePeoplePeriodMetrics("2025-03-15", []);
    for (const period of [snap.yesterday, snap.weekToDate, snap.monthToDate]) {
      expect(period.bounds.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(period.bounds.through).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("People Period Metrics — Aktivität (Eintritte/Austritte)", () => {
  it("7. Eintritt innerhalb der Periode wird gezählt", () => {
    const employees = [employee({ id: "1", hiredAt: "2025-03-14" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.activity.hires).toBe(1);
    expect(snap.yesterday.activity.hiresEmployeeIds).toEqual(["1"]);
  });

  it("8. Eintritt außerhalb der Periode wird nicht gezählt", () => {
    const employees = [employee({ id: "1", hiredAt: "2025-03-01" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.activity.hires).toBe(0);
    expect(snap.yesterday.activity.hiresEmployeeIds).toEqual([]);
  });

  it("9. Austritt innerhalb der Periode wird gezählt", () => {
    const employees = [employee({ id: "1", hiredAt: "2020-01-01", terminatedAt: "2025-03-14" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.activity.terminations).toBe(1);
    expect(snap.yesterday.activity.terminationsEmployeeIds).toEqual(["1"]);
  });

  it("10. Austritt außerhalb der Periode wird nicht gezählt", () => {
    const employees = [employee({ id: "1", hiredAt: "2020-01-01", terminatedAt: "2025-02-01" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.activity.terminations).toBe(0);
  });

  it("11. Employee ohne terminatedAt erzeugt niemals eine Austritts-Zählung", () => {
    const employees = [employee({ id: "1", hiredAt: "2020-01-01" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.activity.terminations).toBe(0);
    expect(snap.weekToDate.activity.terminations).toBe(0);
    expect(snap.monthToDate.activity.terminations).toBe(0);
  });

  it("12. Mehrere Eintritte/Austritte in derselben Periode werden alle gezählt", () => {
    const employees = [
      employee({ id: "1", hiredAt: "2025-03-10" }),
      employee({ id: "2", hiredAt: "2025-03-12" }),
      employee({ id: "3", hiredAt: "2020-01-01", terminatedAt: "2025-03-11" }),
    ];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.monthToDate.activity.hires).toBe(2);
    expect(snap.monthToDate.activity.hiresEmployeeIds.slice().sort()).toEqual(["1", "2"]);
    expect(snap.monthToDate.activity.terminations).toBe(1);
    expect(snap.monthToDate.activity.terminationsEmployeeIds).toEqual(["3"]);
  });
});

describe("People Period Metrics — Bestand (Headcount, Verantwortungsbereiche)", () => {
  it("13. Headcount am Periodenende zählt ausschließlich zu bounds.through aktive Mitarbeitende", () => {
    const employees = [
      employee({ id: "1", hiredAt: "2020-01-01" }),
      employee({ id: "2", hiredAt: "2020-01-01", terminatedAt: "2025-03-10" }),
    ];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.stockAtPeriodEnd.headcount).toBe(1);
    expect(snap.yesterday.stockAtPeriodEnd.headcountEmployeeIds).toEqual(["1"]);
  });

  it("14. Bestand ist niemals eine Zeitraumaktivität — Headcount bleibt bei Nicht-Ereignis-Perioden konstant, nicht 0", () => {
    const employees = [employee({ id: "1", hiredAt: "2019-01-01" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.stockAtPeriodEnd.headcount).toBe(1);
    expect(snap.weekToDate.stockAtPeriodEnd.headcount).toBe(1);
    expect(snap.monthToDate.stockAtPeriodEnd.headcount).toBe(1);
  });

  it("15. Verantwortungsbereich (roleId+managerId) mit aktivem Mitglied gilt als besetzt", () => {
    const employees = [employee({ id: "1", roleId: "role-a", managerId: "mgr-1", hiredAt: "2020-01-01" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(1);
    expect(snap.yesterday.stockAtPeriodEnd.staffedResponsibilityAreaKeys).toEqual(["role-a::mgr-1"]);
    expect(snap.yesterday.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe(0);
  });

  it("16. Verantwortungsbereich ohne mehr aktives Mitglied gilt als unbesetzt, sobald er einmal existierte", () => {
    const employees = [
      employee({ id: "1", roleId: "role-a", managerId: "mgr-1", hiredAt: "2020-01-01", terminatedAt: "2025-03-10" }),
    ];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(0);
    expect(snap.yesterday.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe(1);
    expect(snap.yesterday.stockAtPeriodEnd.unstaffedResponsibilityAreaKeys).toEqual(["role-a::mgr-1"]);
  });

  it("17. Verantwortungsbereich, der zu bounds.through noch nicht existiert (kein Eintritt), zählt weder besetzt noch unbesetzt", () => {
    const employees = [employee({ id: "1", roleId: "role-a", managerId: "mgr-1", hiredAt: "2025-04-01" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(0);
    expect(snap.yesterday.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe(0);
  });

  it("18. Mitarbeitende ohne managerId (Geschäftsführungsebene) bilden eine unternehmensweite Peer-Gruppe auf Ebene der roleId", () => {
    const employees = [
      employee({ id: "1", roleId: "role-geschaeftsfuehrer", hiredAt: "2020-01-01" }),
      employee({ id: "2", roleId: "role-geschaeftsfuehrer", hiredAt: "2020-01-01" }),
    ];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(1);
    expect(snap.yesterday.stockAtPeriodEnd.staffedResponsibilityAreaKeys).toEqual([
      "role-geschaeftsfuehrer::unternehmensweit",
    ]);
  });

  it("19. Zwei verschiedene Verantwortungsbereiche werden getrennt gezählt", () => {
    const employees = [
      employee({ id: "1", roleId: "role-a", managerId: "mgr-1", hiredAt: "2020-01-01" }),
      employee({ id: "2", roleId: "role-b", managerId: "mgr-2", hiredAt: "2020-01-01" }),
    ];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(2);
    expect(snap.yesterday.stockAtPeriodEnd.staffedResponsibilityAreaKeys.slice().sort()).toEqual([
      "role-a::mgr-1",
      "role-b::mgr-2",
    ]);
  });
});

describe("People Period Metrics — Future Knowledge Schutz", () => {
  it("20. zukünftiger Eintritt (hiredAt nach bounds.through) ist in Aktivität und Bestand unsichtbar", () => {
    const employees = [employee({ id: "1", hiredAt: "2025-03-20" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.activity.hires).toBe(0);
    expect(snap.yesterday.stockAtPeriodEnd.headcount).toBe(0);
    expect(snap.yesterday.stockAtPeriodEnd.headcountEmployeeIds).toEqual([]);
  });

  it("21. zukünftiger Austritt (terminatedAt nach bounds.through) lässt die Person zu bounds.through weiterhin aktiv erscheinen", () => {
    const employees = [employee({ id: "1", hiredAt: "2020-01-01", terminatedAt: "2025-03-20" })];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(snap.yesterday.activity.terminations).toBe(0);
    expect(snap.yesterday.stockAtPeriodEnd.headcount).toBe(1);
    expect(snap.yesterday.stockAtPeriodEnd.headcountEmployeeIds).toEqual(["1"]);
  });

  it("22. historischer Headcount bleibt stabil, unabhängig von späteren, nach bounds.through liegenden Ereignissen", () => {
    const employees = [
      employee({ id: "1", hiredAt: "2020-01-01" }),
      employee({ id: "2", hiredAt: "2025-03-20" }),
      employee({ id: "3", hiredAt: "2020-01-01", terminatedAt: "2025-03-25" }),
    ];
    const historical = generatePeoplePeriodMetrics("2025-03-15", employees);
    const later = generatePeoplePeriodMetrics("2025-04-01", employees);
    expect(historical.yesterday.stockAtPeriodEnd.headcount).toBe(2);
    // Zum späteren asOf sind beide Ereignisse eingetreten, der historische Wert
    // zu 2025-03-14 (Yesterday von 2025-03-15) bleibt davon unberührt.
    expect(historical.yesterday.stockAtPeriodEnd.headcount).toBe(2);
    expect(later.monthToDate.stockAtPeriodEnd.headcount).toBe(2);
  });

  it("23. historischer Verantwortungsbereichs-Status (besetzt/unbesetzt) bleibt stabil gegenüber späteren Ereignissen", () => {
    const employees = [
      employee({ id: "1", roleId: "role-a", managerId: "mgr-1", hiredAt: "2020-01-01", terminatedAt: "2025-03-20" }),
    ];
    const beforeTermination = generatePeoplePeriodMetrics("2025-03-15", employees);
    expect(beforeTermination.yesterday.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(1);
    expect(beforeTermination.yesterday.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe(0);
  });
});

describe("People Period Metrics — echte Nullwerte und Evidenz", () => {
  it("24. leere Employee-Liste liefert überall echte 0, keine undefined/NaN", () => {
    const snap = generatePeoplePeriodMetrics("2025-03-15", []);
    for (const period of [snap.yesterday, snap.weekToDate, snap.monthToDate]) {
      expect(period.activity.hires).toBe(0);
      expect(period.activity.terminations).toBe(0);
      expect(period.stockAtPeriodEnd.headcount).toBe(0);
      expect(period.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(0);
      expect(period.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe(0);
      expect(Number.isNaN(period.activity.hires)).toBe(false);
    }
  });

  it("25. hires === hiresEmployeeIds.length in jeder Periode", () => {
    const employees = [
      employee({ id: "1", hiredAt: "2025-03-10" }),
      employee({ id: "2", hiredAt: "2025-03-01" }),
    ];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    for (const period of [snap.yesterday, snap.weekToDate, snap.monthToDate]) {
      expect(period.activity.hires).toBe(period.activity.hiresEmployeeIds.length);
      expect(period.activity.terminations).toBe(period.activity.terminationsEmployeeIds.length);
    }
  });

  it("26. headcount === headcountEmployeeIds.length und staffedResponsibilityAreas === staffedResponsibilityAreaKeys.length", () => {
    const employees = [
      employee({ id: "1", roleId: "role-a", managerId: "mgr-1", hiredAt: "2020-01-01" }),
      employee({ id: "2", roleId: "role-b", managerId: "mgr-2", hiredAt: "2020-01-01" }),
    ];
    const snap = generatePeoplePeriodMetrics("2025-03-15", employees);
    for (const period of [snap.yesterday, snap.weekToDate, snap.monthToDate]) {
      expect(period.stockAtPeriodEnd.headcount).toBe(period.stockAtPeriodEnd.headcountEmployeeIds.length);
      expect(period.stockAtPeriodEnd.staffedResponsibilityAreas).toBe(
        period.stockAtPeriodEnd.staffedResponsibilityAreaKeys.length,
      );
      expect(period.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe(
        period.stockAtPeriodEnd.unstaffedResponsibilityAreaKeys.length,
      );
    }
  });
});

describe("People Period Metrics — keine personenbezogene Bewertung", () => {
  it("27. keine Ranking-/Performance-/Score-Felder irgendwo im Ergebnis", () => {
    const snap = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);
    const text = JSON.stringify(snap);
    for (const forbidden of [
      /rank/i,
      /score/i,
      /performance/i,
      /isTopPerformer/i,
      /produktivit/i,
      /bestermitarbeit/i,
      /schlechtestermitarbeit/i,
    ]) {
      expect(forbidden.test(text)).toBe(false);
    }
  });

  it("28. keine Namen (Employee.name) im Ergebnis — ausschließlich Employee-IDs", () => {
    const snap = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);
    const text = JSON.stringify(snap);
    // Kein einziger echter Vorname aus EMPLOYEES darf im serialisierten
    // Ergebnis vorkommen.
    for (const name of ["Jonas", "Katharina", "Fabian", "Svenja", "Lukas", "Antonia"]) {
      expect(text.includes(name)).toBe(false);
    }
  });

  it("29. keine Abwesenheits-/Verfügbarkeits-/Krankheitssprache im Ergebnis", () => {
    const snap = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);
    const text = JSON.stringify(snap);
    for (const forbidden of [/abwesen/i, /krank/i, /urlaub/i, /verfügbar/i, /burnout/i, /kündigungsrisiko/i]) {
      expect(forbidden.test(text)).toBe(false);
    }
  });

  it("30. keine Bewertungssprache (gesund/kritisch/effizient/ineffizient/überlastet) im Ergebnis", () => {
    const snap = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);
    const text = JSON.stringify(snap);
    for (const forbidden of [/\bgesund\b/i, /kritisch/i, /\beffizient\b/i, /ineffizient/i, /überlastet/i]) {
      expect(forbidden.test(text)).toBe(false);
    }
  });
});

describe("People Period Metrics — Determinismus", () => {
  it("31. zwei Aufrufe mit denselben Argumenten liefern ein identisches Ergebnis (kein RNG, reine Funktion)", () => {
    const a = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);
    const b = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);
    expect(a).toEqual(b);
  });

  it("32. Reihenfolge der übergebenen Employee-Liste beeinflusst das Ergebnis nicht (Evidenzlisten werden sortiert)", () => {
    const employees = [
      employee({ id: "2", hiredAt: "2025-03-10" }),
      employee({ id: "1", hiredAt: "2025-03-01" }),
    ];
    const reversed = [...employees].reverse();
    const a = generatePeoplePeriodMetrics("2025-03-15", employees);
    const b = generatePeoplePeriodMetrics("2025-03-15", reversed);
    expect(a).toEqual(b);
  });
});

describe("People Period Metrics — Referenzwelt (WORLD_NOW, empirisch)", () => {
  it("33. Gestern/WTD/MTD bei WORLD_NOW: keine Eintritte/Austritte, da alle EMPLOYEES-Daten historisch vor WORLD_NOW liegen", () => {
    const snap = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);
    for (const period of [snap.yesterday, snap.weekToDate, snap.monthToDate]) {
      expect(period.activity.hires).toBe(0);
      expect(period.activity.terminations).toBe(0);
    }
  });

  it("34. Headcount bei WORLD_NOW entspricht exakt der bereits an anderer Stelle getesteten Baseline (38)", () => {
    const snap = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);
    expect(snap.yesterday.stockAtPeriodEnd.headcount).toBe(38);
  });

  it("35. unbesetzte Verantwortungsbereiche bei WORLD_NOW sind 0 — echter, nicht erfundener Nullwert (kein Peer-Gruppen-Austritt hat je die letzte aktive Person entfernt)", () => {
    const snap = generatePeoplePeriodMetrics(WORLD_NOW, EMPLOYEES);
    expect(snap.yesterday.stockAtPeriodEnd.unstaffedResponsibilityAreas).toBe(0);
  });
});
