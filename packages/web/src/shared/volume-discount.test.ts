import { describe, expect, test } from 'bun:test';
import {
  planVolumeDiscount, percentForEur, discountedUnitPrice, parseVolumeDiscountRule, validateVolumeDiscountRule,
  buildVolumeDiscountPromotion, DEFAULT_VOLUME_DISCOUNT_RULE,
} from './volume-discount';
import { productProfitRows } from './target-margin-bulk';

// Echte Werte (App-DB, 18.10.2026): stele-220 GRAY VK 20,95 / EK 12,19 / Anzeige 0 %; stele-223 VK 11,95 / EK 1,99 / Anzeige 5 %. Beide China.
const v220 = { label: 'GRAY', sellPrice: 20.95, buyPrice: 12.19, isChinaOrigin: true };
const v223 = { label: '', sellPrice: 11.95, buyPrice: 1.99, isChinaOrigin: true };
const rule = DEFAULT_VOLUME_DISCOUNT_RULE; // 3 € / 5 € (Inhaber 18.10.2026)

describe('Multi-Rabatt Regel', () => {
  test('Standard = Inhaber-Regel 2 Stück 3 €, 3 Stück 5 €', () => {
    expect(rule).toEqual({ eur2: 3, eur3: 5 });
    expect(parseVolumeDiscountRule(null)).toEqual(rule);
    expect(parseVolumeDiscountRule('kaputt')).toEqual(rule);
    expect(parseVolumeDiscountRule('{"eur2":2,"eur3":4}')).toEqual({ eur2: 2, eur3: 4 });
  });
  test('Validierung', () => {
    expect(validateVolumeDiscountRule({ eur2: 3, eur3: 3 }).ok).toBe(false);
    expect(validateVolumeDiscountRule({ eur2: 0, eur3: 5 }).ok).toBe(false);
    expect(validateVolumeDiscountRule({ eur2: 3.001, eur3: 5 }).ok).toBe(false);
    expect(validateVolumeDiscountRule({ eur2: 3, eur3: 5 }).ok).toBe(true);
  });
});

describe('Multi-Rabatt Plan (Formel v2)', () => {
  test('stele-220 GRAY: 8 % / 9 %, Gewinn 3,35 € / 6,48 €', () => {
    const p = planVolumeDiscount({ rule, variants: [v220], adRatePercent: 0, floorEur: 1 });
    expect(p.ok).toBe(true);
    expect(p.percents).toEqual({ 2: 8, 3: 9 });
    expect(p.tiers[0].rows[0]).toMatchObject({ unitPrice: 19.27, total: 38.54, saving: 3.36, profit: 3.35, belowFloor: false });
    expect(p.tiers[1].rows[0]).toMatchObject({ unitPrice: 19.06, total: 57.18, saving: 5.67, profit: 6.48 });
    expect(p.singleRows[0].profit).toBe(1.09);
  });
  test('stele-223: 13 % / 14 %, Gewinn 5,95 € / 11,61 €', () => {
    const p = planVolumeDiscount({ rule, variants: [v223], adRatePercent: 5, floorEur: 1 });
    expect(p.percents).toEqual({ 2: 13, 3: 14 });
    expect(p.tiers[0].rows[0]).toMatchObject({ total: 20.8, saving: 3.1, profit: 5.95 });
    expect(p.tiers[1].rows[0]).toMatchObject({ total: 30.84, saving: 5.01, profit: 11.61 });
  });
  test('Prozent am höchsten VK: billigere Variante bekommt weniger Euro-Rabatt', () => {
    const cheap = { ...v220, label: 'billig', sellPrice: 15.95, buyPrice: 8 }; // synthetisch
    const p = planVolumeDiscount({ rule, variants: [v220, cheap], adRatePercent: 0, floorEur: 1 });
    expect(p.basePrice).toBe(20.95);
    expect(p.percents![2]).toBe(percentForEur(3, 2, 20.95));
    expect(p.tiers[0].rows[1].saving).toBeLessThan(3);
  });
  test('eBay-Minimum: teurer Artikel wird auf 5 % / 6 % angehoben, mit Grund', () => {
    // Synthetischer Rechenfall (kein Produkt): VK 99,95, EK 30.
    const p = planVolumeDiscount({ rule, variants: [{ label: 'x', sellPrice: 99.95, buyPrice: 30, isChinaOrigin: true }], adRatePercent: 0, floorEur: 1 });
    expect(percentForEur(3, 2, 99.95)).toBe(2);
    expect(p.percents).toEqual({ 2: 5, 3: 6 });
    expect(p.tiers[0].reason).toBe('eBay-Minimum 5 %');
  });
  test('Gewinn unter Boden → Prozent gesenkt bzw. gesperrt', () => {
    // Synthetisch: VK 20,95, EK 13,00. Boden 1 → sendbar; Boden 6 → schon beim eBay-Minimum unter dem Boden → gesperrt.
    const tight = { label: 'eng', sellPrice: 20.95, buyPrice: 13, isChinaOrigin: true };
    const p = planVolumeDiscount({ rule, variants: [tight], adRatePercent: 0, floorEur: 1 });
    expect(p.ok).toBe(true);
    const hard = planVolumeDiscount({ rule, variants: [tight], adRatePercent: 0, floorEur: 6 });
    expect(hard.ok).toBe(false);
    expect(hard.error).toContain('2 Stück');
    expect(hard.percents).toBeNull();
  });
  test('Senkung wegen Boden wird angezeigt', () => {
    // Boden 4,10 (synthetisch): bei 8 % liegt der 2-Stück-Gewinn (3,35 €) darunter → Prozent wird gesenkt.
    const v = { label: 'g', sellPrice: 20.95, buyPrice: 12.19, isChinaOrigin: true };
    const p6 = planVolumeDiscount({ rule, variants: [v], adRatePercent: 0, floorEur: 4.10 });
    expect(p6.tiers[0].percent).toBeLessThan(8);
    expect(p6.tiers[0].reason).toBe('gesenkt: Gewinn sonst unter dem Boden');
    expect(p6.tiers[0].rows.every(r => !r.belowFloor)).toBe(true);
  });
  test('ohne Preise → nicht berechenbar', () => {
    expect(planVolumeDiscount({ rule, variants: [], adRatePercent: 0, floorEur: 1 }).ok).toBe(false);
  });
  test('Preis je Stück wie eBay (Cent gerundet)', () => {
    expect(discountedUnitPrice(20.95, 8)).toBe(19.27);
  });
  test('Zeilen aus productProfitRows tragen EK und Herkunft', () => {
    const rows = productProfitRows({ id: 1, variants: null, adRate: 0, sellPrice: 20.95, buyPrice: 12.19, variantPrices: null, shipsFrom: 'China' }).rows;
    expect(rows[0]).toMatchObject({ buyPrice: 12.19, isChinaOrigin: true, sellPrice: 20.95 });
  });
});

describe('Multi-Rabatt an eBay (Request-Körper)', () => {
  test('VOLUME_DISCOUNT, nur dieses Angebot, Stufen 1/2/3', () => {
    const b = buildVolumeDiscountPromotion({ listingId: '123', productLabel: 'stele-220', percents: { 2: 8, 3: 9 }, start: new Date('2026-10-18T10:00:00Z'), end: new Date('2027-10-18T10:00:00Z') });
    expect(b.promotionType).toBe('VOLUME_DISCOUNT');
    expect(b.marketplaceId).toBe('EBAY_DE');
    expect(b.applyDiscountToSingleItemOnly).toBe(true);
    expect(b.inventoryCriterion.listingIds).toEqual(['123']);
    expect(b.discountRules.map(r => [r.discountSpecification.minQuantity, r.discountBenefit.percentageOffOrder, r.ruleOrder]))
      .toEqual([[1, '0', 1], [2, '8', 2], [3, '9', 3]]);
    expect(b.discountRules.length).toBe(3); // höchstens 3 Stück (Inhaber 18.10.2026)
  });
});

describe('Multi-Rabatt je Produkt (api/multi-rabatt.ts planForProduct)', () => {
  test('stele-223 als Produktzeile: Anzeige 5 %, Stufe A → 13 % / 14 %', async () => {
    const { planForProduct } = await import('../api/multi-rabatt');
    const plan = planForProduct({ id: 223, variants: null, adRate: 5, sellPrice: 11.95, buyPrice: 1.99, variantPrices: null, shipsFrom: 'China', targetMarginEur: 1 }, rule);
    expect(plan.ok).toBe(true);
    expect(plan.percents).toEqual({ 2: 13, 3: 14 });
  });
  test('Senden-Route verlangt die Vorschau-Prozent und sendet nur per POST', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const { resolve } = require('path') as typeof import('path');
    const idx = readFileSync(resolve(import.meta.dir, '..', 'api', 'index.ts'), 'utf-8');
    expect(idx).toContain(".post('/products/:id/multi-rabatt/send'");
    expect(idx).not.toContain(".get('/products/:id/multi-rabatt/send'");
    const mr = readFileSync(resolve(import.meta.dir, '..', 'api', 'multi-rabatt.ts'), 'utf-8');
    expect(mr).toContain("Vorschau veraltet");
  });
});
