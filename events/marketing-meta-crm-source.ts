import { createRng } from "../engine/seed";
import { addDays, randomInt } from "../engine/random";
import { WORLD_NOW } from "../timeline/world-clock";
import type { Lead } from "./leads";
import type { MarketingCampaign } from "../world/marketing-campaigns";

// Marketing Meta/CRM Source Foundation V1 — trennt DREI getrennte
// Geschäftsfakten, die zuvor teils fälschlich gleichgesetzt oder zu einer
// zweiten, parallel gespeicherten Wahrheit vermischt waren (Korrekturauftrag
// "Temporal Matching Truth mit eigenem Match-Event", verbindliche
// Architekturentscheidung Variante A):
//
// 1) "bei Meta generiert" — MetaLeadGenerated. Beantwortet: welcher Lead
//    wurde bei Meta generiert, wann, durch welche Campaign.
// 2) "im CRM eingegangen" — MarketingCrmLeadIngested. Beantwortet: welcher
//    Lead-Datensatz wurde im CRM angelegt, wann, welche CRM-ID.
// 3) "Identität eindeutig verbunden" — MarketingLeadIdentityMatched. Ein
//    EIGENES, append-only Match-Event mit eigenem fachlichen
//    Eintrittszeitpunkt (`matchedAt`). Beantwortet: wann wurde belegt, dass
//    Meta-Lead und CRM-Lead denselben Vorgang repräsentieren, und durch
//    welche Methode.
//
// Diese drei Fakten dürfen nicht zusammengelegt werden. Insbesondere darf
// `MarketingCrmLeadIngested` nicht selbst zur zweiten Match-Wahrheit werden
// (ursprünglicher Fehler dieser Datei, siehe Korrekturauftrag Punkt 2: ein
// gespeichertes `matchStatus`-Feld auf dem Ingestion-Event implizierte, ein
// erst später — synchron beim CRM-Eingang — bewiesenes Match sei bereits Teil
// des Ingestion-Fakts selbst, wodurch ein historischer Snapshot exakt AM
// Ingestion-Zeitpunkt das Match ohne eigenen Beleg "mitgeliefert" bekam,
// statt es als eigenständigen, mit `matchedAt` versehenen Fakt zu benötigen).
//
// Kausalrichtung/Nicht-Duplikation (B1/B10, harter Stop 3): Lead (id,
// createdAt, source, status, ...) bleibt VOLLSTÄNDIG unangetastet — die
// einzige, unveränderte interne Lead-Wahrheit. `Lead.createdAt` bleibt exakt
// das, was es im bestehenden Modell technisch bereits ist: der Zeitpunkt, zu
// dem der Lead-Datensatz in der Sales-Pipeline (und damit implizit im CRM)
// entstand — hier NICHT neu berechnet, nur wörtlich in
// `MarketingCrmLeadIngested.ingestedAt` projiziert (exakt dasselbe
// Variante-A-Muster wie events/delivery-lifecycle.ts,
// events/sales-appointment-lifecycle.ts). Es entsteht dadurch keine zweite,
// unabhängige CRM-Zeitwahrheit für ein und denselben Lead.
//
// `MetaLeadGenerated` ist ein GENUIN NEUER Fakt (externes
// Werbeplattform-Ereignis), der im bestehenden Modell an keiner Stelle
// existierte — für eine deterministisch ausgewählte Teilmenge der
// bestehenden Leads wird ein passendes, ZEITLICH VORGELAGERTES
// Meta-Generierungsereignis erzeugt (generatedAt <= ingestedAt, niemals
// danach — ein Lead kann nicht ins CRM gelangen, bevor er bei Meta
// entstanden ist). Zusätzlich werden eigenständige, NIE mit einem internen
// Lead verbundene Meta-Generierungsereignisse erzeugt (Meta-Leads, die nie im
// CRM landeten) — realistisch und von der Referenzwelt bewusst nicht
// unterschlagen (Auftrag B8: "keine perfekte Datenqualität vortäuschen").
// Diese Leads sind NICHT "endgültig unmatched" — es existiert für sie
// schlicht kein Resolution-Fakt; sie bleiben `pending` (siehe
// `resolveMarketingLeadMatchStatus` unten).
//
// Identity Matching (B6): AUSSCHLIESSLICH über einen exakten, deterministisch
// erzeugten externen Meta-Lead-Identifier, der bei einer erfolgreichen
// Übernahme direkt im CRM-Ingestion-Datensatz mitgeführt wird (Variante 1 aus
// der im Auftrag vorgegebenen Präferenzreihenfolge: "direkte externe
// Meta-Lead-ID im CRM-Datensatz"). Keine Namens-/E-Mail-/Telefon-Heuristik,
// keine zeitliche Nähe, keine Campaign+Datum-Näherung — all das ist an
// keiner Stelle dieser Datei vorhanden. Die aktuelle Match-Methode entscheidet
// synchron beim CRM-Eingang (die externe Meta-Lead-ID ist zu diesem Zeitpunkt
// bereits Bestandteil des CRM-Datensatzes) — deshalb gilt in dieser
// Referenzwelt durchgängig `matchedAt === ingestedAt`. Das ist eine
// Eigenschaft der aktuellen Match-Methode, keine architektonische Vorgabe:
// eine künftige, tatsächlich asynchrone Matching-Methode (z. B. ein
// nächtlicher Abgleichlauf) würde `matchedAt > ingestedAt` erzeugen, ohne
// dass sich an dieser Datenstruktur etwas ändern müsste.

// "pending" ist der Regelzustand für jeden bei Meta generierten Lead, für den
// (noch) kein Resolution-Fakt existiert — weder ein Match noch eine
// eigenständige Unmatched-/Ambiguous-/Rejected-Entscheidung. "unmatched",
// "ambiguous" und "rejected" bleiben als künftige, unterstützte Zustände im
// Typsystem reserviert, werden aber ohne einen eigenen, kanonischen
// Resolution-Event-Strom (existiert in diesem Auftrag nicht) niemals
// synthetisch erzeugt — siehe `resolveMarketingLeadMatchStatus`.
export type MarketingLeadMatchStatus = "pending" | "matched" | "unmatched" | "ambiguous" | "rejected";

export interface MetaLeadGenerated {
  id: string;
  externalLeadId: string;
  provider: "meta";
  generatedAt: string;
  externalCampaignId: string;
  campaignId: string;
}

export interface MarketingCrmLeadIngested {
  id: string;
  leadId: string;
  externalCrmLeadId: string;
  ingestedAt: string;
  crmProvider: "synthetic-crm";
  // Nur gesetzt, wenn der CRM-Ingestion-Vorgang tatsächlich eine externe
  // Meta-Lead-ID mitführte (realistisch: ein verstecktes Formularfeld/Webhook-
  // Payload-Attribut) — ein roher CRM-Datensatzfakt, KEINE Match-Aussage.
  // Ob daraus ein eindeutiges Match folgt, entscheidet ausschließlich ein
  // eigenes `MarketingLeadIdentityMatched`-Event (siehe unten) — dieses Feld
  // trägt absichtlich kein `matchStatus` mehr (Korrekturauftrag: das
  // Ingestion-Event darf nicht selbst zur zweiten Match-Wahrheit werden).
  metaExternalLeadIdOnRecord?: string;
}

// Append-only Match-Event: die einzige Source of Truth dafür, DASS und WANN
// eindeutig belegt wurde, dass ein MetaLeadGenerated- und ein
// MarketingCrmLeadIngested-Event denselben Lead-Vorgang repräsentieren.
// Referenziert beide Source Events per ID (referenzielle Integrität) und
// führt zusätzlich die externen/internen Identifier beider Seiten redundant
// mit, damit ein Konsument nicht zwingend beide Source Events nachschlagen
// muss, um die Match-Aussage selbst zu verstehen — exakt dasselbe Muster wie
// `appointmentId` auf den Sales-Appointment-Lifecycle-Events
// (events/sales-appointment-lifecycle.ts), das ebenfalls Kontext redundant
// mitführt, ohne dadurch eine zweite Wahrheit zu werden (die Werte werden
// unten wörtlich von den beiden Source Events übernommen, nie unabhängig neu
// gewürfelt).
export interface MarketingLeadIdentityMatched {
  id: string;
  metaLeadGeneratedEventId: string;
  crmLeadIngestedEventId: string;
  externalLeadId: string;
  externalCrmLeadId: string;
  leadId: string;
  matchedAt: string;
  method: "direct-external-meta-lead-id";
}

// Kalibrierung (B8/B15-analog, synthetische Reference-World-Kalibrierung,
// keine Branchenbenchmark-Behauptung) — siehe Abschlussbericht für den
// vollständigen Kandidatenvergleich (zwei geprüfte Coverage-Kandidaten: 35%
// und 48%; 48% gewählt, liefert über alle sechs Scenario Profiles eine
// vierstellige, aber nicht dominierende Meta-Zuordnung, ohne "jeder Lead kam
// von Meta" vorzutäuschen).
const META_MATCH_COVERAGE = 0.48;
const IMMEDIATE_INGESTION_PROB = 0.55; // Anteil der Matches mit delay=0 ("sofortiger CRM-Eingang")
const DELAYED_INGESTION_MAX_DAYS = 6;
// Zusätzliche, NIE gematchte Meta-Leads (Meta generiert, landet nie im CRM) —
// als Anteil an der bereits gematchten Menge.
const STANDALONE_UNMATCHED_META_LEAD_FRACTION = 0.22;

const META_LEAD_SEED_OFFSET = 70_000_000;
const META_STANDALONE_SEED_OFFSET = 80_000_000;

// Polynomial-Hash MIT anschließendem Avalanche-Finalizer (Murmur3-fmix32-
// Muster). Ohne den Finalizer wäre der reine Polynomial-Hash für Strings, die
// sich nur im letzten Zeichen unterscheiden (z. B. "campaign-04" vs.
// "campaign-05"), monoton im letzten Zeichencode — ein empirisch entdeckter
// Bug in einer früheren Version dieser Funktion: pickCampaignStable() wählte
// dadurch für JEDE Entität dieselbe, zuletzt hinzugefügte Campaign, statt
// einer pseudo-zufälligen, entity-abhängigen Verteilung. Der Finalizer
// streut die Bits ausreichend, damit unterschiedliche Suffixe kein
// vorhersagbares Muster mehr ergeben.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function leadNumericKey(leadId: string): number {
  const match = /^lead-(\d+)$/.exec(leadId);
  if (!match) {
    throw new Error(`marketing-meta-crm-source: unerwartetes Lead-ID-Format "${leadId}"`);
  }
  return parseInt(match[1]!, 10);
}

// Rendezvous-Hashing (HRW) statt Index-Auswahl über `rng() * campaigns.length`:
// eine reine Index-Auswahl wäre von `campaigns.length` abhängig — das
// Hinzufügen einer fünften, völlig unabhängigen Campaign würde dann bei
// bereits bestehenden, längst zugeordneten Leads die Bucket-Grenzen
// verschieben und rückwirkend ihre Campaign-Zuordnung ändern (empirisch
// geprüft: ca. 50% der bestehenden Zuordnungen kippten bei einem Test mit
// einer zusätzlichen Campaign). Exakt dieselbe Fehlerklasse wie der
// Positions-Zähler-Bug bei den Sales-Appointment-IDs (siehe
// world/sales-appointments.ts) — hier vorab vermieden statt nachträglich
// korrigiert. Rendezvous-Hashing wählt stattdessen je Entität deterministisch
// die Campaign mit dem höchsten hash(key, campaign.id) — stabil gegenüber
// Reihenfolge UND gegenüber zusätzlichen Campaigns (nur Entitäten, deren
// Hash für die NEUE Campaign am höchsten ausfällt, wechseln überhaupt; alle
// übrigen bleiben exakt bei ihrer bisherigen Zuordnung).
function pickCampaignStable(key: string, campaigns: readonly MarketingCampaign[]): MarketingCampaign {
  let best = campaigns[0]!;
  let bestScore = -1;
  for (const campaign of campaigns) {
    const score = hashString(`${key}:${campaign.id}`);
    if (score > bestScore) {
      bestScore = score;
      best = campaign;
    }
  }
  return best;
}

export interface MetaCrmSourceBundle {
  metaLeadGenerated: MetaLeadGenerated[];
  crmLeadIngested: MarketingCrmLeadIngested[];
  marketingLeadIdentityMatched: MarketingLeadIdentityMatched[];
}

// Erzeugt ALLE DREI gekoppelten Event-Arrays in einem Durchgang (nicht
// getrennt generierbar ohne die referenzielle Konsistenz zwischen
// externalLeadId, metaExternalLeadIdOnRecord und den beiden im Match-Event
// referenzierten Event-IDs künstlich zu duplizieren) — exakt derselbe Grund,
// aus dem events/generate-interactions.ts mehrere zusammengehörige
// Entitäten in einem gemeinsamen Generator erzeugt.
export function generateMetaCrmSource(
  seed: number,
  leads: readonly Lead[],
  campaigns: readonly MarketingCampaign[],
): MetaCrmSourceBundle {
  const metaLeadGenerated: MetaLeadGenerated[] = [];
  const crmLeadIngested: MarketingCrmLeadIngested[] = [];
  const marketingLeadIdentityMatched: MarketingLeadIdentityMatched[] = [];

  // --- Teil 1: für eine Teilmenge bestehender Leads ein passendes,
  // vorgelagertes Meta-Generierungsereignis erzeugen und — da die aktuelle
  // Match-Methode synchron beim CRM-Eingang entscheidet — im selben Zug ein
  // eigenes Match-Event mit `matchedAt === ingestedAt` erzeugen. -----------
  for (const lead of leads) {
    const coverageRng = createRng(seed + META_LEAD_SEED_OFFSET + leadNumericKey(lead.id));
    const isMetaAttributed = coverageRng() < META_MATCH_COVERAGE;

    const externalCrmLeadId = `crm-lead-${String(leadNumericKey(lead.id)).padStart(5, "0")}`;
    const ingestedAt = lead.createdAt; // wörtliche Projektion, keine zweite Zeitwahrheit
    const crmEventId = `crm-ingest-${lead.id}`;

    if (!isMetaAttributed) {
      // Kein Meta-Bezug überhaupt — dieser Lead ist schlicht kein Meta-Lead
      // (z. B. Empfehlung, Website-Formular, ...). Kein MetaLeadGenerated,
      // kein Match-Event: die Frage "matched?" stellt sich für ihn nicht.
      crmLeadIngested.push({
        id: crmEventId,
        leadId: lead.id,
        externalCrmLeadId,
        ingestedAt,
        crmProvider: "synthetic-crm",
      });
      continue;
    }

    const detailRng = createRng(seed + META_LEAD_SEED_OFFSET + leadNumericKey(lead.id) + 1);
    const campaign = pickCampaignStable(lead.id, campaigns);
    const delayDays = detailRng() < IMMEDIATE_INGESTION_PROB ? 0 : randomInt(detailRng, 1, DELAYED_INGESTION_MAX_DAYS);
    // generatedAt <= ingestedAt garantiert per Konstruktion (Subtraktion einer
    // nicht-negativen Verzögerung) — kausal zwingend, nie umgekehrt (B2).
    const generatedAt = addDays(ingestedAt, -delayDays);
    const externalLeadId = `meta-lead-${String(leadNumericKey(lead.id)).padStart(5, "0")}`;

    const metaEventId = `meta-lead-gen-${lead.id}`;
    metaLeadGenerated.push({
      id: metaEventId,
      externalLeadId,
      provider: "meta",
      generatedAt,
      externalCampaignId: campaign.externalCampaignId,
      campaignId: campaign.id,
    });
    crmLeadIngested.push({
      id: crmEventId,
      leadId: lead.id,
      externalCrmLeadId,
      ingestedAt,
      crmProvider: "synthetic-crm",
      metaExternalLeadIdOnRecord: externalLeadId,
    });
    // Match-Event: eigener, append-only Fakt mit eigenem Zeitpunkt. In dieser
    // Referenzwelt entscheidet die Match-Methode synchron beim CRM-Eingang
    // (die externe Meta-Lead-ID ist zu diesem Zeitpunkt bereits Bestandteil
    // des CRM-Datensatzes) — deshalb matchedAt === ingestedAt, niemals
    // generatedAt und niemals aus WORLD_NOW abgeleitet.
    marketingLeadIdentityMatched.push({
      id: `marketing-lead-match-${lead.id}`,
      metaLeadGeneratedEventId: metaEventId,
      crmLeadIngestedEventId: crmEventId,
      externalLeadId,
      externalCrmLeadId,
      leadId: lead.id,
      matchedAt: ingestedAt,
      method: "direct-external-meta-lead-id",
    });
  }

  // --- Teil 2: eigenständige Meta-Leads, die NIE im CRM landeten
  // (unmatched von der Meta-Seite aus) — realistische Datenqualitätslücke,
  // bewusst nicht unterschlagen (B8). Entity-stabil über einen fortlaufenden,
  // aber von der Lead-Population komplett unabhängigen Index — keine
  // Kopplung an leads.length oder Iterationsreihenfolge der Leads. ----------
  const standaloneCount = Math.round(leads.length * STANDALONE_UNMATCHED_META_LEAD_FRACTION * META_MATCH_COVERAGE);
  for (let i = 0; i < standaloneCount; i++) {
    const rng = createRng(seed + META_STANDALONE_SEED_OFFSET + i);
    const standaloneKey = `meta-standalone-${i}`;
    const campaign = pickCampaignStable(standaloneKey, campaigns);
    // Über den vollen Zeitraum bis WORLD_NOW gestreut (kein Bezug zu einer
    // Lead-Existenz-Zeitspanne, da diese Leads nie ein internes Lead-Pendant
    // besitzen) — verwendet ausschließlich bereits vorhandene, deterministische
    // Ziehungen desselben Rng, kein zweiter Zeitanker nötig.
    const dayOffset = randomInt(rng, 0, 456); // 2024-06-01..2025-09-01 Gesamtspanne
    const generatedAt = addDays("2024-06-01", dayOffset);
    if (generatedAt > WORLD_NOW) {
      continue; // defensiv, obwohl die Spanne bereits exakt auf WORLD_NOW endet
    }
    metaLeadGenerated.push({
      id: `meta-lead-gen-standalone-${String(i + 1).padStart(5, "0")}`,
      externalLeadId: `meta-lead-standalone-${String(i + 1).padStart(5, "0")}`,
      provider: "meta",
      generatedAt,
      externalCampaignId: campaign.externalCampaignId,
      campaignId: campaign.id,
    });
  }

  return { metaLeadGenerated, crmLeadIngested, marketingLeadIdentityMatched };
}

// Kanonische, einzige Auswertungsfunktion für den abgeleiteten Match-Status
// eines Meta-Leads zu einem gegebenen asOf (Korrekturauftrag, Abschnitt 8:
// "Statusberechnung an mehreren Produktionsstellen" ist NICHT zulässig — jede
// Stelle, die wissen will, ob/wann ein MetaLeadGenerated-Ereignis mit einem
// CRM-Lead verbunden wurde, ruft ausschließlich diese Funktion auf, nie einen
// eigenen Vergleich auf `matchEvents`). `matchEvents` muss bereits die für
// den betrachteten asOf sichtbare, gefilterte Menge sein (Snapshot filtert
// dies bereits über `matchedAt <= asOf`, siehe snapshot/snapshot.ts) — diese
// Funktion filtert zusätzlich defensiv selbst, damit ein Aufruf mit der
// vollständigen, ungefilterten World-Wahrheit niemals Future Knowledge in den
// projizierten Status durchsickern lässt.
//
// "unmatched"/"ambiguous"/"rejected" werden hier bewusst NIE zurückgegeben:
// es existiert in diesem Auftrag kein eigener, kanonischer
// Resolution-Event-Strom für diese drei Zustände (siehe Kopfkommentar dieser
// Datei) — ein Meta-Lead ohne sichtbares Match ist daher stets `pending`,
// niemals fälschlich als endgültig entschieden dargestellt.
export function resolveMarketingLeadMatchStatus(
  metaLeadGeneratedEventId: string,
  asOf: string,
  matchEvents: readonly MarketingLeadIdentityMatched[],
): MarketingLeadMatchStatus {
  const visibleMatch = matchEvents.find(
    (m) => m.metaLeadGeneratedEventId === metaLeadGeneratedEventId && m.matchedAt <= asOf,
  );
  return visibleMatch ? "matched" : "pending";
}
