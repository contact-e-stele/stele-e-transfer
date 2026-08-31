# Stele E-Transfer — Hinweise für Claude Code

Feature-/Roadmap-Übersicht: `P-UEBERSICHT.md`. Architektur-Details: `docs/ARCHITECTURE.md`.
Session-Scratchpad für offene Arbeit: `task.md`.

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

**Aktueller Zählerstand (Stand 2026-08-31, aktuelle Version: v1.5):**

Seit v1.3 (PR #40, "bump to v1.3") waren es 10 größere PRs bis PR #50 — das ergab beim
Nachzählen bereits 2 überfällige Bumps (v1.3→v1.4→v1.5, siehe Aufschlüsselung unten). Der
Zähler für die nächste Erhöhung (→ v1.6) läuft ab PR #49:

| # | PR | Zählt zu |
|---|---|---|
| 1 | #49 — P-90 Workflow-kopieren-Button + 4 Bestellkarten-Lücken | v1.6 |
| 2 | #50 — Sicherheitspuffer vom Import-Preisvorschlag getrennt + Mindestgewinn-Auswahl | v1.6 |

**→ Zähler: 2 von 4 seit v1.5.** Nach dem nächsten 2 größeren PRs (Nr. 3 und 4): Version auf
v1.6 erhöhen, diese Tabelle leeren und den Zähler auf 0 zurücksetzen, hier den neuen Stand
dokumentieren.

Vorherige Bump-Historie (zur Nachvollziehbarkeit, danach hier löschen wenn zu lang):
- v1.3 → v1.4: PR #41 (P-89 EAN-Fix), #42 (P-90 Self-Healing), #43 (P-90 Follow-up), #44 (P-91 universelle Heilung)
- v1.4 → v1.5: PR #45 (P-92 Kandidatenliste), #46 (SOFORT-Fix Zoll-Preis stele-93), #47 (P-27/P-28 Dauerlösung), #48 (Sicherheitspuffer + relative Preisprüfungs-Anzeige)
