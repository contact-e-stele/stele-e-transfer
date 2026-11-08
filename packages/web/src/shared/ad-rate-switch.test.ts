// OFFEN 024. Fixtures = Live-Stand 03.11.2026 (App variantPrices/variantSellPrices) von stele-120/123/127/227; Soll = Tabelle
// "FREIGABE INHABER 03.11.2026 08:23" (Fehlerarchiv), mit bun über planAdRateSwitch nachgerechnet: alle 23 Zeilen gleich (Preis + Gewinn).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { netFactor, planAdRateSwitch, roundUpTo95 } from './ad-rate-switch';
import { aliEinfuhrEur, setAliEinfuhrEur } from './constants';

let before = 0;
beforeAll(() => { before = aliEinfuhrEur(); setAliEinfuhrEur(5.95); });
afterAll(() => setAliEinfuhrEur(before));

const row = (label: string, buyPrice: number, sellPrice: number) => ({ skuId: label, label, buyPrice, sellPrice });
// [Label, EK, VK alt, VK neu, Gewinn neu]
// HISTORISCHE ZAHL GEÄNDERT (Formel je Standort, 08.11.2026): die Freigabe-Tabelle vom 03.11. war mit Standort DE (S = 1) gerechnet.
// planAdRateSwitch nimmt S aus der Herkunft (China 1,19, Verhältnis 0,71678 / 0,787585) und hat keinen Parameter dafür → VK neu und
// Gewinn neu frisch mit bun neu gerechnet (VK alt/EK = Live-Stand unverändert). Vorher-Werte je Zeile siehe docs/formel-je-standort-testaenderungen.md.
// Alle Zeilen bleiben send = true (Gewinn neu ≥ Gewinn heute, auch wo er unter dem Boden liegt).
const t120: Array<[string, number, number, number, number]> = [
  ['50PCS 40-42CM', 1.89, 14.95, 13.95, 0.80], ['50PCS 47CM', 3.05, 16.95, 15.95, 1.21], ['50PCS 52CM', 3.39, 17.45, 15.95, 0.87],
  ['50PCS 60CM', 5.09, 19.95, 18.95, 1.54], ['50PCS 70CM', 5.19, 19.95, 18.95, 1.44], ['50PCS 120CM', 11.19, 25.45, 23.95, 1.37],
  ['100PCS 40-42CM', 2.89, 16.45, 15.95, 1.37], ['100PCS 47CM', 5.09, 19.45, 17.95, 0.75], ['100PCS 52CM', 5.79, 20.95, 19.95, 1.63],
  ['100PCS 60CM', 9.99, 25.45, 23.95, 0.58], ['100PCS 70CM', 9.39, 24.95, 22.95, 0.39], ['100PCS 120CM', 25.39, 44.95, 40.95, 0.55],
];
const t123: Array<[string, number, number, number, number]> = [
  ['10PCS', 2.09, 15.95, 14.95, 1.39], ['20PCS', 2.69, 16.95, 15.95, 1.57], ['30PCS', 4.19, 18.95, 17.95, 1.65],
  ['50PCS', 6.09, 21.45, 19.95, 1.33], ['100PCS', 11.79, 25.95, 23.95, 0.77], ['200PCS', 20.39, 36.95, 33.95, 0.04],
];
const t127: Array<[string, number, number, number, number]> = [
  ['Multicolour 50pcs', 2.49, 15.95, 14.95, 0.99], ['Multicolour 100pcs', 3.35, 16.95, 15.95, 0.91],
  ['White 500pcs', 10.39, 23.95, 21.95, 0.59], ['Multicolour 500pcs', 10.69, 24.45, 22.95, 1.08],
];
const t227: Array<[string, number, number, number, number]> = [['Grey', 4.99, 18.95, 17.95, 0.85]];

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
    expect(r.newVk).toBe(19.95);   // China, S 1,19: 17,95 × 0,787585 / 0,71678 = 19,72 → 19,95 (vorher S 1: × 1,07808 = 19,35)
    expect(r.send).toBe(true);
  });
});

import { ebayRateCheck } from './ad-rate-switch';
describe('Abgleich eBay ↔ App (Inhaber 03.11.2026 13:19: App ist maßgeblich)', () => {
  test('gleich → frei, kein Abgleich', () => { expect(ebayRateCheck(5, 5)).toEqual({ block: null, differs: false, note: null }); });
  test('abweichend → NICHT gesperrt, eBay wird angeglichen', () => {
    expect(ebayRateCheck(0, 5)).toEqual({ block: null, differs: true, note: 'Abgleich: bei eBay 5 %, in der App 0 % — eBay wird mit angeglichen' });
  });
  test('unbekannte Werbeart / nicht lesbar → gesperrt', () => {
    expect(ebayRateCheck(5, null).block).toContain('andere Werbeart');
    expect(ebayRateCheck(5, undefined).block).toContain('nicht lesbar');
  });
});
