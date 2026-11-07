// Nebenbefund PR 285: Beschreibungs-PUT (voller Offer-PUT) nur bei Offer-Preis = Käuferpreis (GetItem).
// Injizierter fetch — kein echter eBay-Call.
import { afterEach, describe, expect, test } from 'bun:test';
import { updateOfferDescriptionBySku, updateOfferDescriptionInventory, reviseListingDescription, __setPriceLockSetterForTests, type reviseListingContent } from './ebay';
import { buyerPriceMap, parseGetItemBuyerPrices } from '../shared/ebay-buyer-price';

const HTML = '<p>Neu</p>';
type Lock = { pid: number; rows: Array<{ sku: string; buyerPrice: number; offerPrice: number }> };

// Einzel-SKU stele-1 → OFF-1 (Preis p1); Varianten stele-2-A/B → OFF-A/OFF-B (Preise pA/pB); Gruppe stele-2-GROUP.
function makeFetch(prices: { p1?: string; pA?: string; pB?: string } = {}) {
  const puts: string[] = [];
  const offerPrice: Record<string, string | undefined> = { 'OFF-1': prices.p1 ?? '9.99', 'OFF-A': prices.pA ?? '5.95', 'OFF-B': prices.pB ?? '6.95' };
  let group: Record<string, unknown> = { description: 'alt', variantSKUs: ['stele-2-A', 'stele-2-B'] };
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/inventory_item_group/')) {
      if (!u.includes('stele-2-GROUP')) return new Response('', { status: 404 });
      if (method === 'GET') return new Response(JSON.stringify(group), { status: 200 });
      group = JSON.parse(String(init?.body)); puts.push('GROUP');
      return new Response(null, { status: 204 });
    }
    if (u.includes('/inventory_item/')) return new Response(JSON.stringify({ availability: { shipToLocationAvailability: { quantity: 3 } } }), { status: 200 });
    if (u.includes('/offer?sku=')) {
      const sku = decodeURIComponent(u.match(/sku=([^&]+)/)?.[1] ?? '');
      const offers = sku === 'stele-1' ? [{ offerId: 'OFF-1' }] : sku === 'stele-2-A' ? [{ offerId: 'OFF-A' }] : sku === 'stele-2-B' ? [{ offerId: 'OFF-B' }] : [];
      return new Response(JSON.stringify({ offers }), { status: 200 });
    }
    const id = u.split('/').pop() ?? '';
    if (method === 'GET') {
      const v = offerPrice[id];
      return new Response(JSON.stringify({ sku: 'x', listingDescription: 'alt', ...(v ? { pricingSummary: { price: { value: v, currency: 'EUR' } } } : {}) }), { status: 200 });
    }
    puts.push(id);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { fetchFn, puts };
}

const locks: Lock[] = [];
__setPriceLockSetterForTests(async (pid, lock) => { locks.push({ pid, rows: lock.rows }); });
afterEach(() => { locks.length = 0; });

describe('updateOfferDescriptionBySku — Käuferpreis-Vergleich vor dem vollen PUT', () => {
  test('Offer-Preis = Käuferpreis → PUT', async () => {
    const { fetchFn, puts } = makeFetch();
    const r = await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn, undefined, 9.99);
    expect(r.ok).toBe(true);
    expect(puts).toEqual(['OFF-1']);
  });
  test('Abweichung (Käufer 8,95 ≠ Angebotsdaten 9,99) → kein PUT, Sperre gesetzt', async () => {
    const { fetchFn, puts } = makeFetch();
    const r = await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn, undefined, 8.95);
    expect(r.ok).toBe(false);
    expect(r.priceBlocked).toBe(true);
    expect(r.error).toContain('eBay-Preise uneinheitlich');
    expect(puts).toEqual([]);
    expect(locks).toEqual([{ pid: 1, rows: [{ sku: 'stele-1', label: 'stele-1', buyerPrice: 8.95, offerPrice: 9.99 } as never] }]);
  });
  test('Käuferpreis unbekannt → kein PUT, keine Sperre', async () => {
    const { fetchFn, puts } = makeFetch();
    const r = await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn, undefined, undefined);
    expect(r.ok).toBe(false);
    expect(r.priceBlocked).toBe(true);
    expect(puts).toEqual([]);
    expect(locks).toEqual([]);
  });
  test('Offer-Preis nicht lesbar → kein PUT', async () => {
    const { fetchFn, puts } = makeFetch({ p1: '' });
    const r = await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn, undefined, 9.99);
    expect(r.priceBlocked).toBe(true);
    expect(puts).toEqual([]);
  });
});

describe('updateOfferDescriptionInventory — Varianten', () => {
  test('alle Varianten gleich → beide Offers + Gruppe', async () => {
    const { fetchFn, puts } = makeFetch();
    const r = await updateOfferDescriptionInventory(2, HTML, undefined, fetchFn, async () => 'tok', undefined, new Map([['stele-2-A', 5.95], ['stele-2-B', 6.95]]));
    expect(r.ok).toBe(true);
    expect(puts).toEqual(['OFF-A', 'OFF-B', 'GROUP']);
  });
  test('Käuferpreis einer Variante fehlt → Abbruch VOR dem ersten PUT', async () => {
    const { fetchFn, puts } = makeFetch();
    const r = await updateOfferDescriptionInventory(2, HTML, undefined, fetchFn, async () => 'tok', undefined, new Map([['stele-2-A', 5.95]]));
    expect(r.ok).toBe(false);
    expect(r.priceBlocked).toBe(true);
    expect(r.error).toContain('stele-2-B');
    expect(puts).toEqual([]);
  });
  test('Abweichung bei Variante B → Gruppe NICHT geändert, priceBlocked', async () => {
    const { fetchFn, puts } = makeFetch({ pB: '7.95' });
    const r = await updateOfferDescriptionInventory(2, HTML, undefined, fetchFn, async () => 'tok', undefined, new Map([['stele-2-A', 5.95], ['stele-2-B', 6.95]]));
    expect(r.ok).toBe(false);
    expect(r.priceBlocked).toBe(true);
    expect(puts).not.toContain('GROUP');
    expect(puts).not.toContain('OFF-B');
  });
});

describe('reviseListingDescription — Käuferpreise per GetItem, kein Trading-Fallback bei Preissperre', () => {
  const itemXml = (price: string) => `<GetItemResponse><Ack>Success</Ack><Item><SKU>stele-1</SKU><StartPrice currencyID="EUR">${price}</StartPrice></Item></GetItemResponse>`;
  test('GetItem-Preis = Offer-Preis → Inventory-PUT, Trading nicht aufgerufen', async () => {
    const { fetchFn, puts } = makeFetch();
    let trading = 0;
    const tradingFn = (async () => { trading++; return { ok: true }; }) as unknown as typeof reviseListingContent;
    const r = await reviseListingDescription(1, 'ITEM-1', { htmlDescription: HTML }, fetchFn, async () => 'tok', tradingFn, async () => ({ httpStatus: 200, xml: itemXml('9.99') }));
    expect(r.ok).toBe(true);
    expect(puts).toEqual(['OFF-1']);
    expect(trading).toBe(0);
  });
  test('GetItem-Preis weicht ab → kein PUT, KEIN Trading-Fallback, ok:false', async () => {
    const { fetchFn, puts } = makeFetch();
    let trading = 0;
    const tradingFn = (async () => { trading++; return { ok: true }; }) as unknown as typeof reviseListingContent;
    const r = await reviseListingDescription(1, 'ITEM-1', { htmlDescription: HTML }, fetchFn, async () => 'tok', tradingFn, async () => ({ httpStatus: 200, xml: itemXml('8.95') }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('eBay-Preise uneinheitlich');
    expect(puts).toEqual([]);
    expect(trading).toBe(0);
  });
  test('GetItem wirft → Käuferpreis unbekannt → kein PUT, kein Trading-Fallback', async () => {
    const { fetchFn, puts } = makeFetch();
    let trading = 0;
    const tradingFn = (async () => { trading++; return { ok: true }; }) as unknown as typeof reviseListingContent;
    const r = await reviseListingDescription(1, 'ITEM-1', { htmlDescription: HTML }, fetchFn, async () => 'tok', tradingFn, async () => { throw new Error('netz'); });
    expect(r.ok).toBe(false);
    expect(puts).toEqual([]);
    expect(trading).toBe(0);
  });
});

describe('buyerPriceMap (rein)', () => {
  test('Einzelartikel: StartPrice gilt für die Basis-SKU, auch ohne SKU im GetItem', () => {
    const m = buyerPriceMap(parseGetItemBuyerPrices('<R><Ack>Success</Ack><Item><StartPrice>12.45</StartPrice></Item></R>'), 'stele-7');
    expect([...m]).toEqual([['stele-7', 12.45]]);
  });
  test('Varianten: je SKU', () => {
    const m = buyerPriceMap(parseGetItemBuyerPrices('<R><Ack>Success</Ack><Item><Variations><Variation><SKU>stele-2-A</SKU><StartPrice>5.95</StartPrice></Variation><Variation><SKU>stele-2-B</SKU><StartPrice>6.95</StartPrice></Variation></Variations></Item></R>'), 'stele-2');
    expect([...m]).toEqual([['stele-2-A', 5.95], ['stele-2-B', 6.95]]);
  });
  test('GetItem Failure → leer', () => {
    expect(buyerPriceMap(parseGetItemBuyerPrices('<R><Ack>Failure</Ack><LongMessage>x</LongMessage></R>'), 'stele-1').size).toBe(0);
  });
});
