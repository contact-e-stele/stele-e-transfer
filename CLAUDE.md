# Stele E-Transfer — Hinweise für Claude Code

Feature-/Roadmap-Übersicht: `P-UEBERSICHT.md`. Architektur-Details: `docs/ARCHITECTURE.md`.
Session-Scratchpad für offene Arbeit: `task.md`.

## GRUNDGESETZ — Arbeitsweise (Regel seit 2026-09-13, gilt für jede Session)

Diese Regeln gehen allen anderen vor. Sie sind aus konkreten Fehlern dieses Projekts entstanden —
die Beispiele stehen bewusst dabei, damit klar ist, warum es die Regel gibt.

**1. Selbst ausführen, nicht dem Nutzer zum Ausführen hinlegen.**
Skripte, Tests, Typechecks, Berichte: selbst laufen lassen und das ECHTE Ergebnis zeigen. Einen
Befehl hinzuschreiben, den der Nutzer abtippen soll, ist der Ausnahmefall — zulässig nur, wenn es
technisch unmöglich ist (Produktions-DB, `api.ebay.com` ist aus der Sandbox proxy-geblockt). Dann
den Grund WÖRTLICH benennen (z.B. `403 request blocked: no rule or allowlist entry allows host
"api.ebay.com"`), nicht bloß "geht nicht". Wo ein Lauf gegen echte Daten unmöglich ist: gegen eine
lokale Test-DB mit realistischen Daten end-to-end ausführen — das findet echte Fehler.
*Beleg: beim ersten echten Lauf des Teil-3B-Berichts fielen zwei Fehler auf, die im Code-Review
nicht aufgefallen waren — Produkt-EK statt Varianten-EK, und eine `undefined`-Spalte.*

**2. Logik testbar bauen, damit Punkt 1 überhaupt möglich ist.**
Rechenlogik gehört in reine Funktionen (eigenes Modul), nicht in ein Skript, das ohne Produktions-
zugang nicht läuft. Skripte formatieren nur noch das Ergebnis. Gilt besonders für alles, woraus
Geldbeträge werden.

**3. Keine Zahl raten. Niemals.**
Jeder Zahlenwert in Tests, Tabellen, Dokumenten und PR-Texten wird frisch nachgerechnet (`bun`),
auch wenn er "offensichtlich" wirkt oder aus einem früheren Schritt erinnert wird.
*Belege: geratene Test-Fixtures in Teil 2A waren falsch; in `teil2c-target-margin-audit.md` standen
2,23 €/4,23 € statt 2,08 €/3,61 € (aus einer anderen Zeile übernommen); die Schätzung "~5 Läufe"
waren nachgerechnet 7.*

**4. Keine Daten erfinden.**
Liegen reale Daten nicht vor, wird die Lücke benannt und die Zeile bleibt leer — keine plausibel
aussehenden Platzhalter. Eine Tabelle mit 2 echten statt 10 erfundenen Zeilen ist das richtige
Ergebnis, wenn nur 2 bekannt sind.

**5. Regressions-Beweis nach jedem Fix.**
Fix testweise kaputt machen → prüfen, dass die Tests WIRKLICH fehlschlagen → zurücksetzen → grün.
Dabei prüfen, ob die Fixture überhaupt unterscheidet: ein Test, der auch mit dem alten Verhalten
grün bleibt, beweist nichts.
*Beleg: die erste Fixture für die `up95`→`nearest95`-Umstellung (2,15 €) rundete in beiden Modi
gleich — der Test wäre folgenlos durchgelaufen. Ersetzt durch 2,55 €.*

**6. Abweichungen von der Vorgabe offenlegen, nicht still entscheiden.**
Widerspricht sich eine Vorgabe in sich, gilt die härtere Anforderung — und die Abweichung kommt
sichtbar in die PR-Beschreibung, mit Begründung und Rückfrage.
*Beleg Teil 2D: "Grenzwert nicht unterschreiten" und "mit roundToNearest95() runden" widersprechen
sich; die 8-%-Grenze bekam Vorrang, die Abweichung wurde oben in der PR benannt.*
Umgekehrt gilt: eine Vorgabe, die sachlich unnötig ist (z.B. eine Migration für ein Feld, das es
schon gibt), wird nicht stillschweigend ausgeführt UND nicht stillschweigend übergangen — sondern
begründet zur Entscheidung vorgelegt.

**7. Strikte Grenzen am Ende nachweisen, nicht behaupten.**
"`AUTO_PRICE_WRITE_ENABLED` unangetastet", "nichts geschrieben", "Migration additiv" werden per
`git diff` / `grep` belegt und das Ergebnis in die PR geschrieben.

**8. Nicht duplizieren, extrahieren.**
Regeln, aus denen Geldbeträge werden (SKU-Zuordnung, Preisformel, Matching), existieren genau
einmal. Braucht ein Skript dieselbe Logik wie die App, wird sie herausgezogen (reiner Extract,
bestehende Tests müssen grün bleiben) statt nachgebaut.
*Beleg: PR #82 war ein Bug, der nur existierte, weil eine Blacklist doppelt gepflegt war.*

**9. Voraussetzungen prüfen, bevor ein Teilauftrag beginnt.**
"PR X ist gemergt und deployed" wird verifiziert (PR-Status + Versionsnummer im Code), nicht
angenommen. Ist der Arbeits-Branch bereits gemergt, wird er frisch von `origin/main` gesetzt.

**10. Deploy-Risiken aktiv benennen.**
Ändert ein PR das DB-Schema, gehört in die Meldung, worauf im Deploy-Log zu achten ist und was
passiert, wenn die Migration nicht greift.
*Beleg: nach `variant_sell_prices` fragen 17 Voll-Abfragen diese Spalte ab — ohne Migration bricht
jede davon.*

**11. Kurz berichten.**
Was gemacht wurde, warum, was der Nutzer entscheiden muss. Keine Wiederholung des PR-Textes im
Chat. Antwortsprache: Deutsch.

**12. Funde festhalten.**
Jeder Fund (Root Cause, Fix, Verifikation, offene Entscheidung) kommt in `task.md` und in die
PR-Beschreibung — mit konkreter Bezeichnung, damit nichts zweimal untersucht wird. Ergänzt den
Abschnitt "Verifikations- & Archivierungs-Workflow" weiter unten, ersetzt ihn nicht.

**13. Merge-Regel (Stand 13.09.2026).**
Der Nutzer mergt PRs **selbst und ohne Wartezeit** — auch bei Geld-/Preis-Logik, Migrationen und
Auth. Claude prüft **danach**: Diff lesen, Zahlen unabhängig gegen die echte Produktions-DB
nachrechnen, Live-Zustand prüfen, Abweichungen melden; bei Fehlern Rollback über Render.
Claude übernimmt **keine Dauervollmacht zum Mergen** — nur auf ausdrückliche Ansage pro einzelnem PR.
Das präzisiert den Abschnitt "Immer manuell bestätigen lassen" weiter unten: Draft-PR, vollständige
Offenlegung und das Benennen aller Risiken bleiben Pflicht — die *Wartezeit* auf eine Freigabe
entfällt. Quelle: Archiv-Dokument "Preis-Fundament Teil 2C, 2D und 3" (13.09.2026), Abschnitt 6.

**Archiv:** Grundgesetz und alle Funde liegen zusätzlich im Google-Drive-Ordner
"stele-e-transfer – Bug-Analyse" (Dokument "GRUNDGESETZ Arbeitsweise + Teil 3B …", 13.09.2026).
Dort nachschlagen, bevor etwas erneut untersucht wird.

**Änderungen an diesem Grundgesetz:** nur ergänzen/verbessern, nie bestehende Punkte löschen —
dieselbe Regel wie beim Workflow-Text.

## Immer manuell bestätigen lassen (Regel seit 2026-09-01)

Unabhängig davon, was der Auto-Modus sonst automatisch ausführen würde: bei
**Geld-/Preis-Logik** (Preisformel, Margen, Gebühren, Zölle etc.), **DB-Migrationen** und
**Auth/Sicherheit** (Login, Sessions, Tokens, Berechtigungen) immer explizit beim Nutzer
nachfragen, bevor umgesetzt/gemergt/deployed wird — auch wenn die Aufgabe sonst klar und
risikoarm erscheint.

*Präzisiert durch Grundgesetz-Regel 13 (13.09.2026): Draft-PR und vollständige Offenlegung bleiben
Pflicht, aber der Nutzer mergt selbst ohne Wartezeit; die Prüfung durch Claude erfolgt danach gegen
den echten Live-Zustand.*

## Automatische Versionsnummer-Erhöhung (Regel seit 2026-08-31)

Nach jedem **4. größeren gemergten Update/PR** seit der letzten Versionserhöhung wird die
App-Versionsnummer automatisch um einen Schritt erhöht (z.B. v1.4 → v1.5) — **ohne dass der
Nutzer extra danach fragen muss.** Das gilt für jede Session, die an diesem Repo arbeitet.

**"Größer" zählt:** ein eigenständiger Feature- oder Bugfix-PR (egal von welcher
Session/welchem Branch). **Zählt nicht:** reine Doku-/Test-Anpassungen ohne funktionale
Änderung, oder Folge-Commits, die zu einem bereits gezählten PR gehören (z.B. ein
Merge-Konflikt-Fix im selben PR).

Zwei Stellen synchron aktualisieren, wenn ein Bump fällig ist:
- `packages/web/src/web/app.tsx` (`.stele-tab-version`)
- `packages/web/src/web/pages/einstellungen.tsx` ("Version"-Zeile)

**Aktueller Zählerstand (Stand 2026-09-10, aktuelle Version: v1.11):**

Der Zähler war seit dem 2026-09-08-Stand (v1.8, "2 von 4" mit #71/#74) erneut über mehrere PRs
hinweg nicht weitergepflegt worden — hier anhand von `git log --merges` für #75 bis #87
nachträglich rekonstruiert (PR-Body gegen "eigenständiger Feature-/Bugfix-PR ohne/mit
funktionaler Änderung" geprüft). #75 selbst (der letzte Versions-Nachtrag) zählt NICHT mit —
reine Zähler-/Versions-Housekeeping, kein Feature-/Bugfix-PR. #76/#80 zählen NICHT — beide laut
eigener PR-Beschreibung ausdrücklich "reine Doku-Aktualisierung" ohne Code-/Preis-Bezug.

| # | PR | Zählt zu |
|---|---|---|
| — | #75 | *(zählt nicht — Versionsnummer-Nachtrag selbst, reine Housekeeping)* |
| — | #76 | *(zählt nicht — reine Doku-Aktualisierung task.md)* |
| 3 | #77 | P-27/P-28-Fix: individuelle Preise pro Varianten-SKU statt Einheitspreis (Live-Fund stele-138) |
| 4 | #78 | P-27/P-28 PR 3: einmalige Reparatur bereits falsch bepreister Varianten-Listings → **Bump v1.8 → v1.9 bei #78** |
| 1 | #79 | P-27/P-28 PR 4: Varianten-Preise-reparieren in Chargen statt Single-Request (502-Fix) |
| — | #80 | *(zählt nicht — reine Doku-Ergänzung CLAUDE.md, kein Code-/Preis-Bezug)* |
| 2 | #81 | P-27/P-28 PR 5: SKU-gewichtetes statt produktgewichtetes Chunking (502-Fix bei vielen Varianten) |
| 3 | #82 | "Ships From"-Attribut sprengt SKU-Matching beim Varianten-Preis-Update (Bugfix Produkte 71/77/92/95) |
| 4 | #83 | P-27/P-28 PR 6: Reparatur-Job robust (Job-Persistenz, Voll-Audit) + AliExpress-Verfügbarkeits-Check + eBay-Auto-Deaktivierung → **Bump v1.9 → v1.10 bei #83** |
| 1 | #84 | Folge-Fix: Playwright-Hard-Timeout + DS-API-482-Erkennung + täglicher Verfügbarkeits-Cron + orange UI-Kennzeichnung |
| 2 | #85 | Preis-Fundament Teil 2A: eine zentrale Kalkulationsfunktion (reiner Refactor, 8 Formel-Kopien konsolidiert) |
| 3 | #86 | Preis-Fundament Teil 2B: Gebühren-Konstanten auf real gemessene Werte (15%/0,30€ statt 13/17/18%) |
| 4 | #87 | Preis-Fundament Teil 2C: Zielgewinn trifft exakt (Sicherheitspuffer entfernt, Zielgewinn pro Produkt persistiert) → **Bump v1.10 → v1.11 bei #87** |
| 1 | #88 | Preis-Fundament Teil 2D: Senkungsbremse (max. 8 % Absenkung pro Lauf) |
| 2 | #89 | Preis-Fundament Teil 3: Varianten mit eigenen Preisen (Preisregel + eigene Spalte `variant_sell_prices`) |

**→ Zähler: 2 von 4 seit v1.11.**

Vorherige Bump-Historie (zur Nachvollziehbarkeit, danach hier löschen wenn zu lang):
- v1.4 → v1.5: PR #45 (P-92 Kandidatenliste), #46 (SOFORT-Fix Zoll-Preis stele-93), #47 (P-27/P-28 Dauerlösung), #48 (Sicherheitspuffer + relative Preisprüfungs-Anzeige)
- v1.5 → v1.6: PR #49 (P-90 Workflow-kopieren-Button + 4 Bestellkarten-Lücken), #50 (Sicherheitspuffer vom Import-Preisvorschlag getrennt + Mindestgewinn-Auswahl), #51 (P-93 Verfügbarkeits-Monitor), #52 (P-93 zweite Funktion — Dateinamensschema AliExpress-Rechnungen)
- v1.6 → v1.7: PR #63, #64, #65, #66
- v1.7 → v1.8: PR #67, #68, #69, #70
- v1.8 → v1.9: PR #77, #78 (siehe Tabelle oben)
- v1.9 → v1.10: PR #79, #81, #82, #83 (siehe Tabelle oben)
- v1.10 → v1.11: PR #84, #85, #86, #87 (siehe Tabelle oben)

## Bestellabwicklungs-Workflow-Text (Regel seit P-94, 2026-08-31)

Der Text für den "Workflow kopieren"-Button (Bestellungen-Tab) liegt seit P-94 nicht mehr fest
im Code, sondern editierbar in der DB (`app_settings`, Key `workflow_template`) und im
Einstellungen-Tab pflegbar. Startinhalt/Fallback: `packages/web/src/shared/workflow-template.ts`
(`DEFAULT_WORKFLOW_TEMPLATE`).

**Feste Regel bei jeder künftigen Aktualisierung dieses Texts (auch für Dich als Claude Code):**
neue Version immer gegen die vorherige vergleichen, nur ergänzen/verbessern, niemals bestehende
Punkte einfach löschen. Grundstruktur (Rolle, Schritte 1-6, Effizienz-Hinweis) bleibt erhalten.

## Verifikations- & Archivierungs-Workflow (Regel seit 2026-09-08)

Bei jeder Bug-Untersuchung / jedem Fix, unabhängig vom Themenbereich:

- Erfolgsmeldungen (eigene oder von Sub-Agents) nie ungeprüft übernehmen — Diff lesen,
  Tests/Typecheck selbst laufen lassen, nach einem Deploy den tatsächlichen Live-Zustand
  unabhängig prüfen (Browser: App-Seite, eBay-Seite, Netzwerk-Requests, Konsole;
  Render-Deploy-/App-Logs). Eine reine UI-Erfolgsmeldung ist kein Beweis dafür, dass ein Fix
  wirklich gegriffen hat.
- `/goal`-Text-Länge vor dem Senden prüfen (Limit: 4000 Zeichen). Bei Bedarf in mehrere klar
  nummerierte, in sich abgeschlossene Teilaufträge mit expliziten Abhängigkeits-Hinweisen
  zwischen ihnen aufteilen.
- Jeder Fund (Bug, Root Cause, Fix, Verifikationsergebnis) wird vollständig und mit klarer,
  konkreter Bezeichnung des Problems im projektspezifischen Fehler-Archiv (Google Drive
  "Fehler- & Skript-Archiv – stele-e-transfer") festgehalten — nicht nur kurz notiert. Ziel:
  Sessions/Tokens sparen, indem nichts erneut untersucht werden muss.
