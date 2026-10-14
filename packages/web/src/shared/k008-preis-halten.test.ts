// K-008 (Kalkulator 14.10.2026): "Preis halten" je Variante. Fall stele-220 (Inhaber 21:14): GRAY 19,95 halten, Anzeige aus (adRate 0),
// Kassen-Ware GRAY 11,47 · BLUE 12,49 · BLACK 11,59, China (+3,57 Einfuhr, Versand frei ab 10 €), Stufe A.
// Alle Erwartungswerte mit bun nachgerechnet (Grundgesetz 3).
import { describe, expect, test } from 'bun:test';
import { resolvePriceHolds, parsePriceHolds, releaseNoticeText, SINGLE_ITEM_HOLD_KEY, PRICE_HOLD_MIN_PROFIT_EUR } from './price-hold';
import { planVariantRaises, runVariantRaise } from '../api/variant-raise';

const p220 = (gray: number, graySell = 19.95) => ({
  id: 220, variants: JSON.stringify([{ name: 'Color Name', values: ['GRAY', 'Blue', 'black'] }]), targetMarginEur: 1, shipsFrom: 'China', adRate: 0,
  sellPrice: 19.95, buyPrice: gray,
  variantPrices: JSON.stringify([
    { skuId: 'g', attrs: { 'Color Name': 'GRAY' }, price: gray },
    { skuId: 'b', attrs: { 'Color Name': 'Blue' }, price: 12.49 },
    { skuId: 'k', attrs: { 'Color Name': 'black' }, price: 11.59 },
  ]),
  variantSellPrices: JSON.stringify({ g: graySell, b: 21.95, k: 20.95 }), ebayStatus: 'listed', ebayListingId: '198712713157',
});
const holdGray = { g: { sellPrice: 19.95, at: '2026-10-14T19:14:00.000Z', note: 'Inhaber 21:14' } };

describe('K-008 Preis halten', () => {
  test('ohne Halten: GRAY 19,95 (Gewinn 0,9919 < Boden 1,00) → Anheben auf 20,45 (Verhalten unverändert)', () => {
    const r = planVariantRaises(p220(11.47));
    expect(r.map(x => [x.skuId, x.oldSell, x.newSell])).toEqual([['g', 19.95, 20.45]]);
    expect(r[0].oldProfit).toBeCloseTo(0.9919, 4);
  });
  test('GRAY gehalten bei 19,95, Gewinn 0,99 ≥ 0,90 → gehalten, kein Anheben', () => {
    const h = resolvePriceHolds(p220(11.47), holdGray);
    expect([...h.heldKeys]).toEqual(['g']);
    expect(h.releaseKeys).toEqual([]);
    expect(h.rows[0].profit).toBeCloseTo(0.9919, 4);
    expect(planVariantRaises(p220(11.47), h.heldKeys)).toEqual([]);
  });
  test('Sicherheitsnetz: Ware 11,60 → Gewinn 0,8619 < 0,90 → Halten aufheben, Anheben auf 20,45', () => {
    const h = resolvePriceHolds(p220(11.6), holdGray);
    expect([...h.heldKeys]).toEqual([]);
    expect(h.releaseKeys).toEqual(['g']);
    expect(h.rows[0].profit).toBeCloseTo(0.8619, 4);
    expect(planVariantRaises(p220(11.6), h.heldKeys).map(x => [x.skuId, x.newSell])).toEqual([['g', 20.45]]);
    expect(releaseNoticeText(220, h.rows[0])).toContain('nur noch 0.86 €');
  });
  test('Preis inzwischen geändert (heute 20,45 statt 19,95) → Halten veraltet, wirkt nicht', () => {
    const h = resolvePriceHolds(p220(11.47, 20.45), holdGray);
    expect(h.rows[0].state).toBe('stale');
    expect(h.heldKeys.size).toBe(0);
    expect(h.releaseKeys).toEqual([]);
  });
  test('runVariantRaise (Schalter AN, Mock): gehaltene Variante wird nicht gesendet', async () => {
    const sent: string[] = [];
    const out = await runVariantRaise(p220(11.47), {
      enabled: true, heldSkuIds: new Set(['g']),
      send: async (raises) => { sent.push(...raises.map(r => r.skuId)); return { resolved: true, results: raises.map(r => ({ skuId: r.skuId, ok: true })) }; },
      store: async () => {}, log: () => {},
    });
    expect(out.status).toBe('nothing');
    expect(sent).toEqual([]);
  });
  test('Einzelartikel: Ware 11,47, VK 19,95, adRate 0 → gehalten (alles gehalten)', () => {
    const single = { id: 5, variants: null, targetMarginEur: 1, shipsFrom: 'China', adRate: 0, sellPrice: 19.95, buyPrice: 11.47, variantPrices: null };
    const h = resolvePriceHolds(single, { [SINGLE_ITEM_HOLD_KEY]: { sellPrice: 19.95, at: '2026-10-14T19:14:00.000Z' } });
    expect(h.heldKeys.has(SINGLE_ITEM_HOLD_KEY)).toBe(true);
    expect(h.allHeld).toBe(true);
  });
  test('stele-220: nur GRAY gehalten → nicht "alles gehalten"', () => {
    expect(resolvePriceHolds(p220(11.47), holdGray).allHeld).toBe(false);
  });
  test('Speicherformat: kaputte Einträge werden verworfen, Grenze 0,90', () => {
    expect(parsePriceHolds('{"220":{"g":{"sellPrice":19.95,"at":"x"},"bad":{"sellPrice":-1,"at":"x"}},"9":{}}')).toEqual({ '220': { g: { sellPrice: 19.95, at: 'x', note: null } } });
    expect(parsePriceHolds('kaputt')).toEqual({});
    expect(PRICE_HOLD_MIN_PROFIT_EUR).toBe(0.9);
  });
});
