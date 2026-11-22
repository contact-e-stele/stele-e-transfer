// K1 (Gesetzbuch v67 Nr 173, Inhaber-Ja 22.11.2026 11:11): echter Ali-Versand des Lieferanten in der Preisformel.
// Live-Fund stele-285 (M3): Ali-Versand 4,43 statt Pauschale 1,99 → bei VK 13,95 Verlust, die App zeigte +1,12 €.
// Alle Zahlen mit bun nachgerechnet (Nr 158: Gewinn = VK × (1 − Satz × 1,19 × 1,19) − 0,45 × 1,19 − Ware − Versand − 5,95).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR, ALI_VERSAND_EUR, setAliEinfuhrEur } from './constants';
import { aliShippingOverride, computeAliCosts, computeMinSellPrice, profitAtSellPrice, ebayFeeRatePercentFor } from './pricing';
import { productProfitRows, variantPriceAlarm } from './target-margin-bulk';
import { repriceFeesFor } from './tier-reprice';
import { volumeOrderProfit } from './volume-discount';

beforeEach(() => setAliEinfuhrEur(ALI_EINFUHR_EUR));
afterEach(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));

const china = { isChinaOrigin: true, vatFactor: 1.19, adRatePercent: 0, ebayFeeRatePercent: 15 };
const r2 = (n: number) => Math.round(n * 100) / 100;

describe('K1: aliShippingOverride – nur Werte über der Pauschale zählen', () => {
  test('4,43 → 4,43 · 4,25 → 4,25', () => { expect(aliShippingOverride(4.43)).toBe(4.43); expect(aliShippingOverride(4.25)).toBe(4.25); });
  test('Pauschale, 0, 2 (unter 1,99 + 0,005), leer, NaN → null', () => {
    expect(ALI_VERSAND_EUR).toBe(1.99);
    for (const v of [1.99, 0, 1.994, null, undefined, Number.NaN]) expect(aliShippingOverride(v)).toBeNull();
    expect(aliShippingOverride(2)).toBe(2);
  });
});

describe('K1: computeAliCosts', () => {
  test('China, Ware 1,39, Versand 4,43 → K = 1,39 + 4,43 + 5,95 = 11,77', () => {
    const c = computeAliCosts(1.39, true, 4.43);
    expect(c.shipping).toBe(4.43);
    expect(r2(c.totalCost)).toBe(11.77);
  });
  test('ohne Wert → Pauschale 1,99 wie bisher', () => expect(computeAliCosts(1.39, true).shipping).toBe(1.99));
  test('Wert unter der Pauschale wird nie genommen (0,50 → 1,99)', () => expect(computeAliCosts(1.39, true, 0.5).shipping).toBe(1.99));
  test('Ware ≥ 10 (Pauschale 0): Lieferanten-Versand NICHT angesetzt (nur für die günstigste SKU belegt, stele-123)', () => expect(computeAliCosts(11.99, true, 2.0).shipping).toBe(0));
  test('EU-Lager → Versand 0, auch mit Wert', () => expect(computeAliCosts(1.39, false, 4.43).shipping).toBe(0));
});

describe('K1: Gewinn stele-285 (Kat. 156844 → 15 %, China, Versand 4,43)', () => {
  test('Satz 15 %', () => expect(ebayFeeRatePercentFor('156844')).toBe(15));
  test('Style (Ware 1,39) bei 13,95 → −1,32 € (ohne K1 wären es +1,12)', () => {
    expect(r2(profitAtSellPrice({ ...china, sellPrice: 13.95, buyPrice: 1.39, aliShippingEur: 4.43 }))).toBe(-1.32);
    expect(r2(profitAtSellPrice({ ...china, sellPrice: 13.95, buyPrice: 1.39 }))).toBe(1.12);
  });
  test('Style bei 16,45 → 0,65 € · A/B (Ware 1,75) bei 16,45 → 0,29 € · bei 16,95 → 0,68 €', () => {
    expect(r2(profitAtSellPrice({ ...china, sellPrice: 16.45, buyPrice: 1.39, aliShippingEur: 4.43 }))).toBe(0.65);
    expect(r2(profitAtSellPrice({ ...china, sellPrice: 16.45, buyPrice: 1.75, aliShippingEur: 4.43 }))).toBe(0.29);
    expect(r2(profitAtSellPrice({ ...china, sellPrice: 16.95, buyPrice: 1.75, aliShippingEur: 4.43 }))).toBe(0.68);
  });
  test('Mindest-VK (Ziel 1,00, floor95) steigt mit dem echten Versand', () => {
    const base = { ...china, buyPrice: 1.39, targetMarginEur: 1, safetyBufferEur: 0, rounding: 'floor95' as const };
    const mit = computeMinSellPrice({ ...base, aliShippingEur: 4.43 }).minSellPrice;
    const ohne = computeMinSellPrice(base).minSellPrice;
    expect(mit).toBeGreaterThan(ohne);
    expect(r2(profitAtSellPrice({ ...china, sellPrice: mit, buyPrice: 1.39, aliShippingEur: 4.43 }))).toBeGreaterThanOrEqual(0.9);
  });
});

// Produkt-Sicht: dieselben Wege, die Preisalarm, Senken/Anheben und Multi-Rabatt nutzen.
const p285 = {
  id: 285, variants: JSON.stringify([{ name: 'Color', values: ['Style 2', 'A'] }]), targetMarginEur: 1, shipsFrom: 'China', adRate: 0,
  sellPrice: null, buyPrice: 1.39, ebayCategory: '156844', shippingCost: 4.43,
  variantPrices: JSON.stringify([
    { skuId: 's2', attrs: { Color: 'Style 2' }, price: 1.39 },
    { skuId: 'a', attrs: { Color: 'A' }, price: 1.75 },
  ]),
  variantSellPrices: JSON.stringify({ s2: 13.95, a: 14.45 }),
};

describe('K1: Produkt-Wege lesen product.shippingCost', () => {
  test('productProfitRows: schlechteste Variante −1,32 €', () => {
    const { rows } = productProfitRows(p285);
    expect(r2(Math.min(...rows.map(r => r.profit)))).toBe(-1.32);
  });
  test('variantPriceAlarm: Alarm (ohne shippingCost kein Alarm)', () => {
    expect(variantPriceAlarm(p285).isAlarm).toBe(true);
    expect(variantPriceAlarm({ ...p285, shippingCost: 1.99 }).isAlarm).toBe(false);
  });
  test('repriceFeesFor gibt aliShippingEur 4,43 weiter', () => {
    expect(repriceFeesFor({ ...p285 }).call(null, { Color: 'A' }).aliShippingEur).toBe(4.43);
    expect(repriceFeesFor({ ...p285, shippingCost: 0 }).call(null, { Color: 'A' }).aliShippingEur).toBeNull();
  });
  test('Multi-Rabatt: Versand je Bestellung einmal (2 × Style bei 13,95, 0 %)', () => {
    const v = { label: 'Style 2', sellPrice: 13.95, buyPrice: 1.39, isChinaOrigin: true };
    const mit = volumeOrderProfit(v, 2, 0, { adRatePercent: 0, ebayFeeRatePercent: 15, aliShippingEur: 4.43 }).profit;
    const ohne = volumeOrderProfit(v, 2, 0, { adRatePercent: 0, ebayFeeRatePercent: 15 }).profit;
    expect(r2(ohne - mit)).toBe(2.44); // 4,43 − 1,99, einmal je Bestellung
  });
});
