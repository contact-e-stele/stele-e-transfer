import { describe, expect, test } from 'bun:test';
import { pruneRemovedVariantEntries, countVariantCombinations, maxVariantsError, MAX_VARIANT_COMBINATIONS } from './variant-cleanup';

// Aufbau nach stele-166 (live 16.10.2026): 7 Farben × 2 Längen = 14 Varianten, EK/Lager echt aus der App-Datenbank.
const groups166 = [
  { name: 'Color', values: ['GRAY', 'black', 'Pink', 'Off-white', 'Soft pink', 'Turquoise', 'Blue'] },
  { name: 'Length', values: ['3m', '5m'] },
];
const e = (skuId: string, color: string, len: string, price: number, stock: number) => ({ skuId, attrs: { Color: color, Length: len }, price, stock });
const entries166 = [
  e('12000056160142152', 'GRAY', '5m', 15.99, 19), e('12000056160142150', 'black', '5m', 6.99, 1),
  e('12000056160142155', 'Pink', '3m', 14.79, 20), e('12000060931481714', 'Off-white', '3m', 5.59, 5),
  e('12000060931481715', 'Off-white', '5m', 7.09, 8), e('12000060931481711', 'Soft pink', '5m', 6.99, 13),
  e('12000060931481712', 'Turquoise', '3m', 5.59, 9), e('12000056160142153', 'Blue', '3m', 14.79, 20),
  e('12000060931481710', 'Soft pink', '3m', 5.49, 5), e('12000056160142156', 'Pink', '5m', 17.19, 20),
  e('12000056160142154', 'Blue', '5m', 17.19, 20), e('12000056160142151', 'GRAY', '3m', 13.89, 19),
  e('12000060931481713', 'Turquoise', '5m', 6.99, 9), e('12000056160142149', 'black', '3m', 14.99, 19),
];

describe('Varianten aufräumen (Fix 238)', () => {
  test('Werte entfernt → nur passende Einträge bleiben', () => {
    const newGroups = [{ name: 'Color', values: ['GRAY', 'black'] }, { name: 'Length', values: ['3m', '5m'] }];
    const r = pruneRemovedVariantEntries(groups166, newGroups, entries166);
    expect(r.kept.map(x => x.skuId).sort()).toEqual(['12000056160142149', '12000056160142150', '12000056160142151', '12000056160142152']);
    expect(r.removed.length).toBe(10);
  });
  test('ganze Gruppe Länge auf 5m reduziert → 7 bleiben', () => {
    const r = pruneRemovedVariantEntries(groups166, [groups166[0], { name: 'Length', values: ['5m'] }], entries166);
    expect(r.kept.length).toBe(7);
    expect(r.kept.every(x => x.attrs.Length === '5m')).toBe(true);
  });
  test('reine Umbenennung (gleiche Struktur) → nichts entfernt', () => {
    const renamed = [{ name: 'Farbe', values: ['Grau', 'Schwarz', 'Rosa', 'Creme', 'Hellrosa', 'Türkis', 'Blau'] }, groups166[1]];
    expect(pruneRemovedVariantEntries(groups166, renamed, entries166).removed.length).toBe(0);
  });
  test('schon vorher verwaister Eintrag bleibt (stele-70: 1PCS/Gold zu Silber-Optik/Gold-Optik)', () => {
    const old70 = [{ name: 'Color', values: ['Silber-Optik', 'Gold-Optik'] }];
    const new70 = [{ name: 'Color', values: ['Silber-Optik'] }];
    // Merkmale wie live (16.10.); skuIds nur mit den bekannten letzten 6 Ziffern, Preis für diesen Test ohne Bedeutung.
    const ent70 = [{ skuId: '…693892', attrs: { Color: '1PCS' }, price: 1 }, { skuId: '…564496', attrs: { Color: 'Gold' }, price: 1 }];
    const r = pruneRemovedVariantEntries(old70, new70, ent70);
    expect(r.removed).toEqual([]);
    expect(r.kept.length).toBe(2);
  });
  test('umbenannt UND gelöscht im selben Schritt → nichts entfernen, Hinweis', () => {
    const newGroups = [{ name: 'Color', values: ['Grau', 'black'] }, { name: 'Length', values: ['3m', '5m'] }];
    const r = pruneRemovedVariantEntries(groups166, newGroups, entries166);
    expect(r.removed).toEqual([]);
    expect(r.renamedAndRemoved).toBe(true);
  });
  test('ohne Gruppen (Einzelartikel) → nichts entfernt', () => {
    expect(pruneRemovedVariantEntries([], [], entries166).kept.length).toBe(14);
  });
});

describe('Höchstens 5 Varianten', () => {
  test('Zählung', () => {
    expect(MAX_VARIANT_COMBINATIONS).toBe(5);
    expect(countVariantCombinations(groups166)).toBe(14);
    expect(countVariantCombinations([])).toBe(0);
    expect(countVariantCombinations([{ name: 'Color', values: [] }])).toBe(0);
  });
  test('14 → Fehler, 5 → ok, 6 → Fehler', () => {
    expect(maxVariantsError(groups166)).toContain('Mehr als 5 Varianten (14)');
    expect(maxVariantsError([{ name: 'Color', values: ['a', 'b', 'c', 'd', 'e'] }])).toBeNull();
    expect(maxVariantsError([{ name: 'Color', values: ['a', 'b', 'c'] }, { name: 'Size', values: ['S', 'M'] }])).toContain('(6)');
  });
});
