import { describe, expect, test } from 'bun:test';
import { resolveAbPrice } from './ab-price';

// Fixture stele-251 (Kalkulator 08.11. 19:20, Ware je Variante): 25,79 / 14,89 / 11,99 / 26,59 / 14,59 / 12,39
const V251 = [25.79, 14.89, 11.99, 26.59, 14.59, 12.39].map(price => ({ price }));

describe('resolveAbPrice (Fix 251)', () => {
  test('Ab-Preis vorhanden → wird genommen', () => {
    expect(resolveAbPrice(9.99, true, V251)).toEqual({ ok: true, price: 9.99, source: 'data.price' });
  });
  test('251: kein Ab-Preis, Varianten-Produkt → kleinster Varianten-Preis 11,99', () => {
    expect(resolveAbPrice(0, true, V251)).toEqual({ ok: true, price: 11.99, source: 'min(variantPrices)' });
    expect(resolveAbPrice(null, true, V251)).toEqual({ ok: true, price: 11.99, source: 'min(variantPrices)' });
  });
  test('Varianten ohne gültigen Preis werden ignoriert', () => {
    expect(resolveAbPrice(0, true, [{ price: 0 }, { price: null }, { price: 4.5 }])).toEqual({ ok: true, price: 4.5, source: 'min(variantPrices)' });
  });
  test('Einzelartikel ohne Ab-Preis → Ende mit Grund (kein Raten)', () => {
    const r = resolveAbPrice(0, false, V251);
    expect(r.ok).toBe(false);
  });
  test('Varianten-Produkt ganz ohne Preise → Ende mit Grund', () => {
    expect(resolveAbPrice(0, true, []).ok).toBe(false);
    expect(resolveAbPrice(undefined, true, undefined).ok).toBe(false);
  });
});
