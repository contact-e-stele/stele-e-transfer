# Stele E-Transfer — Hinweise für Claude Code

Feature-/Roadmap-Übersicht: `P-UEBERSICHT.md`. Architektur-Details: `docs/ARCHITECTURE.md`.
Session-Scratchpad für offene Arbeit: `task.md`.

## Immer manuell bestätigen lassen (Regel seit 2026-09-01)

Unabhängig davon, was der Auto-Modus sonst automatisch ausführen würde: bei
**Geld-/Preis-Logik** (Preisformel, Margen, Gebühren, Zölle etc.), **DB-Migrationen** und
**Auth/Sicherheit** (Login, Sessions, Tokens, Berechtigungen) immer explizit beim Nutzer
nachfragen, bevor umgesetzt/gemergt/deployed wird — auch wenn die Aufgabe sonst klar und
risikoarm erscheint.

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

**→ Zähler: 0 von 4 seit v1.11.**

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
