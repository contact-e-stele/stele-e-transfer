// K-011b (Kalkulator-Prüfung #179): gesperrtes Produkt → KEIN Schreibaufruf auf Offer-/Inventory-/Gruppen-Ebene (sonst springt der
// Käuferpreis still auf die alten Angebotsdaten zurück). Ungesperrt → Verhalten wie bisher. Angleichen (bypassPriceLock) bleibt erlaubt.
import { afterAll, describe, expect, test } from 'bun:test';

process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/k011b-test.db';
const ebay = await import('./ebay');
const { updateOfferPriceBySku } = await import('./price-monitor');

const calls: string[] = [];
const f = (async (url: string, init?: RequestInit) => { calls.push(`${init?.method ?? 'GET'} ${url}`); return new Response(JSON.stringify({ offers: [{ offerId: 'o1' }] }), { status: 200 }); }) as unknown as typeof fetch;
const lockedIs220 = async (pid: number) => pid === 220;
afterAll(() => ebay.__setPriceLockCheckForTests(null));

describe('K-011b gesperrt (stele-220) → 0 eBay-Aufrufe', () => {
  test('updateOfferDescriptionBySku (Beschreibung/GPSR, PUT volles Offer)', async () => {
    ebay.__setPriceLockCheckForTests(lockedIs220); calls.length = 0;
    const r = await ebay.updateOfferDescriptionBySku('stele-220-GRAY', '<p>x</p>', 'tok', f);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('K-011 Sperre');
    expect(calls).toEqual([]);
  });
  test('updateInventoryItemTitle / Gruppen-Titel / Gruppen-Beschreibung / Menge', async () => {
    ebay.__setPriceLockCheckForTests(lockedIs220); calls.length = 0;
    expect((await ebay.updateInventoryItemTitle('stele-220-GRAY', 'T', 'tok', f)).ok).toBe(false);
    expect((await ebay.updateInventoryItemGroupTitle('stele-220-GROUP', 'T', 'tok', f)).ok).toBe(false);
    expect((await ebay.updateInventoryItemGroupContent('stele-220-GROUP', { description: 'd' }, 'tok', f)).ok).toBe(false);
    expect(await ebay.setInventoryItemQuantity('stele-220-GRAY', 3, 'tok', f)).toBe(false);
    expect(calls).toEqual([]);
  });
  test('updateOfferDescriptionInventory (Nachzieh-Weg) bricht vor dem Token ab', async () => {
    ebay.__setPriceLockCheckForTests(lockedIs220); calls.length = 0;
    let tokenAsked = false;
    const r = await ebay.updateOfferDescriptionInventory(220, '<p>x</p>', undefined, f, async () => { tokenAsked = true; return 'tok'; });
    expect(r.ok).toBe(false);
    expect(tokenAsked).toBe(false);
    expect(calls).toEqual([]);
  });
  test('Listen/Offer/Publish werfen mit "K-011 Sperre"', async () => {
    ebay.__setPriceLockCheckForTests(lockedIs220);
    const input = { sku: 'stele-220', title: 'T', description: 'd', price: 19.95, quantity: 1 } as Parameters<typeof ebay.listOnEbay>[0];
    await expect(ebay.listOnEbay(input)).rejects.toThrow('K-011 Sperre');
    await expect(ebay.listOnEbayWithVariants(input)).rejects.toThrow('K-011 Sperre');
    await expect(ebay.createOffer(input)).rejects.toThrow('K-011 Sperre');
    await expect(ebay.createOrUpdateInventoryItem(input)).rejects.toThrow('K-011 Sperre');
    await expect(ebay.publishOfferByInventoryItemGroup('stele-220-GROUP')).rejects.toThrow('K-011 Sperre');
  });
  test('anderes Produkt (stele-221) bleibt frei: Aufrufe gehen raus', async () => {
    ebay.__setPriceLockCheckForTests(lockedIs220); calls.length = 0;
    await ebay.updateOfferDescriptionBySku('stele-221-RED', '<p>x</p>', 'tok', f);
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('K-011b ungesperrt / Angleichen', () => {
  test('ungesperrt → updateOfferDescriptionBySku spricht eBay an (wie bisher)', async () => {
    ebay.__setPriceLockCheckForTests(async () => false); calls.length = 0;
    await ebay.updateOfferDescriptionBySku('stele-220-GRAY', '<p>x</p>', 'tok', f);
    expect(calls[0]).toContain('GET ');
  });
  test('Angleichen (bypassPriceLock) bleibt trotz Sperre erlaubt', async () => {
    calls.length = 0;
    await updateOfferPriceBySku('stele-220-GRAY', 19.95, 'tok', f, false, { bypassPriceLock: true, isLocked: async () => true });
    expect(calls.length).toBeGreaterThan(0);
  });
});
