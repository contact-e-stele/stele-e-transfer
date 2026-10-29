// OFFEN 013 Schritt 5: Varianten-VK von Hand (stele-220). Fixtures = Live-Stand 29.10.2026 (App /api/products, eBay-Seite 198752857838):
// GRAY …512 Ware 12,49 VK 23,45 · BLUE …513 Ware 13,59 VK 24,45 · BLACK …511 Ware 12,69 VK 23,45; Anzeige 0 %, Stufe 1,00, Kassen-Faktor 0,9263, China.
// Erwartete Zahlen frisch mit bun nachgerechnet (computeMinSellPrice / profitAtSellPrice, Einfuhr 5,95).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { planManualVariantPrices, hasPriceEnding, type ManualPriceInput } from './manual-variant-prices';
import { setAliEinfuhrEur, aliEinfuhrEur } from './constants';

// Betriebswert 5,95 nur für diese Datei; danach den vorherigen Wert (Preload 3,57) zurücksetzen.
let before = 0;
beforeAll(() => { before = aliEinfuhrEur(); setAliEinfuhrEur(5.95); });
afterAll(() => setAliEinfuhrEur(before));

const base = (requested: Record<string, number>): ManualPriceInput => ({
  productId: 220,
  entries: [
    { skuId: '12000057818173512', price: 12.49, label: 'GRAY', isChinaOrigin: true },
    { skuId: '12000057818173513', price: 13.59, label: 'BLUE', isChinaOrigin: true },
    { skuId: '12000057818173511', price: 12.69, label: 'BLACK', isChinaOrigin: true },
  ],
  currentSell: { '12000057818173512': 23.45, '12000057818173513': 24.45, '12000057818173511': 23.45 },
  requested, adRatePercent: 0, targetMarginEur: 1, checkoutFactor: 0.9263,
});

describe('planManualVariantPrices – stele-220 „ja 220“', () => {
  test('24,45 / 25,45 / 24,45: erlaubt, Gewinn mit und ohne Kassen-Faktor', () => {
    const p = planManualVariantPrices(base({ '12000057818173512': 24.45, '12000057818173513': 25.45, '12000057818173511': 24.45 }));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.rows.map(r => [r.label, r.oldSell, r.newSell, r.minSell, r.profitWithFactor, r.profitWithoutFactor])).toEqual([
      ['GRAY', 23.45, 24.45, 23.45, 2.21, 1.29],
      ['BLUE', 24.45, 25.45, 24.45, 2.01, 1.01],
      ['BLACK', 23.45, 24.45, 23.45, 2.03, 1.09],
    ]);
  });
  test('unter dem Formel-Mindestpreis → abgelehnt', () => {
    const p = planManualVariantPrices(base({ '12000057818173512': 22.95 }));
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.errors[0]).toContain('unter dem Mindestpreis 23.45');
  });
  test('mehr als +15 % → abgelehnt', () => {
    const p = planManualVariantPrices(base({ '12000057818173512': 27.45 }));
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.errors[0]).toContain('+15 %');
  });
  test('falsche Endung und fremde skuId → abgelehnt', () => {
    const p = planManualVariantPrices(base({ '12000057818173512': 24.50, '999': 24.45 }));
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.errors.join(' ')).toContain('endet nicht auf ,45 oder ,95');
    expect(p.errors.join(' ')).toContain('gehört nicht zu stele-220');
  });
  test('Endungen', () => {
    expect(hasPriceEnding(24.45)).toBe(true);
    expect(hasPriceEnding(25.95)).toBe(true);
    expect(hasPriceEnding(24.5)).toBe(false);
  });
});
