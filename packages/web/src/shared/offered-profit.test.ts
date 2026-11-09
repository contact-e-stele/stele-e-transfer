// PLAN 7 Punkt 6 (Kalkulator 08.11. 20:25 + 09.11. 06:50): "Gewinn unter 1,00 €" nur über bei eBay angebotene Varianten.
// STRUKTUR wie live (OFFEN 014, App /api/products 29.10.2026): 234 = 3 AliExpress-Einträge (Brown/GRAY/green), bei eBay nur Brown;
// 235 = 3 Einträge (Orange 5PCS/10PCS/3PCS), bei eBay nur Orange 5PCS. EK aus dem Live-Stand 29.10.
// TESTWERTE (keine Live-Preise): alle VK (variantSellPrices, sellPrice) und products.buyPrice sind Testwerte; die nicht angebotenen
// Einträge GRAY / Orange 10PCS tragen absichtlich einen gespeicherten VK, damit die Fixture den Filter unterscheidet (Grundgesetz 5).
// Erwartete Zahlen frisch mit bun gerechnet (Einfuhr 5,95, China, Anzeige 5 %, Stufe 1,00, Formel je Standort S 1,19).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { offeredProfitSummary, notOfferedLabel } from './offered-profit';
import { marginDisplay } from './margin-display';
import { variantPriceAlarm, type ProfitProduct } from './target-margin-bulk';
import { aliEinfuhrEur, setAliEinfuhrEur } from './constants';

let before = 0;
beforeAll(() => { before = aliEinfuhrEur(); setAliEinfuhrEur(5.95); });
afterAll(() => setAliEinfuhrEur(before));

const p234: ProfitProduct = {
  id: 234, variants: '[{"name":"Varianten","values":["Brown"]}]', targetMarginEur: 1, shipsFrom: 'China', adRate: 5,
  sellPrice: 23.95, buyPrice: 8.89, // Testwerte: Artikel-VK und Produkt-EK (= EK von GRAY, nicht angeboten)
  variantPrices: JSON.stringify([
    { skuId: '12000056068050014', attrs: { Color: 'Brown' }, price: 8.79 },
    { skuId: '12000056068050015', attrs: { Color: 'GRAY' }, price: 8.89 },
    { skuId: '12000056068050016', attrs: { Color: 'green' }, price: 8.89 },
  ]),
  variantSellPrices: JSON.stringify({ '12000056068050014': 25.45, '12000056068050015': 23.95 }), // Testwerte
};

const p235: ProfitProduct = {
  id: 235, variants: '[{"name":"Varianten","values":["Orange 5PCS"]}]', targetMarginEur: 1, shipsFrom: 'China', adRate: 5,
  sellPrice: 18.45, buyPrice: 5.09, // Testwerte: Artikel-VK und Produkt-EK (= EK von Orange 10PCS, nicht angeboten)
  variantPrices: JSON.stringify([
    { skuId: '12000037060310498', attrs: { Color: 'Orange 5PCS' }, price: 3.59 },
    { skuId: '12000037060310500', attrs: { Color: 'Orange 10PCS' }, price: 5.09 },
    { skuId: '12000037060310499', attrs: { Color: 'Orange 3PCS' }, price: 2.79 },
  ]),
  variantSellPrices: JSON.stringify({ '12000037060310498': 18.45, '12000037060310500': 12.95 }), // Testwerte
};

describe('Gewinn unter 1,00 € nur über bei eBay angebotene Varianten (PLAN 7 Punkt 6)', () => {
  test('stele-234: nur Brown zählt (1,16 €), GRAY/green "nicht bei eBay", 0 unter 1,00 €, kein Alarm', () => {
    const s = offeredProfitSummary(p234);
    expect(s.isVariant).toBe(true);
    expect(s.counted.map(r => r.label)).toEqual(['Brown']);
    expect(s.counted[0].profit).toBeCloseTo(1.155051, 6);
    expect(s.belowOne).toEqual([]);
    expect(s.notOffered.map(x => x.label)).toEqual(['GRAY', 'green']);
    expect(s.otherExcluded).toEqual([]);
    expect(notOfferedLabel(s)).toBe('2 nicht bei eBay');
    expect(s.card?.tone).toBe('ok');
    expect(s.card?.buyPriceEur).toBe(8.79);
    expect(variantPriceAlarm(p234).isAlarm).toBe(false);
  });

  test('stele-235: nur Orange 5PCS zählt (1,34 €), 10PCS/3PCS "nicht bei eBay", 0 unter 1,00 €, kein Alarm', () => {
    const s = offeredProfitSummary(p235);
    expect(s.counted.map(r => r.label)).toEqual(['Orange 5PCS']);
    expect(s.counted[0].profit).toBeCloseTo(1.337591, 6);
    expect(s.belowOne).toEqual([]);
    expect(s.notOffered.map(x => x.label)).toEqual(['Orange 10PCS', 'Orange 3PCS']);
    expect(notOfferedLabel(s)).toBe('2 nicht bei eBay');
    expect(s.card?.tone).toBe('ok');
    expect(variantPriceAlarm(p235).isAlarm).toBe(false);
  });

  test('Fixture unterscheidet: die alte Karte (Produkt-EK/-VK) zeigte Verlust', () => {
    const alt234 = marginDisplay({ sellPrice: p234.sellPrice, buyPrice: p234.buyPrice, shipsFrom: p234.shipsFrom, adRatePercent: p234.adRate })!;
    const alt235 = marginDisplay({ sellPrice: p235.sellPrice, buyPrice: p235.buyPrice, shipsFrom: p235.shipsFrom, adRatePercent: p235.adRate })!;
    expect(alt234.profitEur).toBeCloseTo(-0.020119, 6);
    expect(alt235.profitEur).toBeCloseTo(-0.162409, 6);
    expect(alt234.tone).toBe('loss');
    expect(alt235.tone).toBe('loss');
  });

  test('angebotene Variante wirklich unter 1,00 € zählt weiter (kein Wegfiltern echter Fälle)', () => {
    const s = offeredProfitSummary({ ...p234, variantSellPrices: JSON.stringify({ '12000056068050014': 23.95 }) }); // Testwert Brown 23,95
    expect(s.belowOne.map(r => r.label)).toEqual(['Brown']);
    expect(s.belowOne[0].profit).toBeCloseTo(0.079881, 6);
    expect(s.card?.tone).toBe('thin');
    expect(s.notOffered).toHaveLength(2);
  });

  test('Einzelartikel: unverändert eine Zeile, keine "nicht bei eBay"', () => {
    const s = offeredProfitSummary({ id: 1, variants: null, targetMarginEur: 1, shipsFrom: 'China', adRate: 5, sellPrice: 25.45, buyPrice: 8.79, variantPrices: null });
    expect(s.isVariant).toBe(false);
    expect(s.counted).toHaveLength(1);
    expect(s.notOffered).toEqual([]);
    expect(notOfferedLabel(s)).toBeNull();
  });
});
