# Flora Reference World Principles

## Zweck

Die Flora Reference World ist eine vollständig fiktive, aber intern konsistente Unternehmenssimulation.

Sie dient ausschließlich der Entwicklung, Validierung, UX-Forschung und hochwertigen Produktdemonstrationen.

Sie ist ausdrücklich kein Bestandteil des Produktes.

---

## Grundprinzipien

### 1. Product Separation

Die Reference World besitzt keinerlei Produktlogik.

Sie enthält keine Rule Engine.

Keine UI.

Keine Produktfeatures.

Keine Geschäftslogik von Flora.

Sie liefert ausschließlich konsistente Testdaten.

---

### 2. Architecture Frozen

Das Domänenmodell wird bewusst stabil gehalten.

Neue Entitäten werden nur ergänzt, wenn sie langfristig notwendig sind.

Keine spontane Modellierung während der Implementierung.

---

### 3. Deterministic Generation

Jede Welt muss vollständig reproduzierbar sein.

Ein identischer WORLD_SEED erzeugt immer dieselbe Unternehmenswelt.

---

### 4. Referential Integrity

Alle Beziehungen müssen dauerhaft gültig sein.

Keine verwaisten Referenzen.

Keine ungültigen Beziehungen.

Keine widersprüchlichen Historien.

---

### 5. Temporal Consistency

Zeitliche Kausalität ist verpflichtend.

Nichts darf passieren, bevor seine Ursache existiert.

Historien dürfen niemals widersprüchlich werden.

---

### 6. World Before Events

Die Welt existiert zuerst.

Ereignisse entstehen ausschließlich aus der bestehenden Welt.

Nicht umgekehrt.

---

### 7. Events Before Observations

Beobachtungen entstehen ausschließlich aus vorhandenen Ereignissen.

Nie aus Annahmen.

Nie aus Zufall.

---

### 8. Evidence Required

Jede Observation benötigt nachvollziehbare Belege.

Eine Observation ohne Referenzen existiert nicht.

---

### 9. Ground Truth

Die Reference World kennt die tatsächliche Wahrheit jedes Szenarios.

Sie dokumentiert bewusst erzeugte Muster.

Diese Ground Truth dient ausschließlich der Validierung zukünftiger Flora-Ergebnisse.

---

### 10. Scenario Independence

Szenarien verändern ausschließlich Wahrscheinlichkeiten.

Nicht die Architektur.

Nicht die Entitäten.

Nicht die Regeln.

---

### 11. Human Realism

Personen handeln konsistent.

Teams besitzen nachvollziehbare Dynamiken.

Kommunikation soll sich wie in einem echten mittelständischen Unternehmen anfühlen.

Nicht wie zufällig erzeugte Testdaten.

---

### 12. Explainability

Jede spätere Führungsentscheidung muss sich bis zu den zugrunde liegenden Ereignissen zurückverfolgen lassen.

Keine Black Box.

Keine unbegründeten Aussagen.

Die vollständige, benannte Kette dieser Rückverfolgbarkeit steht in Prinzip 18 (Backward Explainability).

---

### 13. Long-Term Maintainability

Die Reference World wird langfristig gepflegt.

Lesbarkeit, Verständlichkeit und Konsistenz sind wichtiger als maximale Komplexität.

---

### 14. Single Source of Truth

Es existiert nur eine Unternehmenswelt.

Alle Snapshots, Szenarien und Datensätze werden ausschließlich daraus erzeugt.

Es entstehen niemals mehrere voneinander abweichende Referenzwelten.

---

### 15. Purpose

Das Ziel der Reference World ist nicht, möglichst viele Daten zu erzeugen.

Das Ziel ist, eine glaubwürdige Unternehmensrealität zu simulieren, gegen die Flora jederzeit getestet, validiert und weiterentwickelt werden kann.

---

### 16. Domain Generality

Die Reference World ist langfristig keine Sales Reference World, sondern eine Company Reference World.

Sales ist bewusst die erste vollständig ausgebaute Domäne — nicht weil Flora eine Sales-KI ist, sondern weil Sales die erste Business-Domäne innerhalb einer vollständigen Unternehmenswelt ist.

Weitere Domänen sollen langfristig nach demselben Prinzip ergänzt werden können: Marketing, Consulting, Customer Success, Operations, Finance, HR.

Jede zukünftige Architekturentscheidung prüft deshalb: Ist diese Lösung allgemein für Business-Domänen geeignet, oder ist sie unnötig Sales-spezifisch? Im Zweifel wird die allgemeinere Lösung gewählt.

---

### 17. Layered Truth

Reference World → Ground Truth → Decision Engine → THE_BOOK.

(THE_BOOK bezeichnet die Management-/Wissensbasis des übergeordneten Flora-Produkts und ist nicht Bestandteil dieses Reference-World-Repositories.)

Jede Schicht hat genau eine Aufgabe und reicht nach oben weiter, ohne die Aufgabe der nächsten vorwegzunehmen.

Die Reference World beschreibt eine glaubwürdige Unternehmensrealität. Ground Truth beschreibt, welche Realität zu einem bestimmten Zeitpunkt als „wahr" gilt — welche Observations gelten, welche am wichtigsten sind, welche zusammengehören. Ground Truth erzeugt dabei keine neue Erkenntnis; sie strukturiert ausschließlich bereits bestätigte Observations und referenziert niemals Rohdaten.

Erst die Decision Engine verbindet Ground Truth mit den Führungsprinzipien aus THE_BOOK und leitet daraus Handlungsempfehlungen ab. Managementlogik gehört ausschließlich dorthin — nie in die Reference World, nie in Ground Truth.

---

### 18. Backward Explainability

Jede Information auf einer höheren Ebene muss sich vollständig bis zur World zurückverfolgen lassen:

Decision → Business State → Ground Truth → Observation → Evidence → Events → World

Keine Ebene darf eine Aussage enthalten, die sich nicht entlang dieser Kette bis zu den zugrunde liegenden Weltereignissen zurückführen lässt. Eine Ebene, die diese Kette unterbricht — etwa durch eine Aussage ohne referenzierbare Herkunft, oder durch das Überspringen einer Zwischenebene —, verletzt dieses Prinzip unabhängig davon, wie plausibel die Aussage inhaltlich wirkt.

Decision Engine existiert zum Zeitpunkt dieses Prinzips noch nicht. Das Prinzip gilt bereits jetzt vollständig für die implementierten Glieder der Kette bis Business State (durchgesetzt u. a. über Observation.derivedFrom, BusinessStateSnapshot.supportingObservationIds und die zugehörigen Invarianten in validation/) und bindet jede künftige Ebene ab ihrer ersten Implementierung.

Ergänzt Prinzip 12 (Explainability) um die vollständige, benannte Kette.

---

### 19. Business State is descriptive, never normative

Der Business State verdichtet Ground Truth zu einem verständlichen Unternehmenszustand.

Er beantwortet ausschließlich, wie die aktuelle Gesamtlage zu verstehen ist — niemals, was daraus folgen soll.

Er darf keinerlei Führungsentscheidung, Handlungsempfehlung oder Priorisierung von Maßnahmen enthalten. Keine normative oder imperative Sprache.

Normative Aussagen — was zu tun ist, was Priorität hat, was der Geschäftsführer entscheiden sollte — entstehen ausschließlich in der Decision Engine, die Ground Truth mit den Führungsprinzipien aus THE_BOOK verbindet. Executive Context (Prinzip 20) liegt zwischen Business State und Decision, bleibt aber ebenso deskriptiv wie Business State selbst — nicht normativ.

Der Business State selbst konsumiert ausschließlich scenario-blinde Wahrheit (GroundTruthSnapshot und die zugehörigen bestätigten Observations) — niemals das erzeugende Scenario Profile. Dieselbe Ground Truth muss unabhängig davon, welches Scenario Profile sie erzeugt hat, immer denselben Business State ergeben.

Prinzip 18 (Backward Explainability) gilt für den Business State uneingeschränkt: jede Aussage muss sich über die zugrunde liegenden Observations bis zur World zurückverfolgen lassen.

**Business State ist eingefroren.** Fünf der sechs definierten Types (ausgeglichen, verlangsamte-pipeline, operative-anspannung, konzentrierte-last, strategischer-freiraum) entstehen aus objektiver, in Ground Truth bestätigter Wahrheit. `wachstum-ueber-kapazitaet` bleibt bewusst unerreichbar — nicht wegen einer Lücke in der Klassifikationsmethode, sondern weil die verfügbare Ground Truth aktuell ausschließlich ein Trend-Signal (Beschleunigung des Lead-Volumens) liefert, kein Niveau-Signal (absolute Volumenhöhe). Das ist eine dokumentierte, ehrliche Grenze der darunterliegenden Wahrheitsschicht, kein Mangel des Business State selbst.

Alle darüberliegenden Ebenen (Executive Context, Decision Engine) konsumieren Business State ausschließlich, verändern ihn nie. Business State selbst wird ab diesem Zeitpunkt nicht mehr erweitert — weder um zusätzliche Types noch um eine reichhaltigere Klassifikationslogik. Eine Anpassung ist ausschließlich dann gerechtfertigt, wenn eine darunterliegende Wahrheitsschicht (World, Events, Observations oder Ground Truth) objektiv neue Realität liefert, die heute noch nicht existiert — z. B. ein künftiges Niveau-Signal für Lead-/Opportunity-Volumen, das `wachstum-ueber-kapazitaet` erreichbar machen würde.

---

### 20. Executive Context explains relevance, never action

Executive Context erklärt, warum ein bereits belegter Business State für die Unternehmensführung relevant ist. Er erzeugt keine neue Wahrheit und keine Handlungsempfehlung.

Er beantwortet ausschließlich, warum ein Zustand Führungsaufmerksamkeit verdient — welche Unternehmensdimension betroffen ist, welche Spannungen sichtbar werden. Niemals, was daraus folgen soll. Keine Priorisierung, keine Handlungsempfehlung, keine Managementmethode, keine eigene Risiko-/Chancen-Bewertung — diese liegt bereits in den zugrunde liegenden Observations/Ground Truth vor und wird hier nicht neu aggregiert.

Executive Context führt keine neue Klassifikation ein. Er ordnet keinen neuen, geschlossenen Typ zu (kein "Führungsmodus", keine Kategorie wie "Firefighting"/"Strategy") — das wäre faktisch ein zweiter Business State. Seine einzigen strukturierten Felder (`affectedDimensions`) stammen ausschließlich aus bereits bestehenden Ground-Truth-Gruppen; alles Weitere ist redaktionell verfasste, evidenzgebundene Prosa.

Executive Context ist in dieser Ausbaustufe ausdrücklich **rollenbezogen, nicht personenbezogen**: er erklärt Relevanz für die Unternehmensführung als Rolle, nicht für eine bestimmte, benannte Person. Eine personenbezogene Executive-Perspektive ist erst zulässig, wenn eine explizite, bewusst entworfene Personen-/Verantwortungsebene existiert — sie darf nicht aus dem bestehenden Organigramm (Employee.managerId) simuliert oder abgeleitet werden, auch wenn das technisch möglich wäre.

Prinzip 18 (Backward Explainability) gilt uneingeschränkt: `supportingObservationIds` ist stets eine Teilmenge der bereits von Business State zitierten Evidenz, niemals eine Erweiterung.
