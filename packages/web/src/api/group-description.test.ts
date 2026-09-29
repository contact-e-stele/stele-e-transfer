// P71-B Nachtrag (Live-Fund 29.09., Produkt 147): bei Varianten-Angeboten liegt die ANGEZEIGTE
// Beschreibung in inventory_item_group.description. Der Gruppen-PUT ist der maßgebliche Schritt;
// Erfolg wird erst gemeldet, wenn er gelungen ist.
import { describe, expect, test } from 'bun:test';
import { updateOfferDescriptionInventory, updateInventoryItemGroupContent } from './ebay';

const OLD_GROUP = {
  inventoryItemGroupKey: 'stele-1-GROUP',
  title: 'Alter Titel',
  description: '<p>ALT contact@stele-e-transfer.com</p>',
  imageUrls: ['https://i.ebayimg.com/a.jpg'],
  aspects: { Marke: ['Markenlos'] },
  variantSKUs: ['stele-1-A', 'stele-1-B'],
  variesBy: { aspectsImageVariesBy: ['Farbe'], specifications: [{ name: 'Farbe', values: ['Rot', 'Blau'] }] },
};

function makeFetch(opts: { groupGetOk?: boolean; groupPutStatus?: number; offerPutOk?: boolean } = {}) {
  const groupPuts: Array<Record<string, unknown>> = [];
  const offerPuts: string[] = [];
  const order: string[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/inventory_item_group/')) {
      if (method === 'GET') {
        return opts.groupGetOk === false ? new Response('', { status: 500 }) : new Response(JSON.stringify(OLD_GROUP), { status: 200 });
      }
      order.push('group-put');
      groupPuts.push(JSON.parse(String(init?.body)));
      const status = opts.groupPutStatus ?? 204;
      return new Response(status >= 400 ? '{"errors":[{"message":"boom"}]}' : null, { status });
    }
    if (u.includes('/offer?sku=')) {
      const sku = decodeURIComponent(u.match(/sku=([^&]+)/)?.[1] ?? '');
      const offers = sku === 'stele-1-A' ? [{ offerId: 'OFF-A' }] : sku === 'stele-1-B' ? [{ offerId: 'OFF-B' }] : [];
      return new Response(JSON.stringify({ offers }), { status: 200 });
    }
    if (method === 'GET') return new Response(JSON.stringify({ sku: 'x', listingDescription: 'alt' }), { status: 200 });
    if (method === 'PUT') {
      order.push('offer-put');
      offerPuts.push(u);
      return new Response('', { status: opts.offerPutOk === false ? 500 : 200 });
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchFn, groupPuts, offerPuts, order };
}

const NEW_HTML = '<p>Hochwertige Frischhaltedose.</p>';

describe('updateOfferDescriptionInventory — Varianten-Angebot: Gruppen-PUT', () => {
  test('Gruppen-PUT wird mit neuer description UND neuem title gesendet, übrige Gruppenfelder bleiben erhalten', async () => {
    const { fetchFn, groupPuts } = makeFetch();
    const r = await updateOfferDescriptionInventory(1, NEW_HTML, 'Neuer Titel', fetchFn, async () => 'tok');
    expect(r.ok).toBe(true);
    expect(groupPuts.length).toBe(1);
    expect(groupPuts[0].description).toBe(NEW_HTML);
    expect(groupPuts[0].title).toBe('Neuer Titel');
    expect(groupPuts[0].variantSKUs).toEqual(['stele-1-A', 'stele-1-B']);
    expect(groupPuts[0].aspects).toEqual({ Marke: ['Markenlos'] });
    expect(groupPuts[0].variesBy).toEqual(OLD_GROUP.variesBy);
  });

  test('ohne Titel: description wird ersetzt, der bestehende Gruppen-Titel bleibt', async () => {
    const { fetchFn, groupPuts } = makeFetch();
    const r = await updateOfferDescriptionInventory(1, NEW_HTML, undefined, fetchFn, async () => 'tok');
    expect(r.ok).toBe(true);
    expect(groupPuts[0].title).toBe('Alter Titel');
    expect(groupPuts[0].description).toBe(NEW_HTML);
  });

  test('Offers je Varianten-SKU werden zusätzlich aktualisiert (2 PUTs), NACH dem Gruppen-PUT', async () => {
    const { fetchFn, offerPuts, order } = makeFetch();
    await updateOfferDescriptionInventory(1, NEW_HTML, undefined, fetchFn, async () => 'tok');
    expect(offerPuts.length).toBe(2);
    expect(order[0]).toBe('group-put');
  });

  test('Gruppen-PUT scheitert (500) → ok:false, Fehlertext nennt die Gruppe, KEIN Offer wird geschrieben', async () => {
    const { fetchFn, offerPuts } = makeFetch({ groupPutStatus: 500 });
    const r = await updateOfferDescriptionInventory(1, NEW_HTML, 'Neuer Titel', fetchFn, async () => 'tok');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Gruppen-Beschreibung fehlgeschlagen');
    expect(r.error).toContain('500');
    expect(offerPuts.length).toBe(0);
  });

  test('Gruppen-GET scheitert → ok:false', async () => {
    const { fetchFn, groupPuts } = makeFetch({ groupGetOk: false });
    const r = await updateOfferDescriptionInventory(1, NEW_HTML, undefined, fetchFn, async () => 'tok');
    expect(r.ok).toBe(false);
    expect(groupPuts.length).toBe(0);
  });

  test('Gruppe gelungen, aber Varianten-Offers scheitern → weiterhin ok:false', async () => {
    const { fetchFn } = makeFetch({ offerPutOk: false });
    const r = await updateOfferDescriptionInventory(1, NEW_HTML, undefined, fetchFn, async () => 'tok');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Gruppe aktualisiert, aber 2 von 2');
  });
});

describe('updateInventoryItemGroupContent', () => {
  test('PUT-Fehler enthält den Antworttext von eBay', async () => {
    const { fetchFn } = makeFetch({ groupPutStatus: 400 });
    const r = await updateInventoryItemGroupContent('stele-1-GROUP', { description: NEW_HTML }, 'tok', fetchFn);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('boom');
  });
});
