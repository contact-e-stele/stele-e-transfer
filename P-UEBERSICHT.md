# Stele DS App — P-Feature Übersicht (Master-Liste)

Diese Datei ist die **einzige Quelle der Wahrheit** für alle P-Themen (gebaut + Ideen).
Wird bei jeder neuen P-Nummer / jedem Status-Update aktualisiert. Backup zusätzlich auf Google Drive.

> Architektur/Code-Details (Diagramm, Routen, Schema) stehen in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) —
> diese Datei hier ist die Feature-/Roadmap-Sicht, nicht die technische Referenz.

## ✅ Gebaut & live — Features

| P | Feature | Details |
|---|---------|---------|
| P2 | Varianten-Bugfix | skuVariants ohne 'name'-Feld — Name aus Farbe/Größe zusammengebaut |
| P3 | EU-Default Lieferland | Standard Deutschland bei Import |
| P4 | China-Zoll-Logik | Pauschale bei shipsFrom=China (ab 01.07.2026 EU-Regel), aktuell 4,00€ (siehe `shared/constants.ts`) |
| P5 | shipsFrom-Feld | Schema + Migration, Versandland pro Produkt |
| P6 | eBay Kategorie-Suche | Taxonomy API + UI Quick-Lookup |
| P8 | Preise-Tab Grundfunktionen | Import, Preiskalkulation, Mindestgewinn |
| P12 | AliExpress-Direktlink | Button im Listings-Tab neben eBay/Bearb./Ende |
| P13 | Bestellungen-Tab | eBay Orders API, Rechnungs-PDF (pdf-lib), Tracking, Netto-Ergebnis, manueller Einkaufspreis |
| P14 | Google Drive Integration | OAuth, DB-Backup, Rechnungen-Upload, Bild/Datei-Proxy (Content-Type-Fix) |
| P30 | "Meine Shops" gruppiertes Dropdown | Chip-Liste ersetzt durch gruppiertes Dropdown nach Kategorie im Suche-Tab |
| P31 | Duplikat-Warnung beim Import | Warnt vor dem Import, wenn AliExpress-Item bereits in der DB existiert |
| **P66** | Lieferanten-Compliance | Schritt 1: Badge/Filter/Bearbeiten für Compliance-Status je Lieferant. Schritt 2: **Import-Gate** — regulierte Produktgruppen (Keyword-Matching) blockieren den Import hart, kein Bypass |
| P69 | Echte Versandkosten | Versandkosten werden beim AliExpress-Scraping (inkl. DS-API-Fallback-Pfad) tatsächlich abgefragt statt geschätzt, zentrales Feld statt Duplikation |
| P71 | eBay-Listing-Fehler behoben | Mehrere Ursachen gefixt: Set-/Mengen-Varianten als eigener Aspekt, EAN/GTIN-Handling ergänzt, genereller Offer-Cleanup + Retry/Backoff bei transienten eBay-Fehlern |
| P73 | Bewertungs-Ampel | Kombiniert Bewertungsanzahl + Sternebewertung im AliExpress-Import, schlechterer Wert gewinnt |
| P74/75 | ,95-Preisrundung + Sammel-Button | Rundet Varianten-Preisvorschläge auf ,95-Endung; ein Button setzt alle Varianten-Preisvorschläge auf einmal |
| P76 | Responsive UI | TabNav (Icons-only Tablet, Hamburger+Drawer Handy), Grid-Layouts, Varianten-Preistabelle, Bewertungs-Ampel — alles responsiv angepasst |
| — | Shops manuell + Suche-Dropdown | Manuelles Shop-Formular (Link+Name+Kategorie), Dropdown im Suche-Tab |
| — | GPSR-Handbuch/Zertifizierung-Upload | Upload läuft über `/api/upload-file` → Google Drive (lokaler Speicher nur Fallback) — löst die früher hier gelistete Idee |
| — | Bestellbenachrichtigung per E-Mail | `order-notifier.ts` + stündlicher GitHub-Actions-Cron (`order-check.yml`) — benachrichtigt den Shop-Betreiber (nicht den Käufer) bei neuen eBay-Bestellungen, dedupliziert über `notificationSentAt` |

## 🔧 Technische Wartung / Bugfixes (P-Nummern ohne eigenen Feature-Charakter)

| P | Was |
|---|-----|
| P7 | Preis-Monitor-Formel an `lieferanten.tsx` angeglichen |
| P9/P11/P13 (Sammel-Commit) | Varianten-Ausschluss bei Preis-Neuberechnung, ,95-Rundung + Update-Schwellenwert, shipsFrom-Fix — **Nummernkollision**, siehe Hinweis unten |
| P14 | Variations-Listings zuverlässig erkennen (nicht per Trading API überschreiben) |
| P15 | `bulk/price` nutzt `updateEbayPriceTrading()` statt eigener Trading-API-Logik |
| P18 | Drive-OAuth-Callback + Bild-Proxy von Session-Auth ausgenommen |
| P23 | Preis-Monitor auf 8h-Intervall, Backup-Scheduler auf 2×/Tag reduziert (Ressourcenverbrauch) |
| P25 | Eigener Backend-Typecheck eingerichtet |
| P32 | Lücke im Backup geschlossen — `trusted_suppliers` fehlte, ist jetzt vollständig enthalten |
| P35, P50, P51 | Kleinere Fixes: fehlender Import, Frontend-Typecheck-Skript-Pfad, unbenutzte Imports/Variablen entfernt |

### ⚠️ Hinweis zur P-Nummerierung
**P-11 ist doppelt vergeben.** Als Idee (Tabelle unten) steht P11 für "Promoted Listings/Anzeige-Rate"
(weiterhin ungebaut — verifiziert, `setAdRate()` in `ebay.ts` nutzt unverändert das von eBay
ignorierte `AdvancedMarketing/BidPercentage`-Feld). In einem Commit wurde P-11 zusätzlich für die
,95-Preisrundung/Update-Schwellenwert verwendet (siehe Wartungstabelle oben). Beide Verwendungen
bleiben hier stehen, statt eine davon stillschweigend zu überschreiben — bei der nächsten neuen
P-Nummer nicht wieder 11 vergeben.

## 💡 Ideen / noch NICHT gebaut

| P | Feature | Details / Warum wichtig |
|---|---------|--------------------------|
| P1 | *(nie vergeben)* | — |
| P7 | *(nie vergeben — Nummer ist durch Wartungs-Commit belegt, siehe Tabelle oben)* | — |
| **P9** | Trackerbot-Ersatz | Tracking-Konvertierung Amazon/AliExpress→eBay + automatische **Käufer**-Nachrichten (Bestellstatus, Bewertungsanfrage). Trackerbot gekündigt am 2026-07-02, macht User aktuell manuell. **Nicht zu verwechseln** mit der bereits gebauten Bestellbenachrichtigung — die geht an den Shop-Betreiber, nicht an den Käufer |
| P10 | *(nie vergeben)* | — |
| **P11** | Promoted Listings / Anzeige-Rate | eBay Marketing API nötig — `AdvancedMarketing/BidPercentage` wird von eBay ignoriert, echte Anzeigen-Rate (5%) kommt aktuell nicht an. Verifiziert weiterhin offen (Stand 2026-08-19) |
| — | Preisaktualisierung Cron-Job | **Größtenteils gebaut** (`price-monitor.ts`: scrapt AliExpress-Preis alle 8h, vergleicht mit DB, passt eBay-Preis inkl. Marge-Logik automatisch an). Offen bleibt nur der ursprünglich geplante **Alert bei Änderung** — aktuell nur ein visuelles Flag (gelber Rahmen in Produkte-Tab), keine aktive Benachrichtigung |
| — | Vorschau-Modal editierbar | **Teilweise gebaut**: Titel ist im Produkte-Tab per Klick inline editierbar. Beschreibung/Bullets sind weiterhin nicht direkt im Vorschau-Modal änderbar |
| — | EU-Lager-Filter bei AliExpress-Suche | **Teilweise gebaut**: Such-Dropdown hat jetzt mehrere Länder (DE, ES, FR, IT, PL, NL, CZ, CN, Alle) statt nur Deutschland — aber weiterhin manuelles Single-Select, kein automatischer "nur EU-Lager"-Filter |
| — | Zweites eBay-Konto für Temu | Getrennt vom Haupt-Konto stele-e-transfer, wegen unzuverlässigerer Lieferzeiten |

## Bekannte technische Einschränkungen
- Playwright/Chromium auf Render Free Tier: ETXTBSY-Fehler → ScrapingAnt als Fallback aktiv, PDF-Generierung läuft über pdf-lib (kein Browser nötig)
- Gemini 2.5 Flash Lite: gelegentlich überlastet → Fallback-Beschreibung greift automatisch
- GPSR structured fields: `ae_store_info` liefert nur den Shop-Namen, Hersteller-Adressdaten werden nicht automatisch geparst — GPSR-Felder müssen weiterhin manuell im Produkte-Tab gepflegt werden

---
*Letzte Aktualisierung: 2026-08-19 — abgeglichen gegen den tatsächlichen Code-Stand (P-33-Nachfolgearbeit)*
