// K-006 (Kalkulator, 14.10.2026): Preisendungen ,45/,95 + Toleranz 0,10 € unter dem Boden, nie unter 1,00 € (Beschluss Inhaber 14.10.).
// Erwartungswerte mit bun nachgerechnet (Grundgesetz 3). f ohne Anzeige = 1 − 0,15×1,19 = 0,8215; mit 5 % = 0,762; Fix 0,357.
import { describe, expect, test } from 'bun:test';
import { computeMinSellPrice, profitAtSellPrice, effectiveProfitFloor, profitFloorFor, PRICE_ENDINGS, PROFIT_FLOOR_TOLERANCE_EUR, DEFAULT_PRICING_CONFIG as C } from './pricing';
import { MARGIN_TIERS } from './constants';

const fees = { ebayFeeRatePercent: C.ebayFeeRatePercent, ebayFixedFeeEur: C.ebayFixedFeeEur, vatFactor: C.vatFactor };
// Formel je Standort (08.11.2026): s = Standort-Faktor S explizit. Die Pflicht-Tests (Kalkulator 14.10.2026, Standort damals DE) rechnen
// mit s = 1 und behalten ihre Zahlen; weggelassen = S aus der Herkunft (China 1,19).
const sell = (ware: number, target: number, ad: number, china = true, s?: number) => computeMinSellPrice({
  ...fees, buyPrice: ware, isChinaOrigin: china, adRatePercent: ad, targetMarginEur: target, safetyBufferEur: 0, rounding: 'floor95', ebayLocationFactor: s,
}).minSellPrice;
const profit = (vk: number, ware: number, ad: number, china = true, s?: number) => profitAtSellPrice({ ...fees, sellPrice: vk, buyPrice: ware, isChinaOrigin: china, adRatePercent: ad, ebayLocationFactor: s });

describe('K-006 Konstanten', () => {
  test('Endungen ,45 und ,95; Toleranz 0,10; nie unter 1,00', () => {
    expect([...PRICE_ENDINGS]).toEqual([0.45, 0.95]);
    expect(PROFIT_FLOOR_TOLERANCE_EUR).toBe(0.10);
    expect(effectiveProfitFloor(1.0)).toBe(1.0);            // Stufe A: 0,90 wäre erlaubt, Beschluss 14.10. hebt auf 1,00
    expect(effectiveProfitFloor(1.2)).toBeCloseTo(1.1, 10);
    expect(effectiveProfitFloor(1.3)).toBeCloseTo(1.2, 10);
    expect(effectiveProfitFloor(1.5)).toBeCloseTo(1.4, 10);
  });
});

describe('K-006 Pflicht-Tests', () => {
  test('China, ohne Anzeige, Ware 11,59, Stufe A → 20,45 / Gewinn 1,28 (19,95 = 0,87 zu wenig)', () => {
    expect(sell(11.59, 1.0, 0, true, 1)).toBe(20.45);
    expect(profit(20.45, 11.59, 0, true, 1)).toBeCloseTo(1.28, 2);   // 20,45×0,8215 − 0,357 − 15,16 = 1,283
    expect(profit(19.95, 11.59, 0, true, 1)).toBeCloseTo(0.87, 2);
  });
  test('ABWEICHUNG (Grundgesetz 6): Ware 12,29, Stufe A → Auftrag 20,95 / 0,99; mit Beschluss "mindestens 1,00 €" → 21,45 / 1,40', () => {
    expect(profit(20.95, 12.29, 0, true, 1)).toBeCloseTo(0.99, 2);   // 1 Cent unter 1,00 → nicht erlaubt
    expect(sell(12.29, 1.0, 0, true, 1)).toBe(21.45);
    expect(profit(21.45, 12.29, 0, true, 1)).toBeCloseTo(1.40, 2);   // 21,45×0,8215 − 0,357 − 15,86 = 1,404
  });
  test('mit 5 % Anzeige: Ware 3,15, Stufe B → 13,45 / Gewinn 1,18 (≥ 1,10)', () => {
    expect(sell(3.15, 1.5, 5, true, 1)).toBe(13.45);
    expect(profit(13.45, 3.15, 5, true, 1)).toBeCloseTo(1.18, 2);    // 13,45×0,762 − 0,357 − 8,71 = 1,1819
  });
});

describe('K-006 Spanne Ware 1–15 € (0,05er), China und EU, Anzeige 0 und 5 %', () => {
  for (const tier of MARGIN_TIERS) {
    test(`Stufe ${tier.label}: Endung ,45/,95; Erwartet ≥ max(Boden − 0,10; 1,00) und ≤ Ziel + 0,45`, () => {
      for (const ad of [0, 5]) for (const china of [true, false]) for (let c = 100; c <= 1500; c += 5) {
        const ware = c / 100;
        const vk = sell(ware, tier.targetEur, ad, china);
        const cents = Math.round(vk * 100) % 100;
        expect(cents === 45 || cents === 95).toBe(true);
        const g = profit(vk, ware, ad, china);
        expect(g).toBeGreaterThanOrEqual(effectiveProfitFloor(profitFloorFor(tier.targetEur)) - 1e-9);
        expect(g).toBeLessThanOrEqual(tier.targetEur + 0.45 + 1e-9);
      }
    });
  }
});

// Gegenprüfung K-006: die Toleranz-Grenze muss überall gleich wirken (Alarm, Regel 6c, Varianten-Anhebung), Start immer abgerundet.
import { evaluatePriceAlarm, evaluateVariantRule6c, roundToProfitFloor } from './pricing';
import { planVariantRaises } from '../api/variant-raise';

// Formel je Standort (08.11.2026): EINGABE GEÄNDERT Ware 3,15 → 3,29 und VK 13,45/12,95 → 14,45/13,95, damit ein VK im Band 1,10–1,20 liegt
// (China 5 %, f = 0,71678: 14,45 × 0,71678 − 0,357 − 8,85 = 1,1505; 13,95 → 0,7921). Mit Ware 3,15 trifft keine Endung das Band.
describe('K-006 Toleranzband (Stufe B: Boden 1,20, erlaubt ab 1,10) – Ware 3,29 China 5 %: VK 14,45 = Gewinn 1,1505', () => {
  const base = { ...fees, isChinaOrigin: true, adRatePercent: 5, targetMarginEur: 1.5 };
  test('Preisalarm: 14,45 (1,1505) kein Alarm; 13,95 (0,7921) Alarm', () => {
    expect(evaluatePriceAlarm({ ...base, currentSellPrice: 14.45, variants: [{ buyPrice: 3.29 }] }).isAlarm).toBe(false);
    expect(evaluatePriceAlarm({ ...base, currentSellPrice: 13.95, variants: [{ buyPrice: 3.29 }] }).isAlarm).toBe(true);
  });
  test('Regel 6c: 14,45 bleibt (keep)', () => {
    expect(evaluateVariantRule6c({ ...base, variants: [{ skuId: 'x', buyPrice: 3.29, currentSellPrice: 14.45 }] })[0].action).toBe('keep');
  });
  test('Varianten-Anhebung: Variante mit eigenem VK 14,45 (1,1505) wird NICHT angehoben', () => {
    const p = {
      id: 1, variants: JSON.stringify([{ name: 'M', values: ['a', 'b'] }]), buyPrice: 3.29, sellPrice: 14.45, shipsFrom: 'China', adRate: 5, targetMarginEur: 1.5,
      variantSellPrices: JSON.stringify({ a: 14.45, b: 13.95 }), ebayStatus: 'listed', ebayListingId: '1',
      variantPrices: JSON.stringify([{ skuId: 'a', attrs: { M: 'a' }, price: 3.29 }, { skuId: 'b', attrs: { M: 'b' }, price: 3.29 }]),
    };
    // b: 13,95 → 0,7921 < 1,10 → angehoben auf 14,45. Hinweis: unterscheidet nicht von der alten Grenze, weil der Formelpreis
    // im Band nie über dem alten VK liegt (Anhebung braucht newSell > oldSell) — Konsistenz-Test, kein Regressionsbeweis.
    expect(planVariantRaises(p).map(r => r.skuId)).toEqual(['b']);
  });
  test('Start abgerundet: Rohpreis 14,449 → 13,95 (nicht 14,45); 14,45 bleibt; nie unter 0,45', () => {
    expect(roundToProfitFloor(14.449, () => 99, 1)).toBe(13.95);
    expect(roundToProfitFloor(14.45, () => 99, 1)).toBe(14.45);
    expect(roundToProfitFloor(0.2, () => 99, 1)).toBe(0.45);
  });
});
