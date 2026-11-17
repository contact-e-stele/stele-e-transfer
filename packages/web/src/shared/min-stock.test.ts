// 051: Mindestlager beim Mengen-Abgleich — 2 (Inhaber 17.11. 23:19, vorher 5). Fixture stele-251 Silver 90cm (neuer Lieferant
// 1005007433728405: Lager 3, 17.11.2026). Lager 3 unterscheidet alt/neu: bei 5 → 0, bei 2 → 3.
import { describe, expect, test } from 'bun:test';
import { ebayQuantityForStock, belowMinStock, MIN_STOCK_FOR_EBAY } from './min-stock';
import { resolveVariantQuantity } from '../api/ebay';

describe('051 Mindestlager 2', () => {
  test('Konstante ist 2 (Inhaber 17.11. 23:19)', () => { expect(MIN_STOCK_FOR_EBAY).toBe(2); });
  test('stele-251 Silver 90cm: Lager 3 → eBay 3 (bei Mindestlager 5 wäre es 0)', () => { expect(ebayQuantityForStock(3, 10)).toBe(3); });
  test('Lager 0 → 0, Lager 1 → 0, Lager 2 → 2, Lager 8 → 8, Lager 317 → Obergrenze 10', () => {
    expect([0, 1, 2, 8, 317].map(s => ebayQuantityForStock(s, 10))).toEqual([0, 0, 2, 8, 10]);
  });
  test('Obergrenze 4 (Einstellung) bei Lager 9 → 4', () => { expect(ebayQuantityForStock(9, 4)).toBe(4); });
  test('unbekannt → 0', () => { expect([undefined, null, NaN].map(s => ebayQuantityForStock(s as number, 10))).toEqual([0, 0, 0]); });
  test('alle Schreiber gehen über resolveVariantQuantity → gleiche Regel', () => {
    expect([resolveVariantQuantity(1, 3, 10), resolveVariantQuantity(2, 3, 10), resolveVariantQuantity(undefined, 3, 10)]).toEqual([0, 2, 0]);
  });
  test('Anzeige-Markierung', () => { expect([belowMinStock(1), belowMinStock(2), belowMinStock(undefined)]).toEqual([true, false, true]); });
});
