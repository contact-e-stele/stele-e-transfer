# Fixgebühr gestaffelt — geänderte Test-Erwartungen (AUFSICHT an 7 App 045 Teil A, 09.11.2026)

GELD-LOGIK. Die eBay-Fixgebühr je Bestellung ist jetzt gestaffelt: **0,35 € netto bei Bestellwert ≤ 10 €, sonst 0,45 € netto**, beides × 1,19
(Bestellwert = VK × S, S = 1,19 bei China-Standort, sonst 1; auf Cent gerundet). Vorher rechnete die App überall **0,30 € netto (0,357 brutto)**.

Alle neuen Erwartungswerte stammen aus einem echten `bun test`-Lauf der geänderten App-Funktionen; Stichproben unabhängig mit `bun -e`
nachgerechnet (z. B. 14,45 × 0,71678 − 0,45 × 1,19 − 8,71 = 1,111971; 19,95 × 0,71678 − 0,5355 − 15,16 = −1,395739; Referenz 14 %:
(29,10 × 0,14 + 0,45) × 1,19 = 5,38356; (24,95 × 0,14 + 0,45) × 1,19 = 4,69217).

Typische Verschiebung: Gewinn je Bestellung über 10 € um **−0,1785 €** ((0,45 − 0,30) × 1,19), unter 10 € um −0,0595 €.

## NACHTRAG Bündel A+B (Stichtag + Provision je Kategorie, 09.11.2026) — gilt VOR allem darunter

Seit Bündel A+B gibt es einen **Stichtag `GEBUEHR_NEU_AB = 2026-10-15T08:00:00Z`**. Bestellungen davor: 15 % + 0,30 € fix; ab dann Provision je
eBay-Kategorie (`EBAY_CATEGORY_FEE_RATES`, unbekannt 15 %) + 0,35/0,45 €. Preisberechnung für künftige Verkäufe = immer neue Regel.
Darum sind die Tests mit **alten echten Bestellungen/Verkäufen wieder auf ihren Wert vor PR #304 zurückgesetzt** (Erwartungswerte UND
Toleranzen exakt wie auf `main`, jeder Wert mit `bun test` bestätigt). Die Einträge dazu in Abschnitt 3 und in der Liste unten sind überholt:

| Datei | Test | PR #304 (Teil A) | jetzt (= main) | Grund |
|---|---|---|---|---|
| `src/api/order-matching.test.ts` | manueller Zweig (09-15210-97703) / Summe 15 Bestellungen | 1,58 / 28,92 | 1,76 / 31,43 | Bestellungen vor Stichtag; Datei wieder identisch mit main |
| `src/api/variant-sales.test.ts` | Gewinn je Verkauf (Bestellungen Sept.) | 1,4164 / 4,1164 / 9,6664 | 1,5949 / 4,2949 / 9,8449 | vor Stichtag; Datei wieder identisch mit main |
| `src/shared/k005-faktor.test.ts` | order-matching mit/ohne Faktor | 2,72 / 3,32 / 2,72 | 2,89 / 3,49 / 2,89 | vor Stichtag |
| `src/shared/k005.test.ts` | Bestellung 20-15262-74118 (11.10.) | 3,26 (Auftrag 3,50 − 0,24) / 2,08 | 3,44 (± 0,10) / 2,25 | vor Stichtag |
| `src/shared/k004-formel-v2.test.ts` | Pflicht-Tests (echte Verkäufe bis 03.10.) | 1,38/0,51/1,71/2,08/1,59 | 1,56/0,68/1,88/2,26/1,77 | über `fixedFeeSchedule: EBAY_FIXED_FEE_SCHEDULE_ALT` |
| `src/shared/k004-formel-v2.test.ts` | Bestellung stele-119-200PCS (24.09.) + computeOrderProfit | 0,51 / 1,40 / 0,51 | 0,68 / 1,57 / 0,68 | `orderDate 2026-09-24`; zusätzlich geprüft: ohne Zeitpunkt 0,51/1,40 |
| `src/shared/k009-anzeige-0.test.ts` | 19-15281-36243 (15.10. 05:43Z) | 4,28 / 1,53 · 5,52 / 0,29 | 4,10 / 1,71 · 5,34 / 0,47 | `orderDate` von '2026-10-15' (nur Datum = mehrdeutig, gilt als neu) auf den echten Zeitpunkt '2026-10-15T05:43:00Z' |
| `src/shared/pricing-v2.test.ts` | 13 echte Verkäufe 12.08.–03.10. | Toleranz 0,28, „Formel < echt“, max 0,2736 | Toleranz 0,20, max < 0,11 | `fixedFeeSchedule: EBAY_FIXED_FEE_SCHEDULE_ALT` |
| `src/shared/pricing-v2.test.ts` | letzter Verkauf 03.10. stele-119 | 0,51 | 0,68 | wie oben |
| `src/shared/pricing.test.ts` | Auftragsvorgabe 17,95/11,56 (09-15210-97703) | 1,58 | 1,76 | `orderDate '2026-10-03'` (TESTWERT: Ende des belegten Zeitraums 12.08.–03.10.); ohne Zeitpunkt zusätzlich 1,58 geprüft |

Weiter auf 0,35/0,45 (neue Regel, korrekt so): alle Tests zu Mindest-VK, Zielpreis, Preislauf, Anzeigen/„Erwartet“ (künftige Verkäufe),
`k017-anzeige.test.ts` (Bestellung 01.11., nach dem Stichtag; Kategorie im Test unbekannt → 15 %).
Zusätzlich angepasst: `plan7-alte-formel.test.ts` (`defaultEbayFeeRateGross` hat jetzt den 3. Parameter Kategorie → `null` = 15 %, Werte gleich),
`fixgebuehr.test.ts` (`summary.minSellLowered` neu, 0), `kaeuferpreis-heben.test.ts` (neuer Block: 162 mit Kategorie 10900 → Ziel 16,45).
Neue Testdatei: `src/shared/gebuehr-stichtag-kategorie.test.ts` (Kategorietabelle, Stichtag-Grenze, 10 echte Belege, Durchreichen der Kategorie).

Zählung (`git diff origin/main -- 'src/**/*.test.ts'`, entfernte Nicht-Kommentarzeilen): Stand PR #304 Teil A 305, jetzt 289.

## Arten der Änderung

1. **Nur Erwartungswert neu** (Gewinn/Gebühr/Mindest-VK) — der überwiegende Teil, Zeilen unten.
2. **Eingabe geändert, damit das Szenario erhalten bleibt** (Testwerte, keine Live-Daten verändert), jeweils im Test kommentiert:
   - `k006.test.ts` / `target-margin-bulk.test.ts`: Toleranzband-Grenzfall Ware 3,29 → 3,15 (14,45 → Gewinn 1,1120 statt 0,9720).
   - `k008-preis-halten.test.ts`: GRAY-Ware 11,59 → 11,41, Sicherheitsnetz 11,72 → 11,54, Einzelartikel 11,59 → 11,41.
   - `k005-faktor.test.ts`: Faktor 0,6 → 0,55 (Szenario „mit Faktor kein Alarm“).
   - `variant-reprice.test.ts`: Ziel 2,00 → 1,80 (Szenario „mit Faktor ≥ Ziel > ohne Faktor“).
   - `pricing-v2.test.ts`: Anker 20,95 → 21,45 (Anker über dem Boden C).
   - `aufsicht-006.test.ts`: geprüfte Farbe Gray → Yellow (Rangfolge der besten 5 hat sich geändert).
   - `article-vk-variants.test.ts`: Artikel-VK 25,45/24,45 → 25,95/24,95 (Mindestpreis Brown 25,45 → 25,95).
   - `offered-profit.test.ts`: Brown-VK 25,45 → 25,95 und 23,95 → 24,45.
   - `variant-raise.test.ts`: v100b-VK 14,95 → 15,45.
   - `api/tier-reprice.test.ts`: Brown-VK 22,45 → 21,95 (sonst keine Preisänderung → kein Senden).
   - `kaeuferpreis-heben.test.ts`: Regel-Tests mit TESTWERT Ziel 16,45; mit den echten Werten rechnet die App für 162 jetzt
     16,95 ≠ Angebotsdaten 16,45 → 162 wird übersprungen (`ziel_abweichend`), nur 208 gehoben (echte Konsequenz, Test angepasst).
3. ~~**Grenze/Toleranz geändert, weil alte echte Bestellungen zu 0,30 passen**~~ — **ÜBERHOLT durch Bündel A+B (Stichtag), s. Nachtrag oben; alle Punkte hier wieder auf main-Werten:**
   - `pricing-v2.test.ts`: 13 echte Verkäufe 12.08.–03.10.: vorher |Formel − echt| ≤ 0,0951, jetzt Formel 0,0572–0,2736 € UNTER echt
     (Toleranz 0,20 → 0,28, zusätzlich „Formel < echt“ geprüft).
   - `k004-formel-v2.test.ts`: Pflichtwerte 1,56/0,68/1,88/2,26/1,77 → 1,38/0,51/1,71/2,08/1,59.
   - `k005.test.ts`: Bestellung 20-15262-74118 (11.10.) 3,44 → 3,26; Auftragswert 3,50 jetzt 0,24 daneben (vorher ± 0,10).
   - `k009-anzeige-0.test.ts`: Bestellung 19-15281-36243 (15.10.) — echte Gebühr 4,10 (= Fix 0,30), App jetzt 4,28.
   - `pricing.test.ts`, `order-matching.test.ts`: Bestellung 09-15210-97703 (September) 1,76 → 1,58; Summe 15 alte Bestellungen 31,43 → 28,92.
4. **`DEFAULT_PRICING_CONFIG.ebayFixedFeeEur` entfernt**: in allen Testdateien die Zeile `ebayFixedFeeEur: 0.30/0.3/C.ebayFixedFeeEur` aus den
   Eingaben gestrichen (Feld existiert nicht mehr).
5. `ad-rate-switch.test.ts`: Spalte „Gewinn neu“ aller 23 Zeilen der Freigabe-Tabelle 03.11. je −0,17/−0,18 € (VK neu und send unverändert).

## Alle geänderten Zeilen (aus `git diff`, Kommentarzeilen ausgelassen)

## `src/api/k017-anzeige.test.ts`

- Zeile 24:
  - alt: `expect(order127(true)).toMatchObject({ nettoErgebnis: 3.18, nettoGebuehren: 4.39, nettoAnzeige: 1.01 });`
  - neu: `expect(order127(true)).toMatchObject({ nettoErgebnis: 3, nettoGebuehren: 4.57, nettoAnzeige: 1.01 });`
- Zeile 27:
  - alt: `expect(order127(false, 5)).toMatchObject({ nettoErgebnis: 4.19, nettoGebuehren: 3.38, nettoAnzeige: 0 });`
  - neu: `expect(order127(false, 5)).toMatchObject({ nettoErgebnis: 4.01, nettoGebuehren: 3.56, nettoAnzeige: 0 });`
- Zeile 31:
  - alt: `expect(order127(true, 3)).toMatchObject({ nettoErgebnis: 3.58, nettoAnzeige: 0.61 });`
  - neu: `expect(order127(true, 3)).toMatchObject({ nettoErgebnis: 3.4, nettoAnzeige: 0.61 });`
- Zeile 34:
  - alt: `expect(order127(undefined, 5)).toMatchObject({ nettoErgebnis: 3.18, nettoAnzeige: null });`
  - alt: `expect(order127(undefined, 0)).toMatchObject({ nettoErgebnis: 4.19, nettoAnzeige: null });`
  - neu: `expect(order127(undefined, 5)).toMatchObject({ nettoErgebnis: 3, nettoAnzeige: null });`
  - neu: `expect(order127(undefined, 0)).toMatchObject({ nettoErgebnis: 4.01, nettoAnzeige: null });`

## `src/api/order-matching.test.ts`

- Zeile 42:
  - alt: `expect(Math.abs((result.nettoErgebnis ?? 0) - 1.76)).toBeLessThanOrEqual(0.01);`
  - neu: `expect(Math.abs((result.nettoErgebnis ?? 0) - 1.58)).toBeLessThanOrEqual(0.01); // AUFSICHT 045 A: Fix 0,45 statt 0,30 → 1,58 statt 1,76 (alte Bestellung)`
- Zeile 157:
  - alt: `expect(neuSumme).toBe(31.43);`
  - neu: `expect(neuSumme).toBe(28.92);`

## `src/api/pack-qty.test.ts`

- Zeile 57:
  - alt: `const g = profitAtSellPrice({ sellPrice: 12.95, buyPrice: p.price, isChinaOrigin: true, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.3, vatFactor: 1.19, adRatePercent: 5 });`
  - alt: `const g1 = profitAtSellPrice({ sellPrice: 12.95, buyPrice: 1.49, isChinaOrigin: true, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.3, vatFactor: 1.19, adRatePercent: 5 });`
  - neu: `const g = profitAtSellPrice({ sellPrice: 12.95, buyPrice: p.price, isChinaOrigin: true, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 5 });`
  - neu: `const g1 = profitAtSellPrice({ sellPrice: 12.95, buyPrice: 1.49, isChinaOrigin: true, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 5 });`

## `src/api/price-monitor.test.ts`

- Zeile 150:
  - alt: `expect(rowsMargin3[0].correctSellPrice).toBe(8.95); // Stufe D`
  - neu: `expect(rowsMargin3[0].correctSellPrice).toBe(9.45); // Stufe D`
- Zeile 153:
  - alt: `expect(computeVariantPriceRows(variantPricesJson, 0, null, 5)[0].correctSellPrice).toBe(15.95);`
  - alt: `expect(computeVariantPriceRows(variantPricesJson, 0, null, 5, 3.00)[0].correctSellPrice).toBe(17.45);`
  - neu: `expect(computeVariantPriceRows(variantPricesJson, 0, null, 5)[0].correctSellPrice).toBe(16.45);`
  - neu: `expect(computeVariantPriceRows(variantPricesJson, 0, null, 5, 3.00)[0].correctSellPrice).toBe(17.95);`

## `src/api/tier-reprice.test.ts`

- Zeile 85:
  - alt: `expect(rows.map(r => [r.skuId, r.correctSellPrice])).toEqual([['a', 14.45], ['b', 15.45]]);`
  - neu: `expect(rows.map(r => [r.skuId, r.correctSellPrice])).toEqual([['a', 14.45], ['b', 15.95]]); // AUFSICHT 045 A: b 15,45 (0,9888 < 1,10) → 15,95 (bun 1,3471)`
- Zeile 95:
  - alt: `expect(JSON.parse(storeArgs[0][1].variantSellPrices as string)).toEqual({ a: 14.45, b: 15.45 });`
  - neu: `expect(JSON.parse(storeArgs[0][1].variantSellPrices as string)).toEqual({ a: 14.45, b: 15.95 });`
- Zeile 119:
  - alt: `expect(sent).toEqual([5, '198600000001', 14.45]);`
  - alt: `expect(storeArgs[0][1]).toEqual({ targetMarginEur: 1.5, sellPrice: 14.45 });`
  - neu: `expect(sent).toEqual([5, '198600000001', 14.95]);`
  - neu: `expect(storeArgs[0][1]).toEqual({ targetMarginEur: 1.5, sellPrice: 14.95 });`
- Zeile 147:
  - alt: `expect(JSON.parse(storeArgs[0][1].variantSellPrices as string)).toEqual({ a: 14.45, b: 15.45 });`
  - neu: `expect(JSON.parse(storeArgs[0][1].variantSellPrices as string)).toEqual({ a: 14.45, b: 15.95 });`
- Zeile 286:
  - alt: `variantSellPrices: JSON.stringify({ '12000056068050014': 22.45, '12000056068050015': 22.45, '12000056068050016': 22.45 }),`
  - neu: `variantSellPrices: JSON.stringify({ '12000056068050014': 21.95, '12000056068050015': 22.45, '12000056068050016': 22.45 }),`

## `src/api/variant-raise.test.ts`

- Zeile 62:
  - alt: `expect(raises[0].newSell).toBe(17.45);`
  - alt: `expect(raises[0].oldProfit).toBeCloseTo(0.7256, 4);`
  - alt: `expect(raises[0].newProfit).toBeCloseTo(1.8008, 4);`
  - neu: `expect(raises[0].newSell).toBe(17.95);`
  - neu: `expect(raises[0].oldProfit).toBeCloseTo(0.5471, 4);`
  - neu: `expect(raises[0].newProfit).toBeCloseTo(1.9807, 4);`
- Zeile 69:
  - alt: `const p = product119({ variantSellPrices: JSON.stringify({ v100a: 19.95, v100b: 14.95, v200: 16.95 }) });`
  - neu: `const p = product119({ variantSellPrices: JSON.stringify({ v100a: 19.95, v100b: 15.45, v200: 16.95 }) });`
- Zeile 90:
  - alt: `expect(r.find(x => x.skuId === 'v100a')!.newSell).toBe(14.95);`
  - neu: `expect(r.find(x => x.skuId === 'v100a')!.newSell).toBe(15.45);`
- Zeile 124:
  - alt: `expect(logs[0]).toContain('15.95 → 17.45');`
  - neu: `expect(logs[0]).toContain('15.95 → 17.95');`
- Zeile 126:
  - alt: `expect(logs[0]).toContain('Gewinn 0.73 → 1.80');`
  - neu: `expect(logs[0]).toContain('Gewinn 0.55 → 1.98'); // 045 A: vorher 0.73 → 1.80 (Fix 0,30; neuer VK 17,45)`
- Zeile 134:
  - alt: `expect(sentRaises[0]).toEqual([{ skuId: 'v200', newSell: 17.45 }]);`
  - alt: `expect(stored[0]).toEqual({ v200: 17.45 });`
  - alt: `expect(logs.some(l => l.includes('ANGEHOBEN') && l.includes('v200') && l.includes('15.95 → 17.45') && l.includes('EK 4.79'))).toBe(true);`
  - neu: `expect(sentRaises[0]).toEqual([{ skuId: 'v200', newSell: 17.95 }]);`
  - neu: `expect(stored[0]).toEqual({ v200: 17.95 });`
  - neu: `expect(logs.some(l => l.includes('ANGEHOBEN') && l.includes('v200') && l.includes('15.95 → 17.95') && l.includes('EK 4.79'))).toBe(true);`
- Zeile 142:
  - alt: `expect(stored[0]).toEqual({ v200: 17.45 });`
  - neu: `expect(stored[0]).toEqual({ v200: 17.95 });`
- Zeile 176:
  - alt: `expect(stored[0]).toEqual({ v200: 17.45 }); // v100a (übersprungen) wird NICHT gespeichert`
  - neu: `expect(stored[0]).toEqual({ v200: 17.95 }); // v100a (übersprungen) wird NICHT gespeichert`
- Zeile 318:
  - alt: `expect(stored[0]).toEqual({ v200: 17.45 });`
  - alt: `expect(logs.some(l => l.includes('PREISSPRUNG stele-119') && l.includes('v100a') && l.includes('11.95 → 14.95'))).toBe(true);`
  - neu: `expect(stored[0]).toEqual({ v200: 17.95 });`
  - neu: `expect(logs.some(l => l.includes('PREISSPRUNG stele-119') && l.includes('v100a') && l.includes('11.95 → 15.45'))).toBe(true); // 045 A: vorher 14,95`

## `src/api/variant-sales.test.ts`

- Zeile 65:
  - alt: `expect(r.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(1.5949, 3);`
  - neu: `expect(r.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(1.4164, 3);`
- Zeile 78:
  - alt: `expect(r.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(1.5949, 3);`
  - neu: `expect(r.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(1.4164, 3);`
- Zeile 80:
  - alt: `expect(r.salesBySku.get('110::v2')!.profitPerSale[0]).toBeCloseTo(4.2949, 3);`
  - neu: `expect(r.salesBySku.get('110::v2')!.profitPerSale[0]).toBeCloseTo(4.1164, 3);`
- Zeile 101:
  - alt: `expect(einePos.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(9.8449, 3);`
  - neu: `expect(einePos.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(9.6664, 3);`
- Zeile 112:
  - alt: `expect(mehrPos.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(1.5949, 3);`
  - neu: `expect(mehrPos.salesBySku.get('110::v1')!.profitPerSale[0]).toBeCloseTo(1.4164, 3);`

## `src/shared/ad-rate-switch.test.ts`

- Zeile 22:
  - alt: `['50PCS 40-42CM', 1.89, 14.95, 13.95, 0.80], ['50PCS 47CM', 3.05, 16.95, 15.95, 1.21], ['50PCS 52CM', 3.39, 17.45, 15.95, 0.87],`
  - alt: `['50PCS 60CM', 5.09, 19.95, 18.95, 1.54], ['50PCS 70CM', 5.19, 19.95, 18.95, 1.44], ['50PCS 120CM', 11.19, 25.45, 23.95, 1.37],`
  - alt: `['100PCS 40-42CM', 2.89, 16.45, 15.95, 1.37], ['100PCS 47CM', 5.09, 19.45, 17.95, 0.75], ['100PCS 52CM', 5.79, 20.95, 19.95, 1.63],`
  - alt: `['100PCS 60CM', 9.99, 25.45, 23.95, 0.58], ['100PCS 70CM', 9.39, 24.95, 22.95, 0.39], ['100PCS 120CM', 25.39, 44.95, 40.95, 0.55],`
  - neu: `['50PCS 40-42CM', 1.89, 14.95, 13.95, 0.62], ['50PCS 47CM', 3.05, 16.95, 15.95, 1.04], ['50PCS 52CM', 3.39, 17.45, 15.95, 0.70],`
  - neu: `['50PCS 60CM', 5.09, 19.95, 18.95, 1.36], ['50PCS 70CM', 5.19, 19.95, 18.95, 1.26], ['50PCS 120CM', 11.19, 25.45, 23.95, 1.19],`
  - neu: `['100PCS 40-42CM', 2.89, 16.45, 15.95, 1.20], ['100PCS 47CM', 5.09, 19.45, 17.95, 0.57], ['100PCS 52CM', 5.79, 20.95, 19.95, 1.45],`
  - neu: `['100PCS 60CM', 9.99, 25.45, 23.95, 0.40], ['100PCS 70CM', 9.39, 24.95, 22.95, 0.21], ['100PCS 120CM', 25.39, 44.95, 40.95, 0.38],`
- Zeile 28:
  - alt: `['10PCS', 2.09, 15.95, 14.95, 1.39], ['20PCS', 2.69, 16.95, 15.95, 1.57], ['30PCS', 4.19, 18.95, 17.95, 1.65],`
  - alt: `['50PCS', 6.09, 21.45, 19.95, 1.33], ['100PCS', 11.79, 25.95, 23.95, 0.77], ['200PCS', 20.39, 36.95, 33.95, 0.04],`
  - neu: `['10PCS', 2.09, 15.95, 14.95, 1.21], ['20PCS', 2.69, 16.95, 15.95, 1.40], ['30PCS', 4.19, 18.95, 17.95, 1.47],`
  - neu: `['50PCS', 6.09, 21.45, 19.95, 1.15], ['100PCS', 11.79, 25.95, 23.95, 0.59], ['200PCS', 20.39, 36.95, 33.95, -0.14],`
- Zeile 32:
  - alt: `['Multicolour 50pcs', 2.49, 15.95, 14.95, 0.99], ['Multicolour 100pcs', 3.35, 16.95, 15.95, 0.91],`
  - alt: `['White 500pcs', 10.39, 23.95, 21.95, 0.59], ['Multicolour 500pcs', 10.69, 24.45, 22.95, 1.08],`
  - neu: `['Multicolour 50pcs', 2.49, 15.95, 14.95, 0.81], ['Multicolour 100pcs', 3.35, 16.95, 15.95, 0.74],`
  - neu: `['White 500pcs', 10.39, 23.95, 21.95, 0.41], ['Multicolour 500pcs', 10.69, 24.45, 22.95, 0.90],`
- Zeile 35:
  - alt: `const t227: Array<[string, number, number, number, number]> = [['Grey', 4.99, 18.95, 17.95, 0.85]];`
  - neu: `const t227: Array<[string, number, number, number, number]> = [['Grey', 4.99, 18.95, 17.95, 0.67]];`

## `src/shared/ali-data-usable.test.ts`

- Zeile 72:
  - alt: `[25.79, 43.45, 46.45], [14.89, 29.45, 31.45], [11.99, 25.45, 26.95],`
  - alt: `[26.59, 44.95, 47.45], [14.59, 28.95, 30.95], [12.39, 25.95, 27.95],`
  - neu: `[25.79, 43.45, 46.45], [14.89, 29.45, 31.45], [11.99, 25.45, 27.45],`
  - neu: `[26.59, 44.95, 47.95], [14.59, 28.95, 30.95], [12.39, 25.95, 27.95],`
- Zeile 75:
  - alt: `expect(r.map(x => x.oldProfit.toFixed(4))).toEqual(['-0.9529', '-0.0878', '-0.0549', '-0.6777', '-0.1462', '-0.0966']);`
  - alt: `expect(r.map(x => x.newProfit.toFixed(4))).toEqual(['1.1974', '1.3457', '1.0202', '1.1142', '1.2873', '1.3370']);`
  - neu: `expect(r.map(x => x.oldProfit.toFixed(4))).toEqual(['-1.1314', '-0.2663', '-0.2334', '-0.8562', '-0.3247', '-0.2751']); // AUFSICHT 045 A: je −0,1785 (Fix 0,45 statt 0,30)`
  - neu: `expect(r.map(x => x.newProfit.toFixed(4))).toEqual(['1.0189', '1.1672', '1.2001', '1.2941', '1.1088', '1.1585']); // AUFSICHT 045 A: Fix 0,45; Varianten 3/4 eine Endung höher (27,45 / 47,95)`
- Zeile 100:
  - alt: `expect(stored).toEqual(Object.fromEntries(SKUS.map((s, i) => [s, [46.45, 31.45, 26.95, 47.45, 30.95, 27.95][i]])));`
  - neu: `expect(stored).toEqual(Object.fromEntries(SKUS.map((s, i) => [s, [46.45, 31.45, 27.45, 47.95, 30.95, 27.95][i]])));`

## `src/shared/article-vk-variants.test.ts`

- Zeile 37:
  - alt: `test('234: 25,45 → nur Brown gesetzt (GRAY/green nicht angeboten)', () => {`
  - alt: `const r = planArticleVkToVariants(p234(25.45));`
  - alt: `expect(r.variantSellPrices).toEqual({ '12000056068050014': 25.45 });`
  - alt: `expect(r.set).toEqual([{ skuId: '12000056068050014', label: 'Brown', from: null, to: 25.45 }]);`
  - neu: `test('234: 25,95 → nur Brown gesetzt (GRAY/green nicht angeboten)', () => {`
  - neu: `const r = planArticleVkToVariants(p234(25.95));`
  - neu: `expect(r.variantSellPrices).toEqual({ '12000056068050014': 25.95 });`
  - neu: `expect(r.set).toEqual([{ skuId: '12000056068050014', label: 'Brown', from: null, to: 25.95 }]);`
- Zeile 48:
  - alt: `const r = planArticleVkToVariants(p234(24.45));`
  - neu: `const r = planArticleVkToVariants(p234(24.95));`
- Zeile 50:
  - alt: `expect(r.belowMin).toEqual([{ skuId: '12000056068050014', label: 'Brown', minSell: 25.45 }]);`
  - neu: `expect(r.belowMin).toEqual([{ skuId: '12000056068050014', label: 'Brown', minSell: 25.95 }]);`

## `src/shared/aufsicht-006.test.ts`

- Zeile 18:
  - alt: `const cfg = { ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: 5 };`
  - neu: `const cfg = { ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: 5 };`
- Zeile 62:
  - alt: `test('Lager < 5 oder unbekannt → nicht wählbar (Gray/Red wären sonst unter den besten 5)', () => {`
  - neu: `test('Lager < 5 oder unbekannt → nicht wählbar (Yellow/Red wären sonst unter den besten 5)', () => {`
- Zeile 66:
  - alt: `expect(base.kept).toContain('Gray');`
  - neu: `expect(base.kept).toContain('Yellow');`
- Zeile 68:
  - alt: `const vp = vp213.map(x => (x.attrs.Color === 'Gray' ? { ...x, stock: 4 } : x.attrs.Color === 'Red' ? { ...x, stock: undefined as unknown as number } : x));`
  - neu: `const vp = vp213.map(x => (x.attrs.Color === 'Yellow' ? { ...x, stock: 4 } : x.attrs.Color === 'Red' ? { ...x, stock: undefined as unknown as number } : x));`
- Zeile 70:
  - alt: `expect(r.kept).not.toContain('Gray');`
  - neu: `expect(r.kept).not.toContain('Yellow');`

## `src/shared/auto-lower.test.ts`

- Zeile 30:
  - alt: `[119, [[PCS100, 16.95, 16.45, 1.76, 1.37]]],`
  - alt: `[228, [[PINK, 21.95, 21.45, 1.65, 1.29]]],`
  - neu: `[119, [[PCS100, 16.95, 16.45, 1.58, 1.19]]],`
  - neu: `[228, [[PINK, 21.95, 21.45, 1.47, 1.11]]],`
- Zeile 63:
  - alt: `expect(multiRabattPerPieceProblem(p228, 5.79, 21.45, attrs, { 2: 36, 3: 37 })).toContain('nur 0.90 € je Stück');`
  - neu: `expect(multiRabattPerPieceProblem(p228, 5.79, 21.45, attrs, { 2: 36, 3: 37 })).toContain('nur 0.81 € je Stück'); // AUFSICHT 045 A: vorher 0.90 (Fix 0,30)`

## `src/shared/electric.test.ts`

- Zeile 120:
  - alt: `buyPrice: 6.00, isChinaOrigin: true, ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,`
  - neu: `buyPrice: 6.00, isChinaOrigin: true, ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,`
- Zeile 130:
  - alt: `expect(r.rawMinSellPrice).toBeCloseTo(19.415999330338458, 9);`
  - alt: `expect(r.minSellPrice).toBe(18.95);`
  - neu: `expect(r.rawMinSellPrice).toBeCloseTo(19.665029716230926, 9);`
  - neu: `expect(r.minSellPrice).toBe(19.45);`
- Zeile 139:
  - alt: `expect(r.rawMinSellPrice).toBeCloseTo(21.50869164876252, 9);`
  - neu: `expect(r.rawMinSellPrice).toBeCloseTo(21.75772203465499, 9);`
- Zeile 143:
  - alt: `const p = { sellPrice: 21.45, buyPrice: 6, isChinaOrigin: true, ebayFeeRatePercent: base.ebayFeeRatePercent, ebayFixedFeeEur: base.ebayFixedFeeEur, vatFactor: base.vatFactor, adRatePercent: 5 };`
  - alt: `expect(profitAtSellPrice({ ...p, earUmlageEur: 1.5 })).toBeCloseTo(1.9579, 4);`
  - alt: `expect(profitAtSellPrice(p)).toBeCloseTo(3.4579, 4); // ohne Umlage unverändert`
  - alt: `expect(profitAtSellPrice({ ...p, sellPrice: 18.95, earUmlageEur: 1.5 })).toBeCloseTo(0.166, 4);`
  - neu: `const p = { sellPrice: 21.45, buyPrice: 6, isChinaOrigin: true, ebayFeeRatePercent: base.ebayFeeRatePercent, vatFactor: base.vatFactor, adRatePercent: 5 };`
  - neu: `expect(profitAtSellPrice({ ...p, earUmlageEur: 1.5 })).toBeCloseTo(1.7794, 4);`
  - neu: `expect(profitAtSellPrice(p)).toBeCloseTo(3.2794, 4); // ohne Umlage unverändert`
  - neu: `expect(profitAtSellPrice({ ...p, sellPrice: 18.95, earUmlageEur: 1.5 })).toBeCloseTo(-0.0125, 4);`

## `src/shared/k004-formel-v2.test.ts`

- Zeile 12:
  - alt: `const fees = { ebayFeeRatePercent: C.ebayFeeRatePercent, ebayFixedFeeEur: C.ebayFixedFeeEur, vatFactor: C.vatFactor };`
  - neu: `const fees = { ebayFeeRatePercent: C.ebayFeeRatePercent, vatFactor: C.vatFactor };`
- Zeile 19:
  - alt: `[13.95, 3.15, 1.56], [14.95, 4.79, 0.68], [14.95, 3.59, 1.88], [13.95, 2.45, 2.26], [17.95, 5.99, 1.77],`
  - neu: `[13.95, 3.15, 1.38], [14.95, 4.79, 0.51], [14.95, 3.59, 1.71], [13.95, 2.45, 2.08], [17.95, 5.99, 1.59],`
- Zeile 38:
  - alt: `expect(minSell(3.15, 1.5, 1)).toBe(13.45);       // Kalkulator-Beispiel (Standort DE) → s = 1`
  - alt: `expect(profitChina5(13.45, 3.15, 1)).toBeCloseTo(1.18, 2);`
  - neu: `expect(minSell(3.15, 1.5, 1)).toBe(13.95);       // Kalkulator-Beispiel (Standort DE) → s = 1`
  - neu: `expect(profitChina5(13.45, 3.15, 1)).toBeCloseTo(1.00, 2);`
- Zeile 111:
  - alt: `expect(r.nettoErgebnis).toBe(0.68);`
  - neu: `expect(r.nettoErgebnis).toBe(0.51);`
- Zeile 137:
  - alt: `expect(with5.profit).toBe(0.68);`
  - neu: `expect(with5.profit).toBe(0.51);`
- Zeile 139:
  - alt: `expect(with0.profit).toBe(1.57);`
  - alt: `expect(computeOrderProfit(14.95, 10.35, undefined, false).profit).toBe(0.68); // weggelassen → Default 5 %`
  - neu: `expect(with0.profit).toBe(1.4);`
  - neu: `expect(computeOrderProfit(14.95, 10.35, undefined, false).profit).toBe(0.51); // weggelassen → Default 5 %`
- Zeile 166:
  - alt: `const base = { currentSellPrice: 15.95, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.3, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2 };`
  - neu: `const base = { currentSellPrice: 15.95, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2 };`

## `src/shared/k005-faktor.test.ts`

- Zeile 95:
  - alt: `buyPrice, isChinaOrigin, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent, targetMarginEur,`
  - neu: `buyPrice, isChinaOrigin, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent, targetMarginEur,`
- Zeile 101:
  - alt: `[12.19, true, 5, 1.00, 0.9508, 11.59, 23.95, 23.45, -1.817239, -1.217239],`
  - alt: `[13.79, false, 5, 2.00, 0.913, 12.59, 20.95, 19.45, 1.0549, 2.2549],`
  - alt: `[9.50, true, 0, 1.50, 0.8, 7.60, 21.45, 18.95, 0.295321, 2.195321],`
  - neu: `[12.19, true, 5, 1.00, 0.9508, 11.59, 24.45, 23.45, -1.995739, -1.395739],`
  - neu: `[13.79, false, 5, 2.00, 0.913, 12.59, 20.95, 19.45, 0.8764, 2.0764],`
  - neu: `[9.50, true, 0, 1.50, 0.8, 7.60, 21.45, 18.95, 0.116821, 2.016821],`
- Zeile 113:
  - alt: `const pIn = { sellPrice: 19.95, isChinaOrigin: china, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: ad };`
  - neu: `const pIn = { sellPrice: 19.95, isChinaOrigin: china, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: ad };`
- Zeile 123:
  - alt: `test('evaluatePriceAlarm reicht den Faktor durch (19,95 €, Ziel 1,00: −1,82 → Alarm; mit 0,9508: bun −1,217239 → Alarm; mit 0,6: Ware 7,31 → Gewinn bun 1,072761 → kein Alarm)', () => {`
  - alt: `const a = { currentSellPrice: 19.95, variants: [{ buyPrice: 12.19 }], isChinaOrigin: true, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 1.00 };`
  - neu: `test('evaluatePriceAlarm reicht den Faktor durch (19,95 €, Ziel 1,00: −2,00 → Alarm; mit 0,9508: bun −1,395739 → Alarm; mit 0,55: Ware 6,70 → Gewinn bun 1,504261 → kein Alarm)', () => {`
  - neu: `const a = { currentSellPrice: 19.95, variants: [{ buyPrice: 12.19 }], isChinaOrigin: true, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 1.00 };`
- Zeile 127:
  - alt: `expect(evaluatePriceAlarm({ ...a, checkoutFactor: 0.9508 }).worstProfit).toBeCloseTo(-1.217239, 6);`
  - alt: `const r = evaluatePriceAlarm({ ...a, checkoutFactor: 0.6 });`
  - alt: `expect(r.worstProfit).toBeCloseTo(1.072761, 6);`
  - neu: `expect(evaluatePriceAlarm({ ...a, checkoutFactor: 0.9508 }).worstProfit).toBeCloseTo(-1.395739, 6);`
  - neu: `const r = evaluatePriceAlarm({ ...a, checkoutFactor: 0.55 });`
  - neu: `expect(r.worstProfit).toBeCloseTo(1.504261, 6);`
- Zeile 149:
  - alt: `expect(r.nettoErgebnis).toBe(2.89);`
  - neu: `expect(r.nettoErgebnis).toBe(2.72);`
- Zeile 154:
  - alt: `expect(r.nettoErgebnis).toBe(3.49);`
  - neu: `expect(r.nettoErgebnis).toBe(3.32);`
- Zeile 158:
  - alt: `expect(run(product(0.9508, new Date(Date.now() - 15 * DAY).toISOString())).nettoErgebnis).toBe(2.89);`
  - neu: `expect(run(product(0.9508, new Date(Date.now() - 15 * DAY).toISOString())).nettoErgebnis).toBe(2.72);`
- Zeile 240:
  - alt: `ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: 5, targetMarginEur: 1 };`
  - neu: `vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: 5, targetMarginEur: 1 };`
- Zeile 245:
  - alt: `expect(a.worstProfit).toBeCloseTo(0.3363, 4);`
  - alt: `expect(a.worstProfitWithoutFactor).toBeCloseTo(-0.3837, 4);`
  - neu: `expect(a.worstProfit).toBeCloseTo(0.1578, 4);`
  - neu: `expect(a.worstProfitWithoutFactor).toBeCloseTo(-0.5622, 4);`
- Zeile 253:
  - alt: `expect(n.worstProfitWithoutFactor).toBeCloseTo(-0.3837, 4);`
  - neu: `expect(n.worstProfitWithoutFactor).toBeCloseTo(-0.5622, 4);`
- Zeile 258:
  - alt: `expect(rows[0].profit).toBeCloseTo(0.3363, 4);`
  - alt: `expect(rows[0].profitWithoutFactor).toBeCloseTo(-0.3837, 4);`
  - neu: `expect(rows[0].profit).toBeCloseTo(0.1578, 4);`
  - neu: `expect(rows[0].profitWithoutFactor).toBeCloseTo(-0.5622, 4);`

## `src/shared/k005.test.ts`

- Zeile 28:
  - alt: `expect(row.newProfit).toBeCloseTo(1.39, 2); // 1,388175`
  - neu: `expect(row.newProfit).toBeCloseTo(1.21, 2); // 1,388175`
- Zeile 36:
  - alt: `expect(r.nettoErgebnis).toBe(3.44);`
  - alt: `expect(Math.abs((r.nettoErgebnis as number) - 3.50)).toBeLessThanOrEqual(0.10);`
  - neu: `expect(r.nettoErgebnis).toBe(3.26);`
  - neu: `expect(Math.round((3.50 - (r.nettoErgebnis as number)) * 100) / 100).toBe(0.24);`
- Zeile 46:
  - alt: `expect(r.nettoErgebnis).toBe(2.25);`
  - neu: `expect(r.nettoErgebnis).toBe(2.08);`
- Zeile 119:
  - alt: `['j', 19.95, 3.44, 1.94, 17.45, 1.39, 18.95, true],`
  - alt: `['v', 16.95, 2.98, 1.48, 14.95, 1.33, 15.95, true],`
  - neu: `['j', 19.95, 3.26, 1.76, 17.45, 1.21, 18.95, true],`
  - neu: `['v', 16.95, 2.8, 1.3, 14.95, 1.16, 15.95, true],`

## `src/shared/k006.test.ts`

- Zeile 9:
  - alt: `const fees = { ebayFeeRatePercent: C.ebayFeeRatePercent, ebayFixedFeeEur: C.ebayFixedFeeEur, vatFactor: C.vatFactor };`
  - neu: `const fees = { ebayFeeRatePercent: C.ebayFeeRatePercent, vatFactor: C.vatFactor };`
- Zeile 31:
  - alt: `expect(profit(20.45, 11.59, 0, true, 1)).toBeCloseTo(1.28, 2);   // 20,45×0,8215 − 0,357 − 15,16 = 1,283`
  - alt: `expect(profit(19.95, 11.59, 0, true, 1)).toBeCloseTo(0.87, 2);`
  - neu: `expect(profit(20.45, 11.59, 0, true, 1)).toBeCloseTo(1.10, 2);   // 20,45×0,8215 − 0,357 − 15,16 = 1,283`
  - neu: `expect(profit(19.95, 11.59, 0, true, 1)).toBeCloseTo(0.69, 2);`
- Zeile 35:
  - alt: `expect(profit(20.95, 12.29, 0, true, 1)).toBeCloseTo(0.99, 2);   // 1 Cent unter 1,00 → nicht erlaubt`
  - neu: `expect(profit(20.95, 12.29, 0, true, 1)).toBeCloseTo(0.81, 2);   // 1 Cent unter 1,00 → nicht erlaubt`
- Zeile 37:
  - alt: `expect(profit(21.45, 12.29, 0, true, 1)).toBeCloseTo(1.40, 2);   // 21,45×0,8215 − 0,357 − 15,86 = 1,404`
  - neu: `expect(profit(21.45, 12.29, 0, true, 1)).toBeCloseTo(1.23, 2);   // 21,45×0,8215 − 0,357 − 15,86 = 1,404`
- Zeile 40:
  - alt: `expect(sell(3.15, 1.5, 5, true, 1)).toBe(13.45);`
  - alt: `expect(profit(13.45, 3.15, 5, true, 1)).toBeCloseTo(1.18, 2);    // 13,45×0,762 − 0,357 − 8,71 = 1,1819`
  - neu: `expect(sell(3.15, 1.5, 5, true, 1)).toBe(13.95);`
  - neu: `expect(profit(13.45, 3.15, 5, true, 1)).toBeCloseTo(1.00, 2);    // 13,45×0,762 − 0,357 − 8,71 = 1,1819`
- Zeile 66:
  - alt: `describe('K-006 Toleranzband (Stufe B: Boden 1,20, erlaubt ab 1,10) – Ware 3,29 China 5 %: VK 14,45 = Gewinn 1,1505', () => {`
  - neu: `describe('K-006 Toleranzband (Stufe B: Boden 1,20, erlaubt ab 1,10) – Ware 3,15 China 5 %: VK 14,45 = Gewinn 1,1120', () => {`
- Zeile 71:
  - alt: `test('Preisalarm: 14,45 (1,1505) kein Alarm; 13,95 (0,7921) Alarm', () => {`
  - alt: `expect(evaluatePriceAlarm({ ...base, currentSellPrice: 14.45, variants: [{ buyPrice: 3.29 }] }).isAlarm).toBe(false);`
  - alt: `expect(evaluatePriceAlarm({ ...base, currentSellPrice: 13.95, variants: [{ buyPrice: 3.29 }] }).isAlarm).toBe(true);`
  - neu: `test('Preisalarm: 14,45 (1,1120) kein Alarm; 13,95 (0,7536) Alarm', () => {`
  - neu: `expect(evaluatePriceAlarm({ ...base, currentSellPrice: 14.45, variants: [{ buyPrice: 3.15 }] }).isAlarm).toBe(false);`
  - neu: `expect(evaluatePriceAlarm({ ...base, currentSellPrice: 13.95, variants: [{ buyPrice: 3.15 }] }).isAlarm).toBe(true);`
- Zeile 76:
  - alt: `expect(evaluateVariantRule6c({ ...base, variants: [{ skuId: 'x', buyPrice: 3.29, currentSellPrice: 14.45 }] })[0].action).toBe('keep');`
  - neu: `expect(evaluateVariantRule6c({ ...base, variants: [{ skuId: 'x', buyPrice: 3.15, currentSellPrice: 14.45 }] })[0].action).toBe('keep');`
- Zeile 78:
  - alt: `test('Varianten-Anhebung: Variante mit eigenem VK 14,45 (1,1505) wird NICHT angehoben', () => {`
  - neu: `test('Varianten-Anhebung: Variante mit eigenem VK 14,45 (1,1120) wird NICHT angehoben', () => {`
- Zeile 80:
  - alt: `id: 1, variants: JSON.stringify([{ name: 'M', values: ['a', 'b'] }]), buyPrice: 3.29, sellPrice: 14.45, shipsFrom: 'China', adRate: 5, targetMarginEur: 1.5,`
  - neu: `id: 1, variants: JSON.stringify([{ name: 'M', values: ['a', 'b'] }]), buyPrice: 3.15, sellPrice: 14.45, shipsFrom: 'China', adRate: 5, targetMarginEur: 1.5,`
- Zeile 82:
  - alt: `variantPrices: JSON.stringify([{ skuId: 'a', attrs: { M: 'a' }, price: 3.29 }, { skuId: 'b', attrs: { M: 'b' }, price: 3.29 }]),`
  - neu: `variantPrices: JSON.stringify([{ skuId: 'a', attrs: { M: 'a' }, price: 3.15 }, { skuId: 'b', attrs: { M: 'b' }, price: 3.15 }]),`

## `src/shared/k008-preis-halten.test.ts`

- Zeile 30:
  - alt: `test('ohne Halten: GRAY 20,95 (Gewinn 0,9829 < Boden 1,00) → Anheben auf 21,45 (Verhalten unverändert)', () => {`
  - alt: `const r = planVariantRaises(p220(11.59));`
  - neu: `test('ohne Halten: GRAY 20,95 (Gewinn 0,9844 < Boden 1,00) → Anheben auf 21,45 (Verhalten unverändert)', () => {`
  - neu: `const r = planVariantRaises(p220(11.41));`
- Zeile 33:
  - alt: `expect(r[0].oldProfit).toBeCloseTo(0.9829, 4);`
  - neu: `expect(r[0].oldProfit).toBeCloseTo(0.9844, 4);`
- Zeile 36:
  - alt: `const h = resolvePriceHolds(p220(11.59), holdGray);`
  - neu: `const h = resolvePriceHolds(p220(11.41), holdGray);`
- Zeile 39:
  - alt: `expect(h.rows[0].profit).toBeCloseTo(0.9829, 4);`
  - alt: `expect(planVariantRaises(p220(11.59), h.heldKeys)).toEqual([]);`
  - neu: `expect(h.rows[0].profit).toBeCloseTo(0.9844, 4);`
  - neu: `expect(planVariantRaises(p220(11.41), h.heldKeys)).toEqual([]);`
- Zeile 42:
  - alt: `test('Sicherheitsnetz: Ware 11,72 → Gewinn 0,8529 < 0,90 → Halten aufheben, Anheben auf 21,45', () => {`
  - alt: `const h = resolvePriceHolds(p220(11.72), holdGray);`
  - neu: `test('Sicherheitsnetz: Ware 11,54 → Gewinn 0,8544 < 0,90 → Halten aufheben, Anheben auf 21,45', () => {`
  - neu: `const h = resolvePriceHolds(p220(11.54), holdGray);`
- Zeile 46:
  - alt: `expect(h.rows[0].profit).toBeCloseTo(0.8529, 4);`
  - alt: `expect(planVariantRaises(p220(11.72), h.heldKeys).map(x => [x.skuId, x.newSell])).toEqual([['g', 21.45]]);`
  - neu: `expect(h.rows[0].profit).toBeCloseTo(0.8544, 4);`
  - neu: `expect(planVariantRaises(p220(11.54), h.heldKeys).map(x => [x.skuId, x.newSell])).toEqual([['g', 21.45]]);`
- Zeile 51:
  - alt: `const h = resolvePriceHolds(p220(11.59, 21.45), holdGray);`
  - neu: `const h = resolvePriceHolds(p220(11.41, 21.45), holdGray);`
- Zeile 58:
  - alt: `const out = await runVariantRaise(p220(11.59), {`
  - neu: `const out = await runVariantRaise(p220(11.41), {`
- Zeile 66:
  - alt: `test('Einzelartikel: Ware 11,59, VK 20,95, adRate 0 → gehalten (alles gehalten)', () => {`
  - alt: `const single = { id: 5, variants: null, targetMarginEur: 1, shipsFrom: 'China', adRate: 0, sellPrice: 20.95, buyPrice: 11.59, variantPrices: null };`
  - neu: `test('Einzelartikel: Ware 11,41, VK 20,95, adRate 0 → gehalten (alles gehalten)', () => {`
  - neu: `const single = { id: 5, variants: null, targetMarginEur: 1, shipsFrom: 'China', adRate: 0, sellPrice: 20.95, buyPrice: 11.41, variantPrices: null };`
- Zeile 73:
  - alt: `expect(resolvePriceHolds(p220(11.59), holdGray).allHeld).toBe(false);`
  - neu: `expect(resolvePriceHolds(p220(11.41), holdGray).allHeld).toBe(false);`

## `src/shared/k009-anzeige-0.test.ts`

- Zeile 35:
  - alt: `test('Bestellung 19-15281-36243 (BLACK 20,95, Einkauf 15,14): adRate 0 → Gebühr 4,10, Gewinn 1,71', () => {`
  - alt: `expect(order(0)).toMatchObject({ nettoGebuehren: 4.1, nettoErgebnis: 1.71 });`
  - neu: `test('Bestellung 19-15281-36243 (BLACK 20,95, Einkauf 15,14): adRate 0 → Gebühr 4,28 (echt 4,10 mit Fix 0,30), Gewinn 1,53', () => {`
  - neu: `expect(order(0)).toMatchObject({ nettoGebuehren: 4.28, nettoErgebnis: 1.53 });`
- Zeile 40:
  - alt: `test('mit adRate 5 (bisheriger App-Stand) → Gebühr 5,34, Gewinn 0,47 (der gemeldete Fehlwert)', () => {`
  - alt: `expect(order(5)).toMatchObject({ nettoGebuehren: 5.34, nettoErgebnis: 0.47 });`
  - neu: `test('mit adRate 5 (bisheriger App-Stand) → Gebühr 5,52, Gewinn 0,29 (vorher 5,34 / 0,47 mit Fix 0,30)', () => {`
  - neu: `expect(order(5)).toMatchObject({ nettoGebuehren: 5.52, nettoErgebnis: 0.29 });`
- Zeile 59:
  - alt: `expect(planVariantRaises(p220(5)).map(r => [r.skuId, r.newSell])).toEqual([['g', 23.45], ['b', 24.45], ['k', 23.45]]);`
  - neu: `expect(planVariantRaises(p220(5)).map(r => [r.skuId, r.newSell])).toEqual([['g', 23.45], ['b', 24.95], ['k', 23.45]]);`

## `src/shared/k014-gelistete-varianten.test.ts`

- Zeile 60:
  - alt: `expect(worst).toBeCloseTo(1.585661, 6);`
  - alt: `expect(Math.min(...r.rows.map(x => x.profitWithoutFactor ?? x.profit))).toBeCloseTo(1.275661, 6);`
  - alt: `expect(evaluateTargetDisplay(1.5, worst).expectedEur).toBe(1.59);`
  - neu: `expect(worst).toBeCloseTo(1.407161, 6);`
  - neu: `expect(Math.min(...r.rows.map(x => x.profitWithoutFactor ?? x.profit))).toBeCloseTo(1.097161, 6);`
  - neu: `expect(evaluateTargetDisplay(1.5, worst).expectedEur).toBe(1.41);`
- Zeile 71:
  - alt: `expect(r.rows[0].profit).toBeCloseTo(19.95 - (4.39 + 1.99 + 5.95) - (19.95 * 0.2 * 1.19 * 1.19 + 0.3 * 1.19), 9); // S 1,19 auf den Prozent-Anteil`
  - neu: `expect(r.rows[0].profit).toBeCloseTo(19.95 - (4.39 + 1.99 + 5.95) - (19.95 * 0.2 * 1.19 * 1.19 + 0.45 * 1.19), 9); // AUFSICHT 045 A: Fix 0,45 (Bestellwert > 10 €) // S 1,19 auf den Prozent-Anteil`
- Zeile 79:
  - alt: `expect(d.expectedEur).toBe(1.45);`
  - neu: `expect(d.expectedEur).toBe(1.28);`

## `src/shared/kaeuferpreis-heben.test.ts`

- Zeile 33:
  - alt: `const row162 = (o: Partial<RaiseBuyerInputRow> = {}): RaiseBuyerInputRow => ({ skuId: SKU162, sku: 'stele-162-10', label: '10', buyerPrice: 15.45, offerPrice: 16.45, targetVk: t162, ...o });`
  - neu: `const row162 = (o: Partial<RaiseBuyerInputRow> = {}): RaiseBuyerInputRow => ({ skuId: SKU162, sku: 'stele-162-10', label: '10', buyerPrice: 15.45, offerPrice: 16.45, targetVk: 16.45, ...o });`
- Zeile 40:
  - alt: `test('stele-162 "10" EK 2,35 → 16,45 € = Angebotsdaten', () => { expect(t162).toBe(16.45); });`
  - neu: `test('stele-162 "10" EK 2,35 → 16,95 € (045 A: vorher 16,45 = Angebotsdaten, jetzt ≠)', () => { expect(t162).toBe(16.95); });`
- Zeile 42:
  - alt: `test('Stufe A (1,00) ergibt denselben Zielpreis, Stufe C (2,00) nicht (17,45 / 17,95)', () => {`
  - alt: `expect(target(mk(162, SKU162, 2.35, '10', 1.0), SKU162)).toBe(16.45);`
  - neu: `test('Stufe A (1,00) ergibt denselben Zielpreis, Stufe C (2,00) nicht (17,45 / 18,45)', () => {`
  - neu: `expect(target(mk(162, SKU162, 2.35, '10', 1.0), SKU162)).toBe(16.95);`
- Zeile 45:
  - alt: `expect(target(mk(208, SKU208, 2.89, 'SILVER', 2.0), SKU208)).toBe(17.95);`
  - neu: `expect(target(mk(208, SKU208, 2.89, 'SILVER', 2.0), SKU208)).toBe(18.45);`
- Zeile 50:
  - alt: `const plan = planBuyerPriceRaise([row162(), row208()]);`
  - alt: `test('beide werden gehoben: 15,45 → 16,45 (+6,47 %), 16,95 → 17,45 (+2,95 %)', () => {`
  - alt: `expect(plan.raiseCount).toBe(2);`
  - alt: `expect(plan.skipCount).toBe(0);`
  - alt: `expect(plan.actions.map(a => [a.status, a.to, a.jumpPct])).toEqual([['heben', 16.45, 6.47], ['heben', 17.45, 2.95]]);`
  - neu: `const plan = planBuyerPriceRaise([row162({ targetVk: t162 }), row208()]);`
  - neu: `test('echte Werte nach 045 A: 162 übersprungen (ziel_abweichend, Ziel 16,95 ≠ 16,45), 208 gehoben 16,95 → 17,45 (+2,95 %)', () => {`
  - neu: `expect(plan.raiseCount).toBe(1);`
  - neu: `expect(plan.skipCount).toBe(1);`
  - neu: `expect(plan.actions.map(a => [a.status, a.to, a.jumpPct])).toEqual([['uebersprungen', null, 6.47], ['heben', 17.45, 2.95]]);`
  - neu: `expect(plan.actions[0].code).toBe('ziel_abweichend');`
- Zeile 59:
  - alt: `expect(expectedFromRaisePlan(plan.actions)).toEqual({ 'stele-162-10': 16.45, 'stele-208-SILVER': 17.45 });`
  - neu: `expect(expectedFromRaisePlan(plan.actions)).toEqual({ 'stele-208-SILVER': 17.45 }); // 045 A: 162 nicht mehr enthalten`

## `src/shared/margin-display.test.ts`

- Zeile 17:
  - alt: `expect(m.profitEur).toBeCloseTo(-1.8799, 4);`
  - neu: `expect(m.profitEur).toBeCloseTo(-2.0584, 4);`
- Zeile 19:
  - alt: `expect(formatMarginDisplay(m)).toBe('−1,88 € (−16,4 %)');`
  - neu: `expect(formatMarginDisplay(m)).toBe('−2,06 € (−18,0 %)'); // AUFSICHT 045 A: vorher −1,88 € (−16,4 %) mit Fix 0,30`
- Zeile 24:
  - alt: `expect(m.profitEur).toBeCloseTo(1.2856, 4);`
  - neu: `expect(m.profitEur).toBeCloseTo(1.1071, 4);`
- Zeile 30:
  - alt: `expect(a5.profitEur).toBeCloseTo(1.496, 4);`
  - neu: `expect(a5.profitEur).toBeCloseTo(1.3175, 4);`

## `src/shared/offered-profit.test.ts`

- Zeile 27:
  - alt: `variantSellPrices: JSON.stringify({ '12000056068050014': 25.45, '12000056068050015': 23.95 }), // Testwerte`
  - neu: `variantSellPrices: JSON.stringify({ '12000056068050014': 25.95, '12000056068050015': 23.95 }), // Testwerte`
- Zeile 43:
  - alt: `test('stele-234: nur Brown zählt (1,16 €), GRAY/green "nicht bei eBay", 0 unter 1,00 €, kein Alarm', () => {`
  - neu: `test('stele-234: nur Brown zählt (1,33 €), GRAY/green "nicht bei eBay", 0 unter 1,00 €, kein Alarm', () => {`
- Zeile 47:
  - alt: `expect(s.counted[0].profit).toBeCloseTo(1.155051, 6);`
  - neu: `expect(s.counted[0].profit).toBeCloseTo(1.334941, 6);`
- Zeile 57:
  - alt: `test('stele-235: nur Orange 5PCS zählt (1,34 €), 10PCS/3PCS "nicht bei eBay", 0 unter 1,00 €, kein Alarm', () => {`
  - neu: `test('stele-235: nur Orange 5PCS zählt (1,16 €), 10PCS/3PCS "nicht bei eBay", 0 unter 1,00 €, kein Alarm', () => {`
- Zeile 60:
  - alt: `expect(s.counted[0].profit).toBeCloseTo(1.337591, 6);`
  - neu: `expect(s.counted[0].profit).toBeCloseTo(1.159091, 6);`
- Zeile 71:
  - alt: `expect(alt234.profitEur).toBeCloseTo(-0.020119, 6);`
  - alt: `expect(alt235.profitEur).toBeCloseTo(-0.162409, 6);`
  - neu: `expect(alt234.profitEur).toBeCloseTo(-0.198619, 6);`
  - neu: `expect(alt235.profitEur).toBeCloseTo(-0.340909, 6);`
- Zeile 78:
  - alt: `const s = offeredProfitSummary({ ...p234, variantSellPrices: JSON.stringify({ '12000056068050014': 23.95 }) }); // Testwert Brown 23,95`
  - neu: `const s = offeredProfitSummary({ ...p234, variantSellPrices: JSON.stringify({ '12000056068050014': 24.45 }) }); // Testwert Brown 24,45 (045 A: vorher 23,95, läge jetzt bei −0,2771 = 'loss' statt 'thin')`
- Zeile 80:
  - alt: `expect(s.belowOne[0].profit).toBeCloseTo(0.079881, 6);`
  - neu: `expect(s.belowOne[0].profit).toBeCloseTo(0.259771, 6);`

## `src/shared/p-einfuhr.test.ts`

- Zeile 75:
  - alt: `['Multicolour 100pcs', 13.95, 17.95],`
  - neu: `['Multicolour 100pcs', 13.95, 18.45],`
- Zeile 77:
  - alt: `['White 500pcs', 20.95, 25.45],`
  - alt: `['Multicolour 500pcs', 20.95, 25.95],`
  - neu: `['White 500pcs', 20.95, 25.95],`
  - neu: `['Multicolour 500pcs', 20.95, 26.45],`
- Zeile 83:
  - alt: `expect(planVariantRaises(p127 as never)[0].oldProfit).toBeCloseTo(-1.7879, 4); // Formel je Standort (S 1,19); vorher −1,1571 (Befund Nachrichten: −1,17)`
  - neu: `expect(planVariantRaises(p127 as never)[0].oldProfit).toBeCloseTo(-1.9664, 4); // Formel je Standort (S 1,19); vorher −1,1571 (Befund Nachrichten: −1,17)`

## `src/shared/plan7-alte-formel.test.ts`

- Zeile 42:
  - alt: `const p = profitAtSellPrice({ sellPrice: CN.vk, buyPrice: CN.ware, isChinaOrigin: true, ebayFeeRatePercent: C.ebayFeeRatePercent, ebayFixedFeeEur: C.ebayFixedFeeEur, vatFactor: C.vatFactor, adRatePercent: CN.ad });`
  - alt: `expect(p).toBeCloseTo(0.692761, 9);`
  - neu: `const p = profitAtSellPrice({ sellPrice: CN.vk, buyPrice: CN.ware, isChinaOrigin: true, ebayFeeRatePercent: C.ebayFeeRatePercent, vatFactor: C.vatFactor, adRatePercent: CN.ad });`
  - neu: `expect(p).toBeCloseTo(0.514261, 9);`
- Zeile 46:
  - alt: `expect(computeOrderProfitRaw(CN.vk, 13.25, CN.ad, true).feesDeducted).toBeCloseTo(6.007239, 9);`
  - neu: `expect(computeOrderProfitRaw(CN.vk, 13.25, CN.ad, true).feesDeducted).toBeCloseTo(6.185739, 9);`
- Zeile 49:
  - alt: `const p = profitAtSellPrice({ sellPrice: DE.vk, buyPrice: DE.ware, isChinaOrigin: false, ebayFeeRatePercent: C.ebayFeeRatePercent, ebayFixedFeeEur: C.ebayFixedFeeEur, vatFactor: C.vatFactor, adRatePercent: DE.ad });`
  - alt: `expect(p).toBeCloseTo(4.187425, 9);`
  - alt: `expect(computeOrderProfit(DE.vk, DE.ware, DE.ad, false)).toEqual({ profit: 4.19, feesDeducted: 3.38 });`
  - neu: `const p = profitAtSellPrice({ sellPrice: DE.vk, buyPrice: DE.ware, isChinaOrigin: false, ebayFeeRatePercent: C.ebayFeeRatePercent, vatFactor: C.vatFactor, adRatePercent: DE.ad });`
  - neu: `expect(p).toBeCloseTo(4.008925, 9);`
  - neu: `expect(computeOrderProfit(DE.vk, DE.ware, DE.ad, false)).toEqual({ profit: 4.01, feesDeducted: 3.56 });`
- Zeile 62:
  - alt: `expect(run(cnProduct, CN.vk, NACH)).toMatchObject({ nettoErgebnis: 0.69, nettoGebuehren: 6.01, nettoQuelle: 'automatisch' });`
  - neu: `expect(run(cnProduct, CN.vk, NACH)).toMatchObject({ nettoErgebnis: 0.51, nettoGebuehren: 6.19, nettoQuelle: 'automatisch' });`
- Zeile 66:
  - alt: `expect(run(cnProduct, CN.vk).nettoErgebnis).toBe(0.69);`
  - neu: `expect(run(cnProduct, CN.vk).nettoErgebnis).toBe(0.51);`
- Zeile 69:
  - alt: `expect(run(cnProduct, CN.vk, VOR)).toMatchObject({ nettoErgebnis: 1.59, nettoGebuehren: 5.11 });`
  - neu: `expect(run(cnProduct, CN.vk, VOR)).toMatchObject({ nettoErgebnis: 1.42, nettoGebuehren: 5.28 });`
- Zeile 72:
  - alt: `expect(run(deProduct, DE.vk, NACH)).toMatchObject({ nettoErgebnis: 4.19, nettoGebuehren: 3.38 });`
  - neu: `expect(run(deProduct, DE.vk, NACH)).toMatchObject({ nettoErgebnis: 4.01, nettoGebuehren: 3.56 });`
- Zeile 76:
  - alt: `expect(r).toMatchObject({ nettoErgebnis: 0.69, nettoQuelle: 'manuell' });`
  - neu: `expect(r).toMatchObject({ nettoErgebnis: 0.51, nettoQuelle: 'manuell' });`
- Zeile 116:
  - alt: `expect(profitAt(NACH)).toBeCloseTo(0.692761, 9);`
  - alt: `expect(profitAt(VOR)).toBeCloseTo(1.5949, 9);`
  - neu: `expect(profitAt(NACH)).toBeCloseTo(0.514261, 9);`
  - neu: `expect(profitAt(VOR)).toBeCloseTo(1.4164, 9);`

## `src/shared/price-report-v2.test.ts`

- Zeile 33:
  - alt: `expect(rows.map(r => [r.variantLabel, r.newSell])).toEqual([['100PCS', 14.95], ['200PCS', 17.45]]);`
  - alt: `expect(rows.map(r => r.deltaSell)).toEqual([3, 2.5]);`
  - neu: `expect(rows.map(r => [r.variantLabel, r.newSell])).toEqual([['100PCS', 15.45], ['200PCS', 17.95]]);`
  - neu: `expect(rows.map(r => r.deltaSell)).toEqual([3.5, 3]); // AUFSICHT 045 A: vorher [3, 2.5]`
- Zeile 38:
  - alt: `expect(rows[0].oldProfitV1).toBeCloseTo(1.5989, 4);`
  - alt: `expect(rows[1].oldProfitV1).toBeCloseTo(2.2449, 4);`
  - neu: `expect(rows[0].oldProfitV1).toBeCloseTo(1.4204, 4);`
  - neu: `expect(rows[1].oldProfitV1).toBeCloseTo(2.0664, 4);`
- Zeile 43:
  - alt: `expect(rows[0].profitNowV2).toBeCloseTo(-0.5015, 4);`
  - alt: `expect(rows[1].profitNowV2).toBeCloseTo(0.0089, 4);`
  - neu: `expect(rows[0].profitNowV2).toBeCloseTo(-0.6800, 4);`
  - neu: `expect(rows[1].profitNowV2).toBeCloseTo(-0.1696, 4);`
- Zeile 46:
  - alt: `expect(rows[0].newProfitV2).toBeCloseTo(1.6489, 4); // 14,95 × 0,71678 − 0,357 − 8,71`
  - alt: `expect(rows[1].newProfitV2).toBeCloseTo(1.8008, 4); // 17,45 × 0,71678 − 0,357 − 10,35`
  - neu: `expect(rows[0].newProfitV2).toBeCloseTo(1.8288, 4); // 14,95 × 0,71678 − 0,357 − 8,71`
  - neu: `expect(rows[1].newProfitV2).toBeCloseTo(1.9807, 4); // 17,45 × 0,71678 − 0,357 − 10,35`
- Zeile 65:
  - alt: `expect(rows[0].newProfitV2).toBeCloseTo(4.4654, 4);`
  - neu: `expect(rows[0].newProfitV2).toBeCloseTo(4.2869, 4);`
- Zeile 70:
  - alt: `expect(rows[0].oldProfitV1).toBeCloseTo(-1.6211, 4);`
  - alt: `expect(profitOldFormulaV1(21.95, 12, 1.99, true, 5)).toBeCloseTo(-1.6211, 4);`
  - neu: `expect(rows[0].oldProfitV1).toBeCloseTo(-1.7996, 4);`
  - neu: `expect(profitOldFormulaV1(21.95, 12, 1.99, true, 5)).toBeCloseTo(-1.7996, 4);`
- Zeile 85:
  - alt: `expect(md).toContain('| 119 Backpapier | 100PCS | 3,15 | ja | C (2,00/1,30) | 11,95 | 14,95 | +3,00 | 1,60 | -0,50 | 1,65 | ROT (unter Boden) |');`
  - neu: `expect(md).toContain('| 119 Backpapier | 100PCS | 3,15 | ja | C (2,00/1,30) | 11,95 | 15,45 | +3,50 | 1,42 | -0,68 | 1,83 | ROT (unter Boden) |');`

## `src/shared/pricing-location.test.ts`

- Zeile 12:
  - alt: `const base = { ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19 };`
  - neu: `const base = { ebayFeeRatePercent: 15, vatFactor: 1.19 };`
- Zeile 32:
  - alt: `expect(gewinn(21.45, 7.49, 0, true)).toBeCloseTo(1.1067, 4);`
  - alt: `expect(gewinn(20.45, 7.49, 0, true)).toBeCloseTo(0.3191, 4);`
  - neu: `expect(gewinn(21.45, 7.49, 0, true)).toBeCloseTo(0.9282, 4);`
  - neu: `expect(gewinn(20.45, 7.49, 0, true)).toBeCloseTo(0.1406, 4);`
- Zeile 36:
  - alt: `expect(gewinn(20.45, 6.49, 0, true)).toBeCloseTo(1.3191, 4);`
  - alt: `expect(gewinn(19.45, 6.49, 0, true)).toBeCloseTo(0.5315, 4);`
  - neu: `expect(gewinn(20.45, 6.49, 0, true)).toBeCloseTo(1.1406, 4);`
  - neu: `expect(gewinn(19.45, 6.49, 0, true)).toBeCloseTo(0.3530, 4);`
- Zeile 40:
  - alt: `expect(gewinn(13.95, 1.89, 0, true)).toBeCloseTo(0.7998, 4);`
  - alt: `expect(gewinn(13.95, 1.89, 0, true, 1)).toBeCloseTo(1.2729, 4);`
  - neu: `expect(gewinn(13.95, 1.89, 0, true)).toBeCloseTo(0.6213, 4);`
  - neu: `expect(gewinn(13.95, 1.89, 0, true, 1)).toBeCloseTo(1.0944, 4);`
- Zeile 44:
  - alt: `expect(gewinn(22.45, 8.49, 5, true)).toBeCloseTo(-0.6953, 4);`
  - alt: `expect(gewinn(22.45, 8.49, 5, true, 1)).toBeCloseTo(0.3199, 4);`
  - neu: `expect(gewinn(22.45, 8.49, 5, true)).toBeCloseTo(-0.8738, 4);`
  - neu: `expect(gewinn(22.45, 8.49, 5, true, 1)).toBeCloseTo(0.1414, 4);`
- Zeile 48:
  - alt: `expect(gewinn(18.95, 13.81, 0, false)).toBeCloseTo(1.4004, 4);`
  - alt: `expect(gewinn(18.95, 13.81, 0, true)).toBeCloseTo(-5.1923, 4);`
  - neu: `expect(gewinn(18.95, 13.81, 0, false)).toBeCloseTo(1.2219, 4);`
  - neu: `expect(gewinn(18.95, 13.81, 0, true)).toBeCloseTo(-5.3708, 4);`
- Zeile 57:
  - alt: `expect(r.minSellPrice).toBe(21.45);`
  - neu: `expect(r.minSellPrice).toBe(21.95);`

## `src/shared/pricing-v2.test.ts`

- Zeile 19:
  - alt: `const FEES = { ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19 };`
  - neu: `const FEES = { ebayFeeRatePercent: 15, vatFactor: 1.19 };`
- Zeile 112:
  - alt: `expect(r.raw).toBeCloseTo(13.8675, 4);`
  - alt: `expect(r.price).toBe(13.45);`
  - alt: `expect(r.profit).toBeCloseTo(1.1819, 4);`
  - neu: `expect(r.raw).toBeCloseTo(14.1017, 4);`
  - neu: `expect(r.price).toBe(13.95);`
  - neu: `expect(r.profit).toBeCloseTo(1.3844, 4);`
- Zeile 119:
  - alt: `expect(r.raw).toBeCloseTo(14.1824, 4);`
  - neu: `expect(r.raw).toBeCloseTo(14.4167, 4);`
- Zeile 121:
  - alt: `expect(r.profit).toBeCloseTo(1.3229, 4);`
  - neu: `expect(r.profit).toBeCloseTo(1.1444, 4);`
- Zeile 126:
  - alt: `expect(r.raw).toBeCloseTo(16.0197, 4);`
  - neu: `expect(r.raw).toBeCloseTo(16.2539, 4);`
- Zeile 128:
  - alt: `expect(r.profit).toBeCloseTo(1.4469, 4);`
  - neu: `expect(r.profit).toBeCloseTo(1.2684, 4);`
- Zeile 133:
  - alt: `expect(r.raw).toBeCloseTo(17.4633, 4);`
  - neu: `expect(r.raw).toBeCloseTo(17.6975, 4);`
- Zeile 135:
  - alt: `expect(r.profit).toBeCloseTo(1.4899, 4);`
  - neu: `expect(r.profit).toBeCloseTo(1.3114, 4);`
- Zeile 142:
  - alt: `expect(r.raw).toBeCloseTo(13.2113, 4);`
  - neu: `expect(r.raw).toBeCloseTo(13.4455, 4);`
- Zeile 144:
  - alt: `expect(r.profit).toBeCloseTo(1.1819, 4);`
  - neu: `expect(r.profit).toBeCloseTo(1.0034, 4);`
- Zeile 146:
  - alt: `expect(profitAtSellPrice({ sellPrice: 12.95, buyPrice: 3.15, isChinaOrigin: true, ...FEES, adRatePercent: 5, ebayLocationFactor: 1 })).toBeCloseTo(0.8009, 4);`
  - neu: `expect(profitAtSellPrice({ sellPrice: 12.95, buyPrice: 3.15, isChinaOrigin: true, ...FEES, adRatePercent: 5, ebayLocationFactor: 1 })).toBeCloseTo(0.6224, 4);`
- Zeile 151:
  - alt: `expect(r.raw).toBeCloseTo(17.9882, 4);`
  - neu: `expect(r.raw).toBeCloseTo(18.2224, 4);`
- Zeile 153:
  - alt: `expect(r.profit).toBeCloseTo(2.9709, 4);`
  - neu: `expect(r.profit).toBeCloseTo(2.7924, 4);`
- Zeile 160:
  - alt: `expect(r.raw).toBeCloseTo(14.5236, 4);`
  - neu: `expect(r.raw).toBeCloseTo(14.7579, 4);`
- Zeile 162:
  - alt: `expect(r.profit).toBeCloseTo(1.9439, 4);`
  - neu: `expect(r.profit).toBeCloseTo(1.7654, 4);`
- Zeile 168:
  - alt: `expect(display.expectedEur).toBe(1.94);`
  - neu: `expect(display.expectedEur).toBe(1.77);`
- Zeile 173:
  - alt: `expect([1.0, 1.5, 2.0, 3.0, 4.5, 5.0].map(t => v2Price(3.15, t, { s: 1 }).price)).toEqual([13.45, 13.45, 14.45, 15.45, 17.45, 18.45]);`
  - neu: `expect([1.0, 1.5, 2.0, 3.0, 4.5, 5.0].map(t => v2Price(3.15, t, { s: 1 }).price)).toEqual([13.45, 13.95, 14.45, 15.95, 17.95, 18.45]);`
- Zeile 178:
  - alt: `expect(ohne.raw).toBeCloseTo(13.4717, 4);`
  - neu: `expect(ohne.raw).toBeCloseTo(13.6890, 4);`
- Zeile 180:
  - alt: `expect(ohne.profit).toBeCloseTo(1.9822, 4);`
  - neu: `expect(ohne.profit).toBeCloseTo(1.8037, 4);`
- Zeile 187:
  - alt: `expect(v2Price(12, 2.0, { china: false, s: 1 }).price).toBe(18.45);`
  - neu: `expect(v2Price(12, 2.0, { china: false, s: 1 }).price).toBe(18.95);`
- Zeile 266:
  - alt: `test('alle 13 Verkäufe im Kostenmodell: |Formel − echt| ≤ 0,20 € (größte Abweichung 0,10 €)', () => {`
  - neu: `test('alle 13 Verkäufe im Kostenmodell: Formel ≤ echt (konservativ), |Formel − echt| ≤ 0,28 € (größte Abweichung 0,2736 €)', () => {`
- Zeile 275:
  - alt: `expect(diff).toBeLessThanOrEqual(0.20);`
  - neu: `expect(formelGewinn(s)).toBeLessThan(s.echt);`
  - neu: `expect(diff).toBeLessThanOrEqual(0.28);`
- Zeile 278:
  - alt: `expect(maxDiff).toBeLessThan(0.11);`
  - neu: `expect(maxDiff).toBeCloseTo(0.2736, 4);`
- Zeile 283:
  - alt: `expect(formelGewinn(s)).toBeCloseTo(0.68, 2);`
  - neu: `expect(formelGewinn(s)).toBeCloseTo(0.51, 2);`
- Zeile 309:
  - alt: `expect(r.worstProfit).toBeCloseTo(1.6489, 4);`
  - neu: `expect(r.worstProfit).toBeCloseTo(1.4704, 4);`
- Zeile 315:
  - alt: `expect(r.worstProfit).toBeCloseTo(0.2153, 4);`
  - neu: `expect(r.worstProfit).toBeCloseTo(0.0368, 4);`
- Zeile 319:
  - alt: `expect(alarm(11.95, 3.39, 2).worstProfit).toBeCloseTo(-0.7415, 4);`
  - neu: `expect(alarm(11.95, 3.39, 2).worstProfit).toBeCloseTo(-0.9200, 4);`
- Zeile 374:
  - alt: `expect(p.rows.map(r => r.sellPrice)).toEqual([19.95, 17.95, 16.45, 15.45, 14.45, 13.95]);`
  - neu: `expect(p.rows.map(r => r.sellPrice)).toEqual([19.95, 17.95, 16.95, 15.95, 14.45, 13.95]);`
- Zeile 376:
  - alt: `expect(p.anchorProfit).toBeCloseTo(0.6928, 4);`
  - neu: `expect(p.anchorProfit).toBeCloseTo(0.5143, 4);`
- Zeile 384:
  - alt: `expect(profits.map(p => Math.round(p * 10000) / 10000)).toEqual([1.5949, 4.2949, 5.0949, 5.9349, 6.7349, 7.1349]);`
  - neu: `expect(profits.map(p => Math.round(p * 10000) / 10000)).toEqual([1.4164, 4.1164, 4.9164, 5.7564, 6.5564, 6.9564]);`
- Zeile 390:
  - alt: `for (const row of plan(true, 20.95).rows) expect(row.profit).toBeGreaterThanOrEqual(1.30 - 1e-9);`
  - neu: `expect(plan(true, 21.45).anchorProfit).toBeCloseTo(1.5894, 4);`
  - neu: `for (const row of plan(true, 21.45).rows) expect(row.profit).toBeGreaterThanOrEqual(1.30 - 1e-9);`
- Zeile 406:
  - alt: `expect(p.anchorProfit).toBeCloseTo(0.729, 3);`
  - neu: `expect(p.anchorProfit).toBeCloseTo(0.550, 3);`
- Zeile 425:
  - alt: `expect(p.anchorProfit).toBeCloseTo(-4.6272, 4);`
  - neu: `expect(p.anchorProfit).toBeCloseTo(-4.8057, 4);`
- Zeile 449:
  - alt: `expect(rows[0].profitAtCurrent).toBeCloseTo(-0.5015, 4);`
  - alt: `expect(rows[0].newSellPrice).toBe(14.95);`
  - neu: `expect(rows[0].profitAtCurrent).toBeCloseTo(-0.6800, 4);`
  - neu: `expect(rows[0].newSellPrice).toBe(15.45);`
- Zeile 456:
  - alt: `expect(rows[1].profitAtCurrent).toBeCloseTo(3.5928, 4);`
  - neu: `expect(rows[1].profitAtCurrent).toBeCloseTo(3.4143, 4);`

## `src/shared/pricing.test.ts`

- Zeile 24:
  - alt: `import { applyDecreaseCap, applyRaiseOnly, planCappedPriceSteps, computeVariantSellPrices, parseVariantSellPrices, serializeVariantSellPrices, resolveVariantSellPrice, roundUpToX95, roundToNearest95, computeOrderProfit, DEFAULT_PRICING_CONFIG, AUTO_PRICE_WRITE_ENABLED } from './pricing';`
  - neu: `import { applyDecreaseCap, applyRaiseOnly, planCappedPriceSteps, computeVariantSellPrices, parseVariantSellPrices, serializeVariantSellPrices, resolveVariantSellPrice, roundUpToX95, roundToNearest95, computeOrderProfit, DEFAULT_PRICING_CONFIG, AUTO_PRICE_WRITE_ENABLED, EBAY_FIXED_FEE_NET_SMALL_EUR, EBAY_FIXED_FEE_NET_EUR, EBAY_FIXED_FEE_THRESHOLD_EUR, ebayFixedFeeGross } from './pricing';`
- Zeile 30:
  - alt: `expect(DEFAULT_PRICING_CONFIG.ebayFixedFeeEur).toBe(0.30);`
  - neu: `expect('ebayFixedFeeEur' in DEFAULT_PRICING_CONFIG).toBe(false);`
  - neu: `expect([EBAY_FIXED_FEE_NET_SMALL_EUR, EBAY_FIXED_FEE_NET_EUR, EBAY_FIXED_FEE_THRESHOLD_EUR]).toEqual([0.35, 0.45, 10]);`
- Zeile 236:
  - alt: `ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2.00,`
  - neu: `ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2.00,`
- Zeile 290:
  - alt: `test('Auftragsvorgabe: 17,95 € Verkauf, 11,56 € wahrer Einkauf ergibt 1,76 € (Toleranz 1 Cent)', () => {`
  - neu: `test('Auftragsvorgabe: 17,95 € Verkauf, 11,56 € wahrer Einkauf ergibt 1,58 € (vorher 1,76 € mit Fix 0,30; Toleranz 1 Cent)', () => {`
- Zeile 294:
  - alt: `expect(Math.abs(profit - 1.76)).toBeLessThanOrEqual(0.01);`
  - neu: `expect(Math.abs(profit - 1.58)).toBeLessThanOrEqual(0.01);`
- Zeile 308:
  - alt: `const fixedFeeGross = DEFAULT_PRICING_CONFIG.ebayFixedFeeEur * DEFAULT_PRICING_CONFIG.vatFactor;`
  - neu: `const fixedFeeGross = ebayFixedFeeGross(20); // AUFSICHT 045 A: Bestellwert 20 € > 10 € → 0,45 × 1,19`
  - neu: `expect(fixedFeeGross).toBeCloseTo(0.5355, 12);`

## `src/shared/target-margin-bulk.test.ts`

- Zeile 27:
  - alt: `const pGrenze = single(1, 14.45, 3.29, true);               // Gewinn 1,1505 (14,45×0,71678−0,357−8,85) — K-006: über B−0,10 (1,10), unter C−0,10 (1,20)`
  - alt: `const pYellow = single(2, 14.95, 3.15, true);               // Gewinn 1,6489`
  - neu: `const pGrenze = single(1, 14.45, 3.15, true);               // Gewinn 1,1120 (14,45×0,71678−0,5355−8,71) — K-006: über B−0,10 (1,10), unter C−0,10 (1,20)`
  - neu: `const pYellow = single(2, 14.95, 3.15, true);               // Gewinn 1,4704 (045 A; vorher 1,6489 mit Fix 0,30)`
- Zeile 39:
  - alt: `test('Produkt 95 (Varianten-Gruppen, nur 1 variantPrices-Eintrag): Varianten-Produkt; K-004: Herkunft der Variante (Germany) → Gewinn 2,8069 €', () => {`
  - neu: `test('Produkt 95 (Varianten-Gruppen, nur 1 variantPrices-Eintrag): Varianten-Produkt; K-004: Herkunft der Variante (Germany) → Gewinn 2,6284 €', () => {`
- Zeile 43:
  - alt: `expect(r.rows[0].profit).toBeCloseTo(2.8069, 4);`
  - neu: `expect(r.rows[0].profit).toBeCloseTo(2.6284, 4);`
- Zeile 50:
  - alt: `expect(r.rows[0].profit).toBeCloseTo(-0.5015, 4);`
  - alt: `expect(r.rows[1].profit).toBeCloseTo(0.0089, 4);`
  - neu: `expect(r.rows[0].profit).toBeCloseTo(-0.6800, 4);`
  - neu: `expect(r.rows[1].profit).toBeCloseTo(-0.1696, 4);`
- Zeile 66:
  - alt: `test('Stufe A (1,00/1,00): rot ist nur 119 (Variante); 95 (2,8069) und Grenzfall-Produkt (1,1505) nicht', () => {`
  - neu: `test('Stufe A (1,00/1,00): rot ist nur 119 (Variante); 95 (2,6284) und Grenzfall-Produkt (1,1120) nicht', () => {`
- Zeile 71:
  - alt: `test('Stufe B (1,50/1,20, rot unter 1,10): Grenzfall (1,1505 ≥ 1,10) ist gelb statt rot', () => {`
  - neu: `test('Stufe B (1,50/1,20, rot unter 1,10): Grenzfall (1,1120 ≥ 1,10) ist gelb statt rot', () => {`
- Zeile 74:
  - alt: `expect(p.yellow).toBe(1);`
  - neu: `expect(p.yellow).toBe(2); // AUFSICHT 045 A: 14,95-Produkt jetzt 1,4704 < Ziel 1,50 → ebenfalls gelb (vorher 1,6489, ok)`
- Zeile 77:
  - alt: `test('Stufe C (2,00/1,30, rot unter 1,20): Grenzfall-Produkt (1,1505 < 1,20) wird rot — der Stufenwechsel verändert die Zahl M', () => {`
  - neu: `test('Stufe C (2,00/1,30, rot unter 1,20): Grenzfall-Produkt (1,1120 < 1,20) wird rot — der Stufenwechsel verändert die Zahl M', () => {`
- Zeile 82:
  - alt: `test('Stufe D (3,00/1,50): rot 2 (Grenzfall, 119); 14,95-Produkt (1,6489) und 95 (2,8069 < 3,00) gelb', () => {`
  - neu: `test('Stufe D (3,00/1,50): rot 2 (Grenzfall, 119); 14,95-Produkt (1,4704) und 95 (2,6284 < 3,00) gelb', () => {`

## `src/shared/tier-reprice.test.ts`

- Zeile 42:
  - alt: `expect(r.newSell).toBe(13.95);`
  - alt: `expect(r.newProfit).toBeCloseTo(1.0921, 4); // 13,95 × 0,71678 − 0,357 − 8,55`
  - neu: `expect(r.newSell).toBe(14.45);`
  - neu: `expect(r.newProfit).toBeCloseTo(1.2720, 4); // 13,95 × 0,71678 − 0,357 − 8,55`
- Zeile 50:
  - alt: `expect(r.newProfit).toBeCloseTo(1.4505, 4);`
  - neu: `expect(r.newProfit).toBeCloseTo(1.2720, 4);`
- Zeile 56:
  - alt: `expect(r.newSell).toBe(14.95);`
  - neu: `expect(r.newSell).toBe(15.45);`
- Zeile 64:
  - alt: `expect(r.newProfit).toBeCloseTo(2.884, 4);`
  - neu: `expect(r.newProfit).toBeCloseTo(2.7055, 4);`
- Zeile 70:
  - alt: `expect(r.oldProfit).toBeCloseTo(1.8089, 4);`
  - neu: `expect(r.oldProfit).toBeCloseTo(1.6304, 4);`
- Zeile 82:
  - alt: `expect(plan.changedCount).toBe(18);`
  - neu: `expect(plan.changedCount).toBe(15);`
- Zeile 124:
  - alt: `expect(p.rows[0].newSell).toBe(14.95); // Roh 15,4399 → 14,95; Gewinn 14,95 × 0,71678 − 0,357 − 8,71 = 1,6489`
  - neu: `expect(p.rows[0].newSell).toBe(15.45); // Roh 15,4399 → 14,95; Gewinn 14,95 × 0,71678 − 0,357 − 8,71 = 1,6489`
- Zeile 126:
  - alt: `expect(p.rows[0].oldProfit).toBeCloseTo(-0.5015, 4);`
  - alt: `expect(storePatchForPlan(single, p)).toEqual({ sellPrice: 14.95 });`
  - neu: `expect(p.rows[0].oldProfit).toBeCloseTo(-0.6800, 4);`
  - neu: `expect(storePatchForPlan(single, p)).toEqual({ sellPrice: 15.45 });`
- Zeile 256:
  - alt: `expect(plan.rows.every(r => r.newProfit >= 1.2)).toBe(true);`
  - neu: `expect(plan.rows.map(r => Math.round(r.newProfit * 10000) / 10000)).toEqual([1.2639, 1.1704]);`
  - neu: `expect(plan.rows.every(r => r.newProfit >= 1.1 - 1e-9)).toBe(true);`

## `src/shared/variant-reprice.test.ts`

- Zeile 43:
  - alt: `[BLUE, 28.45, 26.95, 2.51, 1.33, 'ok'],`
  - alt: `[BLACK, 26.45, 24.45, 2.53, 0.96, 'abgelehnt'],`
  - neu: `[BLUE, 28.45, 26.95, 2.33, 1.15, 'ok'],`
  - neu: `[BLACK, 26.45, 24.45, 2.36, 0.78, 'abgelehnt'],`
- Zeile 51:
  - alt: `expect(mit.map(x => x.gewinnNeu)).toEqual([1.33, 1.35]);`
  - neu: `expect(mit.map(x => x.gewinnNeu)).toEqual([1.15, 1.17]);`
- Zeile 64:
  - alt: `expect(plan({ [GRAY]: 22.95 })[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: -0.22 });`
  - alt: `expect(plan({ [GRAY]: 22.95 }, undefined, { aliCheckoutFactor: null })[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: -0.22 });`
  - neu: `expect(plan({ [GRAY]: 22.95 })[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: -0.4 });`
  - neu: `expect(plan({ [GRAY]: 22.95 }, undefined, { aliCheckoutFactor: null })[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: -0.4 });`
- Zeile 93:
  - alt: `expect(planVariantDecrease(p225({ targetMarginEur: 1.5, variantSellPrices: VSP_HOCH }), { [BLUE]: 27.45 }, GROUPS).rows[0]).toMatchObject({ status: 'ok', gewinnNeu: 1.72 });`
  - neu: `expect(planVariantDecrease(p225({ targetMarginEur: 1.5, variantSellPrices: VSP_HOCH }), { [BLUE]: 27.45 }, GROUPS).rows[0]).toMatchObject({ status: 'ok', gewinnNeu: 1.54 });`
- Zeile 98:
  - alt: `expect(r.map(x => [x.gewinnNeu, x.gewinnOhneFaktor, x.status])).toEqual([[1.33, 1.33, 'ok'], [1.35, 1.35, 'ok']]);`
  - neu: `expect(r.map(x => [x.gewinnNeu, x.gewinnOhneFaktor, x.status])).toEqual([[1.15, 1.15, 'ok'], [1.17, 1.17, 'ok']]);`
- Zeile 102:
  - alt: `test('Warnung „ohne Kassen-Faktor“ gibt es nur noch beim Anheben: Blue 26,95 → 27,45 mit Ziel 2,00 (mit +2,08, ohne +1,72)', () => {`
  - alt: `const r = planVariantReprice(p225({ targetMarginEur: 2.0 }), { [BLUE]: 27.45 }, GROUPS, new Set(), 'up').rows[0];`
  - alt: `expect(r).toMatchObject({ status: 'ok', gewinnNeu: 2.08, gewinnOhneFaktor: 1.72 });`
  - alt: `expect(r.hinweis).toContain('ohne Kassen-Faktor nur 1.72');`
  - neu: `test('Warnung „ohne Kassen-Faktor“ gibt es nur noch beim Anheben: Blue 26,95 → 27,45 mit Ziel 1,80 (mit +1,90, ohne +1,54)', () => {`
  - neu: `const r = planVariantReprice(p225({ targetMarginEur: 1.8 }), { [BLUE]: 27.45 }, GROUPS, new Set(), 'up').rows[0];`
  - neu: `expect(r).toMatchObject({ status: 'ok', gewinnNeu: 1.9, gewinnOhneFaktor: 1.54 });`
  - neu: `expect(r.hinweis).toContain('ohne Kassen-Faktor nur 1.54');`
- Zeile 115:
  - alt: `expect(up({ [BLUE]: 27.45 })[0]).toMatchObject({ status: 'ok', alt: 26.95, neu: 27.45, gewinnNeu: 2.08, gewinnOhneFaktor: 1.72 });`
  - neu: `expect(up({ [BLUE]: 27.45 })[0]).toMatchObject({ status: 'ok', alt: 26.95, neu: 27.45, gewinnNeu: 1.9, gewinnOhneFaktor: 1.54 });`
- Zeile 128:
  - alt: `expect(r).toMatchObject({ status: 'ok', mindestGewinn: 3.5, gewinnAlt: 1.69, gewinnNeu: 2.08 });`
  - neu: `expect(r).toMatchObject({ status: 'ok', mindestGewinn: 3.5, gewinnAlt: 1.51, gewinnNeu: 1.9 });`
- Zeile 134:
  - alt: `expect(r.map(x => [x.gewinnAlt, x.gewinnNeu, x.status])).toEqual([[-1.46, -1.07, 'ok'], [-1.08, -0.69, 'ok']]);`
  - neu: `expect(r.map(x => [x.gewinnAlt, x.gewinnNeu, x.status])).toEqual([[-1.64, -1.25, 'ok'], [-1.26, -0.87, 'ok']]);`
- Zeile 140:
  - alt: `expect(planVariantReprice(p225({ variantSellPrices: vsp }), { [BLUE]: 22.45 }, GROUPS, new Set(), 'down').rows[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: -2.22 });`
  - neu: `expect(planVariantReprice(p225({ variantSellPrices: vsp }), { [BLUE]: 22.45 }, GROUPS, new Set(), 'down').rows[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: -2.39 });`

## `src/shared/volume-discount.test.ts`

- Zeile 38:
  - alt: `expect(p.tiers[0].rows[0]).toMatchObject({ unitPrice: 19.27, total: 38.54, saving: 3.36, profit: 2.05, belowFloor: false });`
  - alt: `expect(p.tiers[1].rows[0]).toMatchObject({ unitPrice: 19.06, total: 57.18, saving: 5.67, profit: 4.54 });`
  - alt: `expect(p.singleRows[0].profit).toBe(0.38);`
  - neu: `expect(p.tiers[0].rows[0]).toMatchObject({ unitPrice: 19.27, total: 38.54, saving: 3.36, profit: 1.87, belowFloor: false });`
  - neu: `expect(p.tiers[1].rows[0]).toMatchObject({ unitPrice: 19.06, total: 57.18, saving: 5.67, profit: 4.36 });`
  - neu: `expect(p.singleRows[0].profit).toBe(0.2);`
- Zeile 45:
  - alt: `expect(p.tiers[0].rows[0]).toMatchObject({ total: 20.8, saving: 3.1, profit: 5.01 });`
  - alt: `expect(p.tiers[1].rows[0]).toMatchObject({ total: 30.84, saving: 5.01, profit: 10.22 });`
  - neu: `expect(p.tiers[0].rows[0]).toMatchObject({ total: 20.8, saving: 3.1, profit: 4.83 });`
  - neu: `expect(p.tiers[1].rows[0]).toMatchObject({ total: 30.84, saving: 5.01, profit: 10.04 });`
- Zeile 150:
  - alt: `expect(p.singleRows[0].profit).toBe(42.41);`
  - alt: `expect(p.tiers[0].rows[0].profit).toBe(83.26); // 41,63 je Stück < 42,41`
  - neu: `expect(p.singleRows[0].profit).toBe(42.23);`
  - neu: `expect(p.tiers[0].rows[0].profit).toBe(83.08); // 41,63 je Stück < 42,41`
- Zeile 157:
  - alt: `expect(p.singleRows[0].profit).toBe(1.7);`
  - alt: `expect(p.tiers[0].rows[0].profit).toBe(2.12); // 1,06 je Stück < 1,70`
  - neu: `expect(p.singleRows[0].profit).toBe(1.52);`
  - neu: `expect(p.tiers[0].rows[0].profit).toBe(1.94); // 1,06 je Stück < 1,70`
- Zeile 166:
  - alt: `expect(p.singleRows[0].profit).toBe(0.59);`
  - alt: `expect(p.tiers[0].rows[0]).toMatchObject({ total: 40.8, profit: 2.69 });`
  - alt: `expect(p.tiers[1].rows[0]).toMatchObject({ total: 59.1, profit: 5.53 });`
  - neu: `expect(p.singleRows[0].profit).toBe(0.41);`
  - neu: `expect(p.tiers[0].rows[0]).toMatchObject({ total: 40.8, profit: 2.51 });`
  - neu: `expect(p.tiers[1].rows[0]).toMatchObject({ total: 59.1, profit: 5.35 });`
