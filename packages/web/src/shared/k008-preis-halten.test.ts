// AUFSICHT 045 Teil A (09.11.2026, gestaffelte eBay-Fixgebühr 0,35/0,45 statt 0,30): Erwartungswerte in dieser Datei mit bun neu gerechnet.
// Zahlen in Testnamen/Kommentaren können noch den Stand mit 0,30 zeigen — maßgeblich sind die expect-Werte. Liste alt → neu: docs/fixgebuehr-testaenderungen.md
// K-008 (Kalkulator 14.10.2026): "Preis halten" je Variante. Fall stele-220 (Inhaber 21:14): GRAY 19,95 halten, Anzeige aus (adRate 0),
// Kassen-Ware GRAY 11,47 · BLUE 12,49 · BLACK 11,59, China (+3,57 Einfuhr, Versand frei ab 10 €), Stufe A.
// Alle Erwartungswerte mit bun nachgerechnet (Grundgesetz 3).
import { describe, expect, test } from 'bun:test';
import { resolvePriceHolds, parsePriceHolds, releaseNoticeText, SINGLE_ITEM_HOLD_KEY, PRICE_HOLD_MIN_PROFIT_EUR } from './price-hold';
import { planVariantRaises, runVariantRaise } from '../api/variant-raise';

// Formel je Standort (08.11.2026): mit S 1,19 (China, f 0 % = 0,787585) läge GRAY 11,47 @ 19,95 nur bei 0,3153 < 0,90 (Halten wäre nie möglich),
// Blue @ 21,95 (0,8705) und black @ 20,95 (0,9829) würden selbst angehoben. EINGABEN GEÄNDERT (frisch mit bun): GRAY-Ware 11,47 → 11,59,
// Halte-VK 19,95 → 20,95 (Gewinn 0,9829, wie vorher knapp unter 1,00); Blue 21,95 → 22,45 (1,2643), black 20,95 → 21,45 (1,3767);
// Sicherheitsnetz-Ware 11,60 → 11,72 (+0,13 wie vorher → 0,8529).
// AUFSICHT 045 Teil A (09.11.2026): Fixgebühr 0,45 statt 0,30 (−0,1785 € Gewinn) → GRAY @ 20,95 läge bei 0,8044 < 0,90 (Halten unmöglich).
// EINGABEN GEÄNDERT (bun): GRAY-Ware 11,59 → 11,41 (Gewinn @ 20,95 wieder knapp unter 1,00), Sicherheitsnetz-Ware 11,72 → 11,54,
// Einzelartikel-Ware 11,59 → 11,41. Blue @ 22,45 / black @ 21,45 bleiben über 1,00 (kein eigenes Anheben).
const p220 = (gray: number, graySell = 20.95) => ({
  id: 220, variants: JSON.stringify([{ name: 'Color Name', values: ['GRAY', 'Blue', 'black'] }]), targetMarginEur: 1, shipsFrom: 'China', adRate: 0,
  sellPrice: 20.95, buyPrice: gray,
  variantPrices: JSON.stringify([
    { skuId: 'g', attrs: { 'Color Name': 'GRAY' }, price: gray },
    { skuId: 'b', attrs: { 'Color Name': 'Blue' }, price: 12.49 },
    { skuId: 'k', attrs: { 'Color Name': 'black' }, price: 11.59 },
  ]),
  variantSellPrices: JSON.stringify({ g: graySell, b: 22.45, k: 21.45 }), ebayStatus: 'listed', ebayListingId: '198712713157',
});
const holdGray = { g: { sellPrice: 20.95, at: '2026-10-14T19:14:00.000Z', note: 'Inhaber 21:14' } };

describe('K-008 Preis halten', () => {
  test('ohne Halten: GRAY 20,95 (Gewinn 0,9844 < Boden 1,00) → Anheben auf 21,45 (Verhalten unverändert)', () => {
    const r = planVariantRaises(p220(11.41));
    expect(r.map(x => [x.skuId, x.oldSell, x.newSell])).toEqual([['g', 20.95, 21.45]]);
    expect(r[0].oldProfit).toBeCloseTo(0.9844, 4);
  });
  test('GRAY gehalten bei 20,95, Gewinn 0,98 ≥ 0,90 → gehalten, kein Anheben', () => {
    const h = resolvePriceHolds(p220(11.41), holdGray);
    expect([...h.heldKeys]).toEqual(['g']);
    expect(h.releaseKeys).toEqual([]);
    expect(h.rows[0].profit).toBeCloseTo(0.9844, 4);
    expect(planVariantRaises(p220(11.41), h.heldKeys)).toEqual([]);
  });
  test('Sicherheitsnetz: Ware 11,54 → Gewinn 0,8544 < 0,90 → Halten aufheben, Anheben auf 21,45', () => {
    const h = resolvePriceHolds(p220(11.54), holdGray);
    expect([...h.heldKeys]).toEqual([]);
    expect(h.releaseKeys).toEqual(['g']);
    expect(h.rows[0].profit).toBeCloseTo(0.8544, 4);
    expect(planVariantRaises(p220(11.54), h.heldKeys).map(x => [x.skuId, x.newSell])).toEqual([['g', 21.45]]);
    expect(releaseNoticeText(220, h.rows[0])).toContain('nur noch 0.85 €');
  });
  test('Preis inzwischen geändert (heute 21,45 statt 20,95) → Halten veraltet, wirkt nicht', () => {
    const h = resolvePriceHolds(p220(11.41, 21.45), holdGray);
    expect(h.rows[0].state).toBe('stale');
    expect(h.heldKeys.size).toBe(0);
    expect(h.releaseKeys).toEqual([]);
  });
  test('runVariantRaise (Schalter AN, Mock): gehaltene Variante wird nicht gesendet', async () => {
    const sent: string[] = [];
    const out = await runVariantRaise(p220(11.41), {
      enabled: true, heldSkuIds: new Set(['g']),
      send: async (raises) => { sent.push(...raises.map(r => r.skuId)); return { resolved: true, results: raises.map(r => ({ skuId: r.skuId, ok: true })) }; },
      store: async () => {}, log: () => {},
    });
    expect(out.status).toBe('nothing');
    expect(sent).toEqual([]);
  });
  test('Einzelartikel: Ware 11,41, VK 20,95, adRate 0 → gehalten (alles gehalten)', () => {
    const single = { id: 5, variants: null, targetMarginEur: 1, shipsFrom: 'China', adRate: 0, sellPrice: 20.95, buyPrice: 11.41, variantPrices: null };
    const h = resolvePriceHolds(single, { [SINGLE_ITEM_HOLD_KEY]: { sellPrice: 20.95, at: '2026-10-14T19:14:00.000Z' } });
    expect(h.heldKeys.has(SINGLE_ITEM_HOLD_KEY)).toBe(true);
    expect(h.allHeld).toBe(true);
  });
  test('stele-220: nur GRAY gehalten → nicht "alles gehalten"', () => {
    expect(resolvePriceHolds(p220(11.41), holdGray).allHeld).toBe(false);
  });
  test('Speicherformat: kaputte Einträge werden verworfen, Grenze 0,90', () => {
    expect(parsePriceHolds('{"220":{"g":{"sellPrice":19.95,"at":"x"},"bad":{"sellPrice":-1,"at":"x"}},"9":{}}')).toEqual({ '220': { g: { sellPrice: 19.95, at: 'x', note: null } } });
    expect(parsePriceHolds('kaputt')).toEqual({});
    expect(PRICE_HOLD_MIN_PROFIT_EUR).toBe(0.9);
  });
});
