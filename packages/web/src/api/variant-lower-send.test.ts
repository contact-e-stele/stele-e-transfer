// OFFEN 033: Senden "Auswahl senken" — nur die genannten SKUs, nie anheben (lowerOnly am Live-Preis). Mock wie variant-raise.test.ts.
import { describe, expect, test } from 'bun:test';
process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/variant-lower-test.db';
const { sendVariantPriceChanges, sendVariantRaises } = await import('./price-monitor');

const GROUPS = [{ name: 'Menge', values: ['200pcs', '100pcs A', '100pcs B'] }];
const entries = [
  { skuId: 'v200', attrs: { Menge: '200pcs' }, price: 4.79, stock: 50 },
  { skuId: 'v100a', attrs: { Menge: '100pcs A' }, price: 3.15, stock: 50 },
  { skuId: 'v100b', attrs: { Menge: '100pcs B' }, price: 3.45, stock: 50 },
];
const skuOf = (label: string) => 'stele-119-' + label.toUpperCase().replace(/[^A-Z0-9]/g, '-');
function mockEbay(live: Record<string, string>) {
  const puts: Array<{ sku: string; price: string }> = [];
  const fn = (async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.includes('/inventory_item_group/')) return new Response(JSON.stringify({ variantSKUs: GROUPS[0].values.map(skuOf) }), { status: 200 });
    const m = /offer\?sku=([^&]+)/.exec(u);
    if (m) { const sku = decodeURIComponent(m[1]); return new Response(JSON.stringify({ offers: [{ offerId: 'o-' + sku, sku }] }), { status: 200 }); }
    const o = /\/offer\/o-(.+)$/.exec(u);
    if (o) {
      if (init?.method === 'PUT') { puts.push({ sku: o[1], price: JSON.parse(init.body as string).pricingSummary.price.value }); return new Response('', { status: 204 }); }
      return new Response(JSON.stringify({ offerId: 'o-' + o[1], sku: o[1], pricingSummary: { price: { value: live[o[1]] ?? '16.95', currency: 'EUR' } } }), { status: 200 });
    }
    throw new Error('Unmocked: ' + u);
  }) as unknown as typeof fetch;
  return { fn, puts };
}

describe('sendVariantPriceChanges(direction "lower")', () => {
  test('nur die genannte SKU wird gesenkt (16,95 → 15,95), andere Varianten unberührt', async () => {
    const { fn, puts } = mockEbay({});
    const r = await sendVariantPriceChanges(119, GROUPS, entries, [{ skuId: 'v200', newSell: 15.95 }], 'tok', fn, 'lower');
    expect(r.resolved).toBe(true);
    expect(r.results[0]).toMatchObject({ skuId: 'v200', ok: true });
    expect(puts).toEqual([{ sku: skuOf('200pcs'), price: '15.95' }]);
  });
  test('nie anheben: eBay steht schon auf 14,95 (≤ 15,95) → kein PUT, "skipped"', async () => {
    const { fn, puts } = mockEbay({ [skuOf('200pcs')]: '14.95' });
    const r = await sendVariantPriceChanges(119, GROUPS, entries, [{ skuId: 'v200', newSell: 15.95 }], 'tok', fn, 'lower');
    expect(puts).toHaveLength(0);
    expect(r.results[0].skipped).toContain('nie anheben');
  });
  test('Anheben-Weg unverändert: sendVariantRaises senkt nie (eBay 16,95, neu 15,95 → kein PUT)', async () => {
    const { fn, puts } = mockEbay({});
    const r = await sendVariantRaises(119, GROUPS, entries, [{ skuId: 'v200', newSell: 15.95 }], 'tok', fn);
    expect(puts).toHaveLength(0);
    expect(r.results[0].skipped).toContain('nie senken');
  });
});

describe('sendVariantPriceChanges(direction "raise") — "Auswahl anheben"', () => {
  test('nur die genannte SKU wird angehoben (16,95 → 17,95), nie senken', async () => {
    const { fn, puts } = mockEbay({});
    const r = await sendVariantPriceChanges(119, GROUPS, entries, [{ skuId: 'v100a', newSell: 17.95 }], 'tok', fn, 'raise');
    expect(r.results[0]).toMatchObject({ skuId: 'v100a', ok: true });
    expect(puts).toEqual([{ sku: skuOf('100pcs A'), price: '17.95' }]);
    const b = mockEbay({ [skuOf('100pcs A')]: '18.95' });
    const r2 = await sendVariantPriceChanges(119, GROUPS, entries, [{ skuId: 'v100a', newSell: 17.95 }], 'tok', b.fn, 'raise');
    expect(b.puts).toHaveLength(0);
    expect(r2.results[0].skipped).toContain('nie senken');
  });
});
