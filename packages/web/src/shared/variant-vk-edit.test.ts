// 050 P1: VK je Variante von Hand. Fixture = echte Daten stele-225 (App, 17.11.2026); alle Gewinnwerte mit bun nachgerechnet
// (productProfitRows, Formel v2, Kassen-Faktor 0,9573, China-Standort, Anzeige 0 %, Kategorie 58730).
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR, setAliEinfuhrEur } from './constants';
import { parseVkInput, planManualVk, splitByDirection, MANUAL_VK_WARN_PROFIT_EUR } from './variant-vk-edit';
import type { ProfitProduct } from './target-margin-bulk';

const P225 = {
  variants: JSON.stringify([{ name: 'Varianten', values: ['BLAU', 'SCHWARZ', 'GRAU'] }]),
  variantPrices: JSON.stringify([
    { skuId: '12000057817791908', attrs: { 'Color Name': 'Blue' }, price: 13.99, stock: 108, displayValues: { Varianten: 'BLAU' }, ebayPrice: 23.95 },
    { skuId: '12000057817791906', attrs: { 'Color Name': 'black' }, price: 12.39, stock: 210, displayValues: { Varianten: 'SCHWARZ' }, ebayPrice: 21.45 },
    { skuId: '12000057817791907', attrs: { 'Color Name': 'GRAY' }, price: 12.39, stock: 118, displayValues: { Varianten: 'GRAU' }, ebayPrice: 21.45 },
  ]),
  variantSellPrices: JSON.stringify({ '12000057817791908': 26.45, '12000057817791906': 24.45, '12000057817791907': 24.45 }),
  shipsFrom: 'China', adRate: 0, ebayCategory: '58730', aliCheckoutFactor: 0.9573, aliCheckoutFactorAt: '2026-11-05T18:40:58.000Z',
  sellPrice: 24.45, buyPrice: 12.69, targetMarginEur: 1,
} as unknown as ProfitProduct;

// Betriebswert Einfuhr 5,95 € (wie p-einfuhr.test.ts); der Preload setzt sonst den alten Beleg-Wert 3,57.
// Datum fest auf den Fixture-Tag (17.11.2026): der Kassen-Faktor vom 05.11. gilt 14 Tage (bis 19.11. 18:40 UTC). Ohne festes Datum
// liefen beide Gewinn-Tests ab dem 19.11. abends rot (Fund 7 App 20.11.2026, nach Merge #318 auf main gemessen).
beforeEach(() => { setAliEinfuhrEur(ALI_EINFUHR_EUR); setSystemTime(new Date('2026-11-17T12:00:00Z')); });
afterEach(() => { setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR); setSystemTime(); });

describe('parseVkInput', () => {
  test('Komma und Punkt', () => { expect(parseVkInput('24,95')).toBe(24.95); expect(parseVkInput(' 24.9 ')).toBe(24.9); });
  test('ungültig → null', () => { for (const t of ['', 'abc', '24,955', '-1', '0']) expect(parseVkInput(t)).toBeNull(); });
});

describe('planManualVk (stele-225, +0,50 € je Variante)', () => {
  const plus50 = () => planManualVk(P225, { '12000057817791908': 26.95, '12000057817791906': 24.95, '12000057817791907': 24.95 });
  test('alle drei Varianten geändert, alt → neu', () => {
    expect(plus50().map(r => [r.label, r.alt, r.neu, r.geaendert])).toEqual([
      ['Blue', 26.45, 26.95, true], ['black', 24.45, 24.95, true], ['GRAY', 24.45, 24.95, true],
    ]);
  });
  test('Gewinn alt/neu aus productProfitRows', () => {
    const rows = plus50();
    expect(rows.map(r => [Math.round(r.gewinnAlt * 100) / 100, Math.round(r.gewinnNeu * 100) / 100])).toEqual([[1.33, 1.73], [1.26, 1.66], [1.26, 1.66]]);
    expect(rows.every(r => !r.warnung)).toBe(true);
  });
  test('alles Anheben → ein Aufruf "up"', () => {
    expect(splitByDirection(plus50())).toEqual({ up: { '12000057817791908': 26.95, '12000057817791906': 24.95, '12000057817791907': 24.95 }, down: {} });
  });
});

describe('Warnung und Senken', () => {
  test('black 23,45 € → Gewinn 0,46 € < 0,50 € → Warnung, Richtung "down", andere unverändert', () => {
    const rows = planManualVk(P225, { '12000057817791906': 23.45 });
    const black = rows.find(r => r.skuId === '12000057817791906')!;
    expect(Math.round(black.gewinnNeu * 100) / 100).toBe(0.46);
    expect(black.gewinnNeu < MANUAL_VK_WARN_PROFIT_EUR).toBe(true);
    expect(black.warnung).toBe(true);
    expect(rows.filter(r => r.geaendert).length).toBe(1);
    expect(splitByDirection(rows)).toEqual({ up: {}, down: { '12000057817791906': 23.45 } });
  });
  test('unveränderte Eingabe → nichts zu senden', () => {
    const rows = planManualVk(P225, { '12000057817791906': 24.45 });
    expect(splitByDirection(rows)).toEqual({ up: {}, down: {} });
  });
  test('unbekannte skuId wird ignoriert (nicht angeboten → kein Preis)', () => {
    const rows = planManualVk(P225, { '999': 5 });
    expect(rows.some(r => r.geaendert)).toBe(false);
  });
});

import { holdsAfterApply } from './variant-vk-edit';
describe('050b M1: Halten nach apply', () => {
  const before = { a: { sellPrice: 24.45, at: '2026-11-10T10:00:00.000Z', note: 'K-008 alt' }, b: { sellPrice: 21.45, at: '2026-11-11T10:00:00.000Z', note: null } };
  test('apply-Fehler → alter Halte-Eintrag unverändert zurück (Preis, Zeit, Notiz)', () => {
    const r = holdsAfterApply(before, ['a', 'b'], new Set(['b']));
    expect(r.restore).toEqual({ a: { sellPrice: 24.45, at: '2026-11-10T10:00:00.000Z', note: 'K-008 alt' } });
    expect(r.neuHalten).toEqual(['b']);
  });
  test('ohne alten Eintrag nichts wiederherzustellen', () => {
    expect(holdsAfterApply({}, ['x'], new Set())).toEqual({ restore: {}, neuHalten: [] });
  });
  test('alles gesetzt → nichts wiederherstellen', () => {
    expect(holdsAfterApply(before, ['a', 'b'], new Set(['a', 'b'])).restore).toEqual({});
  });
});
