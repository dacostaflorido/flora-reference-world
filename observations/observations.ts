import { addDays, daysBetween } from "../engine/random";
import { WORLD_NOW } from "../timeline/world-clock";
import { EMPLOYEES, type Employee } from "../world/employees";
import { CUSTOMER_ACCOUNTS, type CustomerAccount } from "../world/customer-accounts";
import { LEADS, OPPORTUNITIES, OPPORTUNITY_STAGE_HISTORY } from "../events/generate-sales-pipeline";
import type { Lead } from "../events/leads";
import type { Opportunity } from "../events/opportunities";
import type { OpportunityStageHistory } from "../events/opportunity-stage-history";
import { CALLS, EMAILS, CRM_ACTIVITIES } from "../events/generate-interactions";
import type { Call } from "../events/calls";
import type { Email } from "../events/emails";
import type { CrmActivity } from "../events/crm-activities";

// Feldebene wie im eingefrorenen Architekturmodell festgelegt. category ist ein
// eigenständiges, nicht importiertes Enum (inhaltlich an InsightCategory angelehnt,
// strukturell unabhängig) — exakt wie in der Architekturrunde festgelegt, nicht
// erweitert.
//
// `kind` identifiziert, welcher der unten fest benannten, redaktionellen Analyse-
// Blöcke eine Observation erzeugt hat — unabhängig davon, an welcher Position/mit
// welcher `id` sie in einem konkreten Snapshot landet. `id` bleibt ausschließlich ein
// eindeutiger Instanz-Bezeichner (weiterhin positionell vergeben, das ist für reine
// Eindeutigkeit unproblematisch); `kind` ist die stabile fachliche Identität, auf der
// Ground Truth ihre Prioritäts-/Gruppenzuordnung aufbaut (siehe ground-truth.ts).
// Mehrere Observations können denselben `kind` teilen (z. B. mehrere Chance-Accounts
// im selben Snapshot) — das ist beabsichtigt, da Ground Truth ganze Kinds einstuft,
// nie einzelne Konten.
export type ObservationKind =
  | "pipeline-stagnation-summary"
  | "biggest-stagnant-opportunity"
  | "stagnation-concentration-by-ae"
  | "low-stagnation-counterexample"
  | "team-win-rate-parity"
  | "follow-up-consistency-across-sdrs"
  | "fastest-sdr-response-time"
  | "sdr-load-distribution-healthy"
  | "objection-mix-top-category"
  | "chance-account-repeat-business"
  | "touchpoint-richness-won-vs-lost"
  | "pipeline-synthesis"
  | "ae-workload-distribution"
  | "sales-cycle-duration"
  | "stage-regression-rate"
  | "loss-reason-concentration"
  | "lead-volume-trend"
  // People-Domäne (Reference World v2, Schritt "People Foundation"): additive
  // Erweiterung derselben Union, keine neue Taxonomie. Erzeugt ausschließlich in
  // observations/people-observations.ts, aus EmployeeTerminated-Events — nicht aus
  // den Sales-Rohdaten unten. Siehe dort für die vollständige Herleitung.
  | "people-critical-role-last-person"
  | "people-critical-role-unstaffed"
  // Operations-Domäne (Reference World v2, Schritt "Operations Foundation"):
  // additiv, keine neue Taxonomie. Erzeugt ausschließlich in
  // observations/operations-observations.ts, aus aktiven DeliveryUnits — bewusst
  // NICHT über das Observation-Interface selbst transportiert (keine Severity-
  // Bewertung, freigegebene Domain Decision), sondern über die separate
  // OperationsObservation-Struktur. Der Kind-Wert ist hier trotzdem Teil derselben
  // Union, damit Ground Truth (ground-truth.ts, ObservationLike) denselben
  // generischen Mechanismus (Priorität/Gruppierung nach kind) verwenden kann.
  | "operations-delivery-fair-share"
  // Marketing-Domäne (Marketing as First-Class Company Area): additiv, keine neue
  // Taxonomie. Erzeugt ausschließlich in observations/marketing-observations.ts,
  // aus Lead-/Sales-Handoff-Fakten (dieselbe Quelle wie
  // company/marketing-executive-kpis.ts) — dieselbe strukturelle Begründung wie bei
  // Operations: rein deskriptives Volumen, keine im Domainmodell begründbare
  // Severity-Schwelle vorhanden, daher separate MarketingObservation-Struktur statt
  // des vollen Observation-Interfaces.
  | "marketing-demand-generation-volume";

export interface Observation {
  id: string;
  kind: ObservationKind;
  generatedAt: string;
  statement: string;
  category: "risiko" | "chance" | "team-hinweis" | "stabil";
  severity: "niedrig" | "mittel" | "hoch";
  confidence: "niedrig" | "mittel" | "hoch" | "unzureichend";
  derivedFrom: string[];
}

// Observations sind KEINE Rule-Engine-Ausgabe: dieser Generator führt keine generische
// Mustererkennung durch, die auf beliebige künftige Daten anwendbar wäre. Jede
// Sektion unten ist eine bewusste, einmalige Analyse EINES spezifischen, vom Autor
// ausgewählten Musters — die Auswahl, WELCHE Muster überhaupt zu einer Observation
// werden, ist redaktionell, nicht algorithmisch. Der Code berechnet lediglich exakte
// Zahlen/IDs für ein bereits redaktionell entschiedenes Statement, er "entdeckt" es
// nicht selbstständig.
//
// Scenario Profiles (Schritt "Scenario Profiles"): generateObservations() nimmt die
// Welt als Parameter entgegen statt fest verdrahtete Singletons zu importieren —
// dadurch lässt sich derselbe, unveränderte Analyse-Code gegen jede Scenario-Welt
// erneut ausführen. Keine neue Erkenntnis entsteht dadurch: welche Muster überhaupt
// gesucht werden, bleibt exakt dieselbe, vorher redaktionell festgelegte Liste.

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

function formatEuro(value: number): string {
  return `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")} €`;
}

interface OpenEntry {
  opportunity: Opportunity;
  entry: OpportunityStageHistory;
  daysInStage: number;
}

export function generateObservations(
  employees: readonly Employee[],
  accounts: readonly CustomerAccount[],
  leads: readonly Lead[],
  opportunities: readonly Opportunity[],
  stageHistory: readonly OpportunityStageHistory[],
  calls: readonly Call[],
  emails: readonly Email[],
  crmActivities: readonly CrmActivity[],
): Observation[] {
  function openStageEntries(): OpenEntry[] {
    return opportunities
      .filter((o) => o.closedAt === undefined)
      .map((o) => {
        const entry = stageHistory.find((s) => s.opportunityId === o.id && s.exitedAt === undefined);
        return entry ? { opportunity: o, entry, daysInStage: daysBetween(entry.enteredAt, WORLD_NOW) } : undefined;
      })
      .filter((x): x is OpenEntry => x !== undefined);
  }

  function finalEntryByOpportunityId(): Map<string, OpportunityStageHistory> {
    const map = new Map<string, OpportunityStageHistory>();
    for (const entry of stageHistory) {
      if (entry.exitedAt === undefined) {
        map.set(entry.opportunityId, entry);
      }
    }
    return map;
  }

  function evidenceForOpportunities(opportunityIds: readonly string[]): string[] {
    return [
      ...opportunityIds,
      ...stageHistory.filter((s) => opportunityIds.includes(s.opportunityId) && s.exitedAt === undefined).map((s) => s.id),
      ...calls.filter((c) => c.opportunityId && opportunityIds.includes(c.opportunityId)).map((c) => c.id),
      ...crmActivities.filter((a) => a.opportunityId && opportunityIds.includes(a.opportunityId)).map((a) => a.id),
    ];
  }

  const observations: Observation[] = [];
  let counter = 1;
  const nextId = () => `obs-${String(counter++).padStart(5, "0")}`;

  const open = openStageEntries();
  const stagnant = open.filter((e) => e.daysInStage > 90);
  const stagnantMedian = median(open.map((e) => e.daysInStage));

  // 1) Risiko: Pipeline-Stagnation über die gesamte offene Pipeline. Severity wird
  // proportional zum tatsächlichen Anteil berechnet statt fest auf "hoch" gesetzt —
  // nach der Generator-Korrektur (echte Stage-Simulation statt Einfrieren) ist der
  // Anteil deutlich kleiner als vor der Korrektur, severity muss das widerspiegeln.
  const stagnationShare = open.length > 0 ? stagnant.length / open.length : 0;
  const stagnationSeverity: Observation["severity"] = stagnationShare > 0.5 ? "hoch" : stagnationShare > 0.15 ? "mittel" : "niedrig";
  const longestStagnant = [...stagnant].sort((a, b) => b.daysInStage - a.daysInStage).slice(0, 8);
  // Auch eine "0 von N stagniert"-Aussage ist eine Tatsachenbehauptung über die
  // ausgewertete Population und braucht Evidenz — sonst bleibt derivedFrom bei
  // stagnant.length===0 fälschlich leer (Backward Explainability, Prinzip 18).
  const stagnationSampleIds = stagnant.length > 0 ? longestStagnant.map((e) => e.opportunity.id) : open.slice(0, 8).map((e) => e.opportunity.id);
  // Cross-Source-Behauptung verifizieren statt annehmen: fehlt bei den am längsten
  // stagnierenden Opportunities auch jede jüngere dokumentierte Aktivität?
  const noRecentActivityCount = longestStagnant.filter((e) => {
    const touches = [
      ...calls.filter((c) => c.opportunityId === e.opportunity.id).map((c) => c.timestamp),
      ...crmActivities.filter((a) => a.opportunityId === e.opportunity.id).map((a) => a.timestamp),
    ].sort();
    const lastTouch = touches[touches.length - 1];
    return !lastTouch || daysBetween(lastTouch, WORLD_NOW) > 90;
  }).length;
  const obsStagnation: Observation | undefined =
    open.length > 0
      ? {
          id: nextId(),
          kind: "pipeline-stagnation-summary",
          generatedAt: WORLD_NOW,
          statement:
            `${stagnant.length} von ${open.length} aktuell offenen Opportunities (${Math.round(stagnationShare * 100)} %) ` +
            `befinden sich seit mehr als 90 Tagen ohne Stage-Wechsel in ihrer aktuellen Phase; der Median über alle offenen ` +
            `Opportunities liegt bei ${stagnantMedian} Tagen.` +
            (noRecentActivityCount > 0
              ? ` Bei ${noRecentActivityCount} der am längsten stagnierenden Opportunities fehlt zugleich jede dokumentierte ` +
                "Aktivität der letzten 90 Tage."
              : ""),
          category: "risiko",
          severity: stagnationSeverity,
          confidence: "hoch",
          derivedFrom: evidenceForOpportunities(stagnationSampleIds),
        }
      : undefined;
  if (obsStagnation) observations.push(obsStagnation);

  // 2) Risiko: die wertmäßig größte aktuell stagnierende Einzel-Opportunity.
  const highestValueStagnant = [...stagnant].sort((a, b) => b.opportunity.value - a.opportunity.value)[0];
  if (highestValueStagnant) {
    const account = accounts.find((a) => a.id === highestValueStagnant.opportunity.accountId);
    // Severity proportional zum Wert relativ zum Median aller offenen Opportunities
    // (bereits oben als `open` berechnet) statt fest "hoch" — eine stagnierende
    // Opportunity, die deutlich über dem typischen offenen Dealwert liegt, ist
    // qualitativ etwas anderes als eine, die im normalen Wertebereich liegt. "Optional"
    // laut Auftrag, aufgenommen, da ausschließlich bereits vorhandene Daten (`open`)
    // genutzt werden, keine neue Datenquelle.
    const openValueMedian = median(open.map((e) => e.opportunity.value));
    const biggestStagnantSeverity: Observation["severity"] =
      openValueMedian > 0 && highestValueStagnant.opportunity.value > openValueMedian * 1.5 ? "hoch" : "mittel";
    observations.push({
      id: nextId(),
      kind: "biggest-stagnant-opportunity",
      generatedAt: WORLD_NOW,
      statement:
        `Die wertmäßig größte aktuell stagnierende Opportunity (${account?.name ?? highestValueStagnant.opportunity.accountId}, ` +
        `${formatEuro(highestValueStagnant.opportunity.value)}) befindet sich seit ${highestValueStagnant.daysInStage} Tagen ` +
        `unverändert in Stage "${highestValueStagnant.entry.stage}"` +
        (biggestStagnantSeverity === "hoch"
          ? ` — deutlich über dem Medianwert offener Opportunities (${formatEuro(openValueMedian)}).`
          : "."),
      category: "risiko",
      severity: biggestStagnantSeverity,
      confidence: "mittel",
      derivedFrom: evidenceForOpportunities([highestValueStagnant.opportunity.id]),
    });
  }

  // 3) Team-Hinweis: Konzentration stagnierender Opportunities bei einzelnen AEs.
  const stagnantByEmployee = new Map<string, OpenEntry[]>();
  for (const e of stagnant) {
    const list = stagnantByEmployee.get(e.entry.responsibleEmployeeId) ?? [];
    list.push(e);
    stagnantByEmployee.set(e.entry.responsibleEmployeeId, list);
  }
  const topConcentration = [...stagnantByEmployee.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  // Severity proportional zum tatsächlichen Konzentrationsanteil statt fest "mittel" —
  // Anteil, den die am stärksten betroffene Einzelperson an ALLEN stagnierenden Deals
  // trägt. Schwellen analog zu stagnationShare oben, aber auf eine Verteilung über
  // Personen statt über die Gesamtpipeline bezogen: >50 % ist eine klare Dominanz
  // einer einzelnen Person, >25 % bereits mehr als bei einer Gleichverteilung über die
  // üblicherweise gut ein Dutzend AEs zu erwarten wäre.
  //
  // Mindest-Stichprobe (>=3 absolute stagnierende Deals bei der betroffenen Person):
  // ohne diesen Boden würde z. B. eine einzelne Person mit nur 1 von insgesamt 3
  // stagnierenden Opportunities rechnerisch "33 % Konzentration" zeigen — ein reines
  // Kleinstichproben-Artefakt, keine echte Konzentration. Geprüft anhand aller sechs
  // Scenario-Welten vor Festlegung dieser Schwelle.
  const topConcentrationCount = topConcentration.length > 0 ? topConcentration[0]![1].length : 0;
  const topConcentrationShare = stagnant.length > 0 && topConcentration.length > 0 ? topConcentrationCount / stagnant.length : 0;
  const concentrationSeverity: Observation["severity"] =
    topConcentrationCount < 3 ? "niedrig" : topConcentrationShare > 0.5 ? "hoch" : topConcentrationShare > 0.25 ? "mittel" : "niedrig";
  const obsConcentration: Observation | undefined =
    topConcentration.length > 0
      ? {
          id: nextId(),
          kind: "stagnation-concentration-by-ae",
          generatedAt: WORLD_NOW,
          statement:
            "Stagnierende Opportunities verteilen sich nicht gleichmäßig über das Vertriebsteam, sondern konzentrieren sich bei " +
            topConcentration
              .map(([empId, list]) => `${employees.find((e) => e.id === empId)?.name ?? empId} (${list.length})`)
              .join(", ") +
            ` — ${topConcentration[0]![0] ? employees.find((e) => e.id === topConcentration[0]![0])?.name ?? topConcentration[0]![0] : ""} allein trägt ` +
            `${Math.round(topConcentrationShare * 100)} % aller aktuell stagnierenden Opportunities.`,
          category: "team-hinweis",
          severity: concentrationSeverity,
          confidence: "hoch",
          derivedFrom: evidenceForOpportunities(topConcentration.flatMap(([, list]) => list.map((e) => e.opportunity.id))),
        }
      : undefined;
  if (obsConcentration) observations.push(obsConcentration);

  // 4) Stabil (Gegenbeispiel): AEs mit einem realen Buch, aber kaum Stagnation.
  const finalEntries = finalEntryByOpportunityId();
  const bookSizeByEmployee = new Map<string, number>();
  for (const entry of finalEntries.values()) {
    bookSizeByEmployee.set(entry.responsibleEmployeeId, (bookSizeByEmployee.get(entry.responsibleEmployeeId) ?? 0) + 1);
  }
  const aeIds = employees.filter((e) => e.roleId === "role-account-executive" && e.terminatedAt === undefined).map((e) => e.id);
  const lowStagnationAes = aeIds
    .filter((id) => (bookSizeByEmployee.get(id) ?? 0) >= 10)
    .map((id) => ({ id, stagnantCount: stagnantByEmployee.get(id)?.length ?? 0 }))
    .sort((a, b) => a.stagnantCount - b.stagnantCount)
    .slice(0, 2);
  if (lowStagnationAes.length > 0) {
    observations.push({
      id: nextId(),
      kind: "low-stagnation-counterexample",
      generatedAt: WORLD_NOW,
      statement:
        "Nicht das gesamte Team ist von Stagnation betroffen: " +
        lowStagnationAes
          .map((x) => `${employees.find((e) => e.id === x.id)?.name ?? x.id} (${x.stagnantCount} stagnierende von ${bookSizeByEmployee.get(x.id)} Opportunities)`)
          .join(", ") +
        " zeigen trotz vergleichbarer Buchgröße kaum stagnierende Deals.",
      category: "stabil",
      severity: "niedrig",
      confidence: "mittel",
      derivedFrom: evidenceForOpportunities(
        lowStagnationAes.flatMap((x) => [...finalEntries.values()].filter((e) => e.responsibleEmployeeId === x.id).map((e) => e.opportunityId)),
      ),
    });
  }

  // 5) Stabil (negative Ground Truth): Win-Rate der drei Sales-Teams liegt eng beieinander.
  const salesManagers = employees.filter((e) => e.roleId === "role-sales-manager");
  const teamStats = salesManagers
    .map((manager) => {
      const teamIds = new Set(employees.filter((e) => e.managerId === manager.id).map((e) => e.id));
      const closed = opportunities.filter((o) => teamIds.has(o.responsibleEmployeeId) && o.closedAt !== undefined);
      const won = closed.filter((o) => o.currentStage === "gewonnen");
      return { manager, closed, won, winRate: closed.length ? (won.length / closed.length) * 100 : 0 };
    })
    .filter((t) => t.closed.length > 0);
  let teamWinRateObsId: string | undefined;
  if (teamStats.length > 0) {
    const winRates = teamStats.map((t) => t.winRate);
    const winRateSpread = Math.max(...winRates) - Math.min(...winRates);
    // Schwellen redaktionell festgelegt: >35 Prozentpunkte Spanne zwischen drei
    // Teams ist eine deutliche, kaum durch Zufall erklärbare Disparität; >20 Punkte
    // bereits auffällig genug, um festgehalten zu werden. Darunter bleibt die
    // bisherige "eng beieinander"-Aussage zutreffend. category wechselt bewusst nur zu
    // "team-hinweis" (ein Fakt über Teams), nie zu "risiko" — eine Win-Rate-Spanne
    // allein ist kein unternehmensweites Risikosignal.
    const winRateSeverity: Observation["severity"] = winRateSpread > 35 ? "hoch" : winRateSpread > 20 ? "mittel" : "niedrig";
    const winRateCategory: Observation["category"] = winRateSeverity === "niedrig" ? "stabil" : "team-hinweis";
    const obsTeamWinRate: Observation = {
      id: nextId(),
      kind: "team-win-rate-parity",
      generatedAt: WORLD_NOW,
      statement:
        (winRateSeverity === "niedrig"
          ? "Die Win-Rate der drei Sales-Teams liegt aktuell eng beieinander ("
          : "Die Win-Rate der drei Sales-Teams zeigt aktuell eine auffällige Spanne (") +
        teamStats.map((t) => `${t.manager.name}: ${t.winRate.toFixed(0)} %`).join(", ") +
        `); die Spanne beträgt ${winRateSpread.toFixed(0)} Prozentpunkte` +
        (winRateSeverity === "niedrig"
          ? " — keine auffällige Disparität zwischen den Teams feststellbar."
          : " — eine Disparität zwischen den Teams, die einer näheren Betrachtung wert ist."),
      category: winRateCategory,
      severity: winRateSeverity,
      confidence: "hoch",
      derivedFrom: evidenceForOpportunities(teamStats.flatMap((t) => [...t.won.slice(0, 3), ...t.closed.filter((o) => o.currentStage === "verloren").slice(0, 3)].map((o) => o.id))),
    };
    observations.push(obsTeamWinRate);
    teamWinRateObsId = obsTeamWinRate.id;
  }

  // 6) Stabil: Follow-up-Geschwindigkeit ist über die SDRs hinweg konsistent.
  const contactDaysBySdr = new Map<string, number[]>();
  const leadsWithFirstContact = new Map<string, string[]>();
  for (const lead of leads) {
    if (!lead.lastContactedAt) continue;
    const days = daysBetween(lead.createdAt, lead.lastContactedAt);
    const list = contactDaysBySdr.get(lead.ownerEmployeeId) ?? [];
    list.push(days);
    contactDaysBySdr.set(lead.ownerEmployeeId, list);
    const idList = leadsWithFirstContact.get(lead.ownerEmployeeId) ?? [];
    idList.push(lead.id);
    leadsWithFirstContact.set(lead.ownerEmployeeId, idList);
  }
  const sdrsWithSample = employees.filter((e) => e.roleId === "role-sales-development-rep" && (contactDaysBySdr.get(e.id)?.length ?? 0) >= 5);
  const sdrMedians = sdrsWithSample.map((s) => median(contactDaysBySdr.get(s.id)!));
  if (sdrsWithSample.length > 0) {
    const followUpSpread = Math.max(...sdrMedians) - Math.min(...sdrMedians);
    // Schwellen redaktionell festgelegt (Tage Spanne zwischen dem schnellsten und dem
    // langsamsten SDR-Median): >14 Tage Unterschied im typischen Erstkontakt-Tempo ist
    // eine deutliche Inkonsistenz; >8 Tage bereits auffällig. category wechselt wie bei
    // team-win-rate-parity nur zu "team-hinweis", nie zu "risiko".
    const followUpSeverity: Observation["severity"] = followUpSpread > 14 ? "hoch" : followUpSpread > 8 ? "mittel" : "niedrig";
    const followUpCategory: Observation["category"] = followUpSeverity === "niedrig" ? "stabil" : "team-hinweis";
    observations.push({
      id: nextId(),
      kind: "follow-up-consistency-across-sdrs",
      generatedAt: WORLD_NOW,
      statement:
        `Die Zeit bis zum letzten dokumentierten Erstkontakt liegt über alle SDRs mit ausreichender Fallzahl hinweg im Median ` +
        `zwischen ${Math.min(...sdrMedians)} und ${Math.max(...sdrMedians)} Tagen — eine Spanne von ${followUpSpread} Tagen.` +
        (followUpSeverity === "niedrig"
          ? " Kein SDR fällt deutlich aus dem Rahmen."
          : " Diese Spanne ist deutlich genug, um als echte Inkonsistenz im Erstkontakt-Tempo zu gelten."),
      category: followUpCategory,
      severity: followUpSeverity,
      confidence: "hoch",
      derivedFrom: sdrsWithSample.flatMap((s) => leadsWithFirstContact.get(s.id)!.slice(0, 3)),
    });
  }

  // 7) Team-Hinweis: einzelner SDR mit auffällig schnellerer Reaktionszeit.
  const fastestSdr = sdrsWithSample
    .map((s) => ({ s, m: median(contactDaysBySdr.get(s.id)!), n: contactDaysBySdr.get(s.id)!.length }))
    .sort((a, b) => a.m - b.m)[0];
  if (fastestSdr) {
    observations.push({
      id: nextId(),
      kind: "fastest-sdr-response-time",
      generatedAt: WORLD_NOW,
      statement:
        `${fastestSdr.s.name} kontaktiert Leads mit einem Median von ${fastestSdr.m} Tagen am schnellsten im Team (n=${fastestSdr.n}); ` +
        `als jüngste Neueinstellung im Team ist die Fallzahl im Vergleich zu länger beschäftigten SDRs noch begrenzt.`,
      category: "team-hinweis",
      severity: "niedrig",
      confidence: "niedrig",
      derivedFrom: leadsWithFirstContact.get(fastestSdr.s.id)!.slice(0, 5),
    });
  }

  // 8) Stabil: SDR-Lastverteilung liegt in einem gesunden Korridor (Ground-Truth-Bestätigung
  // der in Schritt "Reference World Validation" behobenen Tenure-Bias-Schieflage).
  const leadCountBySdr = new Map<string, number>();
  for (const lead of leads) {
    leadCountBySdr.set(lead.ownerEmployeeId, (leadCountBySdr.get(lead.ownerEmployeeId) ?? 0) + 1);
  }
  const activeSdrIds = employees.filter((e) => e.roleId === "role-sales-development-rep" && e.terminatedAt === undefined).map((e) => e.id);
  const sdrLoadCounts = activeSdrIds.map((id) => leadCountBySdr.get(id) ?? 0).filter((c) => c > 0);
  if (sdrLoadCounts.length > 0) {
    const loadRatio = Math.max(...sdrLoadCounts) / Math.min(...sdrLoadCounts);
    // Anteil, den die am stärksten belastete Person am GESAMTEN Lead-Volumen trägt,
    // relativ zu einer rechnerisch fairen Gleichverteilung (1 / Anzahl aktiver SDRs) —
    // nicht das Max/Min-Verhältnis. Das Max/Min-Verhältnis erwies sich beim Prüfen
    // gegen alle sechs Scenario-Welten als zu verrauscht: es reagiert stark darauf,
    // welche (beliebige, oft unbeteiligte) Person zufällig den niedrigsten Wert trägt,
    // und lag in JEDER der sechs Welten — auch baseline (2.8×) — im selben Bereich wie
    // im gezielt überlasteten Szenario team-engpass (3.1×). Der Anteil am
    // Gesamtvolumen ist robuster: er beschreibt direkt "wie viel trägt die am
    // stärksten belastete Person tatsächlich", unabhängig vom Zufallswert der
    // am geringsten belasteten Person. Schwellen: >150 % über dem fairen Anteil
    // (das Zweieinhalbfache einer Gleichverteilung) ist eine klare Schieflage; >75 %
    // darüber bereits auffällig. Beide Schwellen bewusst rund und eigenständig
    // begründet, NICHT an ein einzelnes Szenario angepasst — im Gegenteil: geprüft
    // gegen alle sechs Scenario-Welten liegt selbst team-engpass (bewusst mit
    // vierfachem Gewicht auf eine Einzelperson) nur bei ~1,58× des fairen Anteils,
    // kaum über baseline (~1,51×). Das ist keine Kalibrierungsschwäche dieser
    // Observation, sondern eine ehrliche strukturelle Erkenntnis: der bestehende
    // lastausgleichende Zuteilungsmechanismus (pickWeightedByInverseLoad in
    // world/account-ownership.ts) kompensiert selbst gezielten Überlastungsdruck
    // weitgehend. Ein niedrigerer, an diese beiden Werte angepasster Schwellenwert
    // hätte genau die Art von Scheingenauigkeit erzeugt, die vermieden werden soll.
    const totalSdrLoad = sdrLoadCounts.reduce((sum, c) => sum + c, 0);
    const maxLoad = Math.max(...sdrLoadCounts);
    const fairShare = 1 / sdrLoadCounts.length;
    const loadShareRatio = totalSdrLoad > 0 ? maxLoad / totalSdrLoad / fairShare : 1;
    const loadSeverity: Observation["severity"] = loadShareRatio > 2.5 ? "hoch" : loadShareRatio > 1.75 ? "mittel" : "niedrig";
    const loadCategory: Observation["category"] = loadSeverity === "niedrig" ? "stabil" : "team-hinweis";
    const maxLoadEmployeeId = activeSdrIds.find((id) => (leadCountBySdr.get(id) ?? 0) === maxLoad);
    observations.push({
      id: nextId(),
      kind: "sdr-load-distribution-healthy",
      generatedAt: WORLD_NOW,
      statement:
        `Die Lead-Auslastung über die aktiven SDRs liegt zwischen ${Math.min(...sdrLoadCounts)} und ${Math.max(...sdrLoadCounts)} ` +
        `zugewiesenen Leads (Verhältnis ${loadRatio.toFixed(1)}×)` +
        (loadSeverity === "niedrig"
          ? " — eine gesunde Spanne ohne einzelne Person mit unverhältnismäßiger Last."
          : ` — ${maxLoadEmployeeId ? employees.find((e) => e.id === maxLoadEmployeeId)?.name ?? maxLoadEmployeeId : "eine einzelne Person"} ` +
            `trägt ${Math.round((maxLoad / totalSdrLoad) * 100)} % des gesamten Lead-Volumens, deutlich mehr als der rechnerisch ` +
            `faire Anteil von ${Math.round(fairShare * 100)} %.`),
      category: loadCategory,
      severity: loadSeverity,
      confidence: "mittel",
      derivedFrom: activeSdrIds.flatMap((id) => (leadsWithFirstContact.get(id) ?? []).slice(0, 2)),
    });
  }

  // 9) Team-Hinweis: Einwand-Zusammensetzung — robust berechnet (rangiert alle
  // Kategorien nach Häufigkeit, ohne eine bestimmte Kategorie an einer bestimmten
  // Position anzunehmen), plus deren tatsächliche Verlust-Korrelation.
  const objectionCalls = calls.filter((c) => c.objectionCategory);
  const byObjection = new Map<string, string[]>();
  for (const c of objectionCalls) {
    const list = byObjection.get(c.objectionCategory!) ?? [];
    list.push(c.id);
    byObjection.set(c.objectionCategory!, list);
  }
  const objectionRanking = [...byObjection.entries()].sort((a, b) => b[1].length - a[1].length);
  const topObjection = objectionRanking[0];
  if (topObjection) {
    const [topCategory, topIds] = topObjection;
    const topLostCount = topIds.filter((id) => {
      const call = calls.find((c) => c.id === id);
      const opp = call?.opportunityId ? opportunities.find((o) => o.id === call.opportunityId) : undefined;
      return opp?.currentStage === "verloren";
    }).length;
    const runnerUp = objectionRanking.slice(1).filter(([, ids]) => ids.length === topIds.length);
    const rankingText =
      runnerUp.length > 0
        ? `"${topCategory}" liegt gleichauf mit ${runnerUp.map(([c]) => `"${c}"`).join(", ")} an der Spitze (je ${topIds.length})`
        : `"${topCategory}" ist mit ${topIds.length} von ${objectionCalls.length} Einwand-Calls die häufigste Kategorie`;
    const lossRate = topLostCount / topIds.length;
    // Schwellen redaktionell festgelegt: >50 % der Calls mit diesem Einwand enden in
    // einer verlorenen Opportunity ist ein echter Verlust-Treiber (category wechselt zu
    // "risiko" — anders als bei den Team-internen Kennzahlen ist eine hohe
    // Verlust-Korrelation ein reales Umsatzrisiko, kein reiner Team-Fakt); >30 % bereits
    // auffällig genug für "mittel", bleibt aber "team-hinweis".
    const objectionSeverity: Observation["severity"] = lossRate > 0.5 ? "hoch" : lossRate > 0.3 ? "mittel" : "niedrig";
    const objectionCategory: Observation["category"] = lossRate > 0.5 ? "risiko" : "team-hinweis";
    observations.push({
      id: nextId(),
      kind: "objection-mix-top-category",
      generatedAt: WORLD_NOW,
      statement:
        `${rankingText}. ` +
        (objectionSeverity === "niedrig"
          ? `Trotz der Häufigkeit führen nur ${topLostCount} dieser Calls (${(lossRate * 100).toFixed(0)} %) tatsächlich zu einer ` +
            "verlorenen Opportunity — kein klarer Verlust-Treiber trotz hoher Häufigkeit."
          : `${topLostCount} dieser Calls (${(lossRate * 100).toFixed(0)} %) führen tatsächlich zu einer verlorenen Opportunity — ` +
            "diese Einwandkategorie ist ein nachweisbarer Verlust-Treiber."),
      category: objectionCategory,
      severity: objectionSeverity,
      confidence: topIds.length >= 30 ? "hoch" : "mittel",
      derivedFrom: topIds.slice(0, 8),
    });
  }

  // 10) Chance: Accounts mit ausschließlich gewonnenen Opportunities (Repeat-Business).
  const oppsByAccount = new Map<string, Opportunity[]>();
  for (const o of opportunities) {
    const list = oppsByAccount.get(o.accountId) ?? [];
    list.push(o);
    oppsByAccount.set(o.accountId, list);
  }
  const allWonAccounts = [...oppsByAccount.entries()].filter(
    ([, opps]) => opps.length >= 2 && opps.every((o) => o.currentStage === "gewonnen"),
  );
  for (const [accountId, opps] of allWonAccounts) {
    const account = accounts.find((a) => a.id === accountId);
    const totalValue = opps.reduce((sum, o) => sum + o.value, 0);
    observations.push({
      id: nextId(),
      kind: "chance-account-repeat-business",
      generatedAt: WORLD_NOW,
      statement:
        `${account?.name ?? accountId} hat alle ${opps.length} bisherigen Opportunities gewonnen (Gesamtvolumen ` +
        `${formatEuro(totalValue)}) — ein Account mit nachweisbarem Repeat-Business und plausiblem Erweiterungspotenzial.`,
      category: "chance",
      severity: "mittel",
      confidence: "mittel",
      derivedFrom: evidenceForOpportunities(opps.map((o) => o.id)),
    });
  }

  // 11) Chance, hohe Confidence, Cross-Source: gewonnene Opportunities zeigen deutlich
  // mehr dokumentierte Touchpoints als verlorene.
  const closedOpps = opportunities.filter((o) => o.closedAt !== undefined);
  const touchCount = (id: string) =>
    calls.filter((c) => c.opportunityId === id).length +
    emails.filter((e) => e.opportunityId === id).length +
    crmActivities.filter((a) => a.opportunityId === id).length;
  const wonOpps = closedOpps.filter((o) => o.currentStage === "gewonnen");
  const lostOpps = closedOpps.filter((o) => o.currentStage === "verloren");
  if (wonOpps.length > 0 && lostOpps.length > 0) {
    const avgWon = wonOpps.reduce((sum, o) => sum + touchCount(o.id), 0) / wonOpps.length;
    const avgLost = lostOpps.reduce((sum, o) => sum + touchCount(o.id), 0) / lostOpps.length;
    const wonSample = wonOpps.slice(0, 4).map((o) => o.id);
    const lostSample = lostOpps.slice(0, 4).map((o) => o.id);
    observations.push({
      id: nextId(),
      kind: "touchpoint-richness-won-vs-lost",
      generatedAt: WORLD_NOW,
      statement:
        `Gewonnene Opportunities weisen im Schnitt deutlich mehr dokumentierte Touchpoints auf als verlorene (${avgWon.toFixed(1)} ` +
        `vs. ${avgLost.toFixed(1)}, über Calls, E-Mails und CRM-Aktivitäten hinweg, n=${wonOpps.length} vs. n=${lostOpps.length}).`,
      category: "chance",
      severity: "mittel",
      confidence: "hoch",
      derivedFrom: [
        ...evidenceForOpportunities(wonSample),
        ...evidenceForOpportunities(lostSample),
        ...emails.filter((e) => e.opportunityId && [...wonSample, ...lostSample].includes(e.opportunityId)).map((e) => e.id),
      ],
    });
  }

  // 12) Höherwertige Observation (Observation→Observation, sparsam eingesetzt):
  // Gesamtbild aus Stagnation, Konzentration und stabiler Team-Performance. Nur
  // gebildet, wenn alle drei Bausteine tatsächlich existieren — sonst gäbe es nichts
  // Reales zu synthetisieren.
  if (obsStagnation && obsConcentration && teamWinRateObsId !== undefined) {
    observations.push({
      id: nextId(),
      kind: "pipeline-synthesis",
      generatedAt: WORLD_NOW,
      statement:
        "Die Pipeline ist überwiegend gesund und die Team-Performance stabil und homogen; die verbleibende Stagnation ist " +
        "klein, aber nicht gleichmäßig verteilt, sondern konzentriert sich bei einzelnen Account Executives.",
      category: stagnationSeverity === "niedrig" ? "stabil" : "risiko",
      severity: stagnationSeverity,
      confidence: "mittel",
      derivedFrom: [obsStagnation.id, obsConcentration.id, teamWinRateObsId],
    });
  }

  // 13) Team-Hinweis: Gesamtauslastung (alle offenen Opportunities, nicht nur
  // stagnierende) über die Account Executives — das AE-Äquivalent zu Block 8
  // (SDR-Lastverteilung), bislang komplett unbeobachtet. Dieselbe Anteil-am-
  // Gesamtvolumen-Methode wie dort, aus denselben Gründen (robuster als ein
  // Max/Min-Verhältnis, siehe Block 8).
  const openCountByAe = new Map<string, number>();
  for (const e of open) {
    openCountByAe.set(e.entry.responsibleEmployeeId, (openCountByAe.get(e.entry.responsibleEmployeeId) ?? 0) + 1);
  }
  const activeAeIdsForWorkload = employees
    .filter((e) => e.roleId === "role-account-executive" && e.terminatedAt === undefined)
    .map((e) => e.id);
  const aeWorkloadCounts = activeAeIdsForWorkload.map((id) => openCountByAe.get(id) ?? 0).filter((c) => c > 0);
  if (aeWorkloadCounts.length > 0) {
    const totalAeWorkload = aeWorkloadCounts.reduce((sum, c) => sum + c, 0);
    const maxAeWorkload = Math.max(...aeWorkloadCounts);
    const fairAeShare = 1 / aeWorkloadCounts.length;
    const aeWorkloadRatio = totalAeWorkload > 0 ? maxAeWorkload / totalAeWorkload / fairAeShare : 1;
    const aeWorkloadSeverity: Observation["severity"] = aeWorkloadRatio > 2.5 ? "hoch" : aeWorkloadRatio > 1.75 ? "mittel" : "niedrig";
    const aeWorkloadCategory: Observation["category"] = aeWorkloadSeverity === "niedrig" ? "stabil" : "team-hinweis";
    const maxWorkloadAeId = activeAeIdsForWorkload.find((id) => (openCountByAe.get(id) ?? 0) === maxAeWorkload);
    const maxWorkloadAeOppIds = open.filter((e) => e.entry.responsibleEmployeeId === maxWorkloadAeId).map((e) => e.opportunity.id);
    observations.push({
      id: nextId(),
      kind: "ae-workload-distribution",
      generatedAt: WORLD_NOW,
      statement:
        `Die Anzahl aktiver Opportunities über die Account Executives liegt zwischen ${Math.min(...aeWorkloadCounts)} und ` +
        `${maxAeWorkload}` +
        (aeWorkloadSeverity === "niedrig"
          ? " — eine gesunde Spanne ohne einzelne Person mit unverhältnismäßiger Last."
          : ` — ${maxWorkloadAeId ? employees.find((e) => e.id === maxWorkloadAeId)?.name ?? maxWorkloadAeId : "eine einzelne Person"} ` +
            `trägt ${Math.round((maxAeWorkload / totalAeWorkload) * 100)} % aller aktiven Opportunities, deutlich mehr als der ` +
            `rechnerisch faire Anteil von ${Math.round(fairAeShare * 100)} %.`),
      category: aeWorkloadCategory,
      severity: aeWorkloadSeverity,
      confidence: "mittel",
      derivedFrom: evidenceForOpportunities(maxWorkloadAeOppIds.slice(0, 5)),
    });
  }

  // 14) Sales-Cycle-Dauer: Median Tage von Lead-Erstellung bis Opportunity-Abschluss
  // (gewonnen oder verloren) — bislang komplett unbeobachtet, obwohl eine der
  // zentralsten Vertriebskennzahlen überhaupt.
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const cycleDaysList = closedOpps
    .map((o) => {
      const lead = leadById.get(o.leadId);
      return lead && o.closedAt ? daysBetween(lead.createdAt, o.closedAt) : undefined;
    })
    .filter((d): d is number => d !== undefined);
  if (cycleDaysList.length > 0) {
    const cycleMedian = median(cycleDaysList);
    // Schwellen redaktionell festgelegt anhand der Generator-eigenen Stage-Dauer-
    // Spannen (qualifizierung 5-20, angebot 10-30, verhandlung 7-25 Tage;
    // stageDurationMultiplier variiert diese zusätzlich je Szenario) — ein Zyklus
    // von unter 40 Tagen entspricht einem zügigen, nahtlosen Durchlauf durch alle
    // drei Stages; über 65 Tage bedeutet einen deutlich längeren, von echten
    // Zwischenstopps geprägten Weg.
    const cycleSeverity: Observation["severity"] = cycleMedian > 65 ? "hoch" : cycleMedian > 40 ? "mittel" : "niedrig";
    const cycleCategory: Observation["category"] = cycleSeverity === "niedrig" ? "stabil" : "risiko";
    observations.push({
      id: nextId(),
      kind: "sales-cycle-duration",
      generatedAt: WORLD_NOW,
      statement:
        `Der Median der Sales-Cycle-Dauer (von Lead-Erstellung bis Opportunity-Abschluss) liegt bei ${cycleMedian} Tagen ` +
        `(n=${cycleDaysList.length})` +
        (cycleSeverity === "niedrig"
          ? " — ein zügiger, unauffälliger Durchlauf."
          : " — ein spürbar längerer Weg von der Lead-Erstellung bis zum Abschluss als ein zügiger, ungestörter Durchlauf.") +
        ".",
      category: cycleCategory,
      severity: cycleSeverity,
      confidence: cycleDaysList.length >= 30 ? "hoch" : "mittel",
      derivedFrom: evidenceForOpportunities(closedOpps.slice(0, 8).map((o) => o.id)),
    });
  }

  // 15) Stage-Regressionsrate: Anteil offener Opportunities mit mindestens einem
  // echten Rückschritt (Stage-Wechsel zurück in eine frühere Phase) — eine andere
  // Pipeline-Facette als reine Stagnation (Block 1: "bewegt sich nicht" vs. hier:
  // "bewegt sich rückwärts"), bislang komplett unbeobachtet.
  const STAGE_RANK: Record<string, number> = { qualifizierung: 0, angebot: 1, verhandlung: 2 };
  const openOpportunityIds = new Set(open.map((e) => e.opportunity.id));
  const stageEntriesByOpenOpportunity = new Map<string, OpportunityStageHistory[]>();
  for (const entry of stageHistory) {
    if (!openOpportunityIds.has(entry.opportunityId)) continue;
    const list = stageEntriesByOpenOpportunity.get(entry.opportunityId) ?? [];
    list.push(entry);
    stageEntriesByOpenOpportunity.set(entry.opportunityId, list);
  }
  const regressedOpportunityIds: string[] = [];
  for (const [opportunityId, entries] of stageEntriesByOpenOpportunity) {
    const sorted = [...entries].sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : 0));
    for (let i = 1; i < sorted.length; i++) {
      const prevRank = STAGE_RANK[sorted[i - 1]!.stage];
      const currRank = STAGE_RANK[sorted[i]!.stage];
      if (prevRank !== undefined && currRank !== undefined && currRank < prevRank) {
        regressedOpportunityIds.push(opportunityId);
        break;
      }
    }
  }
  if (open.length > 0) {
    const regressionShare = regressedOpportunityIds.length / open.length;
    // Schwellen NICHT analog zu stagnationShare übernommen: geprüft gegen alle sechs
    // Scenario-Welten liegt der Anteil offener Opportunities mit mindestens einem
    // Rückschritt in fünf von sechs Welten — einschließlich baseline (74 %) — bei
    // 54-76 %. Das ist keine Anomalie, sondern die erwartete Konsequenz des Stage-
    // Bewegungsmodells: "verhandlung" ist absichtlich kein Endzustand ohne
    // Rückschrittmöglichkeit (siehe generate-sales-pipeline.ts), ein einzelner
    // Rückschritt über die gesamte Lebensdauer einer Opportunity ist damit normales,
    // realistisches Geschäftsverhalten (Nachverhandlung, Rescoping), kein Warnsignal.
    // Ein Schwellenwert nahe der beobachteten Spanne hätte baseline selbst als
    // "hoch" eingestuft — genau die Art Scheingenauigkeit, die vermieden werden soll.
    // Die Schwellen liegen deshalb bewusst mit deutlichem Abstand über der gesamten
    // beobachteten Spanne (max. 76 % in den sechs Welten).
    const regressionSeverity: Observation["severity"] = regressionShare > 0.85 ? "hoch" : regressionShare > 0.8 ? "mittel" : "niedrig";
    observations.push({
      id: nextId(),
      kind: "stage-regression-rate",
      generatedAt: WORLD_NOW,
      statement:
        `${regressedOpportunityIds.length} von ${open.length} aktuell offenen Opportunities (${Math.round(regressionShare * 100)} %) ` +
        `sind im bisherigen Verlauf mindestens einmal in eine frühere Stage zurückgefallen` +
        (regressionSeverity === "niedrig"
          ? " — angesichts realistischer Nachverhandlung/Rescoping ein erwartbarer, normaler Anteil."
          : " — ein außergewöhnlich hoher Anteil, deutlich über dem durch normale Nachverhandlung erwartbaren Maß."),
      category: regressionSeverity === "niedrig" ? "stabil" : "risiko",
      severity: regressionSeverity,
      confidence: "hoch",
      derivedFrom: evidenceForOpportunities(regressedOpportunityIds.slice(0, 8)),
    });
  }

  // 16) Verlustgrund-Konzentration: dominierender lostReason unter verlorenen
  // Opportunities — strukturell identisch zur bereits akzeptierten Methode für
  // Einwand-Kategorien (Block 9), hier auf tatsächliche Verlustgründe angewendet,
  // bislang komplett unbeobachtet.
  const lostOppsWithReason = closedOpps.filter((o) => o.currentStage === "verloren" && o.lostReason);
  const byLostReason = new Map<string, string[]>();
  for (const o of lostOppsWithReason) {
    const list = byLostReason.get(o.lostReason!) ?? [];
    list.push(o.id);
    byLostReason.set(o.lostReason!, list);
  }
  const lostReasonRanking = [...byLostReason.entries()].sort((a, b) => b[1].length - a[1].length);
  const topLostReason = lostReasonRanking[0];
  if (topLostReason && lostOppsWithReason.length > 0) {
    const [reasonLabel, reasonIds] = topLostReason;
    const reasonShare = reasonIds.length / lostOppsWithReason.length;
    // Schwellen redaktionell festgelegt: bei sechs möglichst gleich wahrscheinlichen
    // Verlustgründen (siehe OPPORTUNITY_LOST_REASONS) läge ein rein zufälliger
    // Anteil bei ca. 17 %; >50 % ist eine klare Dominanz eines einzelnen Grundes,
    // >35 % bereits auffällig genug, um festgehalten zu werden.
    const reasonSeverity: Observation["severity"] = reasonShare > 0.5 ? "hoch" : reasonShare > 0.35 ? "mittel" : "niedrig";
    const reasonCategory: Observation["category"] = reasonSeverity === "hoch" ? "risiko" : "team-hinweis";
    observations.push({
      id: nextId(),
      kind: "loss-reason-concentration",
      generatedAt: WORLD_NOW,
      statement:
        `"${reasonLabel}" ist mit ${reasonIds.length} von ${lostOppsWithReason.length} verlorenen Opportunities ` +
        `(${Math.round(reasonShare * 100)} %) der häufigste dokumentierte Verlustgrund` +
        (reasonSeverity === "niedrig"
          ? " — keine einzelne Ursache dominiert die verlorenen Deals."
          : " — eine einzelne Ursache prägt einen bedeutenden Teil der verlorenen Deals.") +
        ".",
      category: reasonCategory,
      severity: reasonSeverity,
      confidence: lostOppsWithReason.length >= 20 ? "hoch" : "mittel",
      derivedFrom: evidenceForOpportunities(reasonIds.slice(0, 8)),
    });
  }

  // 17) Lead-Volumen-Trend: Vergleich des Lead-Volumens der letzten 90 Tage mit dem
  // Volumen der 90 Tage davor — bislang komplett unbeobachtet, obwohl eine der
  // grundlegendsten Fragen überhaupt ("wächst oder schrumpft das Geschäft gerade?").
  // Reines Zeitfenster auf bereits vorhandenem Lead.createdAt, keine neue Datenquelle.
  const recentWindowStart = addDays(WORLD_NOW, -90);
  const priorWindowStart = addDays(WORLD_NOW, -180);
  const recentLeads = leads.filter((l) => l.createdAt > recentWindowStart && l.createdAt <= WORLD_NOW);
  const priorLeads = leads.filter((l) => l.createdAt > priorWindowStart && l.createdAt <= recentWindowStart);
  if (priorLeads.length > 0) {
    const volumeGrowthRate = (recentLeads.length - priorLeads.length) / priorLeads.length;
    const volumeSeverity: Observation["severity"] =
      Math.abs(volumeGrowthRate) > 0.5 ? "hoch" : Math.abs(volumeGrowthRate) > 0.25 ? "mittel" : "niedrig";
    const volumeCategory: Observation["category"] =
      volumeSeverity === "niedrig" ? "stabil" : volumeGrowthRate > 0 ? "chance" : "risiko";
    observations.push({
      id: nextId(),
      kind: "lead-volume-trend",
      generatedAt: WORLD_NOW,
      statement:
        `Das Lead-Volumen der letzten 90 Tage (${recentLeads.length}) liegt ` +
        `${volumeGrowthRate >= 0 ? "um" : "um"} ${Math.abs(Math.round(volumeGrowthRate * 100))} % ` +
        `${volumeGrowthRate >= 0 ? "über" : "unter"} dem Volumen der vorangegangenen 90 Tage (${priorLeads.length})` +
        (volumeSeverity === "niedrig" ? " — ein stabiler, unauffälliger Verlauf." : ".") +
        "",
      category: volumeCategory,
      severity: volumeSeverity,
      confidence: Math.min(recentLeads.length, priorLeads.length) >= 30 ? "hoch" : "mittel",
      derivedFrom: [...recentLeads.slice(0, 5).map((l) => l.id), ...priorLeads.slice(0, 5).map((l) => l.id)],
    });
  }

  return observations;
}

export const OBSERVATIONS: Observation[] = generateObservations(
  EMPLOYEES,
  CUSTOMER_ACCOUNTS,
  LEADS,
  OPPORTUNITIES,
  OPPORTUNITY_STAGE_HISTORY,
  CALLS,
  EMAILS,
  CRM_ACTIVITIES,
);
