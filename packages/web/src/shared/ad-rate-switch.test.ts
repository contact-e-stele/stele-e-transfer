// OFFEN 024. Fixtures = Live-Stand 03.11.2026 (App variantPrices/variantSellPrices) von stele-120/123/127/227; Soll = Tabelle
// "FREIGABE INHABER 03.11.2026 08:23" (Fehlerarchiv), mit bun über planAdRateSwitch nachgerechnet: alle 23 Zeilen gleich (Preis + Gewinn).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { netFactor, planAdRateSwitch, roundUpTo95 } from './ad-rate-switch';
import { aliEinfuhrEur, setAliEinfuhrEur } from './constants';

let before = 0;
beforeAll(() => { before = aliEinfuhrEur(); setAliEinfuhrEur(5.95); });
afterAll(() => setAliEinfuhrEur(before));

const row = (label: string, buyPrice: number, sellPrice: number) => ({ skuId: label, label, buyPrice, sellPrice });
// [Label, EK, VK alt, VK neu laut Tabelle, Gewinn neu laut Tabelle]
const t120: Array<[string, number, number, number, number]> = [
  ['50PCS 40-42CM', 1.89, 14.95, 13.95, 1.27], ['50PCS 47CM', 3.05, 16.95, 15.95, 1.76], ['50PCS 52CM', 3.39, 17.45, 16.95, 2.24],
  ['50PCS 60CM', 5.09, 19.95, 18.95, 2.18], ['50PCS 70CM', 5.19, 19.95, 18.95, 2.08], ['50PCS 120CM', 11.19, 25.45, 23.95, 2.18],
  ['100PCS 40-42CM', 2.89, 16.45, 15.95, 1.92], ['100PCS 47CM', 5.09, 19.45, 18.95, 2.18], ['100PCS 52CM', 5.79, 20.95, 19.95, 2.30],
  ['100PCS 60CM', 9.99, 25.45, 23.95, 1.39], ['100PCS 70CM', 9.39, 24.95, 23.95, 1.99], ['100PCS 120CM', 25.39, 44.95, 41.95, 2.76],
];
const t123: Array<[string, number, number, number, number]> = [
  ['10PCS', 2.09, 15.95, 14.95, 1.89], ['20PCS', 2.69, 16.95, 15.95, 2.12], ['30PCS', 4.19, 18.95, 17.95, 2.26],
  ['50PCS', 6.09, 21.45, 19.95, 2.00], ['100PCS', 11.79, 25.95, 24.95, 2.40], ['200PCS', 20.39, 36.95, 34.95, 2.01],
];
const t127: Array<[string, number, number, number, number]> = [
  ['Multicolour 50pcs', 2.49, 15.95, 14.95, 1.49], ['Multicolour 100pcs', 3.35, 16.95, 15.95, 1.46],
  ['White 500pcs', 10.39, 23.95, 22.95, 2.16], ['Multicolour 500pcs', 10.69, 24.45, 22.95, 1.86],
];
const t227: Array<[string, number, number, number, number]> = [['Grey', 4.99, 18.95, 17.95, 1.46]];

describe('Anzeige-Rate 5 % → 0 % (OFFEN 024)', () => {
  test('Faktoren 0,762 / 0,8215', () => {
    expect(netFactor(5)).toBeCloseTo(0.762, 6);
    expect(netFactor(0)).toBeCloseTo(0.8215, 6);
  });
  test('Aufrunden auf ,95', () => {
    expect(roundUpTo95(14.795)).toBe(14.95);
    expect(roundUpTo95(15.95)).toBe(15.95);
    expect(roundUpTo95(15.96)).toBe(16.95);
    expect(roundUpTo95(41.69)).toBe(41.95);
  });
  for (const [name, table, target] of [['120', t120, 1], ['123', t123, 2], ['127', t127, 1], ['227', t227, 1]] as const) {
    test(`stele-${name}: genau die Freigabe-Tabelle`, () => {
      const plan = planAdRateSwitch({ fromRate: 5, toRate: 0, isChinaOrigin: true, targetMarginEur: target, rows: table.map(([l, ek, vk]) => row(l, ek, vk)) });
      for (const [i, [l, , , newVk, g]] of table.entries()) {
        expect([l, plan[i].newVk, Math.round(plan[i].profitNew * 100) / 100, plan[i].send]).toEqual([l, newVk, g, true]);
      }
    });
  }
  test('Sperre greift nie bei 5↔0: Aufrunden hält den Gewinn immer ≥ heute (Raster EK 0,5–30, VK 9,95–59,95)', () => {
    for (const [from, to] of [[5, 0], [0, 5]]) for (let ek = 0.5; ek <= 30; ek += 0.73) for (let vk = 9.95; vk <= 59.95; vk += 1.5) {
      const [r] = planAdRateSwitch({ fromRate: from, toRate: to, isChinaOrigin: true, targetMarginEur: 3, rows: [row('x', ek, vk)] });
      expect(r.profitNew).toBeGreaterThanOrEqual(r.profitOld - 1e-9);
      expect(r.send || r.reason === 'Preis bleibt gleich').toBe(true);
    }
  });
  test('fehlender EK → nicht gesetzt', () => {
    expect(planAdRateSwitch({ fromRate: 5, toRate: 0, isChinaOrigin: true, rows: [row('x', 0, 18.95)] })[0].send).toBe(false);
  });
  test('0 % → 5 %: Preis steigt (× 0,8215 / 0,762, aufgerundet)', () => {
    const [r] = planAdRateSwitch({ fromRate: 0, toRate: 5, isChinaOrigin: true, targetMarginEur: 1, rows: [row('Grey', 4.99, 17.95)] });
    expect(r.newVk).toBe(19.95);   // 17,95 × 1,07808 = 19,35 → 19,95
    expect(r.send).toBe(true);
  });
});

import { ebayRateBlock } from './ad-rate-switch';
describe('Abgleich eBay ↔ App vor dem Umstellen (Inhaber 03.11. Frage 3)', () => {
  test('gleich → frei', () => { expect(ebayRateBlock(5, 5)).toBeNull(); expect(ebayRateBlock(0, 0)).toBeNull(); });
  test('abweichend → gesperrt mit beiden Sätzen', () => { expect(ebayRateBlock(0, 5)).toBe('Abgleich nötig: bei eBay 5 %, in der App 0 % — nichts geändert'); });
  test('unbekannte Werbeart / nicht lesbar → gesperrt', () => { expect(ebayRateBlock(5, null)).toContain('andere Werbeart'); expect(ebayRateBlock(5, undefined)).toContain('nicht lesbar'); });
});
