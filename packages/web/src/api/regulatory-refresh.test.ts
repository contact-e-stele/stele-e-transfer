// P71-C Teil 2: GPSR (`regulatory`) im selben PUT wie die Beschreibung (Nachzieh-Weg).
// Injizierter fetch — kein echter eBay-Call.
import { describe, expect, test } from 'bun:test';
import { buildRegulatoryBlock, updateOfferDescriptionBySku, updateOfferDescriptionInventory, reviseListingDescription, RESPONSIBLE_PERSON_TYPE_ALT, type reviseListingContent } from './ebay';

const REG = buildRegulatoryBlock({
  eu: { name: 'Muster EU SARL', address: '12 Rue de Test', postalCode: '75017', city: 'Paris', country: 'FR', email: 'eu@example.fr', phone: null },
  manufacturer: null, missing: [],
});
const OLD_REG = { responsiblePersons: [{ companyName: 'ALT', types: ['EU_RESPONSIBLE_PERSON'] }] };
const HTML = '<p>Neue Beschreibung</p>';

type Put = { offerId: string; body: Record<string, any> };

// Einzel-SKU 'stele-1' → OFF-1; Varianten-SKUs 'stele-2-A'/'stele-2-B' → OFF-A/OFF-B; Gruppe stele-2-GROUP.
function makeFetch(opts: { putResponses?: Array<{ status: number; body?: unknown }> } = {}) {
  const puts: Put[] = [];
  const groupPuts: Array<Record<string, any>> = [];
  let group: Record<string, any> = { description: 'alt', variantSKUs: ['stele-2-A', 'stele-2-B'] };
  let putCall = 0;
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/inventory_item_group/')) {
      if (!u.includes('stele-2-GROUP')) return new Response('', { status: 404 });
      if (method === 'GET') return new Response(JSON.stringify(group), { status: 200 });
      group = JSON.parse(String(init?.body));
      groupPuts.push(group);
      return new Response(null, { status: 204 });
    }
    if (u.includes('/offer?sku=')) {
      const sku = decodeURIComponent(u.match(/sku=([^&]+)/)?.[1] ?? '');
      const offers = sku === 'stele-1' ? [{ offerId: 'OFF-1' }] : sku === 'stele-2-A' ? [{ offerId: 'OFF-A' }] : sku === 'stele-2-B' ? [{ offerId: 'OFF-B' }] : [];
      return new Response(JSON.stringify({ offers }), { status: 200 });
    }
    if (method === 'GET') return new Response(JSON.stringify({ sku: 'x', price: { value: '9.99' }, listingDescription: 'alt', regulatory: OLD_REG }), { status: 200 });
    if (method === 'PUT') {
      puts.push({ offerId: u.split('/').pop() ?? '', body: JSON.parse(String(init?.body)) });
      const r = opts.putResponses?.[putCall++] ?? { status: 204 };
      return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status });
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchFn, puts, groupPuts };
}

describe('updateOfferDescriptionBySku — regulatory im selben PUT', () => {
  test('PUT-Body enthält listingDescription UND regulatory; vorhandenes regulatory wird ersetzt, Preis bleibt', async () => {
    const { fetchFn, puts } = makeFetch();
    const r = await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn, REG);
    expect(r.ok).toBe(true);
    expect(puts.length).toBe(1);
    expect(puts[0].body.listingDescription).toBe(HTML);
    expect(puts[0].body.regulatory).toEqual(REG);
    expect(puts[0].body.price).toEqual({ value: '9.99' });
  });

  test('ohne regulatory-Parameter bleibt das vorhandene regulatory unangetastet (altes Verhalten)', async () => {
    const { fetchFn, puts } = makeFetch();
    await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn);
    expect(puts[0].body.regulatory).toEqual(OLD_REG);
  });

  test('types-Fehler → GENAU eine Wiederholung mit EUResponsiblePerson, dann ok', async () => {
    const { fetchFn, puts } = makeFetch({ putResponses: [{ status: 400, body: { errors: [{ message: 'Invalid value responsiblePersons[0].types' }] } }, { status: 204 }] });
    const r = await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn, REG);
    expect(r.ok).toBe(true);
    expect(puts.length).toBe(2);
    expect(puts[0].body.regulatory.responsiblePersons[0].types).toEqual(['EU_RESPONSIBLE_PERSON']);
    expect(puts[1].body.regulatory.responsiblePersons[0].types).toEqual([RESPONSIBLE_PERSON_TYPE_ALT]);
  });

  test('types-Fehler auch im zweiten Versuch → kein dritter PUT, Fehlertext (300 Zeichen) in error', async () => {
    const errBody = { errors: [{ message: 'responsiblePersons[0].types ' + 'x'.repeat(400) }] };
    const { fetchFn, puts } = makeFetch({ putResponses: [{ status: 400, body: errBody }, { status: 400, body: errBody }] });
    const r = await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn, REG);
    expect(r.ok).toBe(false);
    expect(puts.length).toBe(2);
    expect(r.error).toContain('PUT offer/OFF-1: 400 {"errors"');
    const detail = r.error!.replace('PUT offer/OFF-1: 400 ', '');
    expect(detail.length).toBe(300);
  });

  test('anderer PUT-Fehler (kein types) → keine Wiederholung', async () => {
    const { fetchFn, puts } = makeFetch({ putResponses: [{ status: 400, body: { errors: [{ message: 'Preis ungültig' }] } }] });
    const r = await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn, REG);
    expect(r.ok).toBe(false);
    expect(puts.length).toBe(1);
    expect(r.error).toContain('Preis ungültig');
  });
});

describe('updateOfferDescriptionBySku — mehrere Offers je SKU', () => {
  test('mit regulatory: scheitert das zweite Offer, ist das Ergebnis ok:false (kein Scheinerfolg)', async () => {
    const base = makeFetch({ putResponses: [{ status: 204 }, { status: 500 }] }).fetchFn;
    const fetchFn = (async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('/offer?sku=')) return new Response(JSON.stringify({ offers: [{ offerId: 'OFF-1' }, { offerId: 'OFF-2' }] }), { status: 200 });
      return base(url as string, init);
    }) as unknown as typeof fetch;
    const r = await updateOfferDescriptionBySku('stele-1', HTML, 'tok', fetchFn, REG);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('OFF-2');
  });
});

describe('updateOfferDescriptionInventory / reviseListingDescription — Varianten + kein Trading-Fallback', () => {
  test('Varianten: JEDES Varianten-Offer bekommt regulatory, die Gruppe nicht', async () => {
    const { fetchFn, puts, groupPuts } = makeFetch();
    const r = await updateOfferDescriptionInventory(2, HTML, undefined, fetchFn, async () => 'tok', REG);
    expect(r.ok).toBe(true);
    expect(puts.map(p => p.offerId).sort()).toEqual(['OFF-A', 'OFF-B']);
    for (const p of puts) expect(p.body.regulatory).toEqual(REG);
    expect(groupPuts.length).toBe(1);
    expect('regulatory' in groupPuts[0]).toBe(false);
  });

  test('regulatory gesetzt + Inventory-Weg scheitert → Fehler, Trading-API wird NICHT aufgerufen', async () => {
    const { fetchFn } = makeFetch({ putResponses: [{ status: 500, body: { errors: [{ message: 'boom' }] } }] });
    let tradingCalls = 0;
    const tradingFn = (async () => { tradingCalls++; return { ok: true }; }) as unknown as typeof reviseListingContent;
    const r = await reviseListingDescription(1, 'ITEM-1', { htmlDescription: HTML, regulatory: REG }, fetchFn, async () => 'tok', tradingFn);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Inventory-API');
    expect(tradingCalls).toBe(0);
  });

  test('ohne regulatory bleibt der Trading-Fallback wie bisher', async () => {
    const { fetchFn } = makeFetch({ putResponses: [{ status: 500 }] });
    let tradingCalls = 0;
    const tradingFn = (async () => { tradingCalls++; return { ok: true }; }) as unknown as typeof reviseListingContent;
    const r = await reviseListingDescription(1, 'ITEM-1', { htmlDescription: HTML }, fetchFn, async () => 'tok', tradingFn);
    expect(r.ok).toBe(true);
    expect(tradingCalls).toBe(1);
  });
});
