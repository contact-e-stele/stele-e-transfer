# Einkaufspreis pro Bestellung einfrieren (2026-09-18)

## Kontext

Während der P-88-Session (17./18.09.2026) fiel die Produktanzahl in der Produktions-DB
von 62 auf 46 (vermutlich manuelle Aufräumarbeit des Nutzers parallel zur Session, nicht
durch Claude verursacht — per grep bestätigt: nur ein Einzelprodukt-Lösch-Endpunkt, kein
Bulk-Cron). Nebenbefund: zwei abgeschlossene Bestellungen (`02-15151-11415`,
`13-15069-00183`) verloren dadurch ihren `nettoEinkauf`/`nettoErgebnis` — beide `null`.

**Root Cause** (`packages/web/src/api/index.ts:814-822`, `GET /ebay/orders`): der
Einkaufspreis einer Bestellung wird bei JEDEM Aufruf live über die bestellte SKU gegen
die AKTUELLE `products`-Tabelle nachgeschlagen. Es gibt keine `orders`-Tabelle — Bestellungen
kommen live von eBay, angereichert mit `order_notes`. Fällt das referenzierte Produkt weg,
kippt der Wert unwiderruflich auf `null`, auch für längst abgerechnete Bestellungen.

Das ist strukturell derselbe Fehlertyp wie P-49 (Einkaufspreis nicht mit der Bestellung
eingefroren, sondern live aus einer sich ändernden Quelle gezogen).

## Ziel

`nettoEinkauf`/`nettoErgebnis` einer Bestellung werden **einmal** berechnet und dauerhaft
in `order_notes` gespeichert ("eingefroren"), sobald ein Wert vorliegt — unabhängig davon,
was später mit dem referenzierten Produkt passiert. Der Kaufpreis zum Verkaufszeitpunkt ist
die für die EÜR relevante Zahl, nicht ein späterer Live-Wert.

## Geltungsbereich (per Nutzer-Bestätigung, 18.09.2026)

**Betrifft ausschließlich `order_notes`** (abgeschlossene Bestellungen). Explizit NICHT
angefasst: `products`-Tabelle, `shared/pricing.ts` (Zielmarge, Senkungsbremse,
`applyRaiseOnly`, `AUTO_PRICE_WRITE_ENABLED`), `api/price-monitor.ts`,
`web/pages/produkte.tsx`. Diese Bereiche berechnen/aktualisieren Verkaufspreise am Produkt
weiterhin unverändert live — nur die historische Einkaufspreis-Zahl PRO BESTELLUNG wird
eingefroren.

## Architektur

### 1. Migration (additiv)

`order_notes` bekommt zwei neue Spalten:
- `frozen_buy_price REAL` — der eingefrorene Einkaufspreis (Summe über alle Line-Items,
  inkl. Zoll, wie bisher `einkaufGesamt` in index.ts berechnet)
- `frozen_buy_price_at TEXT` — Zeitstempel des Einfrierens

`packages/web/src/db/migrate.ts`: zwei neue `ALTER TABLE order_notes ADD COLUMN`-Zeilen,
gleiches Muster wie die bestehenden 9 Einträge für diese Tabelle.

### 2. Reine Berechnungsfunktion extrahieren

Die bestehende Inline-Logik (index.ts:814-822: SKU → Produkt → `buyPrice + Zoll` je
Line-Item, summiert) wird nach `packages/web/src/api/order-matching.ts` (bestehende Datei,
enthält bereits `findProductForSkuShared`/`buildProductLookups` aus Teil 3B) als eigene
exportierte Funktion verschoben:

```ts
export function computeAutoBuyPrice<T extends ProductForSkuMatch & { buyPrice: number | null; shipsFrom: string | null }>(
  lineItems: Array<{ sku: string | null; quantity: number }>,
  findProductForSku: (sku: string | null) => T | undefined,
): number | null
```

(`ProductForSkuMatch` ist der bestehende generische Constraint aus `order-matching.ts:9`.)

Liefert `null`, sobald für IRGENDEIN Line-Item kein Produkt/kein `buyPrice` gefunden wird
(gleiches Verhalten wie bisher — kein Teilbetrag, kein Raten). Grundgesetz Regel 8: eine
Stelle, zwei Nutzer (Live-Fallback-Pfad + Freeze-Job).

### 3. Sofortiges Einfrieren bei neuen Bestellungen

Im bestehenden Hintergrund-Block für neue Bestellungen (index.ts:836-889, Trigger:
`!invoiceGeneratedAt` = "diese Bestellung hat die App noch nie gesehen") wird zusätzlich
zur Rechnungserstellung `computeAutoBuyPrice()` aufgerufen und das Ergebnis (falls
vorhanden) in denselben `db.insert(...).onConflictDoUpdate(...)`-Aufruf mit aufgenommen.
Läuft im selben Batch wie die Rechnungserstellung, NICHT im Batch-Limit des Altbestand-
Backfills (Punkt 4) — eine neue Bestellung wartet nie hinter einem Rückstau alter
Bestellungen.

### 4. Altbestand: Vorschau vor Schreiben (kein automatischer Hintergrund-Job)

Anders als bei neuen Bestellungen wird der Altbestand (Bestellungen mit
`invoiceGeneratedAt` gesetzt, aber `frozenBuyPrice IS NULL`) **nicht** automatisch im
Hintergrund befüllt. Stattdessen zwei Skripte (Grundgesetz Regel 1 — reale Ausführung
gegen die echte DB, nur lesend zuerst):

- `scripts/freeze-buy-prices-preview.ts` (NUR LESEND): listet jede betroffene Bestellung,
  klassifiziert Alt (bereits `invoiceGeneratedAt` gesetzt) vs. Neu (würde durch Punkt 3
  ohnehin automatisch eingefroren), zeigt den Wert, der eingefroren würde, oder `— nicht
  berechenbar (Produkt fehlt) —` für die 2 bekannten kaputten Fälle.
- `scripts/freeze-buy-prices-apply.ts`: schreibt NUR für Bestellungen, bei denen
  `computeAutoBuyPrice()` einen Wert liefert (nie `null` einfrieren). Wird erst nach
  Prüfung der Vorschau vom Nutzer ausgeführt (lokal oder Render-Shell) — kein impliziter
  Auto-Run.

### 5. Prioritätskette beim Zusammenführen (index.ts)

1. `manualBuyPrice` gesetzt → `nettoQuelle: 'manuell'` (unverändert, höchste Priorität)
2. `frozenBuyPrice` gesetzt → `nettoQuelle: 'eingefroren'`
3. sonst: `computeAutoBuyPrice()` live → `nettoQuelle: 'automatisch'` (Übergang, bis
   Punkt 3/4 gegriffen haben)
4. sonst: `null`

Einmal eingefroren, wird ein Wert NIE automatisch überschrieben — nur eine manuelle
Korrektur (`manualBuyPrice`) kann ihn ändern.

### 6. Frontend (`bestellungen.tsx`)

`nettoQuelle`-Typ: `"manuell" | "eingefroren" | "automatisch" | null`. Tooltip (Z.99) und
Inline-Label (Z.639) unterscheiden "eingefroren am {Datum}" von "automatisch (live)".

## Fehlerbehandlung

- Kein Produkt/keine SKU auflösbar → wie bisher `null`, kein Freeze-Schreibvorgang (weder
  bei neuen noch bei Alt-Bestellungen) — kein falscher `frozenBuyPrice: 0` oder Ähnliches.
- DB-Fehler beim Freeze-Schreibvorgang (neue Bestellungen): wie bisher beim
  Rechnungs-Try/Catch geloggt, blockiert die Response nicht (Hintergrund-Fire-and-forget,
  bestehendes Muster).

## Tests

- `computeAutoBuyPrice()`: Produkt gefunden/fehlt, mehrere Line-Items, China-Zoll,
  gemischter Fall (ein Line-Item bekannt, eins nicht → gesamt `null`).
- Priorität: `manualBuyPrice` schlägt `frozenBuyPrice` schlägt Live-Berechnung.
- Freeze schreibt nie `null`/`0` als Platzhalter.

## Out of Scope

Die 2 bereits kaputten Bestellungen (stele-93/98) bleiben `null`, bis der Nutzer die
Werte manuell über das bestehende `manualBuyPrice`-Feld nachträgt — das ist eine separate,
vom Nutzer selbst zu treffende Entscheidung (Backup vom 15.09. verfügbar).
