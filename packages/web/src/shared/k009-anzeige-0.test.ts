// K-009 (Kalkulator 15.10.2026): Anzeige 0 % wählbar; stele-220 ist seit 14.10. 21:12 bei eBay unbeworben, die App stand auf 5 %.
// Alle Erwartungswerte mit bun nachgerechnet (Grundgesetz 3).
import { describe, expect, test } from 'bun:test';
import { adRateOptions, adRateLabel, AD_RATE_OPTIONS } from './ad-rate-options';
import { computeOrderNettoErgebnis } from '../api/order-matching';
import { planVariantRaises } from '../api/variant-raise';

describe('K-009 Auswahl Anzeigensatz', () => {
  test('"0 % (aus)" ist die erste Option', () => {
    expect(AD_RATE_OPTIONS[0]).toBe(0);
    expect(adRateLabel(0)).toBe('0 % (aus)');
  });
  test('null wird als "—" gezeigt, nicht als 5 %', () => {
    expect(adRateLabel(null)).toBe('—');
    expect(adRateOptions(null)).toEqual([0, 2, 3, 5, 8, 10]);
  });
  test('gespeicherter Sonderwert bleibt sichtbar (4 % → eigene Option)', () => {
    expect(adRateOptions(4)).toEqual([0, 2, 3, 4, 5, 8, 10]);
    expect(adRateOptions(5)).toEqual([0, 2, 3, 5, 8, 10]);
  });
});

describe('K-009 Wirkung adRate 0 (stele-220)', () => {
  const order = (adRate: number) => computeOrderNettoErgebnis({
    orderTotal: 20.95, lineItems: [{ sku: 'stele-220-BLACK', quantity: 1 }], manualBuyPrice: 15.14,
    findProduct: () => ({ id: 220, buyPrice: 12.19, shipsFrom: 'China', adRate, variants: [] }),
  });
  test('Bestellung 19-15281-36243 (BLACK 20,95, Einkauf 15,14): adRate 0 → Gebühr 4,10, Gewinn 1,71', () => {
    expect(order(0)).toMatchObject({ nettoGebuehren: 4.1, nettoErgebnis: 1.71 });
  });
  test('mit adRate 5 (bisheriger App-Stand) → Gebühr 5,34, Gewinn 0,47 (der gemeldete Fehlwert)', () => {
    expect(order(5)).toMatchObject({ nettoGebuehren: 5.34, nettoErgebnis: 0.47 });
  });
  const p220 = (adRate: number) => ({
    id: 220, variants: JSON.stringify([{ name: 'Color Name', values: ['GRAY', 'Blue', 'black'] }]), targetMarginEur: 1, shipsFrom: 'China', adRate,
    sellPrice: 19.95, buyPrice: 11.47,
    variantPrices: JSON.stringify([
      { skuId: 'g', attrs: { 'Color Name': 'GRAY' }, price: 11.47 },
      { skuId: 'b', attrs: { 'Color Name': 'Blue' }, price: 12.49 },
      { skuId: 'k', attrs: { 'Color Name': 'black' }, price: 11.59 },
    ]),
    variantSellPrices: JSON.stringify({ g: 19.95, b: 21.95, k: 20.95 }), ebayStatus: 'listed', ebayListingId: '198712713157',
  });
  test('Preisprüfung adRate 0: nur GRAY (0,9919 < 1,00) würde angehoben — BLACK/BLUE nicht (K-008 regelt GRAY)', () => {
    expect(planVariantRaises(p220(0)).map(r => [r.skuId, r.newSell])).toEqual([['g', 20.45]]);
  });
  test('Preisprüfung adRate 5 (Fehlstand): alle drei würden angehoben', () => {
    expect(planVariantRaises(p220(5)).map(r => [r.skuId, r.newSell])).toEqual([['g', 21.95], ['b', 22.95], ['k', 21.95]]);
  });
});
