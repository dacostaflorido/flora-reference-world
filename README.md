# Flora Reference World

Ein deterministisches, in sich konsistentes Referenzunternehmen ("Elbfeld Software GmbH")
für Entwicklung, UX-Forschung und Demos.

Siehe [`PRINCIPLES.md`](./PRINCIPLES.md) für die verbindlichen Grundprinzipien.

## Elbfeld-Abgrenzung

„Elbfeld Software GmbH" ist in diesem Projekt eine vollständig synthetische Referenzinstanz.
Die Daten innerhalb dieser Reference World sind ausschließlich innerhalb dieses Modells
kanonisch. Der Name darf nicht als Aussage verstanden werden, dass andere, an anderer Stelle
existierende Test- oder Demo-Datensätze mit demselben Namen dieselbe Instanz oder dieselben
Unternehmensdaten darstellen.

## Isolationsregeln

Diese Regeln gelten dauerhaft und sind nicht verhandelbar (siehe `PRINCIPLES.md`, Prinzip 1):

- `flora-reference-world` wurde bewusst als technisch isoliertes Referenz-/Simulationsmodell
  entwickelt — unabhängig von jedem umgebenden Produkt-Repository.
- **Keine** Imports aus umgebendem Produktcode (z. B. `apps/`, `packages/` eines Produkt-Repos)
  in diesen Ordner.
- **Keine** Imports aus diesem Ordner in umgebenden Produktcode.
- Kein Produktcode, keine Regel-Engine, keine UI, keine Produktfeatures.
- Eigene, isolierte `package.json`, `tsconfig.json` und Dependencies — unabhängig von jedem
  umgebenden Produkt-Toolchain.
- Der Ordner ist so strukturiert, dass er als eigenständiges Repository betrieben werden kann,
  ohne strukturelle Änderungen.
- Im aktuellen privaten Monorepo liegt `flora-reference-world` weiterhin als isolierter Ordner
  neben einem separaten Produkt-Workspace (`pnpm-workspace.yaml` erfasst dort nur `apps/*` und
  `packages/*`, nicht diesen Ordner).

## Architektur

```
World (statisch) → Events (dynamisch) → Observations (abgeleitet, evidenzbasiert)
                                              ↓
                                        Ground Truth (Priorität/Gruppierung)
                                              ↓
                                        Business State (Gesamtcharakterisierung)
                                              ↓
                                        Executive Context (Führungsrelevanz)
```

- **Ground Truth** — Was ist wahr? (welche Observations gelten, wie wichtig, welche gehören zusammen)
- **Business State** — Welches Gesamtbild ergibt sich daraus? (rein deskriptiv, siehe `PRINCIPLES.md`, Prinzip 19) — **eingefroren**
- **Executive Context** — Warum ist dieses Gesamtbild für die Unternehmensführung relevant? (rein deskriptiv, rollenbezogen nicht personenbezogen, siehe `PRINCIPLES.md`, Prinzip 20)
- **Decision** (nicht implementiert) — Was folgt daraus? (verbindet Executive Context + Business State + Ground Truth mit THE_BOOK — der Management-/Wissensbasis des übergeordneten Flora-Produkts, nicht Bestandteil dieses Repositories)

**Business State ist eingefroren** (siehe `PRINCIPLES.md`, Prinzip 19): sechs feste, rein deskriptive Types, ausschließlich aus GroundTruthSnapshot + Observations abgeleitet, niemals aus dem erzeugenden Scenario Profile. Fünf der sechs Types entstehen heute aus objektiver Ground Truth (`ausgeglichen`, `verlangsamte-pipeline`, `operative-anspannung`, `konzentrierte-last`, `strategischer-freiraum`); `wachstum-ueber-kapazitaet` bleibt bewusst unerreichbar, da die verfügbare Ground Truth aktuell nur ein Trend-, kein Niveau-Signal für Lead-/Opportunity-Volumen liefert. Alle darüberliegenden Ebenen konsumieren Business State, ändern ihn aber nie.

**Executive Context** erklärt ausschließlich, warum ein Business State Führungsaufmerksamkeit verdient — welche Ground-Truth-Gruppen betroffen sind (`affectedDimensions`) und, falls mehrere Dimensionen gleichzeitig betroffen sind, welche Spannung das erzeugt (`tensionStatement`). Rein rollenbezogen ("die Unternehmensführung"), nicht personenbezogen — eine echte Personalisierung erfordert eine bewusste, hier noch nicht existierende Personen-/Verantwortungsebene und darf nicht aus dem Organigramm simuliert werden.

Scenario Profiles verschieben ausschließlich Wahrscheinlichkeiten/Verteilungen im
bestehenden Generator (`engine/scenario-profiles.ts`) — keine zweite Welt, keine
Architekturänderung (siehe `PRINCIPLES.md`, Prinzip 10). Snapshot (`snapshot/`)
projiziert die Event-Historie auf einen beliebigen Zeitpunkt — reine Rekonstruktion,
keine Analyse.

Eine `Decision`-Ebene ist architektonisch vorgesehen (siehe `PRINCIPLES.md`, Prinzip
17), aber bewusst nicht implementiert.

Die Architektur ist eingefroren. Änderungen am Domänenmodell erfordern eine explizite
Freigabe — siehe `PRINCIPLES.md`, Prinzip 2.

## Struktur

- `engine/` — deterministische Generierungs-Infrastruktur (Seed/PRNG, Scenario Profiles,
  Generator-Orchestrierung)
- `world/` — statische Entitäten (Company, Department, Role, Employee, CustomerAccount, …)
- `timeline/` — Zeitachsen-/Simulationszeitraum-Logik
- `events/` — dynamische Ereignisse (Lead, Opportunity, Interaktionen, …)
- `observations/` — abgeleitete, evidenzbasierte Beobachtungen
- `ground-truth/` — Priorisierung/Gruppierung bereits bestehender Observations
- `business-state/` — rein deskriptive Gesamtcharakterisierung einer Ground Truth,
  scenario-blind (siehe `PRINCIPLES.md`, Prinzip 19)
- `executive-context/` — erklärt, warum ein Business State für die Unternehmensführung
  relevant ist, rein deskriptiv, rollenbezogen (siehe `PRINCIPLES.md`, Prinzip 20)
- `snapshot/` — Extraktion eines Zeitpunkt-Zustands aus der Event-Historie, für einen
  beliebigen Zeitpunkt innerhalb der Timeline (nicht nur WORLD_NOW)
- `validation/` — automatisierte Prüfung der Invarianten

## Voraussetzungen

Node.js >=24, pnpm 11.18.0.

## Entwicklung

```bash
pnpm --dir flora-reference-world install
pnpm --dir flora-reference-world typecheck
pnpm --dir flora-reference-world test
```

## License

MIT License — siehe [`LICENSE`](./LICENSE).
