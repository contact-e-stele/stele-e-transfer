// App-Preise ← eBay + K-011 (15.10.2026): Fall stele-220. eBay-Käuferpreis (Angebotsseite / GetItem) 19,95/21,95/20,95,
// Inventory-Angebotsdaten 20,95/22,95/21,95, App 20,95/22,95/21,95. Wahrheit = Käuferpreis. eBay nur GET (Mock).
import { describe, expect, test } from 'bun:test';
import { readEbaySellPrices, applyEbayPrices, readOfferPrice } from './ebay-price-readback';
import { resolveVariantEntries } from '../shared/variant-resolver';
import { parseGetItemBuyerPrices, priceMismatches, productIdFromSku } from '../shared/ebay-buyer-price';

process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/ebay-price-readback-test.db';
const { updateOfferPriceBySku } = await import('./price-monitor');

const groups = [{ name: 'Color Name', values: ['GRAY', 'Blue', 'black'] }];
const entries = [
  { skuId: 'g', attrs: { 'Color Name': 'GRAY' }, price: 11.79 },
  { skuId: 'b', attrs: { 'Color Name': 'Blue' }, price: 12.79 },
  { skuId: 'k', attrs: { 'Color Name': 'black' }, price: 11.89 },
];
const skuOf = Object.fromEntries(resolveVariantEntries(220, groups, entries).map(r => [r.entry!.skuId, r.sku]));
const offer: Record<string, string> = { [skuOf.g]: '20.95', [skuOf.b]: '22.95', [skuOf.k]: '21.95' };
const calls: string[] = [];
const mockFetch = (async (url: string, init?: RequestInit) => {
  calls.push(`${init?.method ?? 'GET'} ${url}`);
  const sku = decodeURIComponent(String(url).match(/sku=([^&]+)/)?.[1] ?? '');
  return new Response(JSON.stringify({ offers: offer[sku] ? [{ pricingSummary: { price: { value: offer[sku] } } }] : [] }), { status: 200 });
}) as unknown as typeof fetch;
const app = { g: 20.95, b: 22.95, k: 21.95 };

// GetItem-Ausschnitt wie eBay ihn liefert (Pictures-Block mit VariationSpecificPictureSet darf nicht als Variation zählen).
const getItemXml = `<?xml version="1.0"?><GetItemResponse><Ack>Success</Ack><Item><ItemID>198712713157</ItemID><StartPrice currencyID="EUR">19.95</StartPrice>
<Variations>
<Variation><SKU>${skuOf.g}</SKU><StartPrice currencyID="EUR">19.95</StartPrice><Quantity>3</Quantity><VariationSpecifics><NameValueList><Name>Farbe</Name><Value>GRAY</Value></NameValueList></VariationSpecifics><SellingStatus><QuantitySold>3</QuantitySold></SellingStatus></Variation>
<Variation><SKU>${skuOf.b}</SKU><StartPrice currencyID="EUR">21.95</StartPrice><Quantity>5</Quantity><SellingStatus><QuantitySold>2</QuantitySold></SellingStatus></Variation>
<Variation><SKU>${skuOf.k}</SKU><StartPrice currencyID="EUR">20.95</StartPrice><Quantity>4</Quantity><SellingStatus><QuantitySold>2</QuantitySold></SellingStatus></Variation>
<Pictures><VariationSpecificName>Farbe</VariationSpecificName><VariationSpecificPictureSet><VariationSpecificValue>GRAY</VariationSpecificValue><PictureURL>x</PictureURL></VariationSpecificPictureSet></Pictures>
</Variations></Item></GetItemResponse>`;
const buyer = async () => parseGetItemBuyerPrices(getItemXml);
const read = (getGroupSkus = async () => Object.values(skuOf) as string[]) => readEbaySellPrices({
  productId: 220, groups, entries, isVariant: true, appSellPrices: app, appSellPrice: null, token: 't', getGroupSkus, getBuyerPrices: buyer, fetchFn: mockFetch,
});

describe('K-011 Käuferpreis = Wahrheit', () => {
  test('GetItem-Parser: 3 Varianten mit Käuferpreis, Pictures-Block zählt nicht', () => {
    const p = parseGetItemBuyerPrices(getItemXml);
    expect(p.isVariation).toBe(true);
    expect(p.rows.map(r => [r.sku, r.price, r.quantity, r.quantitySold])).toEqual([[skuOf.g, 19.95, 3, 3], [skuOf.b, 21.95, 5, 2], [skuOf.k, 20.95, 4, 2]]);
    expect(parseGetItemBuyerPrices('<GetItemResponse><Ack>Failure</Ack><LongMessage>Ungültig</LongMessage></GetItemResponse>').error).toBe('Ungültig');
  });
  test('stele-220: Käufer 19,95/21,95/20,95 neben Angebotsdaten 20,95/22,95/21,95; nur GET', async () => {
    calls.length = 0;
    const rb = await read();
    expect(rb.ok).toBe(true);
    expect(rb.rows.map(r => [r.skuId, r.appPrice, r.ebayPrice, r.offerPrice])).toEqual([['g', 20.95, 19.95, 20.95], ['b', 22.95, 21.95, 22.95], ['k', 21.95, 20.95, 21.95]]);
    expect(calls.every(c => c.startsWith('GET '))).toBe(true);
  });
  test('Abweichung je 1,00 € → 3 Treffer (Sperre); gleiche Preise → keine', async () => {
    const rb = await read();
    const rows = rb.rows.map(r => ({ ...r, buyerPrice: r.ebayPrice, offerPrice: r.offerPrice ?? null }));
    expect(priceMismatches(rows).map(m => m.sku)).toEqual([skuOf.g, skuOf.b, skuOf.k]);
    expect(priceMismatches(rows.map(r => ({ ...r, offerPrice: r.buyerPrice })))).toEqual([]);
    expect(priceMismatches(rows.map(r => ({ ...r, offerPrice: null })))).toEqual([]); // unbekannt ≠ falsch
  });
  test('App-Preise übernehmen = Käuferpreis 19,95/21,95/20,95', async () => {
    const next = applyEbayPrices(app, (await read()).rows);
    expect(next.variantSellPrices).toEqual({ g: 19.95, b: 21.95, k: 20.95 });
  });
  test('Variante nicht in der eBay-Gruppe → ok=false, App-Preis bleibt', async () => {
    const rb = await read(async () => [skuOf.g, skuOf.b]);
    expect(rb.ok).toBe(false);
    expect(applyEbayPrices(app, rb.rows).variantSellPrices.k).toBe(21.95);
  });
  test('GetItem fehlgeschlagen → nichts (kein Raten aus Angebotsdaten)', async () => {
    const rb = await readEbaySellPrices({ productId: 220, groups, entries, isVariant: true, appSellPrices: app, appSellPrice: null, token: 't',
      getGroupSkus: async () => Object.values(skuOf) as string[], getBuyerPrices: async () => ({ isVariation: false, rows: [], error: 'HTTP 500' }), fetchFn: mockFetch });
    expect(rb.ok).toBe(false);
    expect(rb.rows).toEqual([]);
  });
  test('mehrere Offers mit verschiedenen Preisen → kein Angebotspreis', async () => {
    const f = (async () => new Response(JSON.stringify({ offers: [{ pricingSummary: { price: { value: '19.95' } } }, { pricingSummary: { price: { value: '20.95' } } }] }), { status: 200 })) as unknown as typeof fetch;
    expect((await readOfferPrice('x', 't', f)).price).toBeNull();
  });
  test('Einzelartikel: Käuferpreis aus Item/StartPrice', async () => {
    const f = (async () => new Response(JSON.stringify({ offers: [{ pricingSummary: { price: { value: '15.95' } } }] }), { status: 200 })) as unknown as typeof fetch;
    const rb = await readEbaySellPrices({ productId: 5, groups: [], entries: [], isVariant: false, appSellPrices: {}, appSellPrice: 15.95, token: 't', getGroupSkus: async () => [],
      getBuyerPrices: async () => parseGetItemBuyerPrices('<R><Ack>Success</Ack><Item><SKU>stele-5</SKU><StartPrice currencyID="EUR">14.95</StartPrice></Item></R>'), fetchFn: f });
    expect(rb.rows).toEqual([{ skuId: null, sku: 'stele-5', label: '', ebayPrice: 14.95, offerPrice: 15.95, appPrice: 15.95, error: undefined }]);
  });
});

describe('K-011 Sperre in updateOfferPriceBySku', () => {
  const sent: string[] = [];
  const f = (async (url: string, init?: RequestInit) => { sent.push(`${init?.method ?? 'GET'} ${url}`); return new Response('{}', { status: 500 }); }) as unknown as typeof fetch;
  test('gesperrt → kein einziger eBay-Aufruf, Fehlertext "K-011 Sperre"', async () => {
    sent.length = 0;
    const r = await updateOfferPriceBySku(skuOf.g, 20.45, 'tok', f, true, { isLocked: async (pid) => pid === 220 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('K-011 Sperre');
    expect(sent).toEqual([]);
  });
  test('Angleichen (bypassPriceLock) → eBay wird angesprochen', async () => {
    sent.length = 0;
    await updateOfferPriceBySku(skuOf.g, 19.95, 'tok', f, false, { bypassPriceLock: true, isLocked: async () => true });
    expect(sent.length).toBeGreaterThan(0);
  });
  test('nicht gesperrt → eBay wird angesprochen (Verhalten wie bisher)', async () => {
    sent.length = 0;
    await updateOfferPriceBySku(skuOf.g, 20.45, 'tok', f, true, { isLocked: async () => false });
    expect(sent.length).toBeGreaterThan(0);
  });
  test('Produkt-ID aus SKU', () => {
    expect([productIdFromSku('stele-220-GRAY'), productIdFromSku('stele-220'), productIdFromSku('stele-220-GROUP'), productIdFromSku('x-1')]).toEqual([220, 220, 220, null]);
  });
});
