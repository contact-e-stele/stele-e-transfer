// K-014 Schritt 2 (Kalkulator 28.10.2026): "Erwartet" und Preisalarm nur über bei eBay angebotene Varianten mit eigenem VK.
// Fixtures = Live-Daten 28.10.2026 (App /api/products, eBay-Artikelseiten, AliExpress-Seite), Einfuhr 5,95 (Betriebswert).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { productProfitRows, variantPriceAlarm, previewTierChange, type ProfitProduct } from './target-margin-bulk';
import { evaluateTargetDisplay } from './pricing';
import { setAliEinfuhrEur, ALI_EINFUHR_ALT_EUR } from './constants';

beforeAll(() => setAliEinfuhrEur(5.95));
afterAll(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));

// stele-119: eBay 100pcs 16,45 / 200pcs 22,95; AliExpress …127 500PCs, …129 1000PCs (beide nicht bei eBay). Anzeige 0 %, Stufe B.
// Kassen-Faktor 0,9666 (Bestellung 01-15348-46871); Datum relativ zu heute, damit der Faktor (≤ 14 Tage) im Test gilt.
const p119 = (): ProfitProduct => ({
  id: 119, variants: '[{"name":"Varianten ","values":["200pcs","100pcs"]}]', targetMarginEur: 1.5, shipsFrom: 'China', adRate: 0, sellPrice: 14.95, buyPrice: 3.29,
  variantPrices: JSON.stringify([
    { skuId: '12000050569622128', attrs: { Color: '200pcs', 'Ships From': 'China Mainland' }, price: 9.29 },
    { skuId: '12000050569622130', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' }, price: 3.29 },
    { skuId: '12000050569622129', attrs: { Color: '1000PCs', 'Ships From': 'China Mainland' }, price: 24.59 },
    { skuId: '12000050569622127', attrs: { Color: '500PCs', 'Ships From': 'China Mainland' }, price: 11.69 },
  ]),
  variantSellPrices: JSON.stringify({ '12000050569622128': 22.95, '12000050569622129': 38.95, '12000050569622130': 16.45 }),
  aliCheckoutFactor: 0.9666, aliCheckoutFactorAt: new Date().toISOString(),
});

// stele-189 (Ausschnitt L/Green): eBay-Seite L/Green = 18,95. Drei AliExpress-Einträge für dieselbe eBay-Variante:
// …5759 alter ebayPrice 16,95 (Anzeige-Zuordnung), …0981 ohne VK, …3543 variantSellPrices 18,95.
const p189: ProfitProduct = {
  id: 189, variants: '[{"name":"Size","values":["XS","M","S","L"]},{"name":"Color","values":["Green","Black","Blue"]}]', targetMarginEur: 2, shipsFrom: 'China', adRate: 5,
  sellPrice: 16.95, buyPrice: 3.39,
  variantPrices: JSON.stringify([
    { skuId: '12000060168465759', attrs: { Size: 'L', Color: 'Green' }, displayValues: { Size: 'L', Color: 'Green' }, price: 4.29, ebayPrice: 16.95 },
    { skuId: '12000060779140981', attrs: { Size: 'L', Color: 'Green' }, price: 4.29 },
    { skuId: '12000060802123543', attrs: { Size: 'L', Color: 'Green' }, price: 4.39 },
  ]),
  variantSellPrices: JSON.stringify({ '12000060802123543': 18.95 }),
};

// stele-107: zwei eBay-Varianten, je zwei AliExpress-Einträge gleichen Namens; nur …819/…818 haben einen VK (18,45).
const p107: ProfitProduct = {
  id: 107, variants: '[{"name":"Set´s","values":["white Triangle","white Ellipse"]}]', targetMarginEur: 2, shipsFrom: 'China', adRate: 5, sellPrice: 14.95, buyPrice: 2.19,
  variantPrices: JSON.stringify([
    { skuId: '12000048597697820', attrs: { Color: 'white Triangle', 'Ships From': 'China Mainland' }, price: 4.09 },
    { skuId: '12000048597697817', attrs: { Color: 'white Ellipse', 'Ships From': 'China Mainland' }, price: 2.35 },
    { skuId: '12000048597697819', attrs: { Color: 'white Triangle', 'Ships From': 'China Mainland' }, price: 2.19 },
    { skuId: '12000048597697818', attrs: { Color: 'white Ellipse', 'Ships From': 'China Mainland' }, price: 4.19 },
  ]),
  variantSellPrices: JSON.stringify({ '12000048597697819': 18.45, '12000048597697818': 18.45 }),
};

describe('K-014: Erwartet nur über gelistete Varianten mit eigenem VK', () => {
  test('stele-119: Erwartet = 200pcs 1,58 € (ohne Faktor 1,27), 1000PCs/500PCs grau "nicht bei eBay", kein Alarm', () => {
    const r = productProfitRows(p119());
    expect(r.rows.map(x => x.label)).toEqual(['200pcs / China Mainland', '100pcs / China Mainland']);
    const worst = Math.min(...r.rows.map(x => x.profit));
    expect(worst).toBeCloseTo(1.576425, 6);
    expect(Math.min(...r.rows.map(x => x.profitWithoutFactor ?? x.profit))).toBeCloseTo(1.266425, 6);
    expect(evaluateTargetDisplay(1.5, worst).expectedEur).toBe(1.58);
    expect(r.excluded.map(x => [x.skuId, x.reason])).toEqual([['12000050569622129', 'nicht bei eBay'], ['12000050569622127', 'nicht bei eBay']]);
    expect(variantPriceAlarm(p119()).isAlarm).toBe(false);
  });

  test('stele-189 L/Green: alter ebayPrice 16,95 einer Dublette zählt nicht, nur der aktuelle VK 18,95', () => {
    const r = productProfitRows(p189);
    expect(r.rows.map(x => [x.skuId, x.sellPrice])).toEqual([['12000060802123543', 18.95]]);
    expect(r.excluded.map(x => [x.skuId, x.reason])).toEqual([['12000060779140981', 'ohne eigenen VK'], ['12000060168465759', 'Dublette mit altem VK']]);
    expect(r.rows[0].profit).toBeCloseTo(18.95 - (4.39 + 1.99 + 5.95) - (18.95 * 0.2 * 1.19 + 0.3 * 1.19), 9);
    expect(variantPriceAlarm(p189).isAlarm).toBe(false);
  });

  test('stele-107: Erwartet 1,57 € (gelb), die Dubletten ohne VK zählen nicht', () => {
    const r = productProfitRows(p107);
    expect(r.rows.map(x => x.skuId)).toEqual(['12000048597697819', '12000048597697818']);
    const d = evaluateTargetDisplay(2, Math.min(...r.rows.map(x => x.profit)));
    expect(d.expectedEur).toBe(1.57);
    expect(d.level).toBe('yellow');
    expect(r.excluded.map(x => x.reason)).toEqual(['ohne eigenen VK', 'ohne eigenen VK']);
  });

  test('echter Alarm bleibt: gelistete Variante mit eigenem VK unter dem Boden → Alarm', () => {
    const low = { ...p119(), variantSellPrices: JSON.stringify({ '12000050569622128': 18.95, '12000050569622130': 16.45 }) };
    const a = variantPriceAlarm(low);
    expect(a.isAlarm).toBe(true);
    expect(a.worstProfit).toBeLessThan(1.1);
  });

  test('Einzelartikel unverändert (Rückfall auf sellPrice bleibt nur hier)', () => {
    const single: ProfitProduct = { id: 1, variants: '[]', targetMarginEur: 2, shipsFrom: 'China', adRate: 5, sellPrice: 13.45, buyPrice: 3.15, variantPrices: null };
    const r = productProfitRows(single);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].sellPrice).toBe(13.45);
    expect(r.excluded).toEqual([]);
  });

  test('Stufen-Vorschau zählt 119/107 nicht mehr als rot', () => {
    expect(previewTierChange([p119(), p107, p189], 2).redIds).toEqual([]);
  });
});
