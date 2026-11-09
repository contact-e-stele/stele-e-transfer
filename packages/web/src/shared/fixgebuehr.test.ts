// AUFSICHT an 7 App 045 Teil A (09.11.2026 12:50) — GELD-LOGIK: eBay-Fixgebühr gestaffelt nach Bestellwert.
// 0,35 € netto bei Bestellwert ≤ 10 €, sonst 0,45 € netto, beides × 1,19. Bestellwert = VK × S (S = 1,19 bei China-Standort, sonst 1).
// Alle Erwartungswerte unabhängig mit bun nachgerechnet (Grundgesetz 3). Einfuhr = Test-Preload 3,57 (nur in den Mindestpreis-Fällen relevant).
import { describe, expect, test } from 'bun:test';
import {
  ebayFixedFeeNet, ebayFixedFeeGross, ebayOrderTotal, ebayFixedFeeGrossForSellPrice, computeOrderProfit, computeMinSellPrice,
  profitAtSellPrice, orderFeeChinaLocation, ebayLocationFactorFor, EBAY_FIXED_FEE_SCHEDULE_ALT, IOSS_PROVISION_FACTOR,
} from './pricing';
import { buildFixgebuehrVorschau } from './fixgebuehr-vorschau';

describe('Staffel und Grenze (Bestellwert auf Cent)', () => {
  test('Bestellwert 10,00 → 0,35 · 10,01 → 0,45 · brutto 0,4165 / 0,5355', () => {
    expect(ebayFixedFeeNet(10.00)).toBe(0.35);
    expect(ebayFixedFeeNet(10.01)).toBe(0.45);
    expect(ebayFixedFeeNet(9.99)).toBe(0.35);
    expect(ebayFixedFeeGross(10.00)).toBeCloseTo(0.4165, 12);
    expect(ebayFixedFeeGross(10.01)).toBeCloseTo(0.5355, 12);
  });
  test('Bestellwert = VK × S auf Cent: 24,45 × 1,19 = 29,0955 → 29,10 · China VK 8,40 → 9,996 → 10,00 (0,35) · 8,41 → 10,0079 → 10,01 (0,45)', () => {
    expect(IOSS_PROVISION_FACTOR).toBe(1.19);
    expect(ebayOrderTotal(24.45, 1.19)).toBe(29.10);
    expect(ebayOrderTotal(8.40, 1.19)).toBe(10.00);
    expect(ebayOrderTotal(8.41, 1.19)).toBe(10.01);
    expect(ebayFixedFeeGrossForSellPrice(8.40, true)).toBeCloseTo(0.4165, 12);
    expect(ebayFixedFeeGrossForSellPrice(8.41, true)).toBeCloseTo(0.5355, 12);
    expect(ebayFixedFeeGrossForSellPrice(10.00, false)).toBeCloseTo(0.4165, 12);
    expect(ebayFixedFeeGrossForSellPrice(10.01, false)).toBeCloseTo(0.5355, 12);
  });
});

// Referenz der Aufsicht mit Provision 14 % (eBay-Gebührenseite): (Bestellwert × 0,14 + Fix) × 1,19. Die App rechnet weiter 15 %
// (Provision je Kategorie = Teil B). Hier: 14-%-Wert als Dokumentation über ebayFixedFeeNet, App-Wert mit 15 % über computeOrderProfit.
const referenz14 = (total: number) => (total * 0.14 + ebayFixedFeeNet(total)) * 1.19;

describe('Regression echte Bestellungen', () => {
  test('25-15377-28447 (stele-220 BLACK, 09.11., China, VK 24,45, Bestellwert 29,10, Anzeige 0 %): Fix 0,45; Referenz 14 % = 5,38; App 15 % = 5,73', () => {
    expect(orderFeeChinaLocation(true, '2026-11-09')).toBe(true);
    const total = ebayOrderTotal(24.45, ebayLocationFactorFor(true));
    expect(total).toBe(29.10);
    expect(ebayFixedFeeNet(total)).toBe(0.45);
    expect(referenz14(total)).toBeCloseTo(5.38356, 9);
    expect(Math.round(referenz14(total) * 100) / 100).toBe(5.38);
    // App (15 %): 24,45 × 0,15 × 1,19 × 1,19 + 0,45 × 1,19 = 5,19355 + 0,5355 = 5,72905
    expect(computeOrderProfit(24.45, 0, 0, true).feesDeducted).toBe(5.73);
  });
  test('01-15409-64180 (stele-225, 05.11., S = 1, VK 24,95, Anzeige 0 %): Fix 0,45; Referenz 14 % = 4,69 (= echte Gebühr); App 15 % = 4,99 (vorher 4,81)', () => {
    expect(orderFeeChinaLocation(true, '2026-11-05')).toBe(false);
    const total = ebayOrderTotal(24.95, 1);
    expect(total).toBe(24.95);
    expect(referenz14(total)).toBeCloseTo(4.69217, 9);
    expect(Math.round(referenz14(total) * 100) / 100).toBe(4.69);
    // App (15 %): (24,95 × 0,15 + 0,45) × 1,19 = 4,989075 — mit dem alten Fix 0,30: 4,810575
    expect(computeOrderProfit(24.95, 0, 0, false).feesDeducted).toBe(4.99);
  });
  test('Bestellwert ≤ 10 € (EU, VK 9,95, Anzeige 0 %): Fix 0,35 → Gebühr (9,95 × 0,15 + 0,35) × 1,19 = 2,19255 → 2,19', () => {
    expect(computeOrderProfit(9.95, 0, 0, false).feesDeducted).toBe(2.19);
  });
});

describe('computeMinSellPrice löst nach VK auf, obwohl der Fix vom VK abhängt', () => {
  // EU (S = 1), Anzeige 0 %: f = 1 − 0,15 × 1,19 = 0,8215. Rohpreis = (K + Ziel + Fix × 1,19) / 0,8215.
  const raw = (buyPrice: number, isChinaOrigin = false, target = 1) => computeMinSellPrice({
    buyPrice, isChinaOrigin, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 0, targetMarginEur: target, safetyBufferEur: 0, rounding: 'none',
  });
  test('kleine Stufe: K 6,00 → (7 + 0,4165) / 0,8215 = 9,0280 (≤ 10) → Fix 0,35, Gewinn dort genau 1,00', () => {
    const r = raw(6);
    expect(r.rawMinSellPrice).toBeCloseTo(7.4165 / 0.8215, 12);
    expect(r.fixedFeeGross).toBeCloseTo(0.4165, 12);
    expect(profitAtSellPrice({ sellPrice: r.rawMinSellPrice, buyPrice: 6, isChinaOrigin: false, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 0 })).toBeCloseTo(1, 9);
  });
  test('Grenze: K 6,80 → kleine Stufe ergibt 10,0018 → Bestellwert auf Cent 10,00 (≤ 10) → bleibt klein (Rand einheitlich über ebayOrderTotal)', () => {
    expect(raw(6.8).rawMinSellPrice).toBeCloseTo(8.2165 / 0.8215, 12);
  });
  test('große Stufe: K 6,81 → kleine Stufe ergäbe 10,0140 (> 10) → mit 0,45: (7,81 + 0,5355) / 0,8215 = 10,1589; jeder VK ≤ 10 liegt unter dem Ziel', () => {
    const r = raw(6.81);
    expect(r.rawMinSellPrice).toBeCloseTo(8.3455 / 0.8215, 12);
    expect(r.fixedFeeGross).toBeCloseTo(0.5355, 12);
    const p = (vk: number) => profitAtSellPrice({ sellPrice: vk, buyPrice: 6.81, isChinaOrigin: false, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 0 });
    expect(p(r.rawMinSellPrice)).toBeCloseTo(1, 9);
    expect(p(10.00)).toBeLessThan(1);
    expect(p(10.00)).toBeCloseTo(10 * 0.8215 - 0.4165 - 6.81, 9); // 0,9885
  });
  test('Rundung floor95 mit gestaffeltem Gewinn: K 6,00 Ziel 1,00 → Roh 9,0280 → 8,95 (0,9359 < 1,00) → 9,45 (1,3467)', () => {
    const r = computeMinSellPrice({ buyPrice: 6, isChinaOrigin: false, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 0, targetMarginEur: 1, safetyBufferEur: 0, rounding: 'floor95' });
    expect(r.minSellPrice).toBe(9.45);
    expect(r.fixedFeeGross).toBeCloseTo(0.4165, 12);
  });
  test('alte Rechnung (EBAY_FIXED_FEE_SCHEDULE_ALT 0,30) nur über den Bericht-Parameter erreichbar: K 6,00 → (7 + 0,357) / 0,8215', () => {
    const r = computeMinSellPrice({ buyPrice: 6, isChinaOrigin: false, ebayFeeRatePercent: 15, vatFactor: 1.19, adRatePercent: 0, targetMarginEur: 1, safetyBufferEur: 0, rounding: 'none', fixedFeeSchedule: EBAY_FIXED_FEE_SCHEDULE_ALT });
    expect(r.rawMinSellPrice).toBeCloseTo(7.357 / 0.8215, 12);
  });
});

describe('Vorschau Mindest-VK je gelisteter Variante (GET /api/reports/fixgebuehr-vorschau, rein)', () => {
  // TESTWERTE (keine Produktionsdaten): ein Einzelartikel EU (Ware 6,81, VK 11,95, Anzeige 0 %, Stufe A 1,00),
  // ein nicht gelistetes Produkt (wird ignoriert).
  const single = { id: 1, title: 'Test EU', ebayStatus: 'listed', variants: '[]', targetMarginEur: 1, shipsFrom: 'Germany', adRate: 0, sellPrice: 11.95, buyPrice: 6.81, variantPrices: null };
  const draft = { ...single, id: 2, ebayStatus: 'draft' };
  test('alt 9,95 (Fix 0,30) → neu 10,45 (Fix 0,45), Δ +0,50; heute 11,95 nicht darunter', () => {
    const v = buildFixgebuehrVorschau([single, draft]);
    expect(v.summary).toEqual({ products: 1, rows: 1, minSellRaised: 1, minSellUnchanged: 0, currentBelowNewMin: 0 });
    // alt: Roh (7,81 + 0,357) / 0,8215 = 9,9416 → 9,45 (0,5962 < 1,00) → 9,95 (1,0069 ≥ 1,00)
    // neu: Roh 10,1589 → 9,95 (Fix 0,35: 9,95 × 0,8215 − 0,4165 − 6,81 = 0,9474 < 1,00) → 10,45 (Fix 0,45: 1,2392)
    expect(v.rows.map(r => [r.productId, r.minSellOld, r.minSellNew, r.deltaMinSell, r.fixNetCurrentEur, r.currentBelowNewMin]))
      .toEqual([[1, 9.95, 10.45, 0.5, 0.45, false]]);
  });
});
