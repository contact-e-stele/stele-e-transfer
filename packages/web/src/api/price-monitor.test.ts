// P-27/P-28-Fix (2026-09-08, Live-Fund stele-138): "Preise neu berechnen" schrieb bei
// Varianten-Listings denselben Einheitspreis (Maximum) auf JEDE eBay-Varianten-SKU, obwohl
// computeVariantPriceRows() für jede Variante bereits ihren eigenen korrekten Preis berechnet.
// Dieser Test beweist genau das: 3 synthetische Varianten mit unterschiedlichem Einkaufspreis
// müssen 3 unterschiedliche correctSellPrice-Werte ergeben — kein Kollaps auf einen gemeinsamen
// (z.B. den maximalen) Wert.
import { describe, expect, mock, test } from 'bun:test';

// price-monitor.ts importiert db/index.ts, das ohne TURSO_DATABASE_URL beim Modul-Laden wirft —
// hier per dynamischem Import erst NACH dem Setzen einer Dummy-URL geladen (kein echter
// DB-Zugriff in den hier getesteten reinen Funktionen nötig).
process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/price-monitor-test.db';
const { computeVariantPriceRows, safeUniformVariantPrice, repairVariantPricesForProduct, computeRepairBatchRange } = await import('./price-monitor');

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

// P-27/P-28 PR 3 (2026-09-09): repairVariantPricesForProduct() ist die Kernlogik hinter
// POST /ebay/listings/repair-variant-prices — der Zweck dieses Endpunkts ist explizit, Listings
// zu reparieren, die "Preise neu berechnen" NIE anzeigt (weil deren informativer Vorschlagspreis
// zufällig mit dem aktuellen, falschen Einheitspreis übereinstimmt und so unter der
// 0,50€-Diff-Schwelle bleibt). Dieser Test bestätigt, dass hier KEINE Schwelle geprüft wird —
// updateFn wird immer aufgerufen, auch wenn sich am Preis rein rechnerisch nichts geändert hätte.
describe('repairVariantPricesForProduct (POST /ebay/listings/repair-variant-prices)', () => {
  test('ruft updateFn immer auf, unabhängig von einem Preis-Diff (keine 0,50€-Schwelle wie in recalculate-preview)', async () => {
    const variantPricesJson = JSON.stringify([
      { skuId: 'v1', attrs: { Color: 'Red' }, price: 6.19 },
      { skuId: 'v2', attrs: { Color: 'Blue' }, price: 3.39 },
      { skuId: 'v3', attrs: { Color: 'Green' }, price: 2.39 },
    ]);
    // Simuliert genau den Fall aus der Lücke: der Einkaufspreis hat sich seit dem letzten
    // (falschen) Einheitspreis-Schreibvorgang nicht geändert — computeVariantPriceRows() liefert
    // also denselben Soll-Wert wie beim letzten Mal. Ein diff-basierter Endpunkt (wie
    // recalculate-preview) würde dieses Produkt deshalb NIE anfassen.
    const product = { id: 138, variantPrices: variantPricesJson, shippingCost: 0, shipsFrom: null, adRate: 5 };

    const mockUpdateFn = mock(async (_productId: number, rows: ReturnType<typeof computeVariantPriceRows>) =>
      ({ ok: true, updatedCount: rows.length })
    );

    const result = await repairVariantPricesForProduct(product, mockUpdateFn);

    expect(mockUpdateFn).toHaveBeenCalledTimes(1);
    // updateFn bekommt alle 3 Zeilen mit ihren je EIGENEN correctSellPrice-Werten übergeben —
    // nicht einen einzigen Einheitspreis für alle.
    const [calledProductId, calledRows] = mockUpdateFn.mock.calls[0];
    expect(calledProductId).toBe(138);
    expect(calledRows).toHaveLength(3);
    expect(new Set(calledRows.map(r => r.correctSellPrice)).size).toBe(3);
    expect(result).toEqual({ ok: true, updatedSkuCount: 3 });
  });

  test('meldet Fehler statt updateFn aufzurufen, wenn keine Varianten-Einkaufspreise vorhanden sind', async () => {
    const mockUpdateFn = mock(async () => ({ ok: true, updatedCount: 0 }));
    const product = { id: 999, variantPrices: null, shippingCost: 0, shipsFrom: null, adRate: 5 };

    const result = await repairVariantPricesForProduct(product, mockUpdateFn);

    expect(mockUpdateFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.updatedSkuCount).toBe(0);
    expect(result.error).toBeTruthy();
  });
});

// P-27/P-28 PR 4 (2026-09-09, Live-Fund): repair-variant-prices verarbeitete bisher ALLE
// Varianten-Produkte in einem einzigen Request — bei ~15-20 Produkten kappte Render die
// Verbindung, bevor alle durch waren ("Unexpected token '<'" im Frontend statt JSON). Dieser
// Test prüft nur die reine Chunking-Arithmetik (kein DB-/eBay-Zugriff nötig).
describe('computeRepairBatchRange (Chunking für POST /ebay/listings/repair-variant-prices)', () => {
  test('12 Varianten-Produkte, limit=5 → 3 Batches, done erst beim dritten Aufruf true', () => {
    const total = 12;
    const limit = 5;

    const batch1 = computeRepairBatchRange(total, 0, limit);
    expect(batch1).toEqual({ start: 0, end: 5, done: false });

    const batch2 = computeRepairBatchRange(total, batch1.end, limit);
    expect(batch2).toEqual({ start: 5, end: 10, done: false });

    const batch3 = computeRepairBatchRange(total, batch2.end, limit);
    expect(batch3).toEqual({ start: 10, end: 12, done: true });
  });

  test('leere Liste ist sofort done', () => {
    expect(computeRepairBatchRange(0, 0, 5)).toEqual({ start: 0, end: 0, done: true });
  });

  test('offset über der Gesamtzahl liefert eine leere, aber done-markierte Charge (kein Absturz)', () => {
    expect(computeRepairBatchRange(12, 100, 5)).toEqual({ start: 12, end: 12, done: true });
  });

  test('exakt durch limit teilbare Gesamtzahl wird nach dem letzten Batch als done markiert', () => {
    expect(computeRepairBatchRange(10, 0, 5)).toEqual({ start: 0, end: 5, done: false });
    expect(computeRepairBatchRange(10, 5, 5)).toEqual({ start: 5, end: 10, done: true });
  });
});
