// Mengen-Fix A+B (15.10.2026). Beweis stele-220: Offer availableQuantity GRAY/BLACK = 0 bei Lager 3/2 → Käuferseite "ausverkauft".
// A: setInventoryItemQuantity zieht die Offer-Menge mit. B: jeder volle Offer-PUT (Preis, Beschreibung) setzt die Offer-Menge auf die Lagermenge.
import { afterAll, describe, expect, test } from 'bun:test';
import { applyOfferQuantity } from '../shared/offer-quantity';

process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/mengen-fix-test.db';
const ebay = await import('./ebay');
const { updateOfferPriceBySku } = await import('./price-monitor');
ebay.__setPriceLockCheckForTests(async () => false);
const locksSet: Array<{ pid: number; rows: unknown }> = [];
ebay.__setPriceLockSetterForTests(async (pid, lock) => { locksSet.push({ pid, rows: lock.rows }); });
afterAll(() => { ebay.__setPriceLockCheckForTests(null); ebay.__setPriceLockSetterForTests(null); });

// eBay-Mock: Inventory-Menge 3, Offer-Menge 0 (Fall GRAY), PUT-Bodies werden gesammelt.
function mock(inventoryQty = 3, offerQty: number | undefined = 0, offerPrice = '19.95') {
  const puts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url); const m = init?.method ?? 'GET';
    if (m === 'PUT') { puts.push({ url: u, body: JSON.parse(String(init?.body)) }); return new Response('', { status: 204 }); }
    if (u.includes('/inventory_item/')) return new Response(JSON.stringify({ sku: 'stele-220-GRAY', availability: { shipToLocationAvailability: { quantity: inventoryQty } }, product: { title: 'x' } }), { status: 200 });
    if (u.includes('/offer?sku=')) return new Response(JSON.stringify({ offers: [{ offerId: 'O1' }] }), { status: 200 });
    if (u.includes('/offer/O1')) return new Response(JSON.stringify({ offerId: 'O1', sku: 'stele-220-GRAY', ...(offerQty !== undefined ? { availableQuantity: offerQty } : {}), pricingSummary: { price: { value: offerPrice, currency: 'EUR' } }, listingDescription: 'd' }), { status: 200 });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, puts };
}

describe('applyOfferQuantity (rein)', () => {
  test('Offer 0, Lager 3 → 3 (geändert)', () => {
    const o: Record<string, unknown> = { availableQuantity: 0 };
    expect(applyOfferQuantity(o, 3)).toEqual({ changed: true, from: 0, to: 3 });
    expect(o.availableQuantity).toBe(3);
  });
  test('Lager unbekannt → Offer unverändert (nichts geraten)', () => {
    const o: Record<string, unknown> = { availableQuantity: 0 };
    expect(applyOfferQuantity(o, null).changed).toBe(false);
    expect(o.availableQuantity).toBe(0);
  });
});

describe('A: setInventoryItemQuantity zieht die Offer-Menge mit', () => {
  test('Ziel 4: PUT Inventory (4) UND PUT Offer (availableQuantity 4)', async () => {
    const { f, puts } = mock(3, 0);
    expect(await ebay.setInventoryItemQuantity('stele-220-GRAY', 4, 'tok', f, 19.95)).toBe(true);
    const inv = puts.find(p => p.url.includes('/inventory_item/'))!;
    const off = puts.find(p => p.url.includes('/offer/O1'))!;
    expect((inv.body.availability as { shipToLocationAvailability: { quantity: number } }).shipToLocationAvailability.quantity).toBe(4);
    expect(off.body.availableQuantity).toBe(4);
    expect((off.body.pricingSummary as { price: { value: string } }).price.value).toBe('19.95'); // Preis unberührt
  });
  test('Offer-Menge schon gleich → kein Offer-PUT', async () => {
    const { f, puts } = mock(3, 4);
    await ebay.setInventoryItemQuantity('stele-220-GRAY', 4, 'tok', f, 19.95);
    expect(puts.filter(p => p.url.includes('/offer/')).length).toBe(0);
  });
});

describe('Kalkulator #183: kein Offer-PUT ohne gleichen Käuferpreis', () => {
  test('Offer-Preis 20,95 ≠ Käufer 19,95 → 0 Offer-PUT, Sperre gesetzt (Lager-PUT erfolgt)', async () => {
    locksSet.length = 0;
    const { f, puts } = mock(3, 0, '20.95');
    expect(await ebay.setInventoryItemQuantity('stele-220-GRAY', 4, 'tok', f, 19.95)).toBe(true);
    expect(puts.filter(p => p.url.includes('/offer/')).length).toBe(0);
    expect(puts.filter(p => p.url.includes('/inventory_item/')).length).toBe(1);
    expect(locksSet).toEqual([{ pid: 220, rows: [{ sku: 'stele-220-GRAY', label: 'stele-220-GRAY', buyerPrice: 19.95, offerPrice: 20.95 }] }]);
  });
  test('Käuferpreis unbekannt → 0 Offer-PUT', async () => {
    const { f, puts } = mock(3, 0);
    await ebay.setInventoryItemQuantity('stele-220-GRAY', 4, 'tok', f, null);
    expect(puts.filter(p => p.url.includes('/offer/')).length).toBe(0);
  });
});

describe('B: volle Offer-PUTs schicken die Lagermenge statt der alten Offer-Menge', () => {
  test('Preis-PUT: Offer 0, Lager 3 → PUT mit availableQuantity 3 und neuem Preis', async () => {
    const { f, puts } = mock(3, 0);
    await updateOfferPriceBySku('stele-220-GRAY', 20.45, 'tok', f, false, { isLocked: async () => false });
    const off = puts.find(p => p.url.includes('/offer/O1'))!;
    expect(off.body.availableQuantity).toBe(3);
    expect((off.body.pricingSummary as { price: { value: string } }).price.value).toBe('20.45');
  });
  test('Beschreibungs-PUT: Offer 0, Lager 3 → PUT mit availableQuantity 3', async () => {
    const { f, puts } = mock(3, 0);
    await ebay.updateOfferDescriptionBySku('stele-220-GRAY', '<p>neu</p>', 'tok', f);
    const off = puts.find(p => p.url.includes('/offer/O1'))!;
    expect(off.body.availableQuantity).toBe(3);
    expect(off.body.listingDescription).toBe('<p>neu</p>');
  });
});
