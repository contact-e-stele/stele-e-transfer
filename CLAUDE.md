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

**Aktueller Zählerstand (Stand 2026-09-01, aktuelle Version: v1.6):**

| # | PR | Zählt zu |
|---|---|---|
| 1 | #53+#54 — P-94 Workflow-Text editierbar in der App (zwei PRs wegen Merge-Timing, eine Aufgabe) | v1.7 |
| 2 | #56 — Lagerbestand pro Variante: "Lager aktualisieren"-Button + DS-API-first im 8h-Job | v1.7 |

(#55 zählt nicht — reine Doku-Änderung, keine funktionale Änderung.)

**→ Zähler: 2 von 4 seit v1.6.**

Vorherige Bump-Historie (zur Nachvollziehbarkeit, danach hier löschen wenn zu lang):
- v1.4 → v1.5: PR #45 (P-92 Kandidatenliste), #46 (SOFORT-Fix Zoll-Preis stele-93), #47 (P-27/P-28 Dauerlösung), #48 (Sicherheitspuffer + relative Preisprüfungs-Anzeige)
- v1.5 → v1.6: PR #49 (P-90 Workflow-kopieren-Button + 4 Bestellkarten-Lücken), #50 (Sicherheitspuffer vom Import-Preisvorschlag getrennt + Mindestgewinn-Auswahl), #51 (P-93 Verfügbarkeits-Monitor), #52 (P-93 zweite Funktion — Dateinamensschema AliExpress-Rechnungen)

## Bestellabwicklungs-Workflow-Text (Regel seit P-94, 2026-08-31)

Der Text für den "Workflow kopieren"-Button (Bestellungen-Tab) liegt seit P-94 nicht mehr fest
im Code, sondern editierbar in der DB (`app_settings`, Key `workflow_template`) und im
Einstellungen-Tab pflegbar. Startinhalt/Fallback: `packages/web/src/shared/workflow-template.ts`
(`DEFAULT_WORKFLOW_TEMPLATE`).

**Feste Regel bei jeder künftigen Aktualisierung dieses Texts (auch für Dich als Claude Code):**
neue Version immer gegen die vorherige vergleichen, nur ergänzen/verbessern, niemals bestehende
Punkte einfach löschen. Grundstruktur (Rolle, Schritte 1-6, Effizienz-Hinweis) bleibt erhalten.
