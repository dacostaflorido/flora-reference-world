import type { Opportunity } from "../events/opportunities";
import type { MarketingLeadIdentityMatched } from "../events/marketing-meta-crm-source";

// Customer Acquisition Lifecycle Foundation V1 (Auftrag "Cohort Cost
// Checkpoint + Customer Acquisition Lifecycle Foundation V1", Phase B) —
// kanonische, interne Wahrheit darüber, WANN ein Account erstmals zum Kunden
// wird. Rein deskriptiv: keine Bewertung, kein CAC, kein Customer Lifetime
// Value, kein Churn/Retention-Modell, keine Umsatzattribution (harte
// Scope-Grenze, siehe Auftragstext). NICHT über index.ts exportiert — exakt
// dieselbe Sichtbarkeitsstufe wie company/marketing-sales-attribution.ts und
// company/marketing-cohort-cost-metrics.ts.
//
// --- B1: Forensik-Ergebnis (verbindliche Grundlage dieser Datei) --------------
//
// 1) `CustomerAccount.createdAt` markiert ausschließlich die Account-ANLAGE im
//    Prospect-Pool (zufällig zwischen 2018-01-01 und WORLD_NOW-90 Tage
//    gezogen, world/customer-accounts.ts) — kein Bezug zu irgendeiner
//    Opportunity, kein "Kunde seit"-Zeitpunkt. Bereits an zwei Stellen
//    unabhängig dokumentiert (company/company-executive-kpis.ts,
//    company/sales-period-metrics.ts): "nicht belegbar als 'Kunde seit'".
// 2) JA — jeder der 120 Accounts existiert vom ersten Tag an im Modell, lange
//    bevor (falls überhaupt) eine Opportunity gewonnen wird. Ein Account ist
//    also strukturell ein Prospect, bis er (falls) akquiriert wird.
// 3) 62 von 120 Accounts (empirisch, WORLD_NOW, baseline) besitzen KEINE
//    gewonnene Opportunity — reine Prospects, niemals Kunde geworden.
// 4) 41 Accounts besitzen GENAU EINE gewonnene Opportunity.
// 5) 17 Accounts besitzen MEHRERE gewonnene Opportunities (maximal 3
//    beobachtet) — bereits als eigener Observation-Fund bekannt
//    (`chance-account-repeat-business`, observations/observations.ts).
// 6) NEIN — jede der 272 Opportunities trägt ein Pflichtfeld `accountId`, das
//    empirisch bei allen Einträgen auf einen real existierenden
//    `CustomerAccount` verweist (0 Opportunities ohne oder mit ungültiger
//    accountId). `buildOpportunity` in generate-sales-pipeline.ts erzeugt
//    Opportunities ausschließlich aus einem bereits vorhandenen Account.
// 7) NEIN — alle 79 gewonnenen Opportunities besitzen ein gesetztes
//    `closedAt` (0 Gegenbeispiele). `currentStage==="gewonnen"` und
//    `closedAt` werden im Generator atomar zusammen gesetzt.
// 8) Strukturell JA möglich (Datumsgranularität ist Kalendertag, siehe
//    timeline/calendar.ts) — empirisch in der aktuellen Referenzwelt jedoch
//    0 Kollisionsfälle beobachtet (kein Account mit zwei Won am selben Tag).
//    Der Tie-Break unten ist daher defensiv, nicht durch beobachtete Daten
//    erzwungen.
// 9) `CustomerAccount` selbst — der Typname impliziert für ALLE 120 Accounts
//    bereits "Kunde", obwohl 62 davon reine Prospects sind, die nie eine
//    Opportunity gewonnen haben. Diese Datei korrigiert das NICHT durch
//    Umbenennung von `CustomerAccount` (Public-Contract-relevant, siehe
//    Punkt 10) — der Unterschied wird stattdessen durch die hier neu
//    eingeführte, explizite `CustomerRelationship`/`CustomerAcquired`-Wahrheit
//    sichtbar gemacht, ohne das bestehende Feld umzubenennen.
// 10) `FullCompanyContext`, `WorldSnapshot`, `CompanyExecutiveKpiData`
//     (inkl. `SalesWonDealFact`), `MarketingExecutiveKpiData`,
//     `CompanyAreaSummary`/`CompanyBusinessStateSnapshot`/
//     `CompanyExecutiveContextSnapshot`, `ScenarioProfile` — jedes über
//     index.ts exportierte Symbol bleibt unverändert. Diese Datei fügt dort
//     NICHTS hinzu (siehe Kopfkommentar, "NICHT über index.ts exportiert").
//
// --- B4: Erste Won-Opportunity — Auswahlregel ----------------------------------
//
// Kanonischer Zeitpunkt: `Opportunity.closedAt` (bereits als der einzige
// bestätigte Won-Zeitpunkt etabliert, siehe company/sales-period-metrics.ts,
// dort gegen die parallele Stage-History-Quelle empirisch geprüft: 0
// Abweichungen). Sortierung: frühestes `closedAt` zuerst; bei identischem
// `closedAt` (siehe B1 Punkt 8) stabiler, rein deterministischer Tie-Break
// über die lexikographische Opportunity-ID — dient AUSSCHLIESSLICH der
// deterministischen Auswahl bei echtem Gleichstand, verändert niemals den
// fachlichen `acquiredAt`-Zeitpunkt selbst (der bleibt exakt `closedAt` der
// gewählten Opportunity).
//
// --- B6: As-of-Sicherheit ------------------------------------------------------
//
// Genau EIN Filterpunkt sichert sämtliche As-of-Garantien: nur Opportunities
// mit `closedAt <= asOf` fließen überhaupt in die Berechnung ein (siehe
// `generateCustomerAcquisitionLifecycle`). Daraus folgt automatisch:
// - Won nach `asOf` ist unsichtbar (wird herausgefiltert, bevor irgendeine
//   Ableitung beginnt).
// - `CustomerAcquired` nach `asOf` ist unsichtbar (die auslösende Opportunity
//   selbst ist bereits unsichtbar).
// - Ein Account, dessen einzige/früheste Won-Opportunity erst nach `asOf`
//   `closedAt` erreicht, hat zu diesem `asOf` schlicht keine sichtbaren Won-
//   Opportunities — kein `CustomerAcquired`-Event, keine
//   `CustomerRelationship` entsteht für ihn.
// - Ein Repeat-Win nach `asOf` fehlt in `wonOpportunityIds`, weil er nie in
//   die gefilterte Eingabemenge gelangt.
// - Da diese Funktion eine reine Funktion der (bereits gefilterten)
//   Eingabemenge ist, verändert ein späterer, hier unsichtbarer Won niemals
//   den für einen früheren `asOf` bereits bestimmten `acquiredAt` — ein
//   erneuter Aufruf mit demselben, früheren `asOf` liefert bit-identische
//   Ergebnisse (reine Funktion, kein Zufallsstrom, siehe B12-analog).
// Bewusst KEIN zweistufiges Snapshot-dann-Projektions-Muster (obwohl im
// Auftragstext als Beispiel genannt) — dieselbe direkte
// "asOf als Parameter, einmal gefiltert"-Architektur wie bereits
// `generateMarketingToSalesAttribution` (marketing-sales-attribution.ts) und
// `generateMarketingCohortForBounds` (marketing-cohort-cost-metrics.ts):
// eine zweite, parallele Projektionsfunktion über einem bereits
// vollständigen Snapshot wäre eine zweite Rekonstruktionslogik neben der
// hier bereits vorhandenen (Hard Stop 9: "keine zweite Opportunity-
// Wahrheit").

// B2: interne kanonische Customer-Beziehung — genau eine Instanz pro
// akquiriertem Account (nie für Accounts ohne Won). `currentStatus` trägt
// bewusst NICHT den Wert "active": das Modell enthält kein Churn-/
// Reaktivierungskonzept (Auftragstext, verbindliche Business-Entscheidung),
// "active" würde fälschlich eine laufende wirtschaftliche Beziehung
// suggerieren. "acquired" behauptet ausschließlich den einen tatsächlich
// belegten Fakt: dieser Account hat zu `acquiredAt` seine erste Opportunity
// gewonnen — nichts über den heutigen wirtschaftlichen Zustand.
export interface CustomerRelationship {
  id: string;
  accountId: string;
  acquiredAt: string;
  acquiredThroughOpportunityId: string;
  currentStatus: "acquired";
  wonOpportunityIds: string[];
}

// B3: append-only kanonisches Acquisition-Ereignis — genau eines pro Account,
// ausgelöst durch dessen erste Won-Opportunity. Spätere Won-Opportunities
// desselben Accounts erzeugen KEIN weiteres Event (siehe B5,
// `classifyWonOpportunities`).
export interface CustomerAcquired {
  id: string;
  accountId: string;
  opportunityId: string;
  acquiredAt: string;
}

// B5: abgeleitete, nicht eigenständig gespeicherte Klassifikation jeder
// sichtbaren Won-Opportunity — erste Won je Account ist "customer-
// acquisition", jede weitere ist "repeat-business". `leadId` wird
// mitgeführt (identisch zu `Opportunity.leadId`), damit B7 (Marketing-
// Attribution) ohne erneuten Opportunity-Lookup auskommt.
export type WonBusinessKind = "customer-acquisition" | "repeat-business";

export interface WonOpportunityClassification {
  opportunityId: string;
  accountId: string;
  leadId: string;
  closedAt: string;
  kind: WonBusinessKind;
}

export interface CustomerAcquisitionLifecycleSnapshot {
  asOf: string;
  customerAcquiredEvents: CustomerAcquired[];
  customerRelationships: CustomerRelationship[];
  wonOpportunityClassifications: WonOpportunityClassification[];
}

type WonOpportunity = Opportunity & { closedAt: string };

function isWonAsOf(o: Opportunity, asOf: string): o is WonOpportunity {
  return o.currentStage === "gewonnen" && o.closedAt !== undefined && o.closedAt <= asOf;
}

// B4: deterministische Auswahl der frühesten Won-Opportunity je Account.
// Sortierschlüssel: (closedAt asc, id asc) — der ID-Tie-Break greift
// ausschließlich bei identischem closedAt und ändert nie den gewählten
// Zeitpunkt selbst, nur die Auswahl UNTER mehreren gleich frühen Kandidaten.
function selectFirstWon(opportunities: readonly WonOpportunity[]): WonOpportunity {
  return [...opportunities].sort((a, b) => (a.closedAt === b.closedAt ? a.id.localeCompare(b.id) : a.closedAt < b.closedAt ? -1 : 1))[0]!;
}

// entity-stabile, nicht-positionale IDs: aus der bereits stabilen accountId
// abgeleitet, nicht aus einem Array-Zähler — für denselben Account bei jedem
// Aufruf und jedem asOf bit-identisch (sofern der Account überhaupt
// akquiriert ist).
function customerRelationshipId(accountId: string): string {
  return `customer-relationship-${accountId}`;
}
function customerAcquiredId(accountId: string): string {
  return `customer-acquired-${accountId}`;
}

export function generateCustomerAcquisitionLifecycle(
  opportunities: readonly Opportunity[],
  asOf: string,
): CustomerAcquisitionLifecycleSnapshot {
  // B6: der einzige Filterpunkt, der sämtliche As-of-Garantien trägt (siehe
  // Kopfkommentar) — alles Folgende operiert ausschließlich auf bereits zu
  // `asOf` sichtbaren Won-Opportunities.
  const wonVisible = opportunities.filter((o): o is WonOpportunity => isWonAsOf(o, asOf));

  const byAccount = new Map<string, WonOpportunity[]>();
  for (const o of wonVisible) {
    const list = byAccount.get(o.accountId) ?? [];
    list.push(o);
    byAccount.set(o.accountId, list);
  }

  const customerAcquiredEvents: CustomerAcquired[] = [];
  const customerRelationships: CustomerRelationship[] = [];
  const wonOpportunityClassifications: WonOpportunityClassification[] = [];

  // Deterministische Ausgabereihenfolge (nicht fachlich relevant, aber
  // reproduzierbar) — sortiert nach accountId, nicht nach Einfügereihenfolge
  // einer Map-Iteration.
  const accountIds = [...byAccount.keys()].sort();

  for (const accountId of accountIds) {
    const wonForAccount = byAccount.get(accountId)!;
    const firstWon = selectFirstWon(wonForAccount);

    customerAcquiredEvents.push({
      id: customerAcquiredId(accountId),
      accountId,
      opportunityId: firstWon.id,
      acquiredAt: firstWon.closedAt,
    });

    const wonOpportunityIds = [...wonForAccount].sort((a, b) => (a.closedAt === b.closedAt ? a.id.localeCompare(b.id) : a.closedAt < b.closedAt ? -1 : 1)).map((o) => o.id);

    customerRelationships.push({
      id: customerRelationshipId(accountId),
      accountId,
      acquiredAt: firstWon.closedAt,
      acquiredThroughOpportunityId: firstWon.id,
      currentStatus: "acquired",
      wonOpportunityIds,
    });

    for (const o of wonForAccount) {
      wonOpportunityClassifications.push({
        opportunityId: o.id,
        accountId,
        leadId: o.leadId,
        closedAt: o.closedAt,
        kind: o.id === firstWon.id ? "customer-acquisition" : "repeat-business",
      });
    }
  }

  return { asOf, customerAcquiredEvents, customerRelationships, wonOpportunityClassifications };
}

// --- B7: Marketing-Attribution-Reporting (rein zählend, keine CAC-Formel) -----
//
// Eine Customer Acquisition ist Meta-attribuierbar, wenn die akquirierende
// Opportunity eine `leadId` besitzt, für die ein `MarketingLeadIdentityMatched`
// -Event existiert (Opportunity.leadId → MarketingLeadIdentityMatched.leadId,
// exakt derselbe direkte, bereits in marketing-sales-attribution.ts etablierte
// Verbindungspfad — keine neue Heuristik). Ein Meta-attribuierter Repeat-Win
// wird bewusst GETRENNT gezählt (`metaAttributedRepeatWins`) und fließt NIE in
// `metaAttributableAcquisitions` ein, unabhängig davon, ob derselbe Account
// bereits über Meta akquiriert wurde oder nicht — Repeat Business ist
// definitionsgemäß kein neuer Kunde (siehe verbindliche Business-Entscheidung).
export interface CustomerAcquisitionMarketingAttributionReport {
  totalCustomerAcquisitions: number;
  metaAttributableAcquisitions: number;
  nonMetaAttributableAcquisitions: number;
  metaAttributedRepeatWins: number;
}

export function reportCustomerAcquisitionMarketingAttribution(
  lifecycle: CustomerAcquisitionLifecycleSnapshot,
  marketingLeadIdentityMatchedEvents: readonly MarketingLeadIdentityMatched[],
): CustomerAcquisitionMarketingAttributionReport {
  const matchedLeadIds = new Set(marketingLeadIdentityMatchedEvents.map((m) => m.leadId));

  const acquisitions = lifecycle.wonOpportunityClassifications.filter((c) => c.kind === "customer-acquisition");
  const repeatWins = lifecycle.wonOpportunityClassifications.filter((c) => c.kind === "repeat-business");

  const metaAttributableAcquisitions = acquisitions.filter((c) => matchedLeadIds.has(c.leadId)).length;
  const metaAttributedRepeatWins = repeatWins.filter((c) => matchedLeadIds.has(c.leadId)).length;

  return {
    totalCustomerAcquisitions: acquisitions.length,
    metaAttributableAcquisitions,
    nonMetaAttributableAcquisitions: acquisitions.length - metaAttributableAcquisitions,
    metaAttributedRepeatWins,
  };
}
