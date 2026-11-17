// 050 P2: Lieferant tauschen. Fixture = echte Daten stele-251 (App, 17.11.2026) und das echte Zielangebot 1005007433728405
// (über /api/aliexpress/scrape gelesen, 17.11.2026). Gewinnwerte mit bun nachgerechnet (Formel v2, Einfuhr 5,95, Anzeige 5 %, Kat. 166725).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR, setAliEinfuhrEur } from './constants';
import { planSupplierSwap, suggestMapping, parseEntries, parseAliItemId, sameOrigin } from './supplier-swap';

beforeEach(() => setAliEinfuhrEur(ALI_EINFUHR_EUR));
afterEach(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));

const P251: any = {
  variants: JSON.stringify([{ name: 'Color', values: ['sliver Snowflak', 'gold Snowflak'] }, { name: 'Tree Skirt Diameter', values: ['122cm', '90cm', '78cm'] }]),
  variantPrices: JSON.stringify([
    ['12000046641146389', 'sliver Snowflak', '122cm', 25.79, 4, 43.45], ['12000046641146388', 'sliver Snowflak', '90cm', 14.89, 5, 29.45],
    ['12000046641146385', 'gold Snowflak', '90cm', 14.59, 4, 28.95], ['12000046641146384', 'gold Snowflak', '78cm', 12.39, 9, 25.95],
    ['12000046641146387', 'sliver Snowflak', '78cm', 11.99, 5, 25.45], ['12000046641146386', 'gold Snowflak', '122cm', 26.59, 5, 44.95],
  ].map(([skuId, c, d, price, stock, ebayPrice]) => ({ skuId, attrs: { Color: c, 'Tree Skirt Diameter': d }, price, stock, displayValues: { Color: c, 'Tree Skirt Diameter': d }, ebayPrice }))),
  variantSellPrices: JSON.stringify({ '12000046641146389': 46.45, '12000046641146388': 31.45, '12000046641146387': 26.95, '12000046641146386': 47.45, '12000046641146385': 30.95, '12000046641146384': 27.95 }),
  shipsFrom: 'China', adRate: 5, ebayCategory: '166725', aliCheckoutFactor: null, aliCheckoutFactorAt: null, sellPrice: null, buyPrice: 11.99, targetMarginEur: 1,
};
const OFFER_251 = {
  itemId: '1005007433728405', shipsFrom: 'China',
  variantPrices: [
    { skuId: '12000040737898019', attrs: { Color: 'Gold 90cm' }, price: 12.19, stock: 12 }, { skuId: '12000040737898018', attrs: { Color: 'Gold 78cm' }, price: 10.79, stock: 15 },
    { skuId: '12000040737898023', attrs: { Color: 'Silver 122cm' }, price: 22.59, stock: 9 }, { skuId: '12000040737898022', attrs: { Color: 'Silver 90cm' }, price: 11.99, stock: 3 },
    { skuId: '12000040737898021', attrs: { Color: 'Silver 78cm' }, price: 10.79, stock: 8 }, { skuId: '12000040737898020', attrs: { Color: 'Gold 122cm' }, price: 22.39, stock: 5 },
  ],
};
const MAP_251: Record<string, string | null> = {
  '12000046641146389': '12000040737898023', '12000046641146388': '12000040737898022', '12000046641146387': '12000040737898021',
  '12000046641146386': '12000040737898020', '12000046641146385': '12000040737898019', '12000046641146384': '12000040737898018',
};

const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

describe('suggestMapping', () => {
  test('251: andere Merkmalsnamen ("Gold 90cm" ↔ "gold Snowflak"/"90cm") → kein Vorschlag, nichts geraten', () => {
    const s = suggestMapping(parseEntries(P251.variantPrices), OFFER_251.variantPrices);
    expect(Object.values(s).every(v => v === null)).toBe(true);
  });
  test('gleiche Werte (Groß/Klein, Reihenfolge, Versandland egal) → eindeutiger Vorschlag', () => {
    const s = suggestMapping(
      [{ skuId: 'a', price: 1, attrs: { Farbe: 'Blau', Größe: 'M' } }],
      [{ skuId: 'x', price: 1, attrs: { Size: 'm', Color: 'BLAU', 'Ships From': 'China' } }, { skuId: 'y', price: 1, attrs: { Color: 'Rot', Size: 'M' } }],
    );
    expect(s).toEqual({ a: 'x' });
  });
  test('zwei passende neue Varianten → kein Vorschlag', () => {
    const s = suggestMapping([{ skuId: 'a', price: 1, attrs: { C: 'Blau' } }], [{ skuId: 'x', price: 1, attrs: { C: 'blau' } }, { skuId: 'y', price: 2, attrs: { C: 'Blau' } }]);
    expect(s).toEqual({ a: null });
  });
});

describe('planSupplierSwap (251 → 1005007433728405)', () => {
  test('alle 6 zugeordnet: EK und Lager neu, VK bleibt, Gewinn vorher/nachher', () => {
    const plan = planSupplierSwap(P251, OFFER_251, MAP_251);
    expect(plan.ok).toBe(true);
    expect(plan.rows.map(r => [r.label, r.ekAlt, r.ekNeu, r.lagerNeu, r.vk, r2(r.gewinnAlt), r2(r.gewinnNeu)])).toEqual([
      ['sliver Snowflak / 122cm', 25.79, 22.59, 9, 46.45, 1.68, 4.88],
      ['sliver Snowflak / 90cm', 14.89, 11.99, 3, 31.45, 1.61, 4.51],
      ['gold Snowflak / 90cm', 14.59, 12.19, 12, 30.95, 1.55, 3.95],
      ['gold Snowflak / 78cm', 12.39, 10.79, 15, 27.95, 1.55, 3.15],
      ['sliver Snowflak / 78cm', 11.99, 10.79, 8, 26.95, 1.22, 2.42],
      ['gold Snowflak / 122cm', 26.59, 22.39, 5, 47.45, 1.61, 5.81],
    ]);
  });
  test('eBay-Zuordnung bleibt: displayValues und ebayPrice unverändert, skuId/attrs/EK neu', () => {
    const e = JSON.parse(planSupplierSwap(P251, OFFER_251, MAP_251).variantPrices)[0];
    expect(e).toEqual({ skuId: '12000040737898023', attrs: { Color: 'Silver 122cm' }, price: 22.59, stock: 9, displayValues: { Color: 'sliver Snowflak', 'Tree Skirt Diameter': '122cm' }, ebayPrice: 43.45 });
  });
  test('Verkaufspreise wandern auf die neue skuId', () => {
    expect(JSON.parse(planSupplierSwap(P251, OFFER_251, MAP_251).variantSellPrices as string)).toEqual({
      '12000040737898023': 46.45, '12000040737898022': 31.45, '12000040737898021': 26.95, '12000040737898020': 47.45, '12000040737898019': 30.95, '12000040737898018': 27.95,
    });
  });
  test('ohne Gegenstück → alter Eintrag bleibt mit Lager 0 und supplierMissing, VK bleibt auf alter skuId', () => {
    const plan = planSupplierSwap(P251, OFFER_251, { ...MAP_251, '12000046641146386': null });
    expect(plan.ok).toBe(true);
    const row = plan.rows.find(r => r.oldSkuId === '12000046641146386')!;
    expect([row.newSkuId, row.lagerNeu, row.gewinnNeu]).toEqual([null, 0, null]);
    const e = JSON.parse(plan.variantPrices).find((x: { skuId: string }) => x.skuId === '12000046641146386');
    expect([e.stock, e.supplierMissing, e.price]).toEqual([0, true, 26.59]);
    expect(JSON.parse(plan.variantSellPrices as string)['12000046641146386']).toBe(47.45);
  });
  test('neue Variante doppelt vergeben → Fehler, ok=false', () => {
    const plan = planSupplierSwap(P251, OFFER_251, { ...MAP_251, '12000046641146386': '12000040737898023' });
    expect(plan.ok).toBe(false);
    expect(plan.errors).toEqual(['gold Snowflak / 122cm: neue Variante 12000040737898023 ist schon „sliver Snowflak / 122cm“ zugeordnet']);
  });
  test('unbekannte neue Variante → Fehler', () => {
    expect(planSupplierSwap(P251, OFFER_251, { ...MAP_251, '12000046641146386': '999' }).ok).toBe(false);
  });
  test('nichts zugeordnet → Fehler', () => {
    expect(planSupplierSwap(P251, OFFER_251, {}).errors).toEqual(['Keine einzige Variante zugeordnet — nichts zu tauschen']);
  });
  test('rekey alt → neu', () => {
    expect(planSupplierSwap(P251, OFFER_251, MAP_251).rekey['12000046641146389']).toBe('12000040737898023');
  });
});

describe('Hilfen', () => {
  test('parseAliItemId', () => {
    expect(parseAliItemId('1005007433728405')).toBe('1005007433728405');
    expect(parseAliItemId('https://de.aliexpress.com/item/1005007433728405.html')).toBe('1005007433728405');
    expect(parseAliItemId('abc')).toBeNull();
  });
  test('sameOrigin: leer = China', () => {
    expect(sameOrigin('China', '')).toBe(true);
    expect(sameOrigin('China', 'Poland')).toBe(false);
  });
});
