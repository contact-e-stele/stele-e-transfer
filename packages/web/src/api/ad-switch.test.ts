// OFFEN 024 NACHTRAG: Reihenfolge der eBay-Schritte mit Attrappen (kein Netz). Fixture stele-227 (Live 03.11.: Grey, EK 4,99, VK 18,95, 5 %).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runAdSwitch, type AdSwitchDeps, type AdSwitchProduct } from './ad-switch';
import { aliEinfuhrEur, setAliEinfuhrEur } from '../shared/constants';

let before = 0;
beforeAll(() => { before = aliEinfuhrEur(); setAliEinfuhrEur(5.95); });
afterAll(() => setAliEinfuhrEur(before));

const p227 = (adRate: number, sell = 18.95): AdSwitchProduct => ({
  id: 227, title: 'Grey', ebayListingId: '198725803587', adRate, ebayRate: adRate, targetMarginEur: 1, isChinaOrigin: true, checkoutFactor: null, isVariant: true,
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

// OFFEN 025: stele-123 nach dem Lauf 03.11. 08:43 (Live gelesen 08:5x): 4 Preise gesetzt, 200PCS 36,95 und 20PCS 16,95 nicht.
// Freigabe-Tabelle: 200PCS 34,95, 20PCS 15,95. Nachholen darf NUR diese zwei senden und die schon gesenkten NICHT erneut senken.
// HISTORISCHE ZAHL GEÄNDERT (Formel je Standort, 08.11.2026): planAdRateSwitch rechnet China mit S 1,19 — die Vorschau (= Freigabe) ergibt
// jetzt 14,95 / 15,95 / 17,95 / 19,95 / 23,95 / 33,95 (vorher 100PCS 24,95, 200PCS 34,95; siehe shared/ad-rate-switch.test.ts). Stand
// "nach dem Lauf" entsprechend: 100PCS schon auf 23,95 (Eingabe geändert, vorher 24,95); offen bleiben 20PCS 16,95 und 200PCS 36,95.
const p123now = (): AdSwitchProduct => ({
  id: 123, title: 'Spritzbeutel', ebayListingId: '198601076435', adRate: 0, ebayRate: 0, targetMarginEur: 2, isChinaOrigin: true, checkoutFactor: null, isVariant: true,
  groups: [{ name: 'Menge', values: ['10PCS', '20PCS', '30PCS', '50PCS', '100PCS', '200PCS'] }],
  rows: [
    { skuId: '264', label: '10PCS', attrs: {}, buyPrice: 2.09, sellPrice: 14.95 },
    { skuId: '265', label: '20PCS', attrs: {}, buyPrice: 2.69, sellPrice: 16.95 },
    { skuId: '266', label: '30PCS', attrs: {}, buyPrice: 4.19, sellPrice: 17.95 },
    { skuId: '267', label: '50PCS', attrs: {}, buyPrice: 6.09, sellPrice: 19.95 },
    { skuId: '268', label: '100PCS', attrs: {}, buyPrice: 11.79, sellPrice: 23.95 },
    { skuId: '269', label: '200PCS', attrs: {}, buyPrice: 20.39, sellPrice: 36.95 },
  ],
});
const freigabe123 = { '264': 14.95, '265': 15.95, '266': 17.95, '267': 19.95, '268': 23.95, '269': 33.95 };

describe('Fehlende Preise nachholen (OFFEN 025)', () => {
  test('Vorschau: nur 20PCS 15,95 und 200PCS 33,95, der Rest "schon gesetzt"', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([p123now()], { toRate: 0, confirm: false, expected: freigabe123, retryFromRate: 5 }, m.deps);
    expect(r.status).toBe('preview');
    expect(r.rows.filter(x => x.send).map(x => [x.label, x.newVk])).toEqual([['20PCS', 15.95], ['200PCS', 33.95]]);
    expect(r.rows.filter(x => !x.send).every(x => x.reason === 'schon gesetzt')).toBe(true);
    expect(m.calls).toEqual([]);
  });
  test('Ausführen: sendet alte Preise unverändert mit, keine Werbe-Änderung, dann Rücklesen', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([p123now()], { toRate: 0, confirm: true, expected: freigabe123, retryFromRate: 5 }, m.deps);
    expect(r.status).toBe('done');
    expect(m.calls).toEqual(['send 123 14.95,15.95,17.95,19.95,23.95,33.95', 'readback 123']);
  });
  test('ohne Freigabe-Preis für eine SKU wird sie nicht gesendet', async () => {
    const m = mocks();
    const { '269': _, ...ohne200 } = freigabe123;
    const [r] = await runAdSwitch([p123now()], { toRate: 0, confirm: false, expected: ohne200, retryFromRate: 5 }, m.deps);
    expect(r.rows.find(x => x.label === '200PCS')!.send).toBe(false);
  });
});

describe('Alle Sätze + Abgleich (Inhaber 03.11.2026 13:14)', () => {
  test('5 → 3: Satz runter → erst Kampagne auf 3 %, dann Preis', async () => {
    const m = mocks();
    // China S 1,19: 22,45 × 0,71678 / 0,745102 = 21,60 → 21,95 (bun; vorher S 1: × 0,762 / 0,7858 = 21,77)
    const [r] = await runAdSwitch([p227(5, 22.45)], { toRate: 3, confirm: true }, m.deps);
    expect(r.status).toBe('done');
    expect(m.calls).toEqual(['addAds 198725803587 3', 'adRate 227 3', 'send 227 21.95', 'readback 227']);
  });
  // Formel je Standort: 17,95 × 0,787585 / 0,745102 = 18,97 → 19,95 (bun; vorher S 1 → 18,95)
  test('0 → 3: Satz rauf → erst Preis 19,95, dann Kampagne 3 %', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([p227(0, 17.95)], { toRate: 3, confirm: true }, m.deps);
    expect(r.status).toBe('done');
    expect(m.calls).toEqual(['send 227 19.95', 'addAds 198725803587 3', 'adRate 227 3', 'readback 227']);
  });
  test('eBay 5 %, App 0 %, Wahl 3 %: Preise rechnen vom App-Satz (0 → 3), eBay wird mit auf 3 % gesetzt', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([{ ...p227(0, 17.95), ebayRate: 5 }], { toRate: 3, confirm: true }, m.deps);
    expect(r.status).toBe('done');
    expect(r.note).toBe('Abgleich: bei eBay 5 %, in der App 0 % — eBay wird mit angeglichen');
    expect(m.calls).toEqual(['send 227 19.95', 'addAds 198725803587 3', 'adRate 227 3', 'readback 227']);
  });
  test('reiner Abgleich: App 0 %, eBay 5 %, Wahl 0 % → nur Werbung bei eBay entfernen, keine Preise', async () => {
    const m = mocks();
    const [pv] = await runAdSwitch([{ ...p227(0, 17.95), ebayRate: 5 }], { toRate: 0, confirm: false }, m.deps);
    expect(pv.status).toBe('preview');
    expect(pv.rows).toEqual([]);
    const [r] = await runAdSwitch([{ ...p227(0, 17.95), ebayRate: 5 }], { toRate: 0, confirm: true }, m.deps);
    expect(r.status).toBe('done');
    expect(m.calls).toEqual(['removeAds 198725803587']);
  });
  test('reiner Abgleich: App 5 %, eBay 0 %, Wahl 5 % → nur in Kampagne 5 %', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([{ ...p227(5), ebayRate: 0 }], { toRate: 5, confirm: true }, m.deps);
    expect(r.status).toBe('done');
    expect(m.calls).toEqual(['addAds 198725803587 5']);
  });
  test('Werbestatus nicht lesbar → nichts gesendet', async () => {
    const m = mocks();
    const [r] = await runAdSwitch([{ ...p227(5), ebayRate: undefined }], { toRate: 0, confirm: true }, m.deps);
    expect(r.status).toBe('ebay_differs');
    expect(m.calls).toEqual([]);
  });
});
