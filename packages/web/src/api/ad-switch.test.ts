// OFFEN 024 NACHTRAG: Reihenfolge der eBay-Schritte mit Attrappen (kein Netz). Fixture stele-227 (Live 03.11.: Grey, EK 4,99, VK 18,95, 5 %).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runAdSwitch, type AdSwitchDeps, type AdSwitchProduct } from './ad-switch';
import { aliEinfuhrEur, setAliEinfuhrEur } from '../shared/constants';

let before = 0;
beforeAll(() => { before = aliEinfuhrEur(); setAliEinfuhrEur(5.95); });
afterAll(() => setAliEinfuhrEur(before));

const p227 = (adRate: number, sell = 18.95): AdSwitchProduct => ({
  id: 227, title: 'Grey', ebayListingId: '198725803587', adRate, targetMarginEur: 1, isChinaOrigin: true, checkoutFactor: null, isVariant: true,
  groups: [{ name: 'Color', values: ['Grey'] }],
  rows: [{ skuId: '12000038172369013', label: 'Grey', attrs: { Color: 'Grey' }, buyPrice: 4.99, sellPrice: sell }],
});

function mocks(opts: { adsOk?: boolean; pricesOk?: boolean } = {}) {
  const calls: string[] = [];
  const deps: AdSwitchDeps = {
    removeAds: async ids => { calls.push(`removeAds ${ids}`); return { ok: opts.adsOk !== false, results: ids.map(listingId => ({ listingId, ok: opts.adsOk !== false, error: opts.adsOk === false ? 'eBay 35048' : null })) }; },
    addAds: async (ids, pct) => { calls.push(`addAds ${ids} ${pct}`); return { ok: opts.adsOk !== false, results: ids.map(listingId => ({ listingId, ok: opts.adsOk !== false, error: opts.adsOk === false ? 'eBay 35048' : null })) }; },
    sendVariants: async (id, _g, rows) => { calls.push(`send ${id} ${rows.map(r => r.correctSellPrice).join(',')}`); return opts.pricesOk === false ? { ok: false, updatedCount: 0, errors: ['PUT 500'] } : { ok: true, updatedCount: rows.length, errors: [] }; },
    sendSingle: async (id, _l, price) => { calls.push(`single ${id} ${price}`); return { ok: true }; },
    storeAdRate: async (id, rate) => { calls.push(`adRate ${id} ${rate}`); },
    readback: async id => { calls.push(`readback ${id}`); return { ok: true }; },
  };
  return { calls, deps };
}

describe('Anzeige-Rate umschalten – Reihenfolge (OFFEN 024)', () => {
  test('Vorschau: nichts an eBay', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([p227(5)], { toRate: 0, confirm: false }, m.deps);
    expect(r.status).toBe('preview');
    expect(r.rows[0].newVk).toBe(17.95);
    expect(m.calls).toEqual([]);
  });
  test('5 → 0: erst Werbung raus, dann adRate, dann Preis senken, dann Rücklesen', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([p227(5)], { toRate: 0, confirm: true, expected: { '12000038172369013': 17.95 } }, m.deps);
    expect(r.status).toBe('done');
    expect(m.calls).toEqual(['removeAds 198725803587', 'adRate 227 0', 'send 227 17.95', 'readback 227']);
  });
  test('5 → 0: Werbung lässt sich nicht entfernen → Preis wird NICHT gesenkt', async () => {
    const m = mocks({ adsOk: false });
    const [r] = await runAdSwitch([p227(5)], { toRate: 0, confirm: true }, m.deps);
    expect(r.status).toBe('ads_failed');
    expect(m.calls).toEqual(['removeAds 198725803587']);
  });
  test('0 → 5: erst Preis anheben, dann Werbung, dann adRate', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([p227(0, 17.95)], { toRate: 5, confirm: true }, m.deps);
    expect(r.status).toBe('done');
    expect(m.calls).toEqual(['send 227 19.95', 'addAds 198725803587 5', 'adRate 227 5', 'readback 227']);
  });
  test('0 → 5: Preis nicht gesetzt → Werbung NICHT eingeschaltet', async () => {
    const m = mocks({ pricesOk: false });
    const [r] = await runAdSwitch([p227(0, 17.95)], { toRate: 5, confirm: true }, m.deps);
    expect(r.status).toBe('prices_failed');
    expect(m.calls.some(c => c.startsWith('addAds'))).toBe(false);
  });
  test('Vorschau veraltet (anderer erwarteter Preis) → nichts gesendet', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([p227(5)], { toRate: 0, confirm: true, expected: { '12000038172369013': 16.95 } }, m.deps);
    expect(r.status).toBe('mismatch');
    expect(m.calls).toEqual([]);
  });
  test('steht schon auf 0 % → unverändert, nichts an eBay', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([p227(0, 17.95)], { toRate: 0, confirm: true }, m.deps);
    expect(r.status).toBe('unchanged');
    expect(m.calls).toEqual([]);
  });
});
