// Mengen-Lese-Prüfung (15.10.2026): Fall stele-220 — Seller Hub 5 je Variante, Käuferseite GRAY/BLACK ausverkauft. Nur GET (Mock).
import { describe, expect, test } from 'bun:test';
import { evaluateQuantityRow } from '../shared/quantity-check';

process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/quantity-check-test.db';
const { runQuantityCheck } = await import('./quantity-check');
const { slugify } = await import('./ebay');

const base = { sku: 'stele-220-GRAY', label: 'GRAY', aliStock: 24, targetQty: 4 };
describe('evaluateQuantityRow', () => {
  test('Offer-Menge deckelt: Lager 5, Offer 3, verkauft 3 → Käuferseite 0, Ursache Offer', () => {
    const v = evaluateQuantityRow({ ...base, inventoryQty: 5, offerQty: 3, listingQty: 3, soldQty: 3 });
    expect(v.buyerAvailable).toBe(0);
    expect(v.note).toContain('Offer-Menge 3 deckelt');
  });
  test('ok: Lager 4 = Ziel 4, Käuferseite 2 frei', () => {
    expect(evaluateQuantityRow({ ...base, inventoryQty: 4, offerQty: null, listingQty: 5, soldQty: 3 }).note).toBe('ok');
  });
  test('Lager ≠ App-Ziel → Hinweis, nächster Lauf setzt Ziel', () => {
    expect(evaluateQuantityRow({ ...base, inventoryQty: 5, offerQty: null, listingQty: 8, soldQty: 3 }).note).toContain('nächster Lauf setzt 4');
  });
  test('Käuferseite 0 ohne Offer-Menge → Ursache offen (nichts geraten)', () => {
    expect(evaluateQuantityRow({ ...base, inventoryQty: 5, offerQty: null, listingQty: 3, soldQty: 3 }).note).toContain('Ursache offen');
  });
});

describe('runQuantityCheck (Mock, nur GET)', () => {
  test('liest Lager/Offer/GetItem je Variante, keine Schreibaufrufe', async () => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).includes('/inventory_item/')) return new Response(JSON.stringify({ availability: { shipToLocationAvailability: { quantity: 5 } } }), { status: 200 });
      return new Response(JSON.stringify({ offers: [{ availableQuantity: 3 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const xml = '<R><Ack>Success</Ack><Item><Variations><Variation><SKU>stele-220-GRAY</SKU><StartPrice>19.95</StartPrice><Quantity>3</Quantity><SellingStatus><QuantitySold>3</QuantitySold></SellingStatus></Variation></Variations></Item></R>';
    const r = await runQuantityCheck({ productId: 220, ebayListingId: '1', variantEntries: [{ attrs: { 'Color Name': 'GRAY' }, stock: 24 }], slug: slugify, maxQty: 4,
      token: 't', getItemXml: async () => ({ httpStatus: 200, xml }), fetchFn: f });
    expect(r.rows.map(x => [x.sku, x.inventoryQty, x.offerQty, x.listingQty, x.soldQty, x.buyerAvailable, x.aliStock, x.targetQty])).toEqual([['stele-220-GRAY', 5, 3, 3, 3, 0, 24, 4]]);
    expect(calls.every(c => c.startsWith('GET '))).toBe(true);
  });
});
