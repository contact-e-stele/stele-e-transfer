# P8 — Listing-Tab Überblick + Bearbeitung + Massenabfertigung

## Entscheidungen (bestätigt)
- Titel/Beschreibung ändern im Listings-Tab → 1 Klick, sofort live auf eBay (wie Preis jetzt schon)
- SKU (Custom Label) als eigene Spalte sichtbar, sortier-/durchsuchbar
- Massenbearbeitung Prio (alle 4 gewünscht):
  1. Mehrere Listings gleichzeitig beenden
  2. Anzeige-Rate (Werbekosten) für Auswahl setzen
  3. Kategorie für Auswahl ändern
  4. Preis (% oder fix Betrag) für Auswahl ändern

## Bestehender Stand
- Filter: Suche (Titel/Item-ID), verknüpft/unverknüpft, Verkäufe min/max, Preis min/max, Ablauf-Zeitraum
- Sortierung: Standard, meistverkauft, wenigst verkauft, Preis ↑/↓, läuft bald ab
- Preis-Edit: inline, sofort live via ReviseInventoryStatus API ✅ funktioniert schon
- Anzeige-Rate: inline editierbar, pro Listing ✅ funktioniert schon
- Produkte-Tab: Titel/Bullets/HTML editierbar, aber NUR in DB — kein eBay-Push (Bruch!)

## Bauplan

### 1. SKU sichtbar + filterbar
- Custom Label (SKU) aus eBay-API mitladen (ist evtl. schon im GetSellerList enthalten, prüfen)
- Als Badge/Spalte in Listing-Karte anzeigen
- Suche erweitern: auch SKU durchsuchen
- Neue Sortierung: "Nach SKU"

### 2. Gemeinsame Sync-Funktion (Kernstück)
- Neue Funktion `syncProductToEbay(itemId, { title?, htmlDescription? })` in `ebay.ts`
  - Nutzt `ReviseFixedPriceItem` (Trading API) für Titel + Beschreibung, da Inventory-API nicht für reine Legacy-Listings reicht
  - Wird von 2 Stellen aufgerufen: Listings-Tab UND Produkte-Tab
- Neuer Endpoint: `PATCH /api/ebay/listings/:itemId/content` — { title, htmlDescription }
- Produkte-Tab "Speichern" Button ruft künftig zusätzlich diesen Endpoint auf (wenn Produkt mit ebayListingId verknüpft ist)

### 3. Listings-Tab: Bearbeiten-Modal
- Neuer Button "Bearbeiten" pro Listing (gleiches Modal-Design wie im Produkte-Tab: Titel + Bullets + Live-HTML-Vorschau)
- Speichern-Klick → DB update + sofort `syncProductToEbay` Call
- Fehleranzeige direkt im Modal falls eBay-Push fehlschlägt (DB bleibt trotzdem gespeichert)

### 4. Mehrfachauswahl + Massenaktionen
- Checkbox pro Listing-Karte + "Alle auswählen"
- Aktionsleiste erscheint bei ≥1 Auswahl:
  - **Beenden**: Bestätigung → alle ausgewählten Listings per Batch beenden (bestehender Endpoint, aber Schleife über IDs, mit Fortschrittsanzeige)
  - **Anzeige-Rate setzen**: Dropdown (2/3/5/8/10%) → für alle in Auswahl anwenden
  - **Kategorie ändern**: eBay Kat-ID Feld (nutzt P6 Lookup) → für alle in Auswahl setzen
  - **Preis ändern**: entweder "+X%" / "-X%" oder "auf X € setzen" oder "+X€ / -X€" — Vorschau der neuen Preise vor Bestätigung
- Alle Massenaktionen: sequentiell mit kleiner Pause (eBay Rate-Limit), Fortschrittsbalken + Ergebnis-Liste (✓/✗ pro Item)

### 5. Sicherheit
- Massenaktionen mit Bestätigungsdialog + Anzeige "Betrifft X Listings"
- Bei Preisänderung: Vorschau-Tabelle vor Ausführen zeigen (alt → neu)

## Reihenfolge (Umsetzung)
1. ✅ SKU-Spalte + Suche/Sortierung — deployed `e70d69c`
2. ✅ Backend Sync-Funktionen fertig — deployed `e70d69c`
   - `PATCH /api/ebay/listings/:itemId/content` (Titel + Beschreibung live)
   - `POST /api/ebay/listings/bulk/price` (percent/fixed/set)
   - `POST /api/ebay/listings/bulk/end`
   - `POST /api/ebay/listings/bulk/adrate`
   - `POST /api/ebay/listings/bulk/category`
3. 🔲 Bearbeiten-Modal im Listings-Tab (UI, nutzt /content Endpoint)
4. 🔲 Produkte-Tab an /content Endpoint anschließen (Bruch schließen)
5. 🔲 Mehrfachauswahl-UI (Checkboxen + Aktionsleiste) im Listings-Tab
6. 🔲 Bulk-UI: Beenden Button
7. 🔲 Bulk-UI: Anzeige-Rate Dropdown
8. 🔲 Bulk-UI: Kategorie Feld (nutzt P6 Lookup)
9. 🔲 Bulk-UI: Preis (mit Vorschau alt→neu vor Bestätigung)

## Offene Fragen für später
- eBay Rate-Limits bei Massenaktionen mit vielen Listings (>50) — ggf. Batches mit Pausen
- Ob Custom Label / SKU zuverlässig aus GetSellerList kommt oder Extra-Call nötig ist
