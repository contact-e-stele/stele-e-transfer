# Preis-Fundament Teil 2D — Senkungsbremse (Pflichtbestandteile #5/#6)

Regel: `computeMinSellPrice()` liefert eine **Untergrenze**, keinen Zielpreis. `applyDecreaseCap()`
begrenzt deshalb, wie weit ein automatisch berechneter Preis pro Lauf **unter den aktuellen Preis**
fallen darf — auf `MAX_PRICE_DECREASE_PERCENT = 8` %. **Anheben ist nie gedeckelt.**

## #5 — Tabelle für real live gelistete Produkte

**Datenlage, offen gesagt:** für diese Tabelle braucht es zwei Werte pro Produkt, die nur die
Produktions-Umgebung kennt — den **aktuellen eBay-Live-Preis** und den aktuellen Einkaufspreis.
Aus dieser Sandbox besteht kein Zugriff auf die Produktions-DB oder die eBay-API. Konkret
mitgeteilt wurden mir im Auftrag **2 reale Produkte** — nur die stehen hier. Die restlichen 8+
Zeilen **erfinde ich nicht**; dafür liegt `scripts/export-decrease-cap-audit.ts` bei (nur lesend),
das exakt diese Tabelle für **alle** live gelisteten Produkte gegen die echte DB + eBay-Live-Preise
erzeugt:

```
cd packages/web && bun run scripts/export-decrease-cap-audit.ts > senkungsbremse.csv
```

Das Skript prüft am Ende selbst, ob irgendein Produkt um mehr als 8 % fällt, und meldet das als
Fehler — die Erwartung aus dem Auftrag ist damit maschinell nachprüfbar, statt von mir behauptet.

### Die 2 realen Produkte aus dem Auftrag

| SKU | Aktueller eBay-Preis | Berechneter Mindestpreis | Preis nach Deckel | Gedeckelt | Absenkung |
|---|---|---|---|---|---|
| stele-141 | 23,95 € | 10,95 € | **22,95 €** | ja | 4,18 % |
| stele-110 | 20,95 € | 10,95 € | **19,95 €** | ja | 4,77 % |

Ohne Bremse wären beide in **einem** Lauf auf 10,95 € gefallen (−54,3 % bzw. −47,7 %). Mit Bremse
fällt der Preis schrittweise: stele-141 z. B. 23,95 → 22,95 → 21,95 → … bis die Untergrenze von
10,95 € erreicht ist. Genau das zeigt die Vorschau ab dieser PR über `wasCapped` und
`uncappedNewPrice` pro Zeile an.

**Warum die Absenkung unter 8 % liegt und nicht exakt 8 %:** der 8-%-Grenzwert (bei stele-141:
23,95 × 0,92 = 22,034 €) liegt nicht auf einer ,95-Marke. Gerundet wird auf die nächste ,95-Marke,
die den Grenzwert **nicht unterschreitet** — hier 22,95 €. Siehe Rundungs-Hinweis unten.

## #6 — Die drei geforderten Testfälle (committet in `src/shared/pricing.test.ts`)

| Fall | Aktueller Preis | Berechneter Mindestpreis | Ergebnis | Gedeckelt | Erwartung erfüllt |
|---|---|---|---|---|---|
| a) Anheben | 15,00 € | 18,95 € | 18,95 € | **nein** | ✓ Anheben wird nie gedeckelt |
| b) Absenken > 8 % | 23,95 € | 10,95 € | 22,95 € | **ja** | ✓ auf ≤ 8 % begrenzt (4,18 %) |
| b) Absenken > 8 % | 20,95 € | 10,95 € | 19,95 € | **ja** | ✓ auf ≤ 8 % begrenzt (4,77 %) |
| c) Absenken < 8 % | 20,00 € | 19,00 € | 19,00 € | **nein** | ✓ unverändert durchgelassen |

Zusätzlich abgedeckt: `currentPrice` null/undefined (Erst-Listing → unverändert), `computedMinPrice
=== currentPrice` (Grenzfall, kein Absinken), und ein Test, der für **alle** Fälle nachrechnet, dass
die 8-%-Grenze nie überschritten wird.

## Rundungs-Präzisierung gegenüber der wörtlichen Auftragsvorgabe

Der Auftrag sagt: *"nicht tiefer als currentPrice × (1 − maxDecreasePercent/100) gehen; das Ergebnis
danach mit roundToNearest95() runden"*. Wörtlich umgesetzt kollidieren diese beiden Halbsätze:
`roundToNearest95()` rundet auch **abwärts**, und auf den Grenzwert selbst angewandt drückt es den
Preis unter genau diesen Grenzwert.

Konkret bei stele-141: Grenzwert 22,034 € → `roundToNearest95(22,034)` = **21,95 €** → das sind
**8,35 %** Absenkung, nicht 8 %. Damit wäre die Pflichterwartung aus #5 ("kein Produkt fällt in
einem Lauf um mehr als 8 Prozent") in genau dem Fall verletzt, für den die Bremse gebaut wurde.
Bei billigeren Artikeln wird der Effekt relativ größer (bis zu ~0,47 € Rundungsverlust, bei einem
10-€-Artikel also bis ~5 Prozentpunkte zusätzlich).

**Entscheidung:** die harte 8-%-Grenze hat Vorrang. `applyDecreaseCap()` rundet zuerst mit
`roundToNearest95()` und weicht **nur dann** auf `roundUpToX95()` aus, wenn das Ergebnis sonst unter
den Grenzwert fiele. In der Mehrzahl der Fälle ist das Ergebnis identisch zur wörtlichen Vorgabe;
die Preisendung bleibt immer auf ,95. Ein committeter Regressionstest hält genau diesen Fall fest
(`21,95 € wäre 8,35 %`), damit die Begründung nicht verloren geht.

Falls stattdessen die wörtliche Variante gewünscht ist (leichtes Überschreiten der 8 % durch
Abrundung akzeptiert): eine Zeile in `applyDecreaseCap()` — bitte kurz Bescheid geben.

## Bewusst NICHT gedeckelt (Abgrenzung laut Auftrag)

- `/ebay/list` (Erst-/Re-Listing): es gibt keinen alten Preis, der berechnete Preis ist dort korrekt.
- Reine Anzeige-/Import-Rechner: `lieferanten.tsx`, `index.tsx` (Preise-Tab), `produkte.tsx`.
- **Zusätzlich benannt (nicht im Auftrag, hier bewusst offengelegt):** bei Varianten-Produkten wirkt
  der Deckel auf den informativen Einheitspreis (Vorschau + DB-Speicherung), **nicht** auf die
  einzelnen Varianten-SKU-Preise, die `updateEbayVariantPricesIndividually()` tatsächlich schreibt.
  Grund: für eine einzelne SKU gibt es im aktuellen Datenmodell keinen gespeicherten "aktuellen
  Preis je SKU", gegen den gedeckelt werden könnte — `listing.currentPrice` ist ein Preis pro
  Listing, nicht pro SKU. Ein Deckel pro SKU bräuchte zuerst eine Erfassung der Ist-Preise je SKU.
  Falls das gewünscht ist, wäre das ein eigener Schritt (Teil 2E o. ä.).
