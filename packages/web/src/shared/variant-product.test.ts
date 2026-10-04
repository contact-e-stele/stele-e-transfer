// A-019 Teil 1: eine Definition für "Varianten-Produkt" (Preisprüfung, Vorschau, Senden, Anzeige). Live-Fund stele-95: Varianten-GRUPPEN, aber nur
// EIN variantPrices-Eintrag (eBay-Gruppe stele-95-GROUP mit einer Variante) — die Preisprüfung behandelt das als Varianten-Produkt.
import { describe, expect, test } from 'bun:test';
import { isVariantProduct } from './variant-product';
import { planTierReprice } from './tier-reprice';
import { productProfitRows } from './target-margin-bulk';

const GROUPS95 = '[{"name":"Set","values":["6pcs set"]},{"name":"Stk.","values":["10ml x 6pcs"]}]';
const VP95 = JSON.stringify([{ skuId: '12000056840616727', attrs: { Color: '6pcs set', 'Net Contents': '10ml x 6pcs', 'Ships From': 'Germany' }, price: 8.99, stock: 17 }]);

describe('isVariantProduct', () => {
  test('stele-95: Gruppen + genau 1 variantPrices-Eintrag → Varianten-Produkt (so entscheidet die Preisprüfung)', () => {
    expect(isVariantProduct(GROUPS95, VP95)).toBe(true);
  });
  test('mehr als ein variantPrices-Eintrag ohne Gruppen → Varianten-Produkt', () => {
    expect(isVariantProduct('[]', JSON.stringify([{ skuId: 'a' }, { skuId: 'b' }]))).toBe(true);
  });
  test('Einzelartikel: keine Gruppen, höchstens 1 Eintrag → kein Varianten-Produkt', () => {
    expect(isVariantProduct('[]', null)).toBe(false);
    expect(isVariantProduct(null, JSON.stringify([{ skuId: 'a' }]))).toBe(false);
    expect(isVariantProduct('', '')).toBe(false);
  });
  test('geparstes Array (Produkte-API) wird wie JSON-Text behandelt; kaputtes JSON → kein Varianten-Produkt (kein Absturz)', () => {
    expect(isVariantProduct([{ name: 'Size', values: ['S'] }], null)).toBe(true);
    expect(isVariantProduct('{kaputt', '{kaputt')).toBe(false);
    expect(isVariantProduct('{}', '{}')).toBe(false);
  });
});

describe('Anzeige/Vorschau/Senden und Preisprüfung entscheiden gleich (stele-95)', () => {
  const p95 = { id: 95, variants: GROUPS95, buyPrice: 8.99, sellPrice: 15.95, shipsFrom: null, adRate: 5, variantPrices: VP95, variantSellPrices: null, targetMarginEur: 2 };
  test('planTierReprice und productProfitRows klassifizieren 95 als Varianten-Produkt (vorher: Einzelartikel → Senden über stele-95, das es bei eBay nicht gibt)', () => {
    expect(planTierReprice(p95, 2).isVariant).toBe(true);
    expect(productProfitRows(p95).isVariant).toBe(true);
    expect(planTierReprice(p95, 2).rows[0].skuId).toBe('12000056840616727');
  });
});
