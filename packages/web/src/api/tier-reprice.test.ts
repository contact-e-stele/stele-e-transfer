// A-017: runTierReprice mit Mock-Abhängigkeiten. Beweist die Kernregel: ein Stufenwechsel löst KEINEN eBay-Aufruf aus, solange nicht
// ausdrücklich bestätigt UND gesendet wird; die App-Preise werden bei live gelisteten Produkten erst nach erfolgreichem Senden
// gespeichert. Zusätzlich zählt ein globaler fetch-Spion, dass in keinem Fall ein Netzwerkaufruf passiert (die Deps sind Mocks).
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { runTierReprice, type TierRepriceDeps, type TierRepriceProductRow } from './tier-reprice';

const variantProduct = (over: Partial<TierRepriceProductRow> = {}): TierRepriceProductRow => ({
  id: 218, generatedTitle: 'Test 218', buyPrice: 1.75, sellPrice: null, shipsFrom: 'China', adRate: 5,
  variants: JSON.stringify([{ name: 'Size', values: ['200PCS'] }, { name: 'Color', values: ['6x8cm', '8x12cm'] }]),
  variantPrices: JSON.stringify([
    { skuId: 'a', attrs: { Size: '200PCS', Color: '6x8cm' }, price: 2.99, ebayPrice: 14.95 },
    { skuId: 'b', attrs: { Size: '200PCS', Color: '8x12cm' }, price: 3.99, ebayPrice: 16.95 },
  ]),
  variantSellPrices: null, ebayStatus: 'none', ebayListingId: null, ...over,
});
const live = (over: Partial<TierRepriceProductRow> = {}) => variantProduct({ ebayStatus: 'listed', ebayListingId: '198600000000', ...over });
const single = (over: Partial<TierRepriceProductRow> = {}): TierRepriceProductRow => ({
  id: 5, generatedTitle: 'Einzel', buyPrice: 3.15, sellPrice: 11.95, shipsFrom: 'China', adRate: 5, variants: '[]', variantPrices: null,
  variantSellPrices: null, ebayStatus: 'listed', ebayListingId: '198600000001', ...over,
});

const input = (mode: 'preview' | 'apply', extra: Partial<{ confirm: boolean; sendToEbay: boolean; ids: number[] }> = {}) => ({
  productIds: extra.ids ?? [218], targetMarginEur: 1.5, mode, confirm: extra.confirm ?? false, sendToEbay: extra.sendToEbay ?? false,
});

let calls: { sendVariants: number; sendSingle: number; store: number };
let deps: TierRepriceDeps;
let storeArgs: Array<[number, Record<string, unknown>]>;
const realFetch = globalThis.fetch;
let fetchCount = 0;

beforeEach(() => {
  calls = { sendVariants: 0, sendSingle: 0, store: 0 };
  storeArgs = [];
  fetchCount = 0;
  globalThis.fetch = mock(async () => { fetchCount++; throw new Error('Netzwerk darf nicht berührt werden'); }) as unknown as typeof fetch;
  deps = {
    sendVariants: async () => { calls.sendVariants++; return { ok: true, updatedCount: 2, errors: [] }; },
    sendSingle: async () => { calls.sendSingle++; return { ok: true }; },
    store: async (id, patch) => { calls.store++; storeArgs.push([id, patch]); },
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('Vorschau: nie ein eBay-Aufruf, nie ein Schreibvorgang', () => {
  test('live gelistetes Varianten-Produkt: 0 Sende-Aufrufe, 0 Speichern, 0 fetch — der Stufenwechsel allein löst NICHTS aus', async () => {
    const [r] = await runTierReprice(new Map([[218, live()]]), input('preview'), deps);
    expect(r.status).toBe('preview');
    expect(r.isLive).toBe(true);
    expect(r.plan?.rows).toHaveLength(2);
    expect(calls).toEqual({ sendVariants: 0, sendSingle: 0, store: 0 });
    expect(fetchCount).toBe(0);
  });

  test('Vorschau wird auch mit confirm + sendToEbay nicht zum Senden', async () => {
    await runTierReprice(new Map([[218, live()]]), input('preview', { confirm: true, sendToEbay: true }), deps);
    expect(calls).toEqual({ sendVariants: 0, sendSingle: 0, store: 0 });
  });

  test('unbekannte ID → not_found, nichts passiert', async () => {
    const [r] = await runTierReprice(new Map(), input('preview'), deps);
    expect(r.status).toBe('not_found');
    expect(calls).toEqual({ sendVariants: 0, sendSingle: 0, store: 0 });
  });
});

describe('apply bei live gelisteten Produkten: nur mit ausdrücklichem sendToEbay', () => {
  test('apply + confirm, aber OHNE sendToEbay → abgelehnt, 0 Aufrufe, nichts gespeichert', async () => {
    const [r] = await runTierReprice(new Map([[218, live()]]), input('apply', { confirm: true }), deps);
    expect(r.status).toBe('rejected');
    expect(calls).toEqual({ sendVariants: 0, sendSingle: 0, store: 0 });
    expect(fetchCount).toBe(0);
  });

  test('apply + confirm + sendToEbay: ERST eBay (1 Aufruf mit den neuen VK je Variante), DANACH Speichern von Ziel + variant_sell_prices', async () => {
    const order: string[] = [];
    deps.sendVariants = async (id, groups, rows) => {
      order.push('send'); calls.sendVariants++;
      expect(id).toBe(218);
      expect(groups).toHaveLength(2);
      expect(rows.map(r => [r.skuId, r.correctSellPrice])).toEqual([['a', 13.95], ['b', 14.95]]);
      return { ok: true, updatedCount: 2, errors: [] };
    };
    deps.store = async (id, patch) => { order.push('store'); calls.store++; storeArgs.push([id, patch]); };
    const [r] = await runTierReprice(new Map([[218, live()]]), input('apply', { confirm: true, sendToEbay: true }), deps);
    expect(r.status).toBe('sent');
    expect(r.sentCount).toBe(2);
    expect(order).toEqual(['send', 'store']);
    expect(storeArgs[0][0]).toBe(218);
    expect(storeArgs[0][1].targetMarginEur).toBe(1.5);
    expect(JSON.parse(storeArgs[0][1].variantSellPrices as string)).toEqual({ a: 13.95, b: 14.95 });
  });

  test('Senden schlägt (teilweise) fehl → App-Preise werden NICHT gespeichert (App nie weiter als eBay), Status send_failed', async () => {
    deps.sendVariants = async () => { calls.sendVariants++; return { ok: true, updatedCount: 1, errors: ['x-b: Preis konnte nicht auf 14.95€ gesetzt werden'] }; };
    const [r] = await runTierReprice(new Map([[218, live()]]), input('apply', { confirm: true, sendToEbay: true }), deps);
    expect(r.status).toBe('send_failed');
    expect(r.error).toContain('1 von 2');
    expect(calls.store).toBe(0);
  });

  test('Senden komplett fehlgeschlagen (ok:false) → nichts gespeichert', async () => {
    deps.sendVariants = async () => ({ ok: false, updatedCount: 0, errors: [] });
    const [r] = await runTierReprice(new Map([[218, live()]]), input('apply', { confirm: true, sendToEbay: true }), deps);
    expect(r.status).toBe('send_failed');
    expect(calls.store).toBe(0);
  });

  test('Einzelartikel live: sendSingle mit neuem Preis 13,95 (Ware 3,15, Stufe B), danach sellPrice speichern; Fehler → nichts gespeichert', async () => {
    let sent = null as [number, string, number] | null;
    deps.sendSingle = async (id, listingId, price) => { calls.sendSingle++; sent = [id, listingId, price]; return { ok: true }; };
    const [r] = await runTierReprice(new Map([[5, single()]]), input('apply', { ids: [5], confirm: true, sendToEbay: true }), deps);
    expect(r.status).toBe('sent');
    expect(sent).toEqual([5, '198600000001', 13.95]);
    expect(storeArgs[0][1]).toEqual({ targetMarginEur: 1.5, sellPrice: 13.95 });

    calls.store = 0; storeArgs = [];
    deps.sendSingle = async () => ({ ok: false, error: 'HTTP 400' });
    const [bad] = await runTierReprice(new Map([[5, single()]]), input('apply', { ids: [5], confirm: true, sendToEbay: true }), deps);
    expect(bad.status).toBe('send_failed');
    expect(calls.store).toBe(0);
  });

  test('live, aber Preise schon passend (changedCount 0): nur das Ziel wird gespeichert, eBay bleibt unberührt', async () => {
    const [first] = await runTierReprice(new Map([[5, single()]]), input('apply', { ids: [5], confirm: true, sendToEbay: true }), deps);
    const done = single({ sellPrice: first.stored!.sellPrice! });
    calls = { sendVariants: 0, sendSingle: 0, store: 0 }; storeArgs = [];
    const [r] = await runTierReprice(new Map([[5, done]]), input('apply', { ids: [5], confirm: true, sendToEbay: true }), deps);
    expect(r.status).toBe('stored');
    expect(calls.sendSingle).toBe(0);
    expect(storeArgs[0][1]).toEqual({ targetMarginEur: 1.5 });
  });
});

describe('nicht live gelistet (z. B. stele-218): Preise nur in der App speichern, nie eBay', () => {
  test('apply + confirm → store mit Ziel + variant_sell_prices (alle Varianten), 0 eBay-Aufrufe, 0 fetch', async () => {
    const [r] = await runTierReprice(new Map([[218, variantProduct()]]), input('apply', { confirm: true }), deps);
    expect(r.status).toBe('stored');
    expect(r.isLive).toBe(false);
    expect(calls.sendVariants + calls.sendSingle).toBe(0);
    expect(calls.store).toBe(1);
    expect(JSON.parse(storeArgs[0][1].variantSellPrices as string)).toEqual({ a: 13.95, b: 14.95 });
    expect(fetchCount).toBe(0);
  });

  test('status "listed" ohne ebayListingId gilt NICHT als live', async () => {
    const [r] = await runTierReprice(new Map([[218, variantProduct({ ebayStatus: 'listed', ebayListingId: null })]]), input('apply', { confirm: true }), deps);
    expect(r.isLive).toBe(false);
    expect(r.status).toBe('stored');
  });
});

describe('W1: Exceptions in Abhängigkeiten verwerfen keine Ergebnisse und stoppen die Charge nicht', () => {
  test('store wirft NACH erfolgreichem Senden → sent_not_stored (klarer Text), die anderen Produkte werden trotzdem bearbeitet', async () => {
    deps.store = async (id) => { calls.store++; if (id === 218) throw new Error('DB weg'); };
    const m = new Map<number, TierRepriceProductRow>([[218, live()], [5, single()]]);
    const res = await runTierReprice(m, input('apply', { ids: [218, 5], confirm: true, sendToEbay: true }), deps);
    expect(res.map(r => [r.productId, r.status])).toEqual([[218, 'sent_not_stored'], [5, 'sent']]);
    expect(res[0].error).toContain('eBay ist neuer als die App');
    expect(calls.sendVariants).toBe(1);
    expect(calls.sendSingle).toBe(1);
  });

  test('sendVariants wirft → send_failed (nichts gespeichert), nächstes Produkt läuft', async () => {
    deps.sendVariants = async () => { calls.sendVariants++; throw new Error('Netz weg'); };
    const m = new Map<number, TierRepriceProductRow>([[218, live()], [5, single()]]);
    const res = await runTierReprice(m, input('apply', { ids: [218, 5], confirm: true, sendToEbay: true }), deps);
    expect(res.map(r => r.status)).toEqual(['send_failed', 'sent']);
    expect(res[0].error).toContain('eBay-Stand unklar');
    expect(storeArgs.map(a => a[0])).toEqual([5]);
  });

  test('sendSingle wirft → send_failed, store nicht aufgerufen; Exception beim Speichern (nicht live) → error', async () => {
    deps.sendSingle = async () => { calls.sendSingle++; throw new Error('boom'); };
    const [r] = await runTierReprice(new Map([[5, single()]]), input('apply', { ids: [5], confirm: true, sendToEbay: true }), deps);
    expect(r.status).toBe('send_failed');
    expect(calls.store).toBe(0);
    deps.store = async () => { throw new Error('DB'); };
    const [s] = await runTierReprice(new Map([[218, variantProduct()]]), input('apply', { confirm: true }), deps);
    expect(s.status).toBe('error');
    expect(s.error).toContain('Unerwarteter Fehler');
  });
});

describe('W2: "voller Erfolg" = jede Plan-Zeile wurde an eine reale eBay-Variante gesendet', () => {
  test('updatedCount < Plan-Zeilen bei leeren errors (eBay-Gruppe hat weniger SKUs) → send_failed, App-Preise NICHT gespeichert', async () => {
    deps.sendVariants = async () => { calls.sendVariants++; return { ok: true, updatedCount: 1, errors: [] }; };
    const [r] = await runTierReprice(new Map([[218, live()]]), input('apply', { confirm: true, sendToEbay: true }), deps);
    expect(r.status).toBe('send_failed');
    expect(r.error).toContain('1 von 2');
    expect(r.error).toContain('passende eBay-SKU');
    expect(calls.store).toBe(0);
  });
});

describe('W3: sendToEbay bei einem laut App nicht live gelisteten Produkt wird abgelehnt (keine stille Nur-App-Speicherung)', () => {
  test('rejected, 0 Aufrufe, nichts gespeichert', async () => {
    const [r] = await runTierReprice(new Map([[218, variantProduct()]]), input('apply', { confirm: true, sendToEbay: true }), deps);
    expect(r.status).toBe('rejected');
    expect(r.error).toContain('nicht live gelistet');
    expect(calls).toEqual({ sendVariants: 0, sendSingle: 0, store: 0 });
  });
});

describe('W5: nur bestätigte Preise werden gesendet', () => {
  const confirmedFor = async () => {
    const [prev] = await runTierReprice(new Map([[218, live()]]), input('preview'), deps);
    return Object.fromEntries(prev.plan!.rows.map(r => [r.skuId ?? '', r.newSell]));
  };

  test('Plan hat sich seit der Vorschau geändert (Einkaufspreis) → rejected, 0 Aufrufe', async () => {
    const confirmed = await confirmedFor();
    const drifted = live({ variantPrices: JSON.stringify([
      { skuId: 'a', attrs: { Size: '200PCS', Color: '6x8cm' }, price: 3.59, ebayPrice: 14.95 },
      { skuId: 'b', attrs: { Size: '200PCS', Color: '8x12cm' }, price: 3.99, ebayPrice: 16.95 },
    ]) });
    const [r] = await runTierReprice(new Map([[218, drifted]]), { ...input('apply', { confirm: true, sendToEbay: true }), expected: { '218': confirmed } }, deps);
    expect(r.status).toBe('rejected');
    expect(r.error).toContain('seit der Vorschau geändert');
    expect(calls).toEqual({ sendVariants: 0, sendSingle: 0, store: 0 });
  });

  test('unveränderter Plan + bestätigte Preise → wird gesendet', async () => {
    const confirmed = await confirmedFor();
    const [r] = await runTierReprice(new Map([[218, live()]]), { ...input('apply', { confirm: true, sendToEbay: true }), expected: { '218': confirmed } }, deps);
    expect(r.status).toBe('sent');
  });
});

describe('Charge mit mehreren Produkten', () => {
  test('gemischt live/nicht live: live ohne sendToEbay abgelehnt, nicht-live gespeichert, nichts an eBay', async () => {
    const m = new Map<number, TierRepriceProductRow>([[218, variantProduct()], [5, single()]]);
    const res = await runTierReprice(m, input('apply', { ids: [218, 5], confirm: true }), deps);
    expect(res.map(r => [r.productId, r.status])).toEqual([[218, 'stored'], [5, 'rejected']]);
    expect(calls.sendVariants + calls.sendSingle).toBe(0);
  });
});
