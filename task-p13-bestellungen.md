# P13 — Bestellungen-Tab (Grundstruktur)

## Ziel
Neuer Tab "Bestellungen" — zeigt eBay-Bestellungen, erlaubt Tracking-Nummer-Eingabe, die an eBay übermittelt wird.

## Ausgangslage (geprüft)
- eBay App hat bereits `sell.fulfillment` OAuth-Scope — keine Neu-Autorisierung nötig
- "Retouren"-Tab existiert schon, aber nur mit Demo-Daten (DEMO_RETURNS), nicht live verbunden
- Kein Order-Endpoint im Backend vorhanden — komplettes Neuland
- Tab-Reihenfolge aktuell: Preise → Suche → Import → Produkte → Listings → Retouren → Einstellungen
- User hatte ursprünglich geplant: 1.Dashboard 2.Lieferanten 3.Produkte 4.Listings 5.Bestellungen 6.Einstellungen

## eBay API — Fulfillment API (Trading API Alternative möglich)
Zwei Wege möglich:
1. **REST Fulfillment API** (modern): `GET /sell/fulfillment/v1/order` (Liste), `GET /sell/fulfillment/v1/order/{orderId}`, `POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment` (Tracking übermitteln)
2. **Trading API (Legacy)**: `GetOrders`, `CompleteSale` (mit Tracking) — passt zum bisherigen Muster (GetSellerList, ReviseFixedPriceItem laufen alle über Trading API)

→ Empfehlung: REST Fulfillment API nutzen (moderner, sauberer JSON statt XML-Parsing wie bisher) — aber Token-Scope ist schon vorhanden, easy machbar.

## Datenmodell (neu)
Bestellungen kommen live von eBay (wie Listings) — keine eigene Order-Tabelle nötig für die Kerndaten.
ABER: brauchen lokale Ergänzungstabelle für App-spezifische Zusatzinfos:

```
orderNotes (neu):
  id, ebayOrderId (unique), trackingNumber, carrier, shippedAt, 
  customerNotifiedAt, internalNote, createdAt, updatedAt
```

Grund: eBay speichert Tracking selbst, aber wir wollen zusätzlich lokal tracken:
- Wann wurde der Kunde benachrichtigt (für Status-Update Texte, wie beim Silikon-Beispiel)
- Interne Notizen (z.B. "Tracking konvertiert am X")
- Verknüpfung zu unserem Produkt (via appProduct-Match wie bei Listings)

## UI-Plan (Bestellungen-Tab)
Angelehnt an Listings-Tab-Struktur (Wiederverwendung von Mustern):
1. **Übersicht/Stats oben**: Gesamt, Offen (nicht versendet), Versendet, Geliefert
2. **Filter**: Status (alle/offen/versendet/geliefert), Suche (Käufername, Bestellnummer, Artikel)
3. **Bestellkarte pro Order**:
   - Käufername, Artikel-Titel + Bild, Bestelldatum, Betrag
   - Status-Badge (Bezahlt/Versendet/Geliefert)
   - **Tracking-Eingabefeld** (falls noch nicht versendet): Trackingnummer + Versanddienstleister-Dropdown → "Als versendet markieren" Button → sendet an eBay
   - Falls schon versendet: Tracking-Nummer anzeigen + Link zur Sendungsverfolgung
   - AliExpress-Link (analog zu Listings-Tab P12) — direkter Link zum Lieferanten-Produkt, um dort die eigene Tracking-Nummer abzurufen
4. **Kundennachricht-Button**: nutzt bestehenden Workflow (User schickt Bestellstatus-Foto → ich schreibe Text) — perspektivisch als Vorlage direkt im Tab integrierbar

## Tracking-Nummer Entscheidung (aus vorherigem Gespräch)
- **Für den Start: Option A** — AliExpress-Tracking 1:1 übernehmen und an eBay weitergeben
- Klarer Hinweis im UI: "Tracking wird unverändert übernommen — Kunde könnte Herkunft erkennen"
- **Später (P9)**: Tracking-Konvertierung über Drittanbieter (Trackerbot-Ersatz) als Upgrade-Option

## Backend-Endpoints (neu)
- `GET /api/ebay/orders` — Liste aller Bestellungen (mit Cache wie bei Listings, 5-10 Min TTL)
- `POST /api/ebay/orders/:orderId/ship` — Tracking-Nummer + Carrier übermitteln → eBay Fulfillment API
- `GET /api/order-notes/:ebayOrderId` — lokale Zusatzinfos abrufen
- `PATCH /api/order-notes/:ebayOrderId` — lokale Notiz/Benachrichtigungsstatus speichern

## Reihenfolge Umsetzung
1. DB-Schema: `orderNotes` Tabelle anlegen + Migration
2. Backend: `getAllOrders()` Funktion in ebay.ts (Fulfillment API GET /order)
3. Backend: `GET /api/ebay/orders` Endpoint (Grundstruktur, erstmal nur Anzeige)
4. Frontend: Neuer Tab "Bestellungen" in app.tsx registrieren (Route + TabNav Eintrag)
5. Frontend: Grundgerüst orders.tsx — Liste + Stats + Filter (angelehnt an listings.tsx Muster)
6. Backend: `POST /api/ebay/orders/:orderId/ship` (Tracking übermitteln)
7. Frontend: Tracking-Eingabe-UI + "Als versendet markieren"
8. Später: Kundennachricht-Integration, P9 Tracking-Konvertierung

## Entscheidungen (bestätigt)
- Tab-Position: zwischen Listings und Retouren ✅
- Erst Grundgerüst (nur Anzeige), Tracking-Eingabe als nächster Schritt ✅
- Versanddienstleister wechselt je nach Lieferant (kein Fixwert für Carrier-Dropdown später) ✅
- Rechnung/Quittung: gleich mit ins Grundgerüst, BEIDE Varianten (Ein-Klick-Download UND automatisch als Anhang generiert) ✅

## Status
- ✅ DB-Schema: `orderNotes` Tabelle (inkl. invoiceGeneratedAt, invoicePath) + Migration
- ✅ Backend: `getAllOrders()` in ebay.ts (REST Fulfillment API, Pagination)
- ✅ Backend: `GET /api/ebay/orders` (mit 5-Min-Cache, merged mit lokalen Notizen)
- ✅ Backend: `invoice.ts` — PDF-Generator via Playwright (gleiches Chromium-Launch-Muster wie aliexpress.ts), Kleinunternehmer §19 UStG Hinweistext
- ✅ Backend: `GET /api/ebay/orders/:orderId/invoice` (Ein-Klick-Download, on-demand)
- ✅ Backend: Auto-Generierung — bei jedem Orders-Fetch werden neue Bestellungen (ohne invoiceGeneratedAt) automatisch im Hintergrund als PDF erzeugt und unter /invoices/ gespeichert
- ✅ Frontend: neuer Tab "Bestellungen" (📬) zwischen Listings und Retouren, Route registriert
- ✅ Frontend: bestellungen.tsx — Übersicht/Stats, Filter (alle/offen/versendet), Suche (Bestellnummer/Käufer/Artikel), Rechnungs-Button pro Bestellung
- ✅ Build lokal getestet (Frontend + Backend), beide sauber
- 🔲 Noch nicht deployed/live getestet
- 🔲 Tracking-Eingabe UI (nächster Schritt, separat)

## Nächste Schritte (nach diesem Grundgerüst)
1. ✅ Deploy + Live-Test — echte eBay-Bestellungen kommen durch, Rechnung generiert korrekt
2. Tracking-Eingabefeld pro Bestellung + "Als versendet markieren" Button → POST-Endpoint zu eBay Fulfillment API
3. Carrier-Dropdown flexibel (kein Fixwert, da Lieferant wechselt)
4. Später: P9 Trackerbot-Ersatz (Tracking-Konvertierung) als Upgrade

## Wichtiger Befund: Netto-Berechnung strukturell limitiert
- Geprüft am Live-System: Nur 1 von 107 Bestellungen zeigt einen Netto-Wert
- Root Cause: Unsere Stele-App-Datenbank hat aktuell nur 15 Produkte (alles was seit App-Nutzung importiert wurde)
- Die 335+ restlichen eBay-Listings stammen aus der Zeit VOR dieser App (Ecomsniper/AutoDS-Ära) — nie mit Einkaufspreis in unsere DB importiert
- Das ist kein Bug im Matching-Code (ASIN/Base64/SKU-Matching wurde erweitert und funktioniert korrekt für die 15 vorhandenen Produkte) — die Kostendaten existieren schlicht nicht im System für die alten Listings
- Lösung nur möglich durch: manuellen Nachtrag der Einkaufspreise für alte Produkte, ODER Akzeptanz dass Netto nur für neu importierte Produkte sichtbar ist (wächst mit der Zeit von selbst)
- Dem User in Zusammenfassung ehrlich erklärt
