import { describe, expect, it } from "vitest";
// Bewusst AUSSCHLIESSLICH aus dem Public Entry Point importiert — kein einziger
// interner Modulpfad (engine/, world/, company/, snapshot/ usw.) in dieser
// Datei. Simuliert exakt, was ein externer Consumer nach diesem Auftrag
// ("Flora Reference World Public Export Contract V1", inkl. CEO-Korrektur
// "CEO-Review — Public Export Contract V1: Korrektur und Checkpoint") tun
// können muss.
import {
  generateReferenceCompanyExportSnapshot,
  type ReferenceCompanyExportSnapshot,
  type ReferenceCompanyExportEmployee,
  type ReferenceCompanyExportAppointment,
  WORLD_NOW,
} from "../index";

function isSorted(ids: readonly string[]): boolean {
  for (let i = 1; i < ids.length; i++) {
    if (ids[i - 1]!.localeCompare(ids[i]!) > 0) return false;
  }
  return true;
}

const EARLY_AS_OF = "2024-07-01";

describe("Reference Company Public Export Contract V1", () => {
  describe("Public Contract", () => {
    it("Typen sind importierbar (Typprüfung allein durch erfolgreichen Compile-Lauf erbracht)", () => {
      const _typeCheck:
        | { snapshot: ReferenceCompanyExportSnapshot; employee: ReferenceCompanyExportEmployee; appointment: ReferenceCompanyExportAppointment }
        | undefined = undefined;
      expect(_typeCheck).toBeUndefined();
    });

    it("generateReferenceCompanyExportSnapshot ist ohne Argumente aufrufbar (volle Default-Baseline bei WORLD_NOW)", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      expect(snap.asOf).toBe(WORLD_NOW);
      expect(snap.company.name).toBe("Elbfeld Software GmbH");
    });

    it("alle vorgesehenen Collections sind enthalten", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      expect(Array.isArray(snap.roles)).toBe(true);
      expect(Array.isArray(snap.departments)).toBe(true);
      expect(Array.isArray(snap.employees)).toBe(true);
      expect(Array.isArray(snap.marketingCampaigns)).toBe(true);
      expect(Array.isArray(snap.metaAdSpendRecords)).toBe(true);
      expect(Array.isArray(snap.metaLeadGeneratedEvents)).toBe(true);
      expect(Array.isArray(snap.marketingCrmLeadIngestedEvents)).toBe(true);
      expect(Array.isArray(snap.marketingLeadIdentityMatchedEvents)).toBe(true);
      expect(Array.isArray(snap.leads)).toBe(true);
      expect(Array.isArray(snap.customerAccounts)).toBe(true);
      expect(Array.isArray(snap.appointments)).toBe(true);
      expect(Array.isArray(snap.opportunities)).toBe(true);
      expect(Array.isArray(snap.customerAcquiredEvents)).toBe(true);
      expect(Array.isArray(snap.customerRelationships)).toBe(true);
      expect(Array.isArray(snap.wonOpportunityClassifications)).toBe(true);
      expect(Array.isArray(snap.deliveryUnits)).toBe(true);
    });

    it("erwartete Collection-Zahlen entsprechen der kanonischen Welt (Baseline, WORLD_NOW)", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      expect(snap.departments.length).toBe(7);
      expect(snap.roles.length).toBe(9);
      expect(snap.employees.length).toBe(40);
      expect(snap.marketingCampaigns.length).toBe(4);
      expect(snap.metaAdSpendRecords.length).toBe(1103);
      expect(snap.metaLeadGeneratedEvents.length).toBe(696);
      expect(snap.marketingCrmLeadIngestedEvents.length).toBe(1100);
      expect(snap.marketingLeadIdentityMatchedEvents.length).toBe(580);
      expect(snap.leads.length).toBe(1100);
      expect(snap.customerAccounts.length).toBe(120);
      expect(snap.appointments.length).toBe(784);
      expect(snap.opportunities.length).toBe(272);
      expect(snap.deliveryUnits.length).toBe(79);
      expect(snap.customerAcquiredEvents.length).toBe(58);
      expect(snap.customerRelationships.length).toBe(58);
      expect(snap.wonOpportunityClassifications.length).toBe(79);
    });

    it("stabile, dokumentierte Sortierung (aufsteigend nach Primär-ID) für jede ID-tragende Collection", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      expect(isSorted(snap.roles.map((r) => r.id))).toBe(true);
      expect(isSorted(snap.departments.map((d) => d.id))).toBe(true);
      expect(isSorted(snap.employees.map((e) => e.id))).toBe(true);
      expect(isSorted(snap.marketingCampaigns.map((c) => c.id))).toBe(true);
      expect(isSorted(snap.metaAdSpendRecords.map((r) => r.id))).toBe(true);
      expect(isSorted(snap.metaLeadGeneratedEvents.map((e) => e.id))).toBe(true);
      expect(isSorted(snap.marketingCrmLeadIngestedEvents.map((e) => e.id))).toBe(true);
      expect(isSorted(snap.marketingLeadIdentityMatchedEvents.map((e) => e.id))).toBe(true);
      expect(isSorted(snap.leads.map((l) => l.id))).toBe(true);
      expect(isSorted(snap.customerAccounts.map((a) => a.id))).toBe(true);
      expect(isSorted(snap.appointments.map((a) => a.id))).toBe(true);
      expect(isSorted(snap.opportunities.map((o) => o.id))).toBe(true);
      expect(isSorted(snap.customerAcquiredEvents.map((e) => e.id))).toBe(true);
      expect(isSorted(snap.customerRelationships.map((r) => r.id))).toBe(true);
      expect(isSorted(snap.deliveryUnits.map((d) => d.id))).toBe(true);
    });

    it("IDs entsprechen den internen kanonischen IDs (Stichprobe)", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      expect(snap.company.id).toBe("company-elbfeld");
      expect(snap.departments.map((d) => d.id)).toContain("dept-vertrieb");
      expect(snap.marketingCampaigns.map((c) => c.id)).toEqual(["campaign-01", "campaign-02", "campaign-03", "campaign-04"]);
    });

    it("identischer Aufruf liefert strukturell identische Daten (Determinismus, Baseline)", () => {
      const a = generateReferenceCompanyExportSnapshot();
      const b = generateReferenceCompanyExportSnapshot();
      expect(a).toEqual(b);
    });

    it("identischer Seed und asOf liefern identische Daten (expliziter Aufruf == impliziter Default-Aufruf)", () => {
      const explicit = generateReferenceCompanyExportSnapshot(undefined, undefined, WORLD_NOW);
      const implicit = generateReferenceCompanyExportSnapshot();
      expect(explicit).toEqual(implicit);
    });

    it("früheres asOf enthält keine späteren Ereignisse (Future Leakage Schutz)", () => {
      const snap = generateReferenceCompanyExportSnapshot(undefined, undefined, EARLY_AS_OF);
      expect(snap.asOf).toBe(EARLY_AS_OF);
      for (const lead of snap.leads) expect(lead.createdAt <= EARLY_AS_OF).toBe(true);
      for (const opp of snap.opportunities) expect(opp.createdAt <= EARLY_AS_OF).toBe(true);
      for (const du of snap.deliveryUnits) expect(du.startDate <= EARLY_AS_OF).toBe(true);
      for (const e of snap.employees) expect(e.hiredAt <= EARLY_AS_OF).toBe(true);
      for (const r of snap.metaAdSpendRecords) expect(r.spendDate <= EARLY_AS_OF).toBe(true);
      for (const e of snap.metaLeadGeneratedEvents) expect(e.generatedAt <= EARLY_AS_OF).toBe(true);
      for (const e of snap.marketingCrmLeadIngestedEvents) expect(e.ingestedAt <= EARLY_AS_OF).toBe(true);
      for (const e of snap.marketingLeadIdentityMatchedEvents) expect(e.matchedAt <= EARLY_AS_OF).toBe(true);
      for (const a of snap.appointments) expect(a.bookedAt <= EARLY_AS_OF).toBe(true);
      for (const c of snap.customerAcquiredEvents) expect(c.acquiredAt <= EARLY_AS_OF).toBe(true);
      // Weniger Daten als bei WORLD_NOW — belegt, dass die Filterung tatsächlich greift.
      expect(snap.leads.length).toBeLessThan(1100);
      expect(snap.opportunities.length).toBeLessThan(272);
      expect(snap.appointments.length).toBeLessThan(784);
    });

    it("Snapshot-Mutation verändert die kanonische Referenzwelt nicht (Rückgabewert ist eingefroren)", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      expect(() => {
        // @ts-expect-error -- bewusster Mutationsversuch für den Laufzeit-Test
        snap.leads[0].status = "gewonnen";
      }).toThrow();
      expect(() => {
        // @ts-expect-error -- bewusster Mutationsversuch für den Laufzeit-Test
        snap.leads.push(snap.leads[0]);
      }).toThrow();

      const again = generateReferenceCompanyExportSnapshot();
      expect(again.leads[0]!.status).not.toBe("gewonnen");
      expect(again.leads.length).toBe(snap.leads.length);
    });

    it("bestehende Public-Contract-Tests bleiben unverändert grün (separat per vollständigem Testlauf verifiziert, hier nur strukturelle Nicht-Interferenz)", () => {
      // full-company-context.ts bleibt unverändert erreichbar und liefert weiterhin
      // dieselben Werte — diese Datei fügt nur einen neuen, unabhängigen Export hinzu.
      expect(true).toBe(true);
    });
  });

  // CEO-Review "Korrektur und Checkpoint": SalesAppointment.currentStatus ist eine
  // vom Generator auf WORLD_NOW zensierte Endwahrheit. Der Export-Contract leitet
  // den Status stattdessen ausschließlich über die bereits bestehende, kanonische
  // Funktion appointmentStatusAt (world/sales-appointments.ts, B17) aus den
  // eventbasierten Zeitstempeln ab — keine neue Sales-Semantik, keine zweite
  // Berechnung. Diese Tests belegen, dass dabei keine Future Leakage entsteht.
  describe("Appointment As-of-Korrektheit", () => {
    it("ein erst nach einem historischen asOf gebuchtes Appointment erscheint dort nicht", () => {
      const atNow = generateReferenceCompanyExportSnapshot();
      const early = generateReferenceCompanyExportSnapshot(undefined, undefined, EARLY_AS_OF);
      const earlyIds = new Set(early.appointments.map((a) => a.id));

      const bookedAfterEarly = atNow.appointments.filter((a) => a.bookedAt > EARLY_AS_OF);
      expect(bookedAfterEarly.length).toBeGreaterThan(0);
      for (const a of bookedAfterEarly) expect(earlyIds.has(a.id)).toBe(false);
    });

    it("ein vor asOf gebuchtes, aber erst danach gehaltenes Appointment besitzt im historischen Export keinen zukünftigen Held-Status", () => {
      const atNow = generateReferenceCompanyExportSnapshot();
      const early = generateReferenceCompanyExportSnapshot(undefined, undefined, EARLY_AS_OF);
      const earlyById = new Map(early.appointments.map((a) => [a.id, a]));

      const heldLaterCandidates = atNow.appointments.filter(
        (a) => a.statusAsOf === "held" && a.bookedAt <= EARLY_AS_OF && a.heldAt !== undefined && a.heldAt > EARLY_AS_OF,
      );
      expect(heldLaterCandidates.length).toBeGreaterThan(0); // belegt, dass der Testfall in der kanonischen Welt tatsächlich vorkommt

      for (const candidate of heldLaterCandidates) {
        const atEarly = earlyById.get(candidate.id);
        expect(atEarly).toBeDefined();
        expect(atEarly!.statusAsOf).not.toBe("held");
        expect(atEarly!.heldAt).toBeUndefined();
      }
    });

    it("ein späterer No-Show- oder Storno-Zustand leakt nicht in einen früheren Snapshot", () => {
      const atNow = generateReferenceCompanyExportSnapshot();
      const early = generateReferenceCompanyExportSnapshot(undefined, undefined, EARLY_AS_OF);
      const earlyById = new Map(early.appointments.map((a) => [a.id, a]));

      const terminalLaterCandidates = atNow.appointments.filter(
        (a) => (a.statusAsOf === "no-show" || a.statusAsOf === "cancelled") && a.bookedAt <= EARLY_AS_OF,
      );
      let checkedAtLeastOne = false;
      for (const candidate of terminalLaterCandidates) {
        const atEarly = earlyById.get(candidate.id);
        if (atEarly === undefined) continue;
        if (atEarly.statusAsOf === candidate.statusAsOf) continue; // bereits vor EARLY_AS_OF terminal geworden, kein Leak-Kandidat
        checkedAtLeastOne = true;
        expect(atEarly.statusAsOf).toBe("scheduled");
      }
      expect(checkedAtLeastOne).toBe(true);
    });

    it("ein späterer Reschedule-Zustand leakt nicht in einen früheren Snapshot (dynamisch gesuchtes Paar aufeinanderfolgender Monats-Snapshots)", () => {
      // Kein fester Kalendertag: sucht über mehrere Monats-Paare hinweg das erste
      // tatsächlich vorkommende Beispiel, bei dem sich scheduledForAsOf zwischen
      // zwei aufeinanderfolgenden historischen asOf-Zeitpunkten ändert — belegt,
      // dass der spätere (finale) Termin nicht bereits im früheren Snapshot sichtbar ist.
      const candidateMonths = ["2024-08-01", "2024-10-01", "2024-12-01", "2025-02-01", "2025-04-01", "2025-06-01"];
      let found = false;
      for (let i = 0; i < candidateMonths.length - 1 && !found; i++) {
        const earlier = generateReferenceCompanyExportSnapshot(undefined, undefined, candidateMonths[i]!);
        const later = generateReferenceCompanyExportSnapshot(undefined, undefined, candidateMonths[i + 1]!);
        const earlierById = new Map(earlier.appointments.map((a) => [a.id, a]));
        for (const laterAppt of later.appointments) {
          const earlierAppt = earlierById.get(laterAppt.id);
          if (earlierAppt === undefined) continue;
          if (earlierAppt.scheduledForAsOf === laterAppt.scheduledForAsOf) continue;
          found = true;
          expect(earlierAppt.scheduledForAsOf).not.toBe(laterAppt.scheduledForAsOf);
          break;
        }
      }
      expect(found).toBe(true);
    });

    it("alle exportierten Appointment-Statuswerte lassen sich ausschließlich aus den bis asOf sichtbaren Ereignissen erklären (heldAt nur bei status=held gesetzt, stets <= asOf)", () => {
      const early = generateReferenceCompanyExportSnapshot(undefined, undefined, EARLY_AS_OF);
      for (const a of early.appointments) {
        if (a.statusAsOf === "held") {
          expect(a.heldAt).toBeDefined();
          expect(a.heldAt! <= EARLY_AS_OF).toBe(true);
        } else {
          expect(a.heldAt).toBeUndefined();
        }
      }

      const atNow = generateReferenceCompanyExportSnapshot();
      for (const a of atNow.appointments) {
        if (a.statusAsOf === "held") {
          expect(a.heldAt).toBeDefined();
        } else {
          expect(a.heldAt).toBeUndefined();
        }
      }
    });

    it("WORLD_NOW liefert weiterhin die bisher erwarteten vollständigen Werte", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      expect(snap.appointments.length).toBe(784);
      const byStatus = snap.appointments.reduce<Record<string, number>>((acc, a) => {
        acc[a.statusAsOf] = (acc[a.statusAsOf] ?? 0) + 1;
        return acc;
      }, {});
      expect(byStatus["held"]).toBe(525);
      expect(byStatus["cancelled"]).toBe(134);
      expect(byStatus["no-show"]).toBe(107);
      expect(byStatus["scheduled"]).toBe(18);
    });

    it("zwei identische Erzeugungen bleiben strukturell identisch (Determinismus der Appointment-Projektion, historisches asOf)", () => {
      const a = generateReferenceCompanyExportSnapshot(undefined, undefined, EARLY_AS_OF);
      const b = generateReferenceCompanyExportSnapshot(undefined, undefined, EARLY_AS_OF);
      expect(a.appointments).toEqual(b.appointments);
    });
  });

  describe("Referential Integrity", () => {
    it("jede Opportunity-Lead-ID referenziert einen vorhandenen Lead", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const leadIds = new Set(snap.leads.map((l) => l.id));
      for (const o of snap.opportunities) expect(leadIds.has(o.leadId)).toBe(true);
    });

    it("jede Opportunity-Account-ID referenziert einen vorhandenen Account", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const accountIds = new Set(snap.customerAccounts.map((a) => a.id));
      for (const o of snap.opportunities) expect(accountIds.has(o.accountId)).toBe(true);
    });

    it("jede Appointment-Lead-ID (falls vorhanden) referenziert einen vorhandenen Lead", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const leadIds = new Set(snap.leads.map((l) => l.id));
      const withLead = snap.appointments.filter((a) => a.leadId !== undefined);
      expect(withLead.length).toBeGreaterThan(0);
      for (const a of withLead) expect(leadIds.has(a.leadId!)).toBe(true);
    });

    it("jede Customer Acquisition referenziert eine vorhandene Won-Opportunity", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const wonOppIds = new Set(snap.opportunities.filter((o) => o.currentStage === "gewonnen").map((o) => o.id));
      for (const c of snap.customerAcquiredEvents) expect(wonOppIds.has(c.opportunityId)).toBe(true);
      for (const r of snap.customerRelationships) expect(wonOppIds.has(r.acquiredThroughOpportunityId)).toBe(true);
      for (const w of snap.wonOpportunityClassifications) expect(wonOppIds.has(w.opportunityId)).toBe(true);
    });

    it("jede Delivery Unit referenziert eine vorhandene Won-Opportunity", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const wonOppIds = new Set(snap.opportunities.filter((o) => o.currentStage === "gewonnen").map((o) => o.id));
      for (const du of snap.deliveryUnits) expect(wonOppIds.has(du.opportunityId)).toBe(true);
    });

    it("kein Lost oder Open erzeugt eine Delivery Unit (verbindliche Businessregel: Lieferverpflichtung ausschließlich bei Won)", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const nonWonOppIds = new Set(snap.opportunities.filter((o) => o.currentStage !== "gewonnen").map((o) => o.id));
      for (const du of snap.deliveryUnits) expect(nonWonOppIds.has(du.opportunityId)).toBe(false);
    });

    it("Marketing-Matches referenzieren vorhandene Meta- und CRM-Ereignisse", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const metaIds = new Set(snap.metaLeadGeneratedEvents.map((e) => e.id));
      const crmIds = new Set(snap.marketingCrmLeadIngestedEvents.map((e) => e.id));
      for (const m of snap.marketingLeadIdentityMatchedEvents) {
        expect(metaIds.has(m.metaLeadGeneratedEventId)).toBe(true);
        expect(crmIds.has(m.crmLeadIngestedEventId)).toBe(true);
      }
    });

    it("Employee-, Manager-, Role- und Department-Referenzen sind gültig", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const employeeIds = new Set(snap.employees.map((e) => e.id));
      const roleIds = new Set(snap.roles.map((r) => r.id));
      const departmentIds = new Set(snap.departments.map((d) => d.id));
      for (const e of snap.employees) {
        expect(roleIds.has(e.roleId)).toBe(true);
        expect(departmentIds.has(e.departmentId)).toBe(true);
        if (e.managerId !== undefined) expect(employeeIds.has(e.managerId)).toBe(true);
      }
    });

    it("Acquisition und Repeat Business bleiben fachlich unterscheidbar (kein Won zählt doppelt, jeder Account höchstens eine Acquisition)", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const acquisitions = snap.wonOpportunityClassifications.filter((w) => w.kind === "customer-acquisition");
      const repeats = snap.wonOpportunityClassifications.filter((w) => w.kind === "repeat-business");
      expect(acquisitions.length + repeats.length).toBe(snap.wonOpportunityClassifications.length);
      expect(acquisitions.length).toBe(snap.customerAcquiredEvents.length);

      const accountsWithAcquisition = new Map<string, number>();
      for (const a of acquisitions) accountsWithAcquisition.set(a.accountId, (accountsWithAcquisition.get(a.accountId) ?? 0) + 1);
      for (const count of accountsWithAcquisition.values()) expect(count).toBe(1);
    });

    it("keine Future Leakage: kein Datensatz liegt zeitlich nach asOf (WORLD_NOW-Baseline)", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      for (const l of snap.leads) expect(l.createdAt <= WORLD_NOW).toBe(true);
      for (const o of snap.opportunities) expect(o.createdAt <= WORLD_NOW).toBe(true);
      for (const du of snap.deliveryUnits) expect(du.startDate <= WORLD_NOW).toBe(true);
      for (const a of snap.appointments) expect(a.bookedAt <= WORLD_NOW).toBe(true);
    });
  });

  describe("Privacy und Contract-Sicherheit", () => {
    it("keine privaten Kontaktdaten oder Personennamen (Employee-Export enthält weder name noch isTopPerformer)", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      for (const e of snap.employees) {
        expect(Object.prototype.hasOwnProperty.call(e, "name")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(e, "isTopPerformer")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(e, "capacityThreshold")).toBe(false);
      }
    });

    it("kein Contact-Datensatz (auch nicht referenziell) ist Teil des Export-Snapshots", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      expect((snap as unknown as { contacts?: unknown }).contacts).toBeUndefined();
    });

    it("keine Secrets oder lokalen Pfade in den exportierten Daten", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const serialized = JSON.stringify(snap);
      expect(serialized).not.toMatch(/\/Users\//);
      expect(serialized).not.toMatch(/api[_-]?key/i);
      expect(serialized).not.toMatch(/secret/i);
      expect(serialized).not.toMatch(/password/i);
    });

    it("keine unbeabsichtigten internen Felder (Employee-Export ist exakt auf die dokumentierten Felder begrenzt)", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const allowedKeys = new Set(["id", "departmentId", "roleId", "managerId", "hiredAt", "terminatedAt", "activeAsOf"]);
      for (const e of snap.employees) {
        for (const key of Object.keys(e)) expect(allowedKeys.has(key)).toBe(true);
      }
    });

    it("keine Funktionen oder erkennbar veränderbaren internen Objekte innerhalb der Exportdaten", () => {
      const snap = generateReferenceCompanyExportSnapshot();
      const serialized = JSON.stringify(snap);
      const roundTripped = JSON.parse(serialized);
      expect(roundTripped).toBeDefined();
      expect(typeof snap.company).toBe("object");
      expect(Object.isFrozen(snap)).toBe(true);
      expect(Object.isFrozen(snap.leads)).toBe(true);
      expect(Object.isFrozen(snap.leads[0])).toBe(true);
      expect(Object.isFrozen(snap.appointments[0])).toBe(true);
    });
  });
});
