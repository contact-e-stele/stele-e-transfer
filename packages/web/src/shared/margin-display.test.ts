// OFFEN 020. Fixtures live: stele-229 (VK 11,45, EK 1,79, China, Anzeige 5 %) — Listings-Tab zeigte 84,4 %, echt −1,36 € (bun, 30.10.2026).
// Erwartete Werte mit bun über profitAtSellPrice nachgerechnet (Einfuhr 5,95).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { formatMarginDisplay, marginDisplay } from './margin-display';
import { aliEinfuhrEur, setAliEinfuhrEur } from './constants';

let before = 0;
beforeAll(() => { before = aliEinfuhrEur(); setAliEinfuhrEur(5.95); });
afterAll(() => setAliEinfuhrEur(before));

// Formel je Standort (08.11.2026): China rechnet mit S 1,19 auf den Prozent-Anteil — Werte frisch mit bun neu gerechnet.
describe('Margen-Anzeige Formel v2 (OFFEN 020)', () => {
  test('stele-229: Verlust statt 84,4 %', () => {
    const m = marginDisplay({ sellPrice: 11.45, buyPrice: 1.79, shipsFrom: 'China', adRatePercent: 5 })!;
    expect(m.profitEur).toBeCloseTo(-1.8799, 4);
    expect(m.tone).toBe('loss');
    expect(formatMarginDisplay(m)).toBe('−1,88 € (−16,4 %)');
  });
  // EINGABE GEÄNDERT: VK 14,95 → 15,95 — bei 14,95 wären es nur 0,5689 € (Ton 'thin' statt 'ok').
  test('Ersatz 229 bei 15,95: 1,29 €', () => {
    const m = marginDisplay({ sellPrice: 15.95, buyPrice: 1.85, shipsFrom: 'China', adRatePercent: 5 })!;
    expect(m.profitEur).toBeCloseTo(1.2856, 4);
    expect(m.tone).toBe('ok');
  });
  test('Anzeige 0 % → mehr Gewinn als 5 %', () => {
    const a5 = marginDisplay({ sellPrice: 18.95, buyPrice: 3.79, shipsFrom: 'China', adRatePercent: 5 })!;
    const a0 = marginDisplay({ sellPrice: 18.95, buyPrice: 3.79, shipsFrom: 'China', adRatePercent: 0 })!;
    expect(a5.profitEur).toBeCloseTo(1.496, 4);
    expect(a0.profitEur).toBeGreaterThan(a5.profitEur);
  });
  test('ohne EK oder VK → keine Anzeige', () => {
    expect(marginDisplay({ sellPrice: 10, buyPrice: null })).toBeNull();
    expect(marginDisplay({ sellPrice: null, buyPrice: 2 })).toBeNull();
  });
});
