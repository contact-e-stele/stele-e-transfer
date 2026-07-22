# Stele DS App — P-Feature Übersicht (Master-Liste)

Diese Datei ist die **einzige Quelle der Wahrheit** für alle P-Themen (gebaut + Ideen).
Wird bei jeder neuen P-Nummer / jedem Status-Update aktualisiert. Backup zusätzlich auf Google Drive.

## ✅ Gebaut & live

| P | Feature | Details |
|---|---------|---------|
| P2 | Varianten-Bugfix | skuVariants ohne 'name'-Feld — Name aus Farbe/Größe zusammengebaut |
| P3 | EU-Default Lieferland | Standard Deutschland bei Import |
| P4 | China-Zoll-Logik | +3€ Zoll bei shipsFrom=China (ab 01.07.2026 EU-Regel) |
| P5 | shipsFrom-Feld | Schema + Migration, Versandland pro Produkt |
| P6 | eBay Kategorie-Suche | Taxonomy API + UI Quick-Lookup |
| P8 | Preise-Tab Grundfunktionen | Import, Preiskalkulation, Mindestgewinn |
| P12 | AliExpress-Direktlink | Button im Listings-Tab neben eBay/Bearb./Ende |
| P13 | Bestellungen-Tab | eBay Orders API, Rechnungs-PDF (pdf-lib), Tracking, Netto-Ergebnis, manueller Einkaufspreis |
| P14 | Google Drive Integration | OAuth, DB-Backup, Rechnungen-Upload, Bild/Datei-Proxy (Content-Type-Fix) |
| — | Shops manuell + Suche-Dropdown | Manuelles Shop-Formular (Link+Name+Kategorie), Dropdown im Suche-Tab |

## 💡 Ideen / noch NICHT gebaut

| P | Feature | Details / Warum wichtig |
|---|---------|--------------------------|
| P1 | *(nie vergeben)* | — |
| P7 | *(nie vergeben)* | — |
| **P9** | Trackerbot-Ersatz | Tracking-Konvertierung Amazon/AliExpress→eBay + automatische Käufer-Nachrichten (Bestellstatus, Bewertungsanfrage). Trackerbot gekündigt am 2026-07-02, macht User aktuell manuell mit mir zusammen |
| P10 | *(nie vergeben)* | — |
| **P11** | Promoted Listings / Anzeige-Rate | eBay Marketing API nötig — `AdvancedMarketing/BidPercentage` wird von eBay ignoriert, echte Anzeigen-Rate (5%) kommt aktuell nicht an |
| — | Preisaktualisierung Cron-Job | AliExpress-Preis automatisch scrapen, mit DB vergleichen, eBay-Preis automatisch anpassen inkl. Marge-Logik + Alert bei Änderung |
| — | Vorschau-Modal editierbar | Produkte-Tab: Text/Bullets direkt im Modal ändern + Speichern-Button |
| — | GPSR-Bild + Handbuch-Upload auf Drive-Proxy | Aktuell noch lokaler Server-Speicher, Umstellung auf `/api/drive/file/:id` Proxy vorbereitet aber noch nicht verkabelt |
| — | EU-Lager-Filter bei AliExpress-Suche | Nur Lager in Deutschland/angrenzenden EU-Staaten anzeigen (aktuell manuell "Deutschland" wählen) |
| — | Zweites eBay-Konto für Temu | Getrennt vom Haupt-Konto stele-e-transfer, wegen unzuverlässigerer Lieferzeiten |

## Bekannte technische Einschränkungen
- Playwright/Chromium auf Render Free Tier: ETXTBSY-Fehler → ScrapingAnt als Fallback aktiv, PDF-Generierung läuft über pdf-lib (kein Browser nötig)
- Gemini 2.5 Flash Lite: gelegentlich überlastet → Fallback-Beschreibung greift automatisch

---
*Letzte Aktualisierung: 2026-07-22*
