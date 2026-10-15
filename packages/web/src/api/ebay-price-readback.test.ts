// App-Preise ← eBay (Inhaber 15.10.2026): Fall stele-220, App 20,95/22,95/21,95, eBay 19,95/21,95/20,95. eBay nur GET (Mock).
import { describe, expect, test } from 'bun:test';
import { readEbaySellPrices, applyEbayPrices, readOfferPrice } from './ebay-price-readback';
import { resolveVariantEntries } from '../shared/variant-resolver';

const groups = [{ name: 'Color Name', values: ['GRAY', 'Blue', 'black'] }];
const entries = [
  { skuId: 'g', attrs: { 'Color Name': 'GRAY' }, price: 11.79 },
  { skuId: 'b', attrs: { 'Color Name': 'Blue' }, price: 12.79 },
  { skuId: 'k', attrs: { 'Color Name': 'black' }, price: 11.89 },
];
const skuOf = Object.fromEntries(resolveVariantEntries(220, groups, entries).map(r => [r.entry!.skuId, r.sku]));
const ebay: Record<string, string> = { [skuOf.g]: '19.95', [skuOf.b]: '21.95', [skuOf.k]: '20.95' };
const calls: string[] = [];
const mockFetch = (async (url: string, init?: RequestInit) => {
  calls.push(`${init?.method ?? 'GET'} ${url}`);
  const sku = decodeURIComponent(String(url).match(/sku=([^&]+)/)?.[1] ?? '');
  return new Response(JSON.stringify({ offers: ebay[sku] ? [{ pricingSummary: { price: { value: ebay[sku] } } }] : [] }), { status: 200 });
}) as unknown as typeof fetch;
const app = { g: 20.95, b: 22.95, k: 21.95 };

describe('App-Preise aus eBay übernehmen', () => {
  test('stele-220: liest 19,95/21,95/20,95, nur GET', async () => {
    calls.length = 0;
    const rb = await readEbaySellPrices({ productId: 220, groups, entries, isVariant: true, appSellPrices: app, appSellPrice: null, token: 't',
      getGroupSkus: async () => Object.values(skuOf), fetchFn: mockFetch });
    expect(rb.ok).toBe(true);
    expect(rb.rows.map(r => [r.skuId, r.appPrice, r.ebayPrice])).toEqual([['g', 20.95, 19.95], ['b', 22.95, 21.95], ['k', 21.95, 20.95]]);
    expect(calls.every(c => c.startsWith('GET '))).toBe(true);
    const next = applyEbayPrices(app, rb.rows);
    expect(next.variantSellPrices).toEqual({ g: 19.95, b: 21.95, k: 20.95 });
    expect(next.changed).toEqual([{ skuId: 'g', from: 20.95, to: 19.95 }, { skuId: 'b', from: 22.95, to: 21.95 }, { skuId: 'k', from: 21.95, to: 20.95 }]);
  });
  test('Variante nicht in der eBay-Gruppe → ok=false, Zeile ohne Preis', async () => {
    const rb = await readEbaySellPrices({ productId: 220, groups, entries, isVariant: true, appSellPrices: app, appSellPrice: null, token: 't',
      getGroupSkus: async () => [skuOf.g, skuOf.b], fetchFn: mockFetch });
    expect(rb.ok).toBe(false);
    expect(rb.rows.find(r => r.skuId === 'k')?.ebayPrice).toBeNull();
    expect(applyEbayPrices(app, rb.rows).variantSellPrices.k).toBe(21.95); // ungelesen → unverändert
  });
  test('mehrere Offers mit verschiedenen Preisen → kein Preis (nichts geraten)', async () => {
    const f = (async () => new Response(JSON.stringify({ offers: [{ pricingSummary: { price: { value: '19.95' } } }, { pricingSummary: { price: { value: '20.95' } } }] }), { status: 200 })) as unknown as typeof fetch;
    expect((await readOfferPrice('x', 't', f)).price).toBeNull();
  });
  test('Einzelartikel: SKU stele-<id>', async () => {
    const f = (async (url: string) => new Response(JSON.stringify({ offers: String(url).includes('sku=stele-5&') ? [{ pricingSummary: { price: { value: '14.95' } } }] : [] }), { status: 200 })) as unknown as typeof fetch;
    const rb = await readEbaySellPrices({ productId: 5, groups: [], entries: [], isVariant: false, appSellPrices: {}, appSellPrice: 15.95, token: 't', getGroupSkus: async () => [], fetchFn: f });
    expect(rb.rows).toEqual([{ skuId: null, sku: 'stele-5', label: '', ebayPrice: 14.95, appPrice: 15.95, error: undefined }]);
  });
});
