// P71-B Nachtrag (Live-Fund 29.09., Produkt 147): bei Varianten-Angeboten liegt die ANGEZEIGTE
// Beschreibung in inventory_item_group.description. Der Gruppen-PUT ist der maßgebliche Schritt;
// Erfolg wird erst gemeldet, wenn er gelungen ist.
import { describe, expect, test } from 'bun:test';
import { updateOfferDescriptionInventory, updateInventoryItemGroupContent, reviseListingDescription, type reviseListingContent } from './ebay';

const OLD_GROUP = {
  inventoryItemGroupKey: 'stele-1-GROUP',
  title: 'Alter Titel',
  description: '<p>ALT contact@stele-e-transfer.com</p>',
  imageUrls: ['https://i.ebayimg.com/a.jpg'],
  aspects: { Marke: ['Markenlos'] },
  variantSKUs: ['stele-1-A', 'stele-1-B'],
  variesBy: { aspectsImageVariesBy: ['Farbe'], specifications: [{ name: 'Farbe', values: ['Rot', 'Blau'] }] },
};

function makeFetch(opts: { groupGetOk?: boolean; groupPutStatus?: number; offerPutOk?: boolean; offerPutFailSkus?: string[]; putIgnored?: boolean } = {}) {
  let current: Record<string, unknown> = { ...OLD_GROUP };
  const groupPuts: Array<Record<string, unknown>> = [];
  const offerPuts: string[] = [];
  const order: string[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/inventory_item_group/')) {
      if (method === 'GET') {
        return opts.groupGetOk === false ? new Response('', { status: 500 }) : new Response(JSON.stringify(current), { status: 200 });
      }
      order.push('group-put');
      const body = JSON.parse(String(init?.body));
      groupPuts.push(body);
      if (!opts.putIgnored && (opts.groupPutStatus ?? 204) < 400) current = body; // eBay übernimmt den PUT (außer putIgnored)
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
      const failSku = (opts.offerPutFailSkus ?? []).some(sku => u.endsWith(sku === 'stele-1-A' ? 'OFF-A' : 'OFF-B'));
      return new Response('', { status: opts.offerPutOk === false || failSku ? 500 : 200 });
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

describe('Rücklese-Prüfung, Teilerfolg, kein falscher Erfolg über den Trading-Fallback', () => {
  test('PUT 204, aber die Gruppe trägt beim Zurücklesen noch die alte Beschreibung → ok:false', async () => {
    const { fetchFn, offerPuts } = makeFetch({ putIgnored: true });
    const r = await updateOfferDescriptionInventory(1, NEW_HTML, undefined, fetchFn, async () => 'tok');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Zurücklesen');
    expect(offerPuts.length).toBe(0);
  });

  test('nur 1 von 2 Varianten-Offers scheitert → ok:false, partial:true', async () => {
    const { fetchFn } = makeFetch({ offerPutFailSkus: ['stele-1-B'] });
    const r = await updateOfferDescriptionInventory(1, NEW_HTML, undefined, fetchFn, async () => 'tok');
    expect(r.ok).toBe(false);
    expect(r.partial).toBe(true);
    expect(r.error).toContain('1 von 2');
  });

  test('Teilerfolg (Gruppe neu, Offer scheitert): reviseListingDescription fällt NICHT auf die Trading-API zurück und meldet ok:false', async () => {
    const { fetchFn } = makeFetch({ offerPutFailSkus: ['stele-1-B'] });
    let tradingCalled = false;
    const tradingFn = (async () => { tradingCalled = true; return { ok: true }; }) as unknown as typeof reviseListingContent;
    const r = await reviseListingDescription(1, 'ITEM-1', { htmlDescription: NEW_HTML }, fetchFn, async () => 'tok', tradingFn);
    expect(r.ok).toBe(false);
    expect(tradingCalled).toBe(false);
  });

  test('Gruppen-PUT scheitert komplett: Trading-Fallback bleibt wie bisher erlaubt (kein Teilerfolg)', async () => {
    const { fetchFn } = makeFetch({ groupPutStatus: 500 });
    let tradingCalled = false;
    const tradingFn = (async () => { tradingCalled = true; return { ok: false, error: 'trading down' }; }) as unknown as typeof reviseListingContent;
    const r = await reviseListingDescription(1, 'ITEM-1', { htmlDescription: NEW_HTML }, fetchFn, async () => 'tok', tradingFn);
    expect(r.ok).toBe(false);
    expect(tradingCalled).toBe(true);
    expect(r.error).toContain('Trading-API: trading down');
  });
});
