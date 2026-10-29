// OFFEN 014: Artikel-VK auf angebotene Varianten übernehmen. Fixtures = Live-Stand 29.10.2026 (App /api/products) stele-234/235,
// Anzeige 5 %, Stufe 1,00, China, kein Kassen-Faktor. Mindestpreise mit bun nachgerechnet (Einfuhr 5,95): Brown 23,95 · Orange 5PCS 16,95.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { planArticleVkToVariants } from './article-vk-variants';
import { setAliEinfuhrEur, aliEinfuhrEur } from './constants';

let before = 0;
beforeAll(() => { before = aliEinfuhrEur(); setAliEinfuhrEur(5.95); });
afterAll(() => setAliEinfuhrEur(before));

const p234 = (sellPrice: number) => ({
  sellPrice, groups: [{ name: 'Varianten', values: ['Brown'] }], shipsFrom: 'China', adRatePercent: 5, targetMarginEur: 1, checkoutFactor: null,
  variantSellPricesJson: null,
  entries: [
    { skuId: '12000056068050014', attrs: { Color: 'Brown' }, price: 8.79 },
    { skuId: '12000056068050015', attrs: { Color: 'GRAY' }, price: 8.89 },
    { skuId: '12000056068050016', attrs: { Color: 'green' }, price: 8.89 },
  ],
});
const p235 = (sellPrice: number) => ({
  sellPrice, groups: [{ name: 'Varianten', values: ['Orange 5PCS'] }], shipsFrom: 'China', adRatePercent: 5, targetMarginEur: 1, checkoutFactor: null,
  variantSellPricesJson: null,
  entries: [
    { skuId: '12000037060310498', attrs: { Color: 'Orange 5PCS' }, price: 3.59 },
    { skuId: '12000037060310500', attrs: { Color: 'Orange 10PCS' }, price: 5.09 },
    { skuId: '12000037060310499', attrs: { Color: 'Orange 3PCS' }, price: 2.79 },
  ],
});

describe('Artikel-VK → angebotene Varianten (OFFEN 014)', () => {
  test('234: 23,95 → nur Brown gesetzt (GRAY/green nicht angeboten)', () => {
    const r = planArticleVkToVariants(p234(23.95));
    expect(r.variantSellPrices).toEqual({ '12000056068050014': 23.95 });
    expect(r.set).toEqual([{ skuId: '12000056068050014', label: 'Brown', from: null, to: 23.95 }]);
    expect(r.belowMin).toEqual([]);
  });
  test('235: 16,95 → nur Orange 5PCS gesetzt, 10PCS bleibt unberührt', () => {
    const r = planArticleVkToVariants(p235(16.95));
    expect(r.variantSellPrices).toEqual({ '12000037060310498': 16.95 });
  });
  test('unter Mindestpreis → nicht gesetzt, gemeldet', () => {
    const r = planArticleVkToVariants(p234(22.95));
    expect(r.set).toEqual([]);
    expect(r.belowMin).toEqual([{ skuId: '12000056068050014', label: 'Brown', minSell: 23.95 }]);
  });
  test('vorhandene Einträge bleiben, angebotene werden überschrieben', () => {
    const r = planArticleVkToVariants({ ...p235(17.45), variantSellPricesJson: JSON.stringify({ '12000037060310498': 14.95, '12000037060310500': 18.95 }) });
    expect(r.variantSellPrices).toEqual({ '12000037060310498': 17.45, '12000037060310500': 18.95 });
    expect(r.set[0].from).toBe(14.95);
  });
});
