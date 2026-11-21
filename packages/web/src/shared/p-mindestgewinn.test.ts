// P-MINDESTGEWINN (AUFTRAG Aufsicht an 7 App 19.11.2026 15:05, Inhaber-Ja 14:58, Gesetzbuch v58 Nr 158):
// Gewinn OHNE AliExpress-Rabatt und OHNE Kassen-Faktor muss ≥ 0,50 € sein — für Preis-Boden (Anheben/Preisprüfung), Preisalarm
// und Varianten-Anhebung. Betriebswert Einfuhr 5,95 ausdrücklich gesetzt (der Test-Preload setzt sonst 3,57). Alle Zahlen bun.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR, MIN_PROFIT_OHNE_RABATT_EUR, MINDESTGEWINN_OHNE_RABATT_ANHEBEN_DEFAULT, setAliEinfuhrEur, setMindestgewinnOhneRabattAnheben } from './constants';
import { computeMinSellPrice, evaluatePriceAlarm, profitAtSellPrice, ebayFeeRatePercentFor } from './pricing';
import { variantPriceAlarm } from './target-margin-bulk';
import { planVariantRaises } from '../api/variant-raise';

beforeEach(() => { setAliEinfuhrEur(ALI_EINFUHR_EUR); setMindestgewinnOhneRabattAnheben(true); });
afterEach(() => { setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR); setMindestgewinnOhneRabattAnheben(MINDESTGEWINN_OHNE_RABATT_ANHEBEN_DEFAULT); });

const china = { isChinaOrigin: true, vatFactor: 1.19, adRatePercent: 0 };
const heute = () => new Date().toISOString();

describe('P-MINDESTGEWINN: Formel-Belege aus dem Auftrag', () => {
  test('Grenze ist 0,50 €', () => expect(MIN_PROFIT_OHNE_RABATT_EUR).toBe(0.5));
  test('224 GRAU: VK 23,95, Ware 12,49, 14 % → ohne Rabatt 0,23 € (bun 0,2263167)', () => {
    expect(ebayFeeRatePercentFor('58730')).toBe(14);
    const g = profitAtSellPrice({ ...china, ebayFeeRatePercent: 14, sellPrice: 23.95, buyPrice: 12.49 });
    expect(g).toBeCloseTo(0.2263167, 6);
    expect(Math.round(g * 100) / 100).toBe(0.23);
  });
  test('M88: VK 18,85, Ware 6,50, 12 %, Versand 1,98 → 0,67 € (bun 0,6712818; Auftrag 0,68 ± 0,01)', () => {
    const g = profitAtSellPrice({ ...china, ebayFeeRatePercent: 12, sellPrice: 18.85, buyPrice: 6.50 });
    expect(g).toBeCloseTo(0.6712818, 6);
    expect(Math.abs(g - 0.68)).toBeLessThanOrEqual(0.01 + 1e-9);
  });
});

describe('P-MINDESTGEWINN: Preis-Boden (computeMinSellPrice, floor95)', () => {
  const base = { ...china, ebayFeeRatePercent: 14, buyPrice: 12.49, targetMarginEur: 1.0, safetyBufferEur: 0, rounding: 'floor95' as const };
  test('224 GRAU mit Kassen-Faktor 0,937: 24,45 statt 23,95 (23,95 ohne Rabatt nur 0,23 €)', () => {
    const p = computeMinSellPrice({ ...base, checkoutFactor: 0.937 }).minSellPrice;
    expect(p).toBe(24.45);
    expect(profitAtSellPrice({ ...china, ebayFeeRatePercent: 14, sellPrice: p, buyPrice: 12.49 })).toBeCloseTo(0.6271897, 6); // Kalkulator 0,63
  });
  test('ohne Kassen-Faktor unverändert (Boden 1,00 bindet ohnehin): 24,95', () => {
    expect(computeMinSellPrice({ ...base, checkoutFactor: null }).minSellPrice).toBe(24.95);
    expect(computeMinSellPrice(base).minSellPrice).toBe(24.95);
  });
});

describe('P-MINDESTGEWINN: Preisalarm', () => {
  test('Einzelartikel 224 GRAU 23,95 mit Faktor 0,937: mit Faktor 1,02 (über Boden), ohne 0,23 → Alarm', () => {
    const r = evaluatePriceAlarm({ currentSellPrice: 23.95, variants: [{ buyPrice: 12.49 }], ...china, ebayFeeRatePercent: 14, targetMarginEur: 1.0, checkoutFactor: 0.937 });
    expect(r.worstProfit).toBeCloseTo(1.0163167, 6);
    expect(r.worstProfitWithoutFactor).toBeCloseTo(0.2263167, 6);
    expect(r.isAlarm).toBe(true);
  });
  test('224 BLAU 24,95 / 12,69 mit Faktor: ohne Rabatt bun 0,8280627 ≥ 0,50 → kein Alarm', () => {
    const r = evaluatePriceAlarm({ currentSellPrice: 24.95, variants: [{ buyPrice: 12.69 }], ...china, ebayFeeRatePercent: 14, targetMarginEur: 1.0, checkoutFactor: 0.937 });
    expect(r.worstProfitWithoutFactor).toBeCloseTo(0.8280627, 6);
    expect(r.isAlarm).toBe(false);
  });
});

// Nachbildung stele-224 (Werte aus ERGEBNIS Kalkulator 19.11. 14:42): 3 Varianten, Kat. 58730 (14 %), 0 % Anzeige, Faktor 0,937 (15.11.).
const p224 = (factor: number | null) => ({
  id: 224, sellPrice: 23.95, buyPrice: 12.49, adRate: 0, shipsFrom: 'China', targetMarginEur: 1, ebayCategory: '58730',
  aliCheckoutFactor: factor, aliCheckoutFactorAt: factor == null ? null : heute(), ebayStatus: 'listed', ebayListingId: 'TEST224',
  variants: JSON.stringify([{ name: 'Farbe', values: ['GRAU', 'SCHWARZ', 'BLAU'] }]),
  variantPrices: JSON.stringify([
    { skuId: 's-grau', attrs: { Farbe: 'GRAU' }, price: 12.49 },
    { skuId: 's-schwarz', attrs: { Farbe: 'SCHWARZ' }, price: 12.69 },
    { skuId: 's-blau', attrs: { Farbe: 'BLAU' }, price: 12.69 },
  ]),
  variantSellPrices: JSON.stringify({ 's-grau': 23.95, 's-schwarz': 24.45, 's-blau': 24.95 }),
});

describe('P-MINDESTGEWINN: Varianten (Preisalarm + Anhebung)', () => {
  test('variantPriceAlarm: mit Faktor schlechteste 1,02 (kein Boden-Alarm), ohne Faktor 0,23 → Alarm', () => {
    const r = variantPriceAlarm(p224(0.937) as never);
    expect(r.worstProfit).toBeCloseTo(1.0163167, 6);
    expect(r.worstProfitWithoutFactor).toBeCloseTo(0.2263167, 6);
    expect(r.isAlarm).toBe(true);
  });
  test('Anhebung: GRAU 23,95 → 24,45, SCHWARZ 24,45 → 24,95, BLAU bleibt (wie Kalkulator-Vorschlag)', () => {
    const r = planVariantRaises(p224(0.937) as never).map(x => [x.label, x.oldSell, x.newSell]);
    expect(r).toEqual([['GRAU', 23.95, 24.45], ['SCHWARZ', 24.45, 24.95]]);
    for (const x of planVariantRaises(p224(0.937) as never)) {
      expect(profitAtSellPrice({ ...china, ebayFeeRatePercent: 14, sellPrice: x.newSell, buyPrice: x.ware })).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('P-MINDESTGEWINN: Schalter AUS (Betrieb nach Merge) — keine neue Anhebung, nur Alarm', () => {
  test('Default ist AUS', () => expect(MINDESTGEWINN_OHNE_RABATT_ANHEBEN_DEFAULT).toBe(false));
  test('AUS: Preis-Boden wie bisher 23,95, Varianten-Anhebung leer, Alarm trotzdem an', () => {
    setMindestgewinnOhneRabattAnheben(false);
    const base = { ...china, ebayFeeRatePercent: 14, buyPrice: 12.49, targetMarginEur: 1.0, safetyBufferEur: 0, rounding: 'floor95' as const };
    expect(computeMinSellPrice({ ...base, checkoutFactor: 0.937 }).minSellPrice).toBe(23.95);
    expect(planVariantRaises(p224(0.937) as never)).toEqual([]);
    expect(variantPriceAlarm(p224(0.937) as never).isAlarm).toBe(true);
  });
});

describe('P-MINDESTGEWINN: raiseAlarm (automatisches Anheben) folgt dem Schalter, isAlarm (Anzeige) immer', () => {
  const a = () => evaluatePriceAlarm({ currentSellPrice: 23.95, variants: [{ buyPrice: 12.49 }], ...china, ebayFeeRatePercent: 14, targetMarginEur: 1.0, checkoutFactor: 0.937 });
  test('AN: isAlarm und raiseAlarm', () => { expect(a().isAlarm).toBe(true); expect(a().raiseAlarm).toBe(true); });
  test('AUS: isAlarm ja, raiseAlarm nein (Einzelartikel) — Varianten ebenso', () => {
    setMindestgewinnOhneRabattAnheben(false);
    expect(a().isAlarm).toBe(true);
    expect(a().raiseAlarm).toBe(false);
    const v = variantPriceAlarm(p224(0.937) as never);
    expect(v.isAlarm).toBe(true);
    expect(v.raiseAlarm).toBe(false);
  });
  test('Boden-Alarm hebt weiter an, auch mit Schalter AUS (unverändert)', () => {
    setMindestgewinnOhneRabattAnheben(false);
    const r = evaluatePriceAlarm({ currentSellPrice: 21.95, variants: [{ buyPrice: 12.49 }], ...china, ebayFeeRatePercent: 14, targetMarginEur: 1.0, checkoutFactor: 0.937 });
    expect(r.worstProfit).toBeLessThan(1.0);
    expect(r.raiseAlarm).toBe(true);
  });
});
