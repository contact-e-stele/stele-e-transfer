# Preis-Fundament Teil 3 — Varianten mit eigenen Preisen (Pflichtbestandteile #1, #3–#7)

## #1 — Datenmodell: eigene Spalte `products.variant_sell_prices`

Der Verkaufspreis je Variante bekommt eine **eigene Spalte**: `variant_sell_prices TEXT`, Inhalt eine
JSON-Map `{"<skuId>": 12.95}`. Additive Migration (`ALTER TABLE products ADD COLUMN`), keine
bestehende Spalte geändert oder gelöscht.

**Warum eine eigene Spalte und nicht das vorhandene `ebayPrice`-Feld:** ein VK je Variante existierte
faktisch schon als *optionales* Feld an den `variantPrices`-Einträgen. Ich hatte deshalb zunächst
vorgeschlagen, es dabei zu belassen — der Nutzer hat sich am 13.09.2026 ausdrücklich für die eigene
Spalte entschieden. Der Vorteil: der VK ist damit kein Beiwerk der EINKAUFSpreis-Struktur mehr,
sondern ein eigenständiges, gezielt beschreibbares Feld, und `variantPrices` bleibt reine
Lieferantendaten (EK, Bestand, Bild).

**Der Preis dafür — und wie er abgesichert ist:** zwei Orte für denselben Wert sind genau das
Problem, das Teil 2A beseitigt hat. Deshalb gilt eine feste Vorrang-Regel, die **ausschließlich**
über `resolveVariantSellPrice()` (shared/pricing.ts) angewandt werden darf:

| Stufe | Quelle | gilt |
|---|---|---|
| 1 | `variant_sell_prices[skuId]` (neue Spalte) | gewinnt immer, wenn gesetzt |
| 2 | `variantPrices[].ebayPrice` (Altbestand) | nur, wenn Stufe 1 leer |
| 3 | — | kein gespeicherter VK → Aufrufstelle rechnet über `computeVariantSellPrices()` |

Neue Schreibvorgänge befüllen **ausschließlich Stufe 1**; Stufe 2 wird nur noch gelesen und nie
wieder geschrieben — der Altbestand läuft damit aus, ohne dass etwas migriert werden muss. Dazu
`parseVariantSellPrices()` (tolerant: kaputtes JSON → leere Map, unplausible Einzelwerte werden
verworfen) und `serializeVariantSellPrices()`. Alles durch Tests abgedeckt, inklusive des Falls
„Spalte und Altwert widersprechen sich" (Spalte gewinnt).

Der Bericht zeigt je Variante `gespeicherter_VK` und `VK_Quelle` (`column` / `legacy` / `none`), damit
sichtbar ist, welche Produkte schon umgestellt sind und welche noch am Altbestand hängen.

**In diesem PR wird die Spalte nicht befüllt** — das Schreiben gehört zum Nachziehen der Anzeigen,
das der Nutzer nach Sichtung des Berichts separat freigibt.

## #3 — Über welchen Pfad gingen/gehen Varianten-Preise an eBay (nur Bestandsaufnahme)

Es gibt **genau zwei** Wege, auf denen der Preis einer Varianten-SKU bei eBay landet. Alle Angaben
mit Datei:Zeile, Stand dieses Branches.

### Weg A — pro Variante einzeln (erzeugt echte Preisspannen)

**A1 — Erst-/Re-Listing:**
| Schritt | Stelle |
|---|---|
| VK je Variante wird gebaut (`ebayPrice` je Eintrag, frisch gerechnet) | `src/api/index.ts:2145-2157` |
| Übergabe an das Listing | `src/api/index.ts:2176` + `:2186` (`variantPrices:`) |
| Preis je Varianten-SKU wird gewählt (`varPriceEntry?.ebayPrice`, sonst Nachberechnung) | `src/api/ebay.ts:1299-1308` |
| Preis landet im Offer-Body | `src/api/ebay.ts:1323` (`pricingSummary.price.value`) |
| Offer-POST je SKU (Sell Inventory API) | `src/api/ebay.ts:1340` (`POST /sell/inventory/v1/offer`) |
| Veröffentlichung der Gruppe | `src/api/ebay.ts:903` (`publish_by_inventory_item_group`) |

**A2 — nachträgliche Preisänderung, korrekt je SKU:**
| Schritt | Stelle |
|---|---|
| Einstieg (je Variante ein eigener Preis) | `src/api/price-monitor.ts:113` `updateEbayVariantPricesIndividually()` |
| SKU-Zuordnung je Variante | `src/api/price-monitor.ts:105` `buildVariantSku()` |
| Schreibvorgang je SKU | `src/api/price-monitor.ts:135` → `:197-215` (`PUT /sell/inventory/v1/offer/{offerId}`) |
| Aufrufer: „Preise übernehmen", Varianten-Zweig | `src/api/index.ts:1302` |

### Weg B — ein Einheitspreis auf ALLE SKUs (macht die Spanne platt)

| Schritt | Stelle |
|---|---|
| Einstieg | `src/api/price-monitor.ts:231` `updateEbayPriceInventory(productId, newPrice)` |
| versucht zuerst die Einzelartikel-SKU | `src/api/price-monitor.ts:237` |
| schlägt das fehl: liest die ECHTEN Varianten-SKUs der Gruppe … | `src/api/price-monitor.ts:248` |
| … und schreibt **denselben** `newPrice` auf **jede** davon | `src/api/price-monitor.ts:252` |
| Aufrufer: „Preise übernehmen", **Nicht**-Varianten-Zweig | `src/api/index.ts:1308` |

**In diesem PR wurde an keinem dieser Pfade etwas geändert** — reine Bestandsaufnahme, wie
beauftragt. Es wurde nichts an eBay gesendet.

## #4 — Warum zeigen stele-152/123 echte Spannen, stele-110/141 aber nicht?

Drei Mechanismen können eine Spanne platt machen. Alle drei sind **im Code belegbar**; welcher bei
welchem Produkt gegriffen hat, hängt vom DB-Zustand und der Preis-Historie des Produkts ab — beides
ist aus dieser Sandbox nicht lesbar (kein Zugriff auf Produktions-DB, und `api.ebay.com` ist hier
netzseitig geblockt, siehe unten). Der Bericht aus #5 entscheidet die Frage pro Produkt eindeutig.

**Mechanismus 1 — Weg B lief über ein Varianten-Produkt.**
`index.ts` entscheidet über `variantCount > 1 || variantGroupCount > 0` (`src/api/index.ts:1262`,
für die Vorschau identisch bei `:1146`),
wobei `variantCount` = Einträge in `variantPrices` und `variantGroupCount` = Einträge in `variants`.
Ein Produkt, dessen `variantPrices` **≤ 1** Eintrag hat **und** dessen `variants` leer ist, gilt als
Einzelartikel — obwohl das eBay-Listing mehrere SKUs hat. Dann läuft `index.ts:1308` → Weg B →
`price-monitor.ts:252` schreibt einen Preis auf alle SKUs.

**Mechanismus 2 — SKU-Zuordnung schlägt fehl, Einheits-Fallback greift für jede SKU.**
`updateEbayVariantPricesIndividually()` ordnet jeder echten eBay-SKU eine Zeile zu; findet es für
eine SKU keine, nimmt es `safeUniformVariantPrice()` (das Maximum) — `src/api/price-monitor.ts:128`
(Fallback-Preis) und `:133` (Zuweisung je SKU).
Matcht **keine** Zeile (z. B. weil `attrs` fehlen/anders geschrieben sind als beim Listing), bekommt
**jede** SKU denselben Fallback-Preis. Das ist exakt die Fehlerklasse aus PR #82 („Ships From"
verlängerte die erwartete SKU), nur mit dem Ergebnis „alle gleich" statt „eine falsch".

**Mechanismus 3 — historisch: der P-27/P-28-Bug selbst.**
Vor PR #77 (08.09.2026) schrieb der Varianten-Zweig von „Preise übernehmen" grundsätzlich den
Einheitspreis (Maximum) auf jede SKU. Jedes Produkt, das vor diesem Fix zuletzt neu bepreist wurde,
steht bis heute platt — der Fix wirkt nicht rückwirkend (deshalb gab es PR #78, den
Reparatur-Endpunkt).

**Wie der Bericht es entscheidet:** die Spalte `SKU_Match` zeigt je Variante, ob die aus `attrs`
gebaute SKU einer echten eBay-SKU entspricht (Mechanismus 2 → „nein"), `Live_Preisspanne_heute`
zeigt je Produkt die tatsächliche Spanne bei eBay (platt → `x,xx-x,xx`), und `Preisquelle` zeigt, ob
je SKU überhaupt ein eigener Live-Preis existiert. Damit ist die Frage nach einem Lauf beantwortet,
ohne zu raten.

## #5/#6 — Bericht-Skript

`scripts/export-variant-price-plan.ts` (**nur lesend**; eBay ausschließlich GET:
`getInventoryItemGroupSkus`, Offer-GET je SKU, `getAllOrders`).

```
cd packages/web && bun run scripts/export-variant-price-plan.ts > varianten-preisplan.csv
```

Spalten je Variante: `SKU, Variante, Varianten_SKU, SKU_Match, EK, heutiger_Preis, Preisquelle,
neuer_Preis, Gewinn_heute, Gewinn_neu, Differenz_Preis, Absenkung_Prozent, ueber_8_Prozent, Anker,
Verkaeufe_90T`. Je Produkt zusätzlich: `Anzahl_Varianten, Ankervariante, Ankerpreis, Ankergewinn,
Zielgewinn, Zielgewinn_Quelle, **Summe_Preissenkungen**, groesste_Absenkung_Prozent,
Live_Preisspanne_heute`.

**#6 Verkaufszahlen je Varianten-SKU:** aus `getAllOrders()` aggregiert (`lineItems[].sku` ×
`quantity`). eBay liefert dort standardmäßig die **letzten ~90 Tage** (siehe den P-101-Kommentar in
`src/api/ebay.ts:1847-1855`) — die Spalte ist also „Verkäufe der letzten 90 Tage", nicht „seit
Beginn". Ist kein eBay-Token verfügbar, steht `n/v` statt einer erfundenen Zahl.

**Gegen die echte DB ausgeführt habe ich das Skript NICHT — das kann ich nicht.** Aus dieser Sandbox
gibt es keinen Zugriff auf die Produktions-DB, und `api.ebay.com` wird vom Netz-Proxy blockiert
(wörtlich: `403 request blocked: no rule or allowlist entry allows host "api.ebay.com"`). Bitte das
Skript in der Render-Shell laufen lassen; die Ausgabe ist der eigentliche Bericht.

**Stattdessen end-to-end gegen eine lokale Test-DB geprüft** (ein Produkt mit den 6 realen
stele-110-Einkaufspreisen, sellPrice 19,95 €, China, adRate 5 %) — das prüft die komplette
Berichtslogik inklusive CSV-Aufbau, Summen und Warnschwelle:

| Variante | EK | heute | neu | Gewinn heute | Gewinn neu | Differenz | Absenkung |
|---|---|---|---|---|---|---|---|
| Rot (Anker) | 7,69 | 19,95 | **19,95** | 3,15 | 3,15 | ±0,00 | 0,00 % |
| Blau | 4,99 | 19,95 | **15,95** | 5,85 | 2,81 | −4,00 | 20,05 % |
| Grün | 4,19 | 19,95 | **14,95** | 6,65 | 2,84 | −5,00 | 25,06 % |
| Gelb | 3,35 | 19,95 | **13,95** | 7,49 | 2,92 | −6,00 | 30,08 % |
| Weiß | 2,55 | 19,95 | **12,95** | 8,29 | 2,96 | −7,00 | 35,09 % |
| Schwarz | 2,15 | 19,95 | **12,95** | 8,69 | 3,36 | −7,00 | 35,09 % |

Summe der Preissenkungen: **29,00 €**. Ankergewinn = Zielgewinn = 3,15 €.

## #7 — Pflichtwert stele-110: erfüllt

Gefordert: `19,95 / 15,95 / 14,95 / 13,95 / 12,95 / 12,95`. Genau das liefert
`computeVariantSellPrices()` — als committeter Test festgehalten (`pricing.test.ts`).

Zwei Dinge, die dabei unabhängig bestätigt wurden:

1. **Der BEFUND des Auftrags reproduziert sich exakt.** Beim heutigen Einheitspreis 19,95 € ergeben
   die 6 realen Einkaufspreise Gewinne von **3,15 € bis 8,69 €**, Spanne **5,54 €** — exakt die
   Zahlen aus dem Auftrag („stele-110: 3,15 bis 8,69", „stele-110: 5,54"). Das bestätigt rückwärts
   die Annahmen, die dafür nötig sind: sellPrice **19,95 €**, Zollpauschale **4,00 €** (China),
   adRate **5 %**, Lieferantenversand **0 €**.
2. **Die Zollpauschale kürzt sich heraus.** Sie senkt den Ankergewinn um denselben Betrag, um den
   sie die Kosten jeder Variante erhöht — die Zielpreise sind mit und ohne China-Zoll identisch
   (eigener Test). Punkt 7 trifft deshalb unabhängig von der `shipsFrom`-Angabe zu.

**Eine Abweichung, die auffällt und die ich nicht glattbügele:** in Teil 2D war für stele-110 ein
eBay-Live-Preis von **20,95 €** genannt; der Wert, der die Gewinnzahlen dieses Auftrags reproduziert,
ist **19,95 €**. Beides zugleich stimmt nur, wenn der gespeicherte `sellPrice` (19,95 €) und der
Live-Preis bei eBay (20,95 €) auseinanderlaufen. Der Bericht macht genau das sichtbar
(`Ankerpreis` vs. `Live_Preisspanne_heute`). Der Plan verwendet — der wörtlichen Vorgabe folgend —
den gespeicherten `sellPrice` als Anker. Falls stattdessen der Live-Preis ankern soll, ist das eine
Zeile im Skript; sag kurz Bescheid.

## Offener Punkt für das spätere Nachziehen: Kollision mit der 8-%-Bremse

Die Umstellung senkt einzelne Varianten um **20–35 %** (siehe Tabelle oben). Die Senkungsbremse aus
Teil 2D (`MAX_PRICE_DECREASE_PERCENT = 8`) bleibt in diesem PR **unverändert gültig** — sie ist hier
nicht angefasst. Beim späteren Nachziehen muss aber entschieden werden:

- **Bremse gilt auch hier:** die Zielpreise werden über mehrere Läufe erreicht (bei 35 % ca. 5 Läufe).
- **Einmalige Ausnahme:** die Umstellung wird als bewusst freigegebene Korrektur von der Bremse
  ausgenommen und in einem Schritt geschrieben.

Der Bericht markiert jede betroffene Zeile (`ueber_8_Prozent`) und zählt die Produkte am Ende, damit
die Entscheidung auf Zahlen beruht. **In diesem PR wird nichts davon geschrieben.**
