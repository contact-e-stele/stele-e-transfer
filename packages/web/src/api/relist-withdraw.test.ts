// Fix 208: welche eBay-Aufrufe withdrawEndedOffersBeforePublish macht (Fake-fetch, nichts live).
import { describe, expect, test } from 'bun:test';

const ebay = await import('./ebay');

type OfferJson = { offerId: string; status: string; listing?: { listingId: string; listingStatus: string } };
function fakeEbay(offersBySku: Record<string, OfferJson[]>, groupSkus: string[] | null, withdrawStatus = 204) {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.replace(/^https:\/\/[^/]+/, '')}${init?.body ? ' ' + String(init.body) : ''}`);
    if (url.includes('/inventory_item_group/')) {
      return groupSkus ? new Response(JSON.stringify({ variantSKUs: groupSkus }), { status: 200 }) : new Response('{}', { status: 404 });
    }
    if (url.includes('/offer?sku=')) {
      const sku = decodeURIComponent(url.split('sku=')[1].split('&')[0]);
      const offers = offersBySku[sku];
      return offers ? new Response(JSON.stringify({ offers }), { status: 200 }) : new Response('{"errors":[{"errorId":25713}]}', { status: 404 });
    }
    if (url.includes('withdraw')) return new Response(withdrawStatus === 204 ? null : '{"errors":[{"errorId":25001}]}', { status: withdrawStatus });
    return new Response('{}', { status: 500 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const ended = (offerId: string): OfferJson => ({ offerId, status: 'PUBLISHED', listing: { listingId: '198671009468', listingStatus: 'ENDED' } });
const active = (offerId: string): OfferJson => ({ offerId, status: 'PUBLISHED', listing: { listingId: '198671009468', listingStatus: 'ACTIVE' } });

describe('withdrawEndedOffersBeforePublish (Fix 208)', () => {
  test('208 Gruppe, beide Offers am beendeten Angebot → genau ein withdraw_by_inventory_item_group mit stele-208-GROUP/EBAY_DE', async () => {
    const { f, calls } = fakeEbay({ 'stele-208-BLACK': [ended('B1')], 'stele-208-SILVER': [ended('S1')] }, ['stele-208-BLACK', 'stele-208-SILVER']);
    const d = await ebay.withdrawEndedOffersBeforePublish('stele-208-GROUP', null, 'tok', f);
    expect(d?.withdraw).toBe(true);
    const writes = calls.filter(c => c.startsWith('POST'));
    expect(writes).toEqual(['POST /sell/inventory/v1/offer/withdraw_by_inventory_item_group {"inventoryItemGroupKey":"stele-208-GROUP","marketplaceId":"EBAY_DE"}']);
  });

  test('Gruppe mit laufendem Angebot, App führt es nicht → Fehler, KEIN withdraw', async () => {
    const { f, calls } = fakeEbay({ 'stele-208-BLACK': [active('B1')], 'stele-208-SILVER': [active('S1')] }, ['stele-208-BLACK', 'stele-208-SILVER']);
    await expect(ebay.withdrawEndedOffersBeforePublish('stele-208-GROUP', null, 'tok', f)).rejects.toThrow('laufenden eBay-Angebot');
    expect(calls.filter(c => c.startsWith('POST'))).toEqual([]);
  });

  test('Gruppe mit laufendem Angebot, das die App führt → kein withdraw, kein Fehler', async () => {
    const { f, calls } = fakeEbay({ 'stele-208-BLACK': [active('B1')], 'stele-208-SILVER': [active('S1')] }, ['stele-208-BLACK', 'stele-208-SILVER']);
    const d = await ebay.withdrawEndedOffersBeforePublish('stele-208-GROUP', '198671009468', 'tok', f);
    expect(d?.withdraw).toBe(false);
    expect(calls.filter(c => c.startsWith('POST'))).toEqual([]);
  });

  test('UNPUBLISHED-Offers → kein withdraw', async () => {
    const { f, calls } = fakeEbay({ 'stele-208-BLACK': [{ offerId: 'B1', status: 'UNPUBLISHED' }] }, ['stele-208-BLACK']);
    const d = await ebay.withdrawEndedOffersBeforePublish('stele-208-GROUP', null, 'tok', f);
    expect(d?.withdraw).toBe(false);
    expect(calls.filter(c => c.startsWith('POST'))).toEqual([]);
  });

  test('Einzel-SKU am beendeten Angebot → POST offer/{id}/withdraw', async () => {
    const { f, calls } = fakeEbay({ 'stele-500': [ended('E1')] }, null);
    await ebay.withdrawEndedOffersBeforePublish('stele-500', null, 'tok', f);
    expect(calls.filter(c => c.startsWith('POST'))).toEqual(['POST /sell/inventory/v1/offer/E1/withdraw']);
  });

  test('erstes Listen (keine Offers, 404) → nichts geschrieben', async () => {
    const { f, calls } = fakeEbay({}, null);
    const d = await ebay.withdrawEndedOffersBeforePublish('stele-501', null, 'tok', f);
    expect(d?.withdraw).toBe(false);
    expect(calls.filter(c => c.startsWith('POST'))).toEqual([]);
  });

  test('withdraw scheitert → klarer Fehler (kein stilles publish)', async () => {
    const { f } = fakeEbay({ 'stele-500': [ended('E1')] }, null, 400);
    await expect(ebay.withdrawEndedOffersBeforePublish('stele-500', null, 'tok', f)).rejects.toThrow('nichts veröffentlicht');
  });
});
