# Stele App — Task Board

> Session-Scratchpad für aktuell offene Arbeit. Feature-Historie/Roadmap: `P-UEBERSICHT.md`.
> Architektur-Details: `docs/ARCHITECTURE.md`.

## NOCH OFFEN
1. GPSR structured fields — `ae_store_info` liefert nur den Shop-Namen; Hersteller-Adressdaten (Name/Adresse/Stadt/E-Mail/Telefon) werden nicht automatisch aus der API-Antwort geparst → GPSR-Felder bleiben manuelle Pflege im Produkte-Tab
2. Playwright/Chromium auf Render Free Tier (ETXTBSY) — kein Fix möglich ohne Paid Tier, ScrapingAnt trägt den Scraping-Pfad
3. Gemini Overload fallback — läuft, aber intermittierend (503 bei Überlastung, Fallback-Beschreibung greift automatisch)
4. Preis-Cron "Alert bei Änderung" — aktuell nur visuelles Flag (gelber Rahmen in Produkte-Tab), keine aktive Benachrichtigung bei Preissprüngen
5. P-11-Nummernkollision — bei der nächsten neuen P-Nummer nicht wieder 11 vergeben (siehe `P-UEBERSICHT.md`)

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
