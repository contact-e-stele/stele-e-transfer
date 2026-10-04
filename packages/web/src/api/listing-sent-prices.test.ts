// A-021: Beim Listen werden die an eBay gesendeten Preise eingesammelt (OUT-Array sentPrices) und erst NACH erfolgreichem Listing gespeichert.
// Mit gemocktem eBay (global fetch): Erfolg → sentPrices = genau die Offer-Preise aus den POST-/offer-Bodys; Fehler beim Publish → listOnEbay wirft,
// der Aufrufer speichert nichts. Fixture angelehnt an stele-193 (Stufe C, China, Preise 13,95–28,95 €).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/listing-sent-prices-test.db';
process.env.EBAY_REFRESH_TOKEN = process.env.EBAY_REFRESH_TOKEN || 'test-refresh-token';
const { listOnEbay } = await import('./ebay');
import { sentPricesToPatch } from '../shared/sent-prices';
import { parseVariantSellPrices } from '../shared/pricing';
import type { SentListingPrice } from './ebay';

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let failPublish: boolean;
const realFetch = globalThis.fetch;

function installMock() {
  calls = [];
  let offerCounter = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    calls.push({ method, url, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (url.includes('/identity/v1/oauth2/token')) return json({ access_token: 'tok', expires_in: 7200 });
    if (url.includes('/sell/inventory/v1/location/')) return json({});
    if (method === 'GET' && /\/offer\?sku=/.test(url)) return json({ offers: [] });
    if (method === 'PUT' && /\/inventory_item(_group)?\//.test(url)) return new Response('', { status: 204 });
    if (method === 'POST' && /\/sell\/inventory\/v1\/offer$/.test(url)) return json({ offerId: 'OFFER-' + ++offerCounter }, 201);
    if (method === 'POST' && /publish/.test(url)) {
      if (failPublish) return json({ errors: [{ errorId: 25002, message: 'Publish failed (Test)' }] }, 400);
      return json({ listingId: '198687312238' });
    }
    if (/commerce\/taxonomy/.test(url)) return json({ aspects: [], categorySuggestions: [] });
    return json({}, 200);
  }) as unknown as typeof fetch;
}

beforeEach(() => { failPublish = false; installMock(); });
afterEach(() => { globalThis.fetch = realFetch; });

const offerBodies = () => calls.filter(c => c.method === 'POST' && /\/sell\/inventory\/v1\/offer$/.test(c.url)).map(c => c.body as { sku: string; pricingSummary: { price: { value: string } } });

const baseInput = {
  title: 'Test Hängematte', description: '<p>Beschreibung</p>', quantity: 3, condition: 'NEW' as const, imageUrls: ['https://i.ebayimg.com/a.jpg'],
  categoryId: '57920', adRate: 5, shipsFrom: 'China', targetMarginEur: 2,
  // Pflicht für Varianten-Listings (buildRegulatoryBlock): EU-verantwortliche Person (Test-Fixture)
  gpsr: {
    eu: { name: 'Muster EU SARL', address: '12 Rue de Test', postalCode: '75017', city: 'Paris', country: 'FR', email: 'eu@example.fr', phone: null },
    manufacturer: null, manufacturerMissing: [], missing: [],
  },
};

describe('listOnEbay — Einzelartikel: sentPrices = Offer-Preis', () => {
  test('Erfolg: sentPrices enthält genau den gesendeten Preis (skuId null); Patch → sellPrice', async () => {
    const sentPrices: SentListingPrice[] = [];
    const id = await listOnEbay({ ...baseInput, sku: 'stele-901', price: 13.95, sentPrices });
    expect(id).toBe('198687312238');
    expect(offerBodies()).toHaveLength(1);
    expect(offerBodies()[0].pricingSummary.price.value).toBe('13.95');
    expect(sentPrices).toEqual([{ skuId: null, sku: 'stele-901', price: 13.95 }]);
    expect(sentPricesToPatch(sentPrices)).toEqual({ sellPrice: 13.95 });
  });

  test('Fehler beim Publish: listOnEbay wirft — der Aufrufer speichert nichts (der Patch wird nur im Erfolgszweig angewandt)', async () => {
    failPublish = true;
    const sentPrices: SentListingPrice[] = [];
    await expect(listOnEbay({ ...baseInput, sku: 'stele-901', price: 13.95, sentPrices })).rejects.toThrow();
    // Der Aufrufer (index.ts) wertet sentPrices nur nach erfolgreichem listOnEbay aus: hier kommt er nie dorthin.
  });
});

describe('listOnEbay — Varianten: sentPrices = Offer-Preise je Variante', () => {
  const groups = [{ name: 'Größe', values: ['S', 'M'] }];
  const variantPrices = [
    { skuId: '1001', attrs: { 'Größe': 'S' }, price: 3.15, stock: 5, ebayPrice: 13.95 },
    { skuId: '1002', attrs: { 'Größe': 'M' }, price: 6.29, stock: 5, ebayPrice: 19.95 },
  ];

  test('Erfolg: je Variante der gesendete Preis (skuId → Preis); Patch → variant_sell_prices exakt wie gesendet, kein sellPrice', async () => {
    const sentPrices: SentListingPrice[] = [];
    const id = await listOnEbay({ ...baseInput, sku: 'stele-902', price: 13.95, variantGroups: groups, variantPrices, sentPrices });
    expect(id).toBe('198687312238');
    const sent = Object.fromEntries(offerBodies().map(b => [b.sku, b.pricingSummary.price.value]));
    expect(sent).toEqual({ 'stele-902-S': '13.95', 'stele-902-M': '19.95' });
    expect(sentPrices.map(s => [s.skuId, s.sku, s.price])).toEqual([['1001', 'stele-902-S', 13.95], ['1002', 'stele-902-M', 19.95]]);
    const patch = sentPricesToPatch(sentPrices);
    expect(parseVariantSellPrices(patch.variantSellPrices)).toEqual({ '1001': 13.95, '1002': 19.95 });
    expect(patch.sellPrice).toBeUndefined();
  });

  test('Fehler beim Publish der Gruppe: listOnEbay wirft (nichts zu speichern)', async () => {
    failPublish = true;
    const sentPrices: SentListingPrice[] = [];
    await expect(listOnEbay({ ...baseInput, sku: 'stele-902', price: 13.95, variantGroups: groups, variantPrices, sentPrices })).rejects.toThrow();
  });

  test('ohne sentPrices-Parameter (bisheriger Aufruf) ändert sich nichts', async () => {
    const id = await listOnEbay({ ...baseInput, sku: 'stele-902', price: 13.95, variantGroups: groups, variantPrices });
    expect(id).toBe('198687312238');
  });
});

describe('sentPricesToPatch (rein)', () => {
  test('leer / ungültige Preise → leerer Patch (nichts gespeichert)', () => {
    expect(sentPricesToPatch([])).toEqual({});
    expect(sentPricesToPatch([{ skuId: 'a', sku: 'x', price: 0 }, { skuId: null, sku: 'y', price: NaN }])).toEqual({});
  });

  test('Varianten: Map skuId → Preis, bei doppelter skuId gewinnt der zuletzt gesendete; Einzelartikel: sellPrice', () => {
    expect(parseVariantSellPrices(sentPricesToPatch([
      { skuId: 'a', sku: 'x-A', price: 13.95 }, { skuId: 'b', sku: 'x-B', price: 15.95 }, { skuId: 'a', sku: 'x-A2', price: 14.95 },
    ]).variantSellPrices)).toEqual({ a: 14.95, b: 15.95 });
    expect(sentPricesToPatch([{ skuId: null, sku: 'stele-1', price: 12.95 }])).toEqual({ sellPrice: 12.95 });
  });
});

// Verdrahtung (Regressionsschutz ohne Datenbank): index.ts reicht das OUT-Array an listOnEbay und wendet den Patch NUR im Erfolgs-Update an.
describe('index.ts: gesendete Preise nur im Erfolgszweig gespeichert', () => {
  const src = readFileSync(resolve(import.meta.dir, 'index.ts'), 'utf8');
  const ok = src.indexOf('...sentPricesToPatch(sentPrices)');

  test('sentPrices wird an listOnEbay übergeben und der Patch steht im Update mit ebayStatus "listed"', () => {
    expect(src).toMatch(/const sentPrices: SentListingPrice\[\] = \[\];/);
    expect(src).toMatch(/listOnEbay\(\{[\s\S]{0,400}sentPrices,/);
    expect(ok).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, ok - 400), ok);
    expect(before).toContain("ebayStatus: 'listed'");
  });

  test('der Patch kommt nirgends im Fehlerzweig (ebayStatus "error") vor', () => {
    expect(src.split('sentPricesToPatch(').length - 1).toBe(1); // genau eine Anwendung
  });
});
