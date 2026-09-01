# Stele App — Task Board

> Session-Scratchpad für aktuell offene Arbeit. Feature-Historie/Roadmap: `P-UEBERSICHT.md`.
> Architektur-Details: `docs/ARCHITECTURE.md`.

## NOCH OFFEN
1. GPSR structured fields — `ae_store_info` liefert nur den Shop-Namen; Hersteller-Adressdaten (Name/Adresse/Stadt/E-Mail/Telefon) werden nicht automatisch aus der API-Antwort geparst → GPSR-Felder bleiben manuelle Pflege im Produkte-Tab
2. Playwright/Chromium auf Render Free Tier (ETXTBSY) — kein Fix möglich ohne Paid Tier, ScrapingAnt trägt den Scraping-Pfad
3. Gemini Overload fallback — läuft, aber intermittierend (503 bei Überlastung, Fallback-Beschreibung greift automatisch)
4. Preis-Cron "Alert bei Änderung" — aktuell nur visuelles Flag (gelber Rahmen in Produkte-Tab), keine aktive Benachrichtigung bei Preissprüngen
5. P-11-Nummernkollision — bei der nächsten neuen P-Nummer nicht wieder 11 vergeben (siehe `P-UEBERSICHT.md`)
6. **P-95 (vorgemerkt, noch NICHT behoben)** — `/products/check-all-prices` (index.ts, Route für den "Alle Preise prüfen"-Button im Produkte-Tab) hat keine Varianten-Sicherheitsgrenze: aktualisiert `sellPrice` einheitlich für ALLE Produkte, auch Varianten-Produkte — anders als der automatische 8h-Job `runPriceCheck()` (price-monitor.ts), der Varianten-Preise zwar frisch berechnet/speichert, aber laut explizitem Code-Kommentar bewusst NIE automatisch an eBay pusht (nur über die vom Menschen bestätigte Vorschau im Listings-Tab). `/products/check-all-prices` hat diese Ausnahme nicht — pusht bei Varianten-Produkten also potenziell unbestätigt einen automatisch berechneten Preis an eBay. Gefunden während der P-93-Bestands-Untersuchung (stele-136, siehe PR #56), dort nur dokumentiert, nicht behoben (Preislogik-Änderung außerhalb des damaligen Auftrags). Verwandt mit P-27/P-28 (Dauerlösung für Soll-Preis-Neuberechnung bei jedem Lauf, siehe Kommentar in `price-monitor.ts` bei `checkOne()`) — zusammen einordnen, bevor entschieden wird, ob/wie behoben.

## LETZTE GRÖSSERE ARBEIT (diese Session)
- ✅ `docs/ARCHITECTURE.md` angelegt — code-verifizierte Architektur-Übersicht mit Mermaid-Diagramm, löst P-33 (veraltete/widersprüchliche `AGENT-RESTORE.md`-Generierung in `backup.ts`)
- ✅ `backup.ts`: `generateAgentRestoreMd()` verweist jetzt auf `docs/ARCHITECTURE.md` statt Fakten zu duplizieren; Doku wird automatisch in jeden Backup-Code-ZIP aufgenommen
- ✅ `P-UEBERSICHT.md` + `task.md` gegen tatsächlichen Code-Stand abgeglichen (Details siehe `P-UEBERSICHT.md`, u.a. P-66 Import-Gate, GPSR-Upload via Drive-Proxy und Bestellbenachrichtigung waren nicht dokumentiert)

Vollständige Commit-Historie: `git log --oneline main` (87 Commits seit Projektstart, laufend gepflegt über PRs).

## ARCHITEKTUR (Kurzfassung — Details in `docs/ARCHITECTURE.md`)
- Shop: stele-e-transfer (eBay DE), Kleingewerbe §19 UStG, Wiesbaden
- Stack: Bun + Hono + React + Turso (libSQL)/Drizzle
- Deploy: Render (auto auf push) → stele-e-transfer.onrender.com
- Preisformel (`price-monitor.ts calcSellPrice()`): `sellPrice = (buyPrice + versand + zoll + MIN_GEWINN + 0.45×1.19) / (1 - (13+adRate)/100×1.19)`, aufgerundet auf ,95
- Mindestgewinn: **2,00 €** (`MIN_GEWINN_EUR`, seit 14.07.2026 — vorher 1,60€)
- China-Zoll: **4,00 €** (`CHINA_ZOLL_EUR`, seit 27.07.2026 — vorher 3,00€)

## BEKANNTE ISSUES
- Playwright/Chromium: ETXTBSY auf Render Free → ScrapingAnt Fallback aktiv
- Gemini 2.5 Flash Lite: gelegentlich überlastet → Fallback-Beschreibung
- `render.yaml` (env: node) und `Dockerfile` (installiert Chrome für Playwright) widersprechen sich — nur `render.yaml` ist laut Render-Konfiguration aktiv

## ENV RENDER
Bestätigt gesetzt (aus vorherigem Stand übernommen, nicht neu verifiziert — kein Render-Dashboard-Zugriff von hier):
- ALIEXPRESS_ACCESS_TOKEN ✅
- EBAY credentials ✅
- SCRAPINGANT_API_KEY ✅

Weitere laut Code erforderlich, Render-Status nicht geprüft: GEMINI_API_KEY, RESEND_API_KEY,
SESSION_SECRET, BACKUP_API_KEY, DATABASE_URL/DATABASE_AUTH_TOKEN (Turso), ALIEXPRESS_APP_KEY/SECRET,
EBAY_APP_ID/DEV_ID/CERT_ID/USER_TOKEN — die App läuft produktiv, was dafür spricht, dass sie gesetzt
sind, aber das ist keine Bestätigung.
