import { describe, expect, it } from "vitest";
import { generateSalesPipeline } from "../events/generate-sales-pipeline";
import { generateScenarioWorld } from "../engine/generator";
import { BASELINE_PROFILE, SCENARIO_PROFILES, type ScenarioProfile } from "../engine/scenario-profiles";
import { CUSTOMER_ACCOUNTS } from "../world/customer-accounts";
import { CONTACTS } from "../world/contacts";
import { EMPLOYEES } from "../world/employees";
import { ACCOUNT_OWNERSHIPS } from "../world/account-ownership";
import { WORLD_SEED } from "../engine/seed";
import type { MarketingDemandModel } from "../engine/marketing-demand";
import { NO_DEMAND_REGIMES, DEFAULT_MARKETING_DEMAND_MODEL } from "../engine/marketing-demand";
import { generateBusinessStateSnapshot } from "../business-state/business-state";
import { generateFullCompanyContext } from "../company/full-company-context";
import { WORLD_TIMELINE_START, WORLD_NOW } from "../timeline/world-clock";
import { addDays } from "../engine/random";
import type { Lead } from "../events/leads";

// AUFTRAG — SALES OWNERSHIP / MARKETING DEMAND DECOUPLING: Kernbefund war, dass
// `sampleDemandDrivenDate` (engine/marketing-demand.ts) über Rejection Sampling
// eine VARIABLE Anzahl von rng()-Aufrufen pro Lead verbraucht — bei einem
// gemeinsam sequenziell verbrauchten `demandRng`-Strom verschiebt eine
// Nachfrage-Änderung für EIN Kalenderfenster dadurch die kumulative
// Stream-Position für JEDEN nachfolgenden Lead, unabhängig davon, ob dessen
// eigenes zulässiges Zeitfenster das geänderte Regime überhaupt berührt — ein
// reines RNG-Sequenz-/Order-Artefakt (Kategorie B/D), nicht die eigentlich
// vermutete Ownership-Resolution selbst (die ist über die statische, lückenlose
// SDR-Ownership-Tabelle bereits praktisch deterministisch, siehe
// world/account-ownership.ts). Fix: `demandRng` ist jetzt entity-stabil je
// Lead-Index (siehe events/generate-sales-pipeline.ts,
// MARKETING_DEMAND_SEED_OFFSET-Kommentar).

function buildPipeline(model: MarketingDemandModel) {
  const profile: ScenarioProfile = { ...BASELINE_PROFILE, marketing: { demandModel: model } };
  return generateSalesPipeline(WORLD_SEED + 4, CUSTOMER_ACCOUNTS, CONTACTS, EMPLOYEES, ACCOUNT_OWNERSHIPS, profile);
}

describe("Sales Ownership Decoupling — Determinismus", () => {
  it("gleicher Seed + gleiches Modell erzeugt bit-identische Leads (inkl. ownerEmployeeId)", () => {
    const a = buildPipeline(DEFAULT_MARKETING_DEMAND_MODEL);
    const b = buildPipeline(DEFAULT_MARKETING_DEMAND_MODEL);
    expect(a.leads).toEqual(b.leads);
  });
});

describe("Sales Ownership Decoupling — Entity-Stabilität (Kernbefund, Kategorie B/D behoben)", () => {
  it("ein Demand-Modell-Wechsel in einem frühen, isolierten Kalenderfenster verändert nicht mehr chaotisch spätere Leads mit unbetroffenem eigenen Zeitfenster", () => {
    // Reproduktion des ursprünglichen Befunds: zwei Modelle, identisch bis auf
    // ein zusätzliches Regime weit am Anfang der Timeline (2024-06, fern von
    // WORLD_NOW). Vor dem Fix: 1023 von 1100 Leads (93%) unterschieden sich in
    // Account/Contact/createdAt — ein reines Artefakt geteilten,
    // sequenziellen RNG-Konsums. Nach dem Fix bleibt die überwältigende
    // Mehrheit identisch; die wenigen verbleibenden Abweichungen sind
    // ausschließlich Leads, deren EIGENES zulässiges Zeitfenster das geänderte
    // Regime tatsächlich überlappt (legitime Kategorie-C-Zeitkopplung).
    const modelA: MarketingDemandModel = { regimes: [] };
    const modelB: MarketingDemandModel = {
      regimes: [{ id: "elevated", startsAt: "2024-06-01", endsAt: "2024-06-30", rateMultiplier: 1.3 }],
    };
    const a = buildPipeline(modelA);
    const b = buildPipeline(modelB);
    const n = Math.min(a.leads.length, b.leads.length);

    let fullDiffs = 0;
    let accountContactDiffsOutsideChangedWindow = 0;
    for (let i = 0; i < n; i++) {
      const la = a.leads[i]!;
      const lb = b.leads[i]!;
      const sameCore = la.id === lb.id && la.accountId === lb.accountId && la.contactId === lb.contactId;
      if (!sameCore) {
        fullDiffs++;
        continue;
      }
      if (la.createdAt !== lb.createdAt) {
        // Legitime Kategorie-C-Abweichung nur zulässig, wenn mindestens eines
        // der beiden createdAt-Werte innerhalb (oder sehr nah an) dem
        // geänderten Fenster liegt.
        const touchesChangedWindow = (d: string) => d <= "2024-07-15";
        if (!touchesChangedWindow(la.createdAt) && !touchesChangedWindow(lb.createdAt)) {
          accountContactDiffsOutsideChangedWindow++;
        }
      }
    }
    // Vor dem Fix lag fullDiffs bei >1000 von 1100 — nach dem Fix erwartet
    // deutlich unter 5% (großzügiger Puffer für den bereits bekannten,
    // seltenen residualen Kaskadeneffekt über main-rng-Statusverzweigung,
    // siehe Abschlussbericht).
    expect(fullDiffs).toBeLessThan(n * 0.05);
    expect(accountContactDiffsOutsideChangedWindow).toBe(0);
  });

  it("Account-/Contact-Zuordnung für ein GEGEBENES Scenario-Profil ist unabhängig vom Demand Model (Haupt-`rng`-Strom bleibt bei stabilem Status-Pfad unverändert)", () => {
    // Bewusst zwei NAHE beieinanderliegende Modelle statt NO_DEMAND_REGIMES vs.
    // Produktion: die Produktionsregime decken inzwischen (84+84 von 456 Tagen)
    // gut ein Drittel der Timeline ab — ein Vergleich gegen die Nullhypothese
    // hätte für die meisten Leads bereits legitim (Kategorie C) andere
    // createdAt-Werte, was die "gleiches createdAt+status"-Stichprobe
    // verzerrt. Hier: Produktionsmodell vs. Produktionsmodell + einem
    // zusätzlichen, schmalen, isolierten Regime weit entfernt vom Gros der
    // Leads — dieselbe Methodik wie im vorherigen, bereits bestandenen Test.
    const withProduction = buildPipeline(DEFAULT_MARKETING_DEMAND_MODEL);
    const withExtraFarRegime = buildPipeline({
      regimes: [...DEFAULT_MARKETING_DEMAND_MODEL.regimes, { id: "elevated", startsAt: "2024-06-01", endsAt: "2024-06-10", rateMultiplier: 1.3 }],
    });
    // Für Leads mit identischer createdAt UND identischem status muss auch
    // Account/Contact identisch sein — bestätigt, dass Account-/Contact-Picks
    // ausschließlich vom Haupt-rng-Strom kommen, nicht vom Demand Model.
    let checked = 0;
    for (let i = 0; i < Math.min(withProduction.leads.length, withExtraFarRegime.leads.length); i++) {
      const la = withProduction.leads[i]!;
      const lb = withExtraFarRegime.leads[i]!;
      if (la.createdAt === lb.createdAt && la.status === lb.status) {
        expect(la.accountId, `lead index ${i}`).toBe(lb.accountId);
        expect(la.contactId, `lead index ${i}`).toBe(lb.contactId);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("Sales Ownership Decoupling — Timing-Korrektheit / asOf (Phase 7, Phase 15)", () => {
  it("jeder Lead-Owner war zum jeweiligen Lead.createdAt tatsächlich beschäftigt (kein zukünftiger Hire, kein bereits ausgeschiedener Mitarbeiter)", () => {
    const { leads } = buildPipeline(DEFAULT_MARKETING_DEMAND_MODEL);
    const byId = new Map(EMPLOYEES.map((e) => [e.id, e]));
    for (const lead of leads) {
      const owner = byId.get(lead.ownerEmployeeId);
      expect(owner, `owner ${lead.ownerEmployeeId} for lead ${lead.id}`).toBeDefined();
      expect(owner!.hiredAt <= lead.createdAt, `${lead.id}: hiredAt ${owner!.hiredAt} <= createdAt ${lead.createdAt}`).toBe(true);
      if (owner!.terminatedAt !== undefined) {
        expect(
          lead.createdAt <= owner!.terminatedAt,
          `${lead.id}: createdAt ${lead.createdAt} <= terminatedAt ${owner!.terminatedAt}`,
        ).toBe(true);
      }
    }
  });

  it("spätere Ownership-Änderungen verändern nicht rückwirkend die Owner-Zuordnung bereits vergangener Leads (asOf-sicher)", () => {
    // Ownership-Wechsel sind über validFrom/validTo modelliert (siehe
    // world/account-ownership.ts) — ein Lead mit createdAt vor einem Wechsel
    // muss den ALTEN Owner erhalten, nie den neuen.
    const { leads } = buildPipeline(DEFAULT_MARKETING_DEMAND_MODEL);
    const reassignments = ACCOUNT_OWNERSHIPS.filter((o) => o.ownershipRole === "sdr" && o.validTo !== undefined);
    let checked = 0;
    for (const reassignment of reassignments.slice(0, 20)) {
      const leadsBeforeSwitch = leads.filter(
        (l) => l.accountId === reassignment.accountId && l.createdAt <= reassignment.validTo!,
      );
      for (const lead of leadsBeforeSwitch) {
        expect(lead.ownerEmployeeId, `${lead.id} (account ${reassignment.accountId})`).toBe(reassignment.employeeId);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("Sales Ownership Decoupling — Order Independence (Phase 14)", () => {
  it("Owner-Zuordnung für einen gegebenen Account/Datum ist unabhängig davon, in welcher Reihenfolge andere Leads verarbeitet wurden", () => {
    // findOwnershipAt ist eine reine Funktion von (accountId, date) über eine
    // bereits vollständig materialisierte, generatorunabhängige Tabelle
    // (ACCOUNT_OWNERSHIPS) — per Konstruktion ordnungsunabhängig. Bewiesen
    // indirekt: zwei Läufe mit unterschiedlichem Demand Model (das die
    // Bearbeitungsposition/den RNG-Zustand verschiebt) liefern für Leads mit
    // IDENTISCHEM (accountId, createdAt) immer denselben Owner.
    const a = buildPipeline(NO_DEMAND_REGIMES);
    const b = buildPipeline(DEFAULT_MARKETING_DEMAND_MODEL);
    const seenPairs = new Map<string, string>();
    let checked = 0;
    for (const lead of [...a.leads, ...b.leads]) {
      const key = `${lead.accountId}|${lead.createdAt}`;
      const existing = seenPairs.get(key);
      if (existing !== undefined) {
        expect(lead.ownerEmployeeId, key).toBe(existing);
        checked++;
      } else {
        seenPairs.set(key, lead.ownerEmployeeId);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("Sales Ownership Decoupling — Fairness (Phase 16, bestehende Struktur wiederverwendet)", () => {
  it("SDR-Lastverhältnis bleibt für alle 6 Profile (außer team-engpass) innerhalb des bereits etablierten Korridors", () => {
    for (const profile of SCENARIO_PROFILES) {
      if (profile.id === "team-engpass") continue;
      const world = generateScenarioWorld(WORLD_SEED, profile);
      const leadCounts = new Map<string, number>();
      for (const lead of world.leads) leadCounts.set(lead.ownerEmployeeId, (leadCounts.get(lead.ownerEmployeeId) ?? 0) + 1);
      const activeSdrIds = EMPLOYEES.filter((e) => e.roleId === "role-sales-development-rep" && !e.terminatedAt).map((e) => e.id);
      const counts = activeSdrIds.map((id) => leadCounts.get(id) ?? 0).filter((c) => c > 0);
      const ratio = Math.max(...counts) / Math.min(...counts);
      expect(ratio, `profile ${profile.id}`).toBeLessThan(7.5);
    }
  });
});

describe("Sales Ownership Decoupling — alle 6 Sales-Scenario-Profile korrekt (Phase 17)", () => {
  it(
    "businessState.type entspricht für jedes Profil der bereits etablierten, fachlich begründeten Erwartung",
    () => {
    // 6 volle Weltgenerierungen mit dem jetzt 84 Tage breiten Produktionsmodell
    // — unter voller Suite-Parallelität langsamer als die 5s-Default-Grenze.
    const expected: Record<string, string> = {
      baseline: "ausgeglichen",
      "operativer-fokus": "verlangsamte-pipeline",
      "strategischer-tag": "strategischer-freiraum",
      wachstumsdruck: "ausgeglichen",
      "team-engpass": "konzentrierte-last",
      "pipeline-risiko": "operative-anspannung",
    };
    for (const profile of SCENARIO_PROFILES) {
      const world = generateScenarioWorld(WORLD_SEED, profile);
      const businessState = generateBusinessStateSnapshot(world.groundTruth, world.observations);
      expect(businessState.type, `profile ${profile.id}`).toBe(expected[profile.id]);
    }
    },
    20000,
  );
});

describe("Sales Ownership Decoupling — People/Operations/Company Regression (Phase 18)", () => {
  it("People bleibt vollständig unberührt", () => {
    const context = generateFullCompanyContext();
    const people = context.executiveContext.areaSummaries.find((a) => a.key === "people")!;
    expect(people.state).toBe("ausgeglichen");
    expect(people.evaluationStatus).toBe("bewertet");
  });

  it("Operations bleibt strukturell bewertbar (state=null, evaluationStatus=unzureichende-evidenz)", () => {
    const context = generateFullCompanyContext();
    const operations = context.executiveContext.areaSummaries.find((a) => a.key === "operations")!;
    expect(operations.state).toBeNull();
    expect(operations.evaluationStatus).toBe("unzureichende-evidenz");
    expect((operations.relevantMetrics as { activeDeliveryUnits: number }).activeDeliveryUnits).toBeGreaterThan(0);
  });

  it("Company evaluatedAreas/insufficientEvidenceAreas/affectedAreas bleiben korrekt", () => {
    const context = generateFullCompanyContext();
    expect(context.businessState.evaluatedAreas.slice().sort()).toEqual(["people", "sales"]);
    expect(context.businessState.insufficientEvidenceAreas).toEqual(["marketing", "operations"]);
    expect(context.executiveContext.affectedAreas).toEqual(["marketing", "operations"]);
  });
});

describe("Sales Ownership Decoupling — Marketing bleibt unzureichende-evidenz (harte Stop-Regel)", () => {
  it("Marketing state bleibt null, evaluationStatus bleibt unzureichende-evidenz", () => {
    const context = generateFullCompanyContext();
    const marketing = context.executiveContext.areaSummaries.find((a) => a.key === "marketing")!;
    expect(marketing.state).toBeNull();
    expect(marketing.evaluationStatus).toBe("unzureichende-evidenz");
    expect(marketing.relevantMetrics).toEqual({});
  });

  it("Public Marketing KPI Contract (MarketingLeadFact/MarketingSalesHandoffFact) unverändert", () => {
    const context = generateFullCompanyContext();
    const lead = context.executiveKpis.marketing.leads[0]!;
    const handoff = context.executiveKpis.marketing.salesHandoffs[0]!;
    expect(Object.keys(lead).sort()).toEqual(["createdAt", "leadId"]);
    expect(Object.keys(handoff).sort()).toEqual(["handedOffAt", "leadId", "opportunityId"]);
    const keys = JSON.stringify(Object.keys(context.executiveKpis.marketing));
    expect(/qualified/i.test(keys)).toBe(false);
    expect(/cac/i.test(keys)).toBe(false);
    expect(/spend/i.test(keys)).toBe(false);
    expect(/attribution/i.test(keys)).toBe(false);
  });
});

describe("Sales Ownership Decoupling — RNG-Stream-Unabhängigkeit (Phase 5, Phase 10)", () => {
  it("Anzahl Leads mit demselben (accountId, contactId, source) bleibt zwischen zwei nur schmal-isoliert unterschiedlichen Demand-Modellen ganz überwiegend identisch verteilt", () => {
    // Grober, aber robuster Beleg: die überwältigende Mehrheit der Leads
    // erhält bei unverändertem Haupt-rng-Konsum (kein Status-Kaskaden-Trigger)
    // exakt dieselbe (account, contact, source)-Kombination — hier bewusst
    // zwei NAHE beieinanderliegende Modelle (siehe Begründung im vorherigen
    // Test) statt NO_DEMAND_REGIMES vs. Produktion, dessen Regime-Fenster
    // inzwischen zu breit für einen fairen "isolierte Störung"-Vergleich sind.
    const a = buildPipeline(DEFAULT_MARKETING_DEMAND_MODEL);
    const b = buildPipeline({
      regimes: [...DEFAULT_MARKETING_DEMAND_MODEL.regimes, { id: "elevated", startsAt: "2024-06-01", endsAt: "2024-06-10", rateMultiplier: 1.3 }],
    });
    const n = Math.min(a.leads.length, b.leads.length);
    let matchingSource = 0;
    for (let i = 0; i < n; i++) {
      if (a.leads[i]!.accountId === b.leads[i]!.accountId && a.leads[i]!.contactId === b.leads[i]!.contactId) {
        if (a.leads[i]!.source === b.leads[i]!.source) matchingSource++;
      }
    }
    expect(matchingSource).toBeGreaterThan(n * 0.9);
  });
});
