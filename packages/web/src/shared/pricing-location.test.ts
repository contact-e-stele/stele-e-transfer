// AUFSICHT 045 Teil A (09.11.2026, gestaffelte eBay-Fixgebühr 0,35/0,45 statt 0,30): Erwartungswerte in dieser Datei mit bun neu gerechnet.
// Zahlen in Testnamen/Kommentaren können noch den Stand mit 0,30 zeigen — maßgeblich sind die expect-Werte. Liste alt → neu: docs/fixgebuehr-testaenderungen.md
// Formel je Standort (ENTSCHEIDUNG INHABER 08.11.2026 16:31) — Gegenrechnungen des Kalkulators (Auftrag Punkt 4, Nachtrag 17:30).
// Gewinn = VK × (1 − (0,15 + Anzeige) × 1,19 × S) − 0,357 − Kosten; S = 1,19 bei Standort/Herkunft außerhalb der EU, sonst 1.
import { beforeEach, describe, expect, test } from 'bun:test';
import { setAliEinfuhrEur, ALI_EINFUHR_EUR } from './constants';
import { profitAtSellPrice, computeMinSellPrice, ebayLocationFactorFor, IOSS_PROVISION_FACTOR, DEFAULT_PRICING_CONFIG } from './pricing';
import { netFactor } from './ad-rate-switch';

beforeEach(() => setAliEinfuhrEur(ALI_EINFUHR_EUR)); // 5,95 — andere Tests lassen den Laufzeitwert auf 3,57 stehen

const base = { ebayFeeRatePercent: 15, vatFactor: 1.19 };
const gewinn = (sellPrice: number, buyPrice: number, adRatePercent: number, isChinaOrigin: boolean, ebayLocationFactor?: number) =>
  profitAtSellPrice({ ...base, sellPrice, buyPrice, adRatePercent, isChinaOrigin, ebayLocationFactor });

describe('Standort-Faktor S', () => {
  test('China/unbekannt → 1,19; EU → 1; Konstante 1,19', () => {
    expect(IOSS_PROVISION_FACTOR).toBe(1.19);
    expect(ebayLocationFactorFor(true)).toBe(1.19);
    expect(ebayLocationFactorFor(false)).toBe(1);
  });
  test('F bei CN 0,7876 (0 %) / 0,7168 (5 %), bei DE/EU unverändert 0,8215 / 0,762', () => {
    expect(netFactor(0, 1.19)).toBeCloseTo(0.787585, 6);
    expect(netFactor(5, 1.19)).toBeCloseTo(0.71678, 6);
    expect(netFactor(0)).toBeCloseTo(0.8215, 6);
    expect(netFactor(5)).toBeCloseTo(0.762, 6);
  });
});

describe('Kalkulator-Gegenrechnung (Auftrag 16:31, Punkt 4)', () => {
  test('255 Pink: Ware 7,49, 0 %, CN → VK 21,45 = +1,11 · VK 20,45 = +0,32', () => {
    expect(gewinn(21.45, 7.49, 0, true)).toBeCloseTo(0.9282, 4);
    expect(gewinn(20.45, 7.49, 0, true)).toBeCloseTo(0.1406, 4);
  });
  test('255 Blue: Ware 6,49, 0 %, CN → VK 20,45 = +1,32 · VK 19,45 = +0,53', () => {
    expect(gewinn(20.45, 6.49, 0, true)).toBeCloseTo(1.1406, 4);
    expect(gewinn(19.45, 6.49, 0, true)).toBeCloseTo(0.3530, 4);
  });
  test('120 …3447: 13,95, Ware 1,89, 0 % → CN +0,80 · Standort DE (gleiche China-Kosten, S = 1) +1,27', () => {
    expect(gewinn(13.95, 1.89, 0, true)).toBeCloseTo(0.6213, 4);
    expect(gewinn(13.95, 1.89, 0, true, 1)).toBeCloseTo(1.0944, 4);
  });
  test('234 …0015: 22,45, Ware 8,49, 5 % → CN −0,70 · Standort DE +0,32', () => {
    expect(gewinn(22.45, 8.49, 5, true)).toBeCloseTo(-0.8738, 4);
    expect(gewinn(22.45, 8.49, 5, true, 1)).toBeCloseTo(0.1414, 4);
  });
  test('513 (Nachtrag 17:30): Lager DE, Ware 13,81, 0 %, VK 18,95 → +1,40 · dieselbe Ware aus China → −5,19', () => {
    expect(gewinn(18.95, 13.81, 0, false)).toBeCloseTo(1.2219, 4);
    expect(gewinn(18.95, 13.81, 0, true)).toBeCloseTo(-5.3708, 4);
  });
});

describe('Mindestpreis rechnet mit S (Preisvorschlag/Anheben/Senken nutzen computeMinSellPrice)', () => {
  test('255 Pink Ziel 1,00: CN-Mindestpreis ≥ 21,45 (20,45 reicht nicht mehr)', () => {
    const r = computeMinSellPrice({ ...base, buyPrice: 7.49, isChinaOrigin: true, adRatePercent: 0, targetMarginEur: 1.0,
      safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur, rounding: 'floor95' });
    expect(r.minSellPrice).toBe(21.95);
    expect(gewinn(r.minSellPrice, 7.49, 0, true)).toBeGreaterThanOrEqual(1.0 - 0.1);
  });
});
