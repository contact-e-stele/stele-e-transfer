// 051: Mindestlager 5 beim Mengen-Abgleich. Fixture stele-251 Silver 90cm (neuer Lieferant 1005007433728405: Lager 3, 17.11.2026).
import { describe, expect, test } from 'bun:test';
import { ebayQuantityForStock, belowMinStock, MIN_STOCK_FOR_EBAY } from './min-stock';
import { resolveVariantQuantity } from '../api/ebay';

describe('051 Mindestlager 5', () => {
  test('Konstante ist 5 (Gesetz Nr 94)', () => { expect(MIN_STOCK_FOR_EBAY).toBe(5); });
  test('stele-251 Silver 90cm: Lager 3 → eBay 0', () => { expect(ebayQuantityForStock(3, 10)).toBe(0); });
  test('Lager 4 → 0, Lager 5 → 5, Lager 8 → 8, Lager 317 → Obergrenze 10', () => {
    expect([4, 5, 8, 317].map(s => ebayQuantityForStock(s, 10))).toEqual([0, 5, 8, 10]);
  });
  test('Obergrenze 4 (Einstellung) bei Lager 9 → 4', () => { expect(ebayQuantityForStock(9, 4)).toBe(4); });
  test('unbekannt → 0', () => { expect([undefined, null, NaN].map(s => ebayQuantityForStock(s as number, 10))).toEqual([0, 0, 0]); });
  test('alle Schreiber gehen über resolveVariantQuantity → gleiche Regel', () => {
    expect([resolveVariantQuantity(3, 3, 10), resolveVariantQuantity(5, 3, 10), resolveVariantQuantity(undefined, 3, 10)]).toEqual([0, 5, 0]);
  });
  test('Anzeige-Markierung', () => { expect([belowMinStock(3), belowMinStock(5), belowMinStock(undefined)]).toEqual([true, false, true]); });
});
