# STELE APP - Task Board (14.06.2026)

## PROBLEM: AliExpress Produktdaten holen

### Was nicht funktioniert:
- DS API (`aliexpress.ds.product.get`) → braucht access_token (OAuth blockiert, AppKey nicht aktiviert)
- Affiliate API → InsufficientPermission (App nicht freigeschaltet)
- ScrapingAnt → gibt nur 74KB Bot-Seite zurück
- Playwright direkt → CAPTCHA sofort
- Direktes Scraping → Bot-Block

### Was funktioniert (ScrapingAnt früher):
- Titel ✅
- Preis ✅  
- Bilder ✅
- Beschreibung ✅
- Versandland ✅
- Varianten ❌ (kommen nicht weil JS nicht vollständig rendert)

## LÖSUNG - Plan B: Zenrows oder ScraperAPI

**Zenrows** ist besser als ScrapingAnt für JS-heavy Sites:
- Premium residential proxies
- Bessere JS-Rendering
- Kostenpflichtiger aber zuverlässiger

**ScraperAPI** mit `render=true`:
- Hat auch gute AliExpress-Unterstützung

**ODER: Manuelle Varianten-Eingabe (pragmatisch für Go-Live)**
- Produkt scrapen → Titel/Preis/Bilder kommen schon
- Varianten: User tippt sie manuell ein (bereits gebaut in lieferanten.tsx!)
- Das reicht für Go-Live 15.06!

## ENTSCHEIDUNG FÜR GO-LIVE 15.06:
1. Scraping mit ScrapingAnt wie bisher (Titel/Preis/Bilder funktionieren)
2. Varianten manuell eingeben (UI bereits fertig)
3. eBay Listen funktioniert bereits
4. Preisüberwachung via Scraping (nur Preis, kein Variant-Bedarf)

## NÄCHSTE SCHRITTE:
1. Prüfe ob ScrapingAnt aktuell noch Produktseiten zurückgibt (war vorher 282KB)
2. Wenn ja: Varianten manuell lassen, live gehen
3. Beschreibung verbessern (Gemini AI nutzen)
4. Preisüberwachung Cron testen

## OFFEN:
- AutoDS Import CSV hochladen
- eBay Vorlage in AutoDS 
- Ecomsniper gekündigt ✅
