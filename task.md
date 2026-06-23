# Stele App — Task Board

## ERLEDIGT (diese Nacht)
- ✅ Dashboard Stats-Redesign: 5 Karten (Gesamt/eBay/Fehler + Gesamtgewinn/Ø Gewinn) [ecceaaf]
- ✅ Einstellungen: Token-Expiry Anzeige + Refresh-Button (erneuert Token ohne Neu-OAuth) [ec8f087]
- ✅ Lieferanten: "Speichern + Direkt Listen" Ein-Klick Button [ec8f087]
- ✅ Lieferanten: Bilder-Toggle UI (ausblenden/einblenden mit grauem Filter, kein Löschen) [135c283]
- ✅ shipsFrom-Fix price-monitor verifiziert: nur 'china' übersprungen, unbekannt OK [bereits live]

## NOCH OFFEN
1. GPSR structured fields — ae_store_info Manufacturer-Daten aus API Response parsen → auto GPSR Text
2. Playwright/Chromium auf Render Free Tier (ETXTBSY) — kein Fix möglich ohne Paid Tier
3. Gemini Overload fallback — läuft, aber intermittent

## COMMITS DIESER SESSION (neueste zuerst)
135c283  feat: Lieferanten Bilder-Toggle (ausblenden/einblenden statt löschen)
ec8f087  feat: Einstellungen Token-Expiry + Refresh Button; Lieferanten Speichern+Listen Ein-Klick
ecceaaf  feat: Dashboard Stats redesign — Gesamtgewinn + Ø Gewinn Karten
9d928fb  feat: Produkte-Tab → Alle Preise prüfen + eBay-Update Button mit Fortschrittsbalken
0a699b1  feat: Lieferanten-Tab → Empfohlener Mindestpreis-Button (≥1.60€ Gewinn)
01f235b  feat: Price Monitor + check-all-prices → eBay Listing Preis automatisch updaten
63b986d  feat: Suche→Lieferanten Auto-Import (buyPrice prefill + auto-scrape)

## ARCHITEKTUR
- Shop: stele-e-transfer (eBay DE), Kleingewerbe §19 UStG, Wiesbaden
- Stack: Bun + Hono + React + SQLite/Drizzle
- Deploy: Render (auto auf push) → stele-e-transfer.onrender.com
- Preisformel: eBay - eBay*(13+adRate)/100*1.19 - 0.45*1.19 - buyPrice = Gewinn
- Mindestgewinn: 1,60€

## BEKANNTE ISSUES
- Playwright/Chromium: ETXTBSY auf Render Free → ScrapingAnt Fallback aktiv
- Gemini 2.5 Flash Lite: gelegentlich überlastet → Fallback-Beschreibung

## ENV RENDER
- ALIEXPRESS_ACCESS_TOKEN ✅
- EBAY credentials ✅
- SCRAPINGANT_API_KEY ✅
