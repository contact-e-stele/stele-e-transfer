// OFFEN 030 Punkt 4b: Bestand umstellen — mit Mocks (kein eBay). Prüft: Vorschau schreibt nichts · nur Offers DIESES Angebots ·
// nur Lagerort + Richtlinie geändert (Preis bleibt) · Rücklesen · schon richtig · ohne Herkunft/ohne Offer übersprungen.
import { describe, expect, test } from 'bun:test';
import { runOriginSwitch, type OriginSwitchDeps, type OriginSwitchListing } from './origin-switch';
import { listingOrigin } from '../shared/listing-origin';
import type { LiveShipping } from '../shared/origin-shipping';

const CN = listingOrigin('China', []);
const POLICIES = [
  { id: '303262307014', name: 'Versand aus China', handlingDays: 3, services: [], freeShipping: true },
  { id: '303262319014', name: 'Versand aus EU-Lager', handlingDays: 1, services: [], freeShipping: true },
  { id: '276306574014', name: 'Versand', handlingDays: 1, services: [], freeShipping: true },
];
const OLD: LiveShipping = { merchantLocationKey: 'default', fulfillmentPolicyId: '276306574014', source: 'offer' };
const NEW: LiveShipping = { merchantLocationKey: 'CN-Shenzhen', fulfillmentPolicyId: '303262307014', source: 'offer' };
const L225: OriginSwitchListing = { itemId: '198725779927', sku: 'stele-225-GROUP', productId: 225, origin: CN };

function deps(over: Partial<OriginSwitchDeps> = {}) {
  const offers: Record<string, Record<string, unknown>> = {
    o1: { offerId: 'o1', sku: 'stele-225-a', merchantLocationKey: 'default', listingPolicies: { fulfillmentPolicyId: '276306574014', paymentPolicyId: 'P', returnPolicyId: 'R' }, pricingSummary: { price: { value: '25.45', currency: 'EUR' } }, availableQuantity: 3 },
    o2: { offerId: 'o2', sku: 'stele-225-b', merchantLocationKey: 'default', listingPolicies: { fulfillmentPolicyId: '276306574014' }, pricingSummary: { price: { value: '23.95', currency: 'EUR' } } },
    oX: { offerId: 'oX', sku: 'stele-225-a', merchantLocationKey: 'default', listingPolicies: { fulfillmentPolicyId: '276306574014' } },
  };
  const calls = { put: [] as Array<{ id: string; body: Record<string, unknown> }>, ensure: [] as string[], reads: 0, locks: [] as Array<{ pid: number; sku: string; buyerPrice: number; offerPrice: number }> };
  let switched = false;
  const d: OriginSwitchDeps = {
    policies: POLICIES, locations: {},
    readLive: async () => { calls.reads++; return switched ? NEW : OLD; },
    skusOf: async () => ['stele-225-a', 'stele-225-b'],
    offersOf: async (sku) => sku === 'stele-225-a'
      ? [{ offerId: 'o1', sku, listing: { listingId: '198725779927' } }, { offerId: 'oX', sku, listing: { listingId: '111111111111' } }]
      : [{ offerId: 'o2', sku, listing: { listingId: '198725779927' } }],
    getOffer: async (id) => structuredClone(offers[id]),
    quantityOf: async () => 5,
    applyQuantity: (o, q) => { if (q != null) o.availableQuantity = q; },
    putOffer: async (id, body) => { calls.put.push({ id, body }); switched = true; return { ok: true }; },
    ensureLocation: async (spec) => { calls.ensure.push(spec.key); return 'created'; },
    buyerPrices: async () => ({ bySku: new Map([['stele-225-a', 25.45], ['stele-225-b', 23.95]]), single: null }),
    priceLocked: async () => null,
    setLock: async (pid, row) => { calls.locks.push({ pid, ...row }); },
    ...over,
  };
  return { d, calls };
}

describe('runOriginSwitch', () => {
  test('Vorschau (ohne confirm): nichts geschrieben, Ziel CN-Shenzhen / Versand aus China', async () => {
    const { d, calls } = deps();
    const [r] = await runOriginSwitch([L225], { confirm: false }, d);
    expect(r.status).toBe('vorschau');
    expect(r.ziel).toEqual({ locationKey: 'CN-Shenzhen', fulfillmentPolicyId: '303262307014' });
    expect(r.vorher).toEqual({ lagerort: 'default', richtlinie: '276306574014' });
    expect(calls.put).toEqual([]);
    expect(calls.ensure).toEqual([]);
  });

  test('Umstellen: nur die 2 Offers DIESES Angebots (oX eines anderen Angebots bleibt), nur Lagerort + Richtlinie, Preis unverändert, zurückgelesen', async () => {
    const { d, calls } = deps();
    const [r] = await runOriginSwitch([L225], { confirm: true }, d);
    expect(calls.ensure).toEqual(['CN-Shenzhen']);
    expect(calls.put.map(p => p.id)).toEqual(['o1', 'o2']);
    const b = calls.put[0].body;
    expect(b.merchantLocationKey).toBe('CN-Shenzhen');
    expect(b.listingPolicies).toEqual({ fulfillmentPolicyId: '303262307014', paymentPolicyId: 'P', returnPolicyId: 'R' });
    expect(b.pricingSummary).toEqual({ price: { value: '25.45', currency: 'EUR' } });
    expect(b.availableQuantity).toBe(5);  // Menge folgt dem Lager (Mengen-Fix B)
    expect(r).toMatchObject({ status: 'umgestellt', offers: 2, nachher: { lagerort: 'CN-Shenzhen', richtlinie: '303262307014', stimmt: true } });
  });

  test('schon richtig → nichts geschrieben', async () => {
    const { d, calls } = deps({ readLive: async () => NEW });
    const [r] = await runOriginSwitch([L225], { confirm: true }, d);
    expect(r.status).toBe('schon richtig');
    expect(calls.put).toEqual([]);
  });

  test('ohne Herkunft / nicht in der App → übersprungen mit Grund, nichts geschrieben', async () => {
    const { d, calls } = deps();
    const rows = await runOriginSwitch([
      { ...L225, origin: listingOrigin(null, []) },
      { itemId: '222222222222', sku: '', productId: null, origin: null },
    ], { confirm: true }, d);
    expect(rows.map(r => r.status)).toEqual(['übersprungen', 'übersprungen']);
    expect(rows[0].grund).toContain('Herkunft fehlt');
    expect(rows[1].grund).toContain('nicht in der App');
    expect(calls.put).toEqual([]);
  });

  test('kein Inventory-Offer zu diesem Angebot → übersprungen „von Hand im Seller Hub“', async () => {
    const { d, calls } = deps({ offersOf: async (sku) => [{ offerId: 'oX', sku, listing: { listingId: '111111111111' } }] });
    const [r] = await runOriginSwitch([L225], { confirm: true }, d);
    expect(r.status).toBe('übersprungen');
    expect(r.grund).toContain('Seller Hub');
    expect(calls.put).toEqual([]);
  });

  test('PUT-Fehler → Status fehler mit eBay-Text; Rücklesen meldet „stimmt nicht“', async () => {
    const { d } = deps({ putOffer: async (id) => ({ ok: false, error: `PUT offer/${id}: 400 Lagerort ungültig` }) });
    const [r] = await runOriginSwitch([L225], { confirm: true }, d);
    expect(r.status).toBe('fehler');
    expect(r.grund).toContain('400 Lagerort ungültig');
  });

  test('Versandrichtlinie „Versand aus China“ fehlt im Konto → übersprungen, nie die alte Richtlinie behalten', async () => {
    const { d, calls } = deps({ policies: POLICIES.filter(p => p.name !== 'Versand aus China') });
    const [r] = await runOriginSwitch([L225], { confirm: true }, d);
    expect(r.status).toBe('übersprungen');
    expect(r.grund).toContain('Versand aus China');
    expect(calls.put).toEqual([]);
  });

  // Befund 1 (Aufsicht PR 285): kein voller Offer-PUT ohne Preisvergleich.
  test('Offer-Preis ≠ Käuferpreis (Variante b: Käufer 22,95, Angebot 23,95) → kein PUT, übersprungen, Sperre gesetzt', async () => {
    const { d, calls } = deps({ buyerPrices: async () => ({ bySku: new Map([['stele-225-a', 25.45], ['stele-225-b', 22.95]]), single: null }) });
    const [r] = await runOriginSwitch([L225], { confirm: true }, d);
    expect(r.status).toBe('übersprungen');
    expect(r.grund).toContain('eBay-Preise uneinheitlich');
    expect(calls.put).toEqual([]);
    expect(calls.locks).toEqual([{ pid: 225, sku: 'stele-225-b', buyerPrice: 22.95, offerPrice: 23.95 }]);
  });
  test('dasselbe in der Vorschau: gemeldet, aber KEINE Sperre gesetzt und nichts geschrieben', async () => {
    const { d, calls } = deps({ buyerPrices: async () => ({ bySku: new Map([['stele-225-a', 25.45], ['stele-225-b', 22.95]]), single: null }) });
    const [r] = await runOriginSwitch([L225], { confirm: false }, d);
    expect(r.status).toBe('übersprungen');
    expect(r.grund).toContain('eBay-Preise uneinheitlich');
    expect(calls.locks).toEqual([]);
    expect(calls.put).toEqual([]);
  });
  test('Sperre aktiv (K-011b) → kein PUT', async () => {
    const { d, calls } = deps({ priceLocked: async () => 'K-011 Sperre – erst angleichen' });
    const [r] = await runOriginSwitch([L225], { confirm: true }, d);
    expect(r).toMatchObject({ status: 'übersprungen', grund: 'K-011 Sperre – erst angleichen' });
    expect(calls.put).toEqual([]);
  });
  test('Käuferpreis unbekannt (GetItem nicht lesbar) → kein PUT', async () => {
    const { d, calls } = deps({ buyerPrices: async () => null });
    const [r] = await runOriginSwitch([L225], { confirm: true }, d);
    expect(r.status).toBe('übersprungen');
    expect(r.grund).toContain('Käuferpreis für stele-225-a unbekannt');
    expect(calls.put).toEqual([]);
  });
  test('Einzelartikel: Käuferpreis = Offer-Preis → umgestellt', async () => {
    const { d, calls } = deps({ skusOf: async () => ['stele-225-a'], buyerPrices: async () => ({ bySku: new Map(), single: 25.45 }) });
    const [r] = await runOriginSwitch([{ ...L225, sku: 'stele-225-a' }], { confirm: true }, d);
    expect(r.status).toBe('umgestellt');
    expect(calls.put.map(p => p.id)).toEqual(['o1']);
  });
  // Befund 2: alle Offers schon richtig, Rücklesen widerspricht → eigener Grund (nicht „kein Inventory-Offer“).
  test('Offers schon richtig, Rücklesen widerspricht → eigener Grund', async () => {
    const { d } = deps({ getOffer: async (id) => ({ offerId: id, merchantLocationKey: 'CN-Shenzhen', listingPolicies: { fulfillmentPolicyId: '303262307014' }, pricingSummary: { price: { value: id === 'o1' ? '25.45' : '23.95', currency: 'EUR' } } }) });
    const [r] = await runOriginSwitch([L225], { confirm: true }, d);
    expect(r.status).toBe('übersprungen');
    expect(r.grund).toContain('Offers schon richtig, Rücklesen widerspricht');
  });
});
