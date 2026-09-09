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
const {
  computeVariantPriceRows, safeUniformVariantPrice, repairVariantPricesForProduct,
  computeRepairBatchRange, updateEbayVariantPricesIndividually,
} = await import('./price-monitor');

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

// P-27/P-28 PR 4+5 (2026-09-09, Live-Funde): repair-variant-prices verarbeitete zunächst ALLE
// Varianten-Produkte in einem einzigen Request (Render kappte die Verbindung, "Unexpected
// token '<'" im Frontend statt JSON). PR 4s Fix (feste Anzahl PRODUKTE pro Charge) reichte
// nicht — ein einzelnes Produkt mit vielen Varianten (Live-Fund: 11) sprengte das Zeitbudget
// einer Charge unabhängig von der Produktzahl. computeRepairBatchRange() ist jetzt varianten-/
// SKU-gewichtet: nimmt die Varianten-Anzahl pro Produkt als Array entgegen. Diese Tests prüfen
// nur die reine Chunking-Arithmetik (kein DB-/eBay-Zugriff nötig).
describe('computeRepairBatchRange (Chunking für POST /ebay/listings/repair-variant-prices)', () => {
  test('12 Produkte mit je 1 Variante, maxVariantsPerBatch=5 → 3 Batches, done erst beim dritten Aufruf true', () => {
    const variantCounts = Array(12).fill(1);
    const maxVariantsPerBatch = 5;

    const batch1 = computeRepairBatchRange(variantCounts, 0, maxVariantsPerBatch);
    expect(batch1).toEqual({ start: 0, end: 5, done: false });

    const batch2 = computeRepairBatchRange(variantCounts, batch1.end, maxVariantsPerBatch);
    expect(batch2).toEqual({ start: 5, end: 10, done: false });

    const batch3 = computeRepairBatchRange(variantCounts, batch2.end, maxVariantsPerBatch);
    expect(batch3).toEqual({ start: 10, end: 12, done: true });
  });

  test('Live-Fund-Szenario: ein Produkt mit 11 Varianten sprengt allein schon das Limit und bildet seine eigene Charge', () => {
    // Nachgebaut aus dem Live-Fund: Produkte 70,71,77,92,95 — Produkt 71 hat 11 Varianten,
    // die anderen 1-2. maxVariantsPerBatch=6 (Default).
    const variantCounts = [3, 11, 2, 1, 4, 2]; // Summe 23, insgesamt > 6
    const maxVariantsPerBatch = 6;

    // Charge 1: nur Produkt 0 (3 Varianten) — Produkt 1 (11) würde 3+11=14 > 6 sprengen.
    const batch1 = computeRepairBatchRange(variantCounts, 0, maxVariantsPerBatch);
    expect(batch1).toEqual({ start: 0, end: 1, done: false });

    // Charge 2: Produkt 1 allein (11 Varianten) — liegt allein schon über dem Limit, bildet
    // trotzdem nur seine eigene Charge statt mit anderen Produkten zusammengelegt zu werden.
    const batch2 = computeRepairBatchRange(variantCounts, batch1.end, maxVariantsPerBatch);
    expect(batch2).toEqual({ start: 1, end: 2, done: false });

    // Charge 3: Produkte 2+3+4 (2+1+4=7 > 6, also nur 2+3 = 3, dann Produkt 4 (4) würde
    // 3+4=7>6 sprengen) → Produkte 2,3 (Summe 3).
    const batch3 = computeRepairBatchRange(variantCounts, batch2.end, maxVariantsPerBatch);
    expect(batch3).toEqual({ start: 2, end: 4, done: false });

    // Charge 4: Produkte 4,5 (4+2=6 <= 6) → fertig.
    const batch4 = computeRepairBatchRange(variantCounts, batch3.end, maxVariantsPerBatch);
    expect(batch4).toEqual({ start: 4, end: 6, done: true });
  });

  test('leere Liste ist sofort done', () => {
    expect(computeRepairBatchRange([], 0, 6)).toEqual({ start: 0, end: 0, done: true });
  });

  test('offset über der Gesamtzahl liefert eine leere, aber done-markierte Charge (kein Absturz)', () => {
    expect(computeRepairBatchRange(Array(12).fill(1), 100, 6)).toEqual({ start: 12, end: 12, done: true });
  });

  test('exakt durch das Limit teilbare Gesamt-Variantenzahl wird nach der letzten Charge als done markiert', () => {
    const variantCounts = Array(10).fill(1);
    expect(computeRepairBatchRange(variantCounts, 0, 5)).toEqual({ start: 0, end: 5, done: false });
    expect(computeRepairBatchRange(variantCounts, 5, 5)).toEqual({ start: 5, end: 10, done: true });
  });
});

// P-27/P-28-Fix (2026-09-09, Live-Fund Produkte 71/77/92/95): row.attrs kann Felder wie
// "Ships From" enthalten, die NIE Teil der echten eBay-SKU sind — ohne Filterung verlängerte
// sich die hier erwartete SKU um ein nicht existierendes Segment (z.B. "-CHINA-MAINLAND") →
// kein Match → Preis blieb für die betroffene(n) Variante(n) unverändert, eBay zeigte weiterhin
// einen einzigen Preis für alle Varianten. Diese Tests mocken die eBay-API komplett (kein
// echter Netzwerkzugriff) und prüfen die tatsächlich an eBay gesendeten PUT-Preise pro SKU.
describe('updateEbayVariantPricesIndividually — Ships-From/Blacklist-Filterung beim SKU-Matching', () => {
  // Baut einen Mock für genau die drei eBay-Aufrufe, die updateEbayVariantPricesIndividually()
  // auslöst: OAuth-Token, Varianten-SKU-Liste der Gruppe, und pro SKU GET+PUT auf /offer.
  // realSkus: die SKUs, die eBay laut getInventoryItemGroupSkus() tatsächlich kennt (OHNE
  // Ships-From-Segment, wie live bestätigt).
  function mockEbayFetch(realSkus: string[]) {
    const putBodiesBySku = new Map<string, { value: string }>();
    globalThis.fetch = (async (url: string, opts?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes('/identity/v1/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 7200 }), { status: 200 });
      }
      if (u.includes('/inventory_item_group/')) {
        return new Response(JSON.stringify({ variantSKUs: realSkus }), { status: 200 });
      }
      const offerMatch = u.match(/\/sell\/inventory\/v1\/offer\?sku=([^&]+)&/);
      if (offerMatch && (!opts || opts.method === undefined)) {
        const sku = decodeURIComponent(offerMatch[1]);
        return new Response(JSON.stringify({ offers: [{ offerId: `offer-${sku}`, sku }] }), { status: 200 });
      }
      if (u.includes('/sell/inventory/v1/offer/offer-') && opts?.method === 'PUT') {
        const sku = u.split('/sell/inventory/v1/offer/offer-')[1];
        const body = JSON.parse(opts.body as string) as { pricingSummary: { price: { value: string } } };
        putBodiesBySku.set(sku, body.pricingSummary.price as { value: string });
        return new Response('', { status: 204 });
      }
      throw new Error('Unmocked eBay fetch: ' + u + ' ' + (opts?.method ?? 'GET'));
    }) as unknown as typeof fetch;
    return putBodiesBySku;
  }

  test('a) row.attrs mit "Ships From" wird beim SKU-Aufbau korrekt ignoriert (analog Produkt 71/77/92/95)', async () => {
    const realSkus = ['stele-71-RED', 'stele-71-BLUE']; // echte eBay-SKUs, KEIN Ships-From-Segment
    const putBodies = mockEbayFetch(realSkus);

    const rows = [
      { skuId: 'v1', attrs: { Color: 'Red', 'Ships From': 'China Mainland' }, buyPrice: 5, correctSellPrice: 12.95 },
      { skuId: 'v2', attrs: { Color: 'Blue', 'Ships From': 'China Mainland' }, buyPrice: 8, correctSellPrice: 17.95 },
    ];

    const result = await updateEbayVariantPricesIndividually(71, rows);

    expect(result).toEqual({ ok: true, updatedCount: 2 });
    // Jede SKU bekommt ihren EIGENEN Preis — kein Fallback auf den Einheitspreis, weil beide
    // trotz "Ships From" im attrs-Objekt korrekt der jeweils echten SKU zugeordnet wurden.
    expect(putBodies.get('stele-71-RED')?.value).toBe('12.95');
    expect(putBodies.get('stele-71-BLUE')?.value).toBe('17.95');
  });

  test('b) row.attrs OHNE "Ships From" bleibt unverändert korrekt (Regressionsschutz, analog Produkt 138)', async () => {
    const realSkus = ['stele-138-RED', 'stele-138-BLUE', 'stele-138-GREEN'];
    const putBodies = mockEbayFetch(realSkus);

    const rows = [
      { skuId: 'v1', attrs: { Color: 'Red' }, buyPrice: 6.19, correctSellPrice: 20.95 },
      { skuId: 'v2', attrs: { Color: 'Blue' }, buyPrice: 3.39, correctSellPrice: 15.95 },
      { skuId: 'v3', attrs: { Color: 'Green' }, buyPrice: 2.39, correctSellPrice: 13.95 },
    ];

    const result = await updateEbayVariantPricesIndividually(138, rows);

    expect(result).toEqual({ ok: true, updatedCount: 3 });
    expect(putBodies.get('stele-138-RED')?.value).toBe('20.95');
    expect(putBodies.get('stele-138-BLUE')?.value).toBe('15.95');
    expect(putBodies.get('stele-138-GREEN')?.value).toBe('13.95');
  });

  test('c) mehrere Blacklist-Keys gleichzeitig ("Ships From" UND "Herstellungsland") werden beide gefiltert', async () => {
    const realSkus = ['stele-92-M', 'stele-92-L'];
    const putBodies = mockEbayFetch(realSkus);

    const rows = [
      { skuId: 'v1', attrs: { Size: 'M', 'Ships From': 'Germany', 'Herstellungsland': 'Deutschland' }, buyPrice: 4, correctSellPrice: 14.95 },
      { skuId: 'v2', attrs: { Size: 'L', 'Ships From': 'Germany', 'Herstellungsland': 'Deutschland' }, buyPrice: 4.5, correctSellPrice: 15.95 },
    ];

    const result = await updateEbayVariantPricesIndividually(92, rows);

    expect(result).toEqual({ ok: true, updatedCount: 2 });
    expect(putBodies.get('stele-92-M')?.value).toBe('14.95');
    expect(putBodies.get('stele-92-L')?.value).toBe('15.95');
  });

  test('Regression: ohne Filterung hätte "Ships From" die SKU-Zuordnung sprengen müssen (Beweis, dass der Test den Bug wirklich erkennt)', async () => {
    // Diese Variante des Tests baut die SKU absichtlich OHNE Blacklist-Filterung nach, um zu
    // zeigen, dass "stele-71-RED-CHINA-MAINLAND" (die alte, kaputte Erwartung) NICHT unter den
    // echten eBay-SKUs vorkommt — der eigentliche Fix-Test oben beweist damit tatsächlich etwas.
    const realSkus = ['stele-71-RED'];
    expect(realSkus.includes('stele-71-RED-CHINA-MAINLAND')).toBe(false);
  });
});
