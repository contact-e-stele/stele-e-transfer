// OFFEN 033 Orchestrierung mit Mocks (kein DB-/eBay-Zugriff): nur Auswahl wird gesendet · Speichern nur bei vollem Erfolg · Rücklesen.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { setAliEinfuhrEur, ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR } from '../shared/constants';
// Betriebswert Einfuhr 5,95 (der Test-Preload setzt sonst 3,57 für alte Belege) — danach zurück.
beforeAll(() => setAliEinfuhrEur(ALI_EINFUHR_EUR));
afterAll(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));
import { runVariantReprice, type VariantRepriceDeps, type VariantRepriceProductRow } from './variant-reprice';
import { p225, BLUE, BLACK, GRAY } from '../shared/variant-reprice.fixture';
import { parseVariantSellPrices } from '../shared/pricing';

const row = (over: Partial<VariantRepriceProductRow> = {}): VariantRepriceProductRow =>
  ({ ...p225(), generatedTitle: 'Reisekissen', variants: p225().variants as string, ebayStatus: 'listed', ebayListingId: '198725779927', ...over });

function deps(over: Partial<VariantRepriceDeps> = {}) {
  const calls = { send: [] as Array<Array<{ skuId: string; newSell: number }>>, store: [] as string[], readBack: 0, direction: [] as string[] };
  const d: VariantRepriceDeps = {
    heldSkuIds: async () => new Set(),
    send: async (_id, _g, _e, changes, direction) => { calls.send.push(changes); calls.direction.push(direction); return { resolved: true, results: changes.map(c => ({ skuId: c.skuId, sku: 's-' + c.skuId, ok: true })) }; },
    store: async (_id, json) => { calls.store.push(json); },
    readBack: async () => { calls.readBack++; return { ok: true, prices: { [BLUE]: 25.45, [BLACK]: 23.45, [GRAY]: 24.95 } }; },
    ...over,
  };
  return { d, calls };
}
const APPLY = { productId: 225, mode: 'apply' as const, confirm: true, sendToEbay: true };

describe('runVariantReprice', () => {
  test('preview: nichts gesendet, nichts gespeichert', async () => {
    const { d, calls } = deps();
    const r = await runVariantReprice(row(), { ...APPLY, mode: 'preview', confirm: false, prices: { [BLUE]: 25.45 } }, d);
    expect(r.status).toBe('preview');
    expect(calls.send).toHaveLength(0);
    expect(calls.store).toHaveLength(0);
  });
  test('nur die geprüfte Auswahl wird gesendet (abgelehnte Zeile nicht), App speichert nur diese, GRAY bleibt 24,95; Rücklesen eBay = App', async () => {
    const { d, calls } = deps();
    const r = await runVariantReprice(row(), { ...APPLY, prices: { [BLUE]: 25.45, [BLACK]: 23.45, [GRAY]: 25.95 } }, d);
    expect(r.status).toBe('sent');
    expect(calls.send).toEqual([[{ skuId: BLUE, newSell: 25.45 }, { skuId: BLACK, newSell: 23.45 }]]);
    expect(parseVariantSellPrices(calls.store[0])).toEqual({ [BLUE]: 25.45, [BLACK]: 23.45, [GRAY]: 24.95 });
    expect(r.rows.find(x => x.skuId === GRAY)?.status).toBe('abgelehnt');
    expect(r.rows.filter(x => x.ergebnis === 'gesetzt').every(x => x.ebayGleichApp === true)).toBe(true);
    expect(calls.readBack).toBe(1);
  });
  test('Teil-Fehler bei eBay → NICHTS gespeichert, Meldung "x von y"', async () => {
    const { d, calls } = deps({ send: async (_i, _g, _e, ch) => ({ resolved: true, results: ch.map((c, i) => ({ skuId: c.skuId, ok: i === 0, error: i === 0 ? undefined : 'PUT 500' })) }) });
    const r = await runVariantReprice(row(), { ...APPLY, prices: { [BLUE]: 25.45, [BLACK]: 23.45 } }, d);
    expect(r.status).toBe('send_failed');
    expect(r.error).toContain('1 von 2');
    expect(calls.store).toHaveLength(0);
  });
  test('übersprungen (eBay-Preis schon niedriger) zählt nicht als Erfolg → nichts gespeichert', async () => {
    const { d, calls } = deps({ send: async (_i, _g, _e, ch) => ({ resolved: true, results: ch.map(c => ({ skuId: c.skuId, ok: true, skipped: 'Live-Preis ist schon ≤ neuer Preis (nie anheben)' })) }) });
    const r = await runVariantReprice(row(), { ...APPLY, prices: { [BLUE]: 25.45 } }, d);
    expect(r.status).toBe('send_failed');
    expect(calls.store).toHaveLength(0);
  });
  test('Zuordnung nicht eindeutig → nichts gespeichert', async () => {
    const { d, calls } = deps({ send: async () => ({ resolved: false, reason: 'mehrdeutig', results: [] }) });
    const r = await runVariantReprice(row(), { ...APPLY, prices: { [BLUE]: 25.45 } }, d);
    expect(r.status).toBe('send_failed');
    expect(calls.store).toHaveLength(0);
  });
  test('live ohne sendToEbay → abgelehnt, nichts gesendet; nicht live → nur App speichern, nichts gesendet', async () => {
    const a = deps();
    expect((await runVariantReprice(row(), { ...APPLY, sendToEbay: false, prices: { [BLUE]: 25.45 } }, a.d)).status).toBe('rejected');
    expect(a.calls.send).toHaveLength(0);
    const b = deps();
    const r = await runVariantReprice(row({ ebayStatus: 'none', ebayListingId: null }), { ...APPLY, sendToEbay: false, prices: { [BLUE]: 25.45 } }, b.d);
    expect(r.status).toBe('stored');
    expect(b.calls.send).toHaveLength(0);
    expect(b.calls.store).toHaveLength(1);
  });
  test('"Preis halten" → gehalten und nicht gesendet; keine gültige Zeile → nothing_to_do', async () => {
    const { d, calls } = deps({ heldSkuIds: async () => new Set([BLUE]) });
    const r = await runVariantReprice(row(), { ...APPLY, prices: { [BLUE]: 25.45 } }, d);
    expect(r.status).toBe('nothing_to_do');
    expect(r.rows[0].status).toBe('gehalten');
    expect(calls.send).toHaveLength(0);
  });
  test('Rücklesen weicht ab → ebayGleichApp false (gemeldet)', async () => {
    const { d } = deps({ readBack: async () => ({ ok: true, prices: { [BLUE]: 26.95 } }) });
    const r = await runVariantReprice(row(), { ...APPLY, prices: { [BLUE]: 25.45 } }, d);
    expect(r.rows[0]).toMatchObject({ ergebnis: 'gesetzt', ebay: 26.95, ebayGleichApp: false });
  });
  test('Produkt fehlt → not_found', async () => {
    expect((await runVariantReprice(undefined, { ...APPLY, prices: { x: 1 } }, deps().d)).status).toBe('not_found');
  });
});

describe('runVariantReprice direction up (OFFEN 034)', () => {
  test('anheben: nur die Auswahl, Richtung "up" an das Senden, gespeichert nach vollem Erfolg', async () => {
    const { d, calls } = deps({ readBack: async () => ({ ok: true, prices: { [BLUE]: 27.45 } }) });
    const r = await runVariantReprice(row(), { ...APPLY, direction: 'up', prices: { [BLUE]: 27.45, [BLACK]: 23.95 } }, d);
    expect(r.status).toBe('sent');
    expect(calls.send).toEqual([[{ skuId: BLUE, newSell: 27.45 }]]);
    expect(calls.direction).toEqual(['up']);
    expect(parseVariantSellPrices(calls.store[0])[BLUE]).toBe(27.45);
    expect(r.rows[0]).toMatchObject({ ergebnis: 'gesetzt', ebayGleichApp: true });
  });
  test('ohne direction bleibt es Senken (Standard)', async () => {
    const { d, calls } = deps();
    await runVariantReprice(row(), { ...APPLY, prices: { [BLUE]: 25.45 } }, d);
    expect(calls.direction).toEqual(['down']);
  });
});
