// P-27/P-28-Fix (2026-09-08, Live-Fund stele-138): "Preise neu berechnen" schrieb bei
// Varianten-Listings denselben Einheitspreis (Maximum) auf JEDE eBay-Varianten-SKU, obwohl
// computeVariantPriceRows() für jede Variante bereits ihren eigenen korrekten Preis berechnet.
// Dieser Test beweist genau das: 3 synthetische Varianten mit unterschiedlichem Einkaufspreis
// müssen 3 unterschiedliche correctSellPrice-Werte ergeben — kein Kollaps auf einen gemeinsamen
// (z.B. den maximalen) Wert.
import { describe, expect, test } from 'bun:test';

// price-monitor.ts importiert db/index.ts, das ohne TURSO_DATABASE_URL beim Modul-Laden wirft —
// hier per dynamischem Import erst NACH dem Setzen einer Dummy-URL geladen (kein echter
// DB-Zugriff in den hier getesteten reinen Funktionen nötig).
process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/price-monitor-test.db';
const { computeVariantPriceRows, safeUniformVariantPrice } = await import('./price-monitor');

describe('computeVariantPriceRows (Varianten-fähige Preisprüfung)', () => {
  test('3 Varianten mit unterschiedlichem Einkaufspreis ergeben 3 unterschiedliche correctSellPrice-Werte', () => {
    // Nachgebaut aus dem Live-Fund stele-138 (3 Varianten, EK 6,19/3,39/2,39€).
    const variantPricesJson = JSON.stringify([
      { skuId: 'v1', attrs: { Color: 'Red' }, price: 6.19 },
      { skuId: 'v2', attrs: { Color: 'Blue' }, price: 3.39 },
      { skuId: 'v3', attrs: { Color: 'Green' }, price: 2.39 },
    ]);

    const rows = computeVariantPriceRows(variantPricesJson, 0, null, 5);

    expect(rows).toHaveLength(3);
    const prices = rows.map(r => r.correctSellPrice);
    const distinctPrices = new Set(prices);

    // Der eigentliche Bug: safeUniformVariantPrice() (Maximum) wurde vorher auf ALLE SKUs
    // geschrieben — hier wird geprüft, dass die zugrunde liegenden Zeilen selbst schon
    // unterschiedlich sind (Voraussetzung dafür, dass updateEbayVariantPricesIndividually()
    // überhaupt unterschiedliche Preise schreiben KANN).
    expect(distinctPrices.size).toBe(3);
    expect(prices[0]).not.toBe(prices[1]);
    expect(prices[1]).not.toBe(prices[2]);
    expect(prices[0]).not.toBe(prices[2]);

    // Höherer Einkaufspreis muss auch höheren Verkaufspreis ergeben (Formel ist monoton).
    expect(rows[0].correctSellPrice).toBeGreaterThan(rows[1].correctSellPrice);
    expect(rows[1].correctSellPrice).toBeGreaterThan(rows[2].correctSellPrice);
  });

  test('safeUniformVariantPrice() bleibt das Maximum — jetzt nur noch als Fallback genutzt, nicht mehr für alle SKUs', () => {
    const variantPricesJson = JSON.stringify([
      { skuId: 'v1', attrs: { Color: 'Red' }, price: 6.19 },
      { skuId: 'v2', attrs: { Color: 'Blue' }, price: 3.39 },
      { skuId: 'v3', attrs: { Color: 'Green' }, price: 2.39 },
    ]);
    const rows = computeVariantPriceRows(variantPricesJson, 0, null, 5);
    const uniform = safeUniformVariantPrice(rows);

    expect(uniform).toBe(Math.max(...rows.map(r => r.correctSellPrice)));
    expect(uniform).toBe(rows[0].correctSellPrice); // teuerste Variante (Red, EK 6,19€) bestimmt das Maximum
  });
});
