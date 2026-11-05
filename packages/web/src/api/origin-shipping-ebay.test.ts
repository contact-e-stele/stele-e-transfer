// OFFEN 030 Teil 2: eBay-Seite — Offer trägt Lagerort/Richtlinie je Herkunft, keine Richtlinie wird angelegt,
// Lagerort nur bei 404 angelegt, Lesewege (Offer, Lieferschätzung) schreiben nichts.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ensureInventoryLocation, listOnEbay, readDeliveryEstimate, readOfferShipping, requireOriginShipping } from './ebay';

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let locationExists = true;
const realFetch = globalThis.fetch;

function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status }); }

beforeEach(() => {
  calls = [];
  locationExists = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    calls.push({ method, url, body });
    if (url.includes('/identity/v1/oauth2/token')) return json({ access_token: 'tok', expires_in: 7200 });
    if (/\/sell\/inventory\/v1\/location\//.test(url)) {
      if (method === 'GET') return locationExists ? json({ merchantLocationKey: 'CN-Shenzhen' }) : json({ errors: [{ errorId: 25805 }] }, 404);
      return new Response('', { status: 204 });
    }
    if (method === 'GET' && /\/offer\?sku=/.test(url)) return json({ offers: [] });
    if (method === 'PUT' && /\/inventory_item(_group)?\//.test(url)) return new Response('', { status: 204 });
    if (method === 'POST' && /\/sell\/inventory\/v1\/offer$/.test(url)) return json({ offerId: 'OFFER-1' }, 201);
    if (method === 'POST' && /publish/.test(url)) return json({ listingId: '198000000001' });
    if (/commerce\/taxonomy/.test(url)) return json({ aspects: [], categorySuggestions: [] });
    return json({}, 200);
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const SHIPPING = { location: { key: 'CN-Shenzhen', name: 'Versand aus China (Shenzhen)', country: 'CN', city: 'Shenzhen', stateOrProvince: 'Guangdong', estimated: true }, fulfillmentPolicyId: 'FP-CN' };
const baseInput = {
  sku: 'stele-990', title: 'Test Artikel', description: '<p>Beschreibung</p>', price: 12.95, quantity: 3, condition: 'NEW' as const,
  imageUrls: ['https://i.ebayimg.com/a.jpg'], categoryId: '57920', adRate: 0, shipsFrom: 'China', targetMarginEur: 2,
  handlingTimeDays: 7, // früher: führte zu getOrCreateFulfillmentPolicy → POST fulfillment_policy "Stele 7d Handling"
  gpsr: { eu: { name: 'Muster EU SARL', address: '12 Rue de Test', postalCode: '75017', city: 'Paris', country: 'FR', email: 'eu@example.fr', phone: null }, manufacturer: null, manufacturerMissing: [], missing: [] },
};

describe('Listen mit Lagerort/Richtlinie je Herkunft', () => {
  test('Offer: merchantLocationKey = CN-Shenzhen, fulfillmentPolicyId = FP-CN (nicht "default", nicht Handling-Zeit-Richtlinie)', async () => {
    await listOnEbay({ ...baseInput, originShipping: SHIPPING });
    const offer = calls.find(c => c.method === 'POST' && /\/sell\/inventory\/v1\/offer$/.test(c.url))?.body as { merchantLocationKey: string; listingPolicies: { fulfillmentPolicyId: string } };
    expect(offer.merchantLocationKey).toBe('CN-Shenzhen');
    expect(offer.listingPolicies.fulfillmentPolicyId).toBe('FP-CN');
  });
  test('keine Versandrichtlinie wird angelegt oder gelesen-und-angelegt (kein Aufruf an fulfillment_policy)', async () => {
    await listOnEbay({ ...baseInput, originShipping: SHIPPING });
    expect(calls.filter(c => c.url.includes('/sell/account/v1/fulfillment_policy'))).toEqual([]);
  });
  test('ohne originShipping → Fehler, nichts an eBay geschrieben', async () => {
    await expect(listOnEbay({ ...baseInput })).rejects.toThrow('ohne Herkunft wird nicht gelistet');
    expect(calls.filter(c => c.method !== 'GET' && !c.url.includes('oauth2'))).toEqual([]);
    expect(() => requireOriginShipping({})).toThrow();
  });
});

describe('ensureInventoryLocation', () => {
  test('vorhanden → nur GET, kein POST', async () => {
    expect(await ensureInventoryLocation(SHIPPING.location, fetch, 'tok')).toBe('exists');
    expect(calls.map(c => c.method)).toEqual(['GET']);
  });
  test('404 → POST mit Adresse aus der Herkunft (Shenzhen, Guangdong, CN)', async () => {
    locationExists = false;
    expect(await ensureInventoryLocation(SHIPPING.location, fetch, 'tok')).toBe('created');
    const post = calls.find(c => c.method === 'POST');
    expect(post?.url).toContain('/location/CN-Shenzhen');
    expect(post?.body).toEqual({ location: { address: { city: 'Shenzhen', stateOrProvince: 'Guangdong', country: 'CN' } }, locationTypes: ['WAREHOUSE'], name: 'Versand aus China (Shenzhen)', merchantLocationStatus: 'ENABLED' });
  });
  test('anderer Lesefehler (500) → werfen, nicht blind anlegen', async () => {
    const f = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(ensureInventoryLocation(SHIPPING.location, f, 'tok')).rejects.toThrow('500');
  });
});

describe('Lesewege (nur GET)', () => {
  test('readOfferShipping GROUP: Varianten-SKU → Offer → Lagerort + Richtlinie', async () => {
    const seen: string[] = [];
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${String(u)}`);
      if (String(u).includes('inventory_item_group')) return json({ variantSKUs: ['stele-120-ROT'] });
      return json({ offers: [{ merchantLocationKey: 'default', listingPolicies: { fulfillmentPolicyId: '276306574014' } }] });
    }) as unknown as typeof fetch;
    expect(await readOfferShipping('stele-120-GROUP', f, 'tok')).toEqual({ merchantLocationKey: 'default', fulfillmentPolicyId: '276306574014', source: 'offer' });
    expect(seen.every(s => s.startsWith('GET '))).toBe(true);
    expect(seen[1]).toContain('sku=stele-120-ROT');
  });
  test('readDeliveryEstimate: Varianten-Angebot → Fallback get_items_by_item_group', async () => {
    const seen: string[] = [];
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${String(u)}`);
      if (String(u).includes('get_item_by_legacy_id')) return json({ errors: [{ errorId: 11006 }] }, 400);
      return json({ items: [{ shippingOptions: [{ minEstimatedDeliveryDate: '2026-11-13T08:00:00.000Z', maxEstimatedDeliveryDate: '2026-11-19T08:00:00.000Z' }] }] });
    }) as unknown as typeof fetch;
    expect(await readDeliveryEstimate('198693421029', f, 'app')).toEqual({ minDate: '2026-11-13T08:00:00.000Z', maxDate: '2026-11-19T08:00:00.000Z' });
    expect(seen.every(s => s.startsWith('GET '))).toBe(true);
  });
});

describe('readOfferShipping: alle Varianten-SKUs + GetItem-Fallback (Fund 05.11.)', () => {
  test('erste SKU leer, zweite SKU hat das veröffentlichte Offer → das nehmen', async () => {
    const f = (async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.includes('inventory_item_group')) return json({ variantSKUs: ['A', 'B'] });
      if (url.includes('sku=A')) return json({ offers: [{ status: 'UNPUBLISHED' }] });
      return json({ offers: [{ status: 'PUBLISHED', merchantLocationKey: 'default', listingPolicies: { fulfillmentPolicyId: '276306574014' }, listing: { listingId: '198625473351' } }] });
    }) as unknown as typeof fetch;
    expect(await readOfferShipping('stele-152-GROUP', f, 'tok', '198625473351')).toEqual({ merchantLocationKey: 'default', fulfillmentPolicyId: '276306574014', source: 'offer' });
  });
  test('kein Offer mit Feldern → GetItem (nur lesen)', async () => {
    const seen: string[] = [];
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      seen.push(`${init?.method ?? 'GET'} ${url.includes('ws/api.dll') ? 'GetItem' : 'rest'}`);
      if (url.includes('inventory_item_group')) return json({ variantSKUs: ['A'] });
      if (url.includes('ws/api.dll')) {
        expect(String(init?.headers && (init.headers as Record<string, string>)['X-EBAY-API-CALL-NAME'])).toBe('GetItem');
        return new Response('<GetItemResponse><Ack>Success</Ack><Item><Country>DE</Country><Location>Wiesbaden</Location><SellerProfiles><SellerShippingProfile><ShippingProfileID>276306574014</ShippingProfileID></SellerShippingProfile></SellerProfiles></Item></GetItemResponse>', { status: 200 });
      }
      return json({ offers: [{ status: 'UNPUBLISHED' }] });
    }) as unknown as typeof fetch;
    expect(await readOfferShipping('stele-152-GROUP', f, 'tok', '198625473351')).toEqual({ merchantLocationKey: null, fulfillmentPolicyId: '276306574014', locationText: 'Wiesbaden, DE', source: 'getitem' });
    expect(seen.filter(s => s.startsWith('POST')).length).toBe(1); // nur der GetItem-Lese-POST
  });
});
