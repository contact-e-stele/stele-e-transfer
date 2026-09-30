// P71-B Teil 2: die blockierende Sperre sitzt an den SENDESTELLEN in ebay.ts (nicht je Route) —
// Neulisten, Trading-Revise, Inventory-Nachzieh-Weg — und der MPN-Guard in buildAspects.
// Die Sperre greift VOR jedem Netzwerkzugriff: die Fetch-/Token-Attrappen dürfen nie aufgerufen werden.
import { describe, expect, test } from 'bun:test';
import { buildAspects, listOnEbay, reviseListingContent, reviseListingDescription, updateOfferDescriptionInventory, type EbayListingInput } from './ebay';

const CLEAN = '<p>Hochwertige Frischhaltedose aus Edelstahl.</p>';
const DIRTY = '<p>Lieferzeit 7 Werktage per DHL. Fragen an service@zreeshop.com</p>';

function neverFetch() {
  const calls: string[] = [];
  const fetchFn = (async (url: unknown) => { calls.push(String(url)); throw new Error('darf nicht aufgerufen werden'); }) as unknown as typeof fetch;
  const tokenFn = async () => { calls.push('token'); return 'tok'; };
  return { calls, fetchFn, tokenFn };
}

describe('reviseListingContent (Trading-API) — Sperre vor dem Senden', () => {
  test('Verstoß in der Beschreibung → ok:false mit Klartext, kein Netzwerkzugriff', async () => {
    const result = await reviseListingContent('ITEM-1', { htmlDescription: DIRTY });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Dauerregeln');
    expect(result.error).toContain('service@zreeshop.com');
  });
  test('Verstoß nur im Titel → ebenfalls gesperrt', async () => {
    const result = await reviseListingContent('ITEM-1', { title: 'Dose info@shop.com', htmlDescription: CLEAN });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('email');
  });
});

describe('reviseListingDescription / updateOfferDescriptionInventory (Inventory-Weg) — Sperre vor dem Senden', () => {
  test('reviseListingDescription: Verstoß → nur EIN Sperr-Fehler, weder Inventory- noch Trading-Weg werden aufgerufen', async () => {
    const { calls, fetchFn, tokenFn } = neverFetch();
    let tradingCalled = false;
    const tradingReviseFn = (async () => { tradingCalled = true; return { ok: true }; }) as typeof reviseListingContent;
    const result = await reviseListingDescription(1, 'ITEM-1', { htmlDescription: DIRTY }, fetchFn, tokenFn, tradingReviseFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Dauerregeln');
    expect(result.error).not.toContain('Trading-API:');
    expect(calls).toEqual([]);
    expect(tradingCalled).toBe(false);
  });

  test('updateOfferDescriptionInventory (direkter Aufruf): Verstoß im Titel → gesperrt, kein Token, kein Fetch', async () => {
    const { calls, fetchFn, tokenFn } = neverFetch();
    const result = await updateOfferDescriptionInventory(1, CLEAN, 'Dose info@shop.com', fetchFn, tokenFn);
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test('sauberer Text passiert die Sperre und erreicht den Inventory-Weg', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: unknown, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url).includes('/offer?sku=')) return new Response(JSON.stringify({ offers: [{ offerId: 'O1' }] }), { status: 200 });
      return new Response(JSON.stringify({ offerId: 'O1', listingDescription: 'alt' }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await reviseListingDescription(1, 'ITEM-1', { htmlDescription: CLEAN }, fetchFn, async () => 'tok');
    expect(result.ok).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('listOnEbay (Neulisten) — Sperre vor jedem Netzwerkzugriff', () => {
  const base = { sku: 'stele-1', price: 9.99, quantity: 3, condition: 'NEW' as const, imageUrls: ['https://i.ebayimg.com/a.jpg'] };

  test('Verstoß in der Beschreibung → wirft mit Klartext', async () => {
    await expect(listOnEbay({ ...base, title: 'Dose', description: DIRTY } as EbayListingInput)).rejects.toThrow(/Dauerregeln.*service@zreeshop\.com/);
  });
  test('alicdn-Bild in der Beschreibung → wirft', async () => {
    await expect(listOnEbay({ ...base, title: 'Dose', description: '<img src="https://ae01.alicdn.com/kf/a.jpg">' } as EbayListingInput)).rejects.toThrow(/alicdn/);
  });
});

describe('buildAspects — Regel 5: MPN nie AliExpress-ID', () => {
  const mpnRequired = () => (async () => new Response(JSON.stringify({
    aspects: [{ localizedAspectName: 'MPN', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT' } }],
  }), { status: 200 })) as unknown as typeof fetch;
  const tokenFn = async () => 'test-token';

  test('mpn = AliExpress-Produkt-ID (16 Stellen) → nicht gesendet, Default "Nicht zutreffend"', async () => {
    const result = await buildAspects({}, '1005006123456789', 'CAT-MPN-GUARD-1', undefined, undefined, [], undefined, mpnRequired(), tokenFn);
    expect(result['MPN']).toEqual(['Nicht zutreffend']);
  });
  test('echte Herstellernummer → wird gesendet', async () => {
    const result = await buildAspects({}, 'WD-4471B', 'CAT-MPN-GUARD-2', undefined, undefined, [], undefined, mpnRequired(), tokenFn);
    expect(result['MPN']).toEqual(['WD-4471B']);
  });
  test('manuell eingetragener MPN = AliExpress-ID wird ebenfalls nicht gesendet', async () => {
    const result = await buildAspects({}, undefined, 'CAT-MPN-GUARD-3', undefined, { MPN: '1005006123456789' }, [], undefined, mpnRequired(), tokenFn);
    expect(result['MPN']).toEqual(['Nicht zutreffend']);
  });
});
