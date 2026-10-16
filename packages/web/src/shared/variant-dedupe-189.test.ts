// Echte Daten stele-189 (live gelesen 16.10.2026 ~07:10 über /api/products; imageUrl gekürzt auf Platzhalter, da nur "vorhanden" zählt).
// 465xxx/863xxx = ursprüngliche Einträge (Bild, displayValues, ebayPrice); 140xxx = alte Scrape-Dubletten (laut Log nicht mehr bei AliExpress);
// 123xxx = aktuelle Scrape-Einträge.
import { describe, expect, test } from 'bun:test';
import { planVariantDedupe, dedupeStillAmbiguous, DEDUPE_RESTING_PRODUCT_IDS, type DedupeEntry } from './variant-dedupe';

const groups = [{ name: 'Size', values: ['XS', 'M', 'S', 'L'] }, { name: 'Color', values: ['Green', 'Black', 'Blue'] }];
const o = (id: string, size: string, color: string, price: number, stock: number, ebayPrice: number, colorFirst = false): DedupeEntry => ({
  skuId: id, attrs: colorFirst ? { Color: color, Size: size } : { Size: size, Color: color }, price, stock,
  imageUrl: 'img', displayValues: { Size: size, Color: color }, ebayPrice,
});
const s = (id: string, size: string, color: string, price: number, stock: number): DedupeEntry => ({ skuId: id, attrs: { Size: size, Color: color }, price, stock });
const entries: DedupeEntry[] = [
  o('12000060168465760', 'XS', 'Green', 3.39, 2, 15.95), o('12000038985863216', 'M', 'Black', 3.45, 5, 15.95, true),
  o('12000060168465761', 'M', 'Green', 4.09, 7, 16.95), o('12000060168465762', 'S', 'Green', 3.99, 1, 16.95),
  o('12000060168465763', 'XS', 'Black', 3.19, 7, 15.95), o('12000060168465764', 'XS', 'Blue', 3.15, 7, 15.95),
  o('12000038985863211', 'S', 'Blue', 3.99, 14, 15.95), o('12000038985863210', 'M', 'Blue', 4.19, 15, 16.95),
  o('12000038985863213', 'S', 'Black', 3.35, 4, 15.95, true), o('12000038985863215', 'L', 'Black', 4.09, 11, 16.95),
  o('12000038985863214', 'L', 'Blue', 4.09, 39, 16.95), o('12000060168465759', 'L', 'Green', 4.29, 14, 16.95),
  s('12000060779140981', 'L', 'Green', 4.29, 14), s('12000060779140983', 'M', 'Green', 4.09, 7), s('12000060779140982', 'XS', 'Green', 3.39, 2),
  s('12000060779140985', 'XS', 'Black', 3.19, 7), s('12000060779140984', 'S', 'Green', 3.99, 14), s('12000060779140986', 'XS', 'Blue', 3.15, 5),
  s('12000060802123543', 'L', 'Green', 4.39, 44), s('12000060802123547', 'XS', 'Black', 3.25, 6), s('12000060802123546', 'S', 'Green', 4.09, 9),
  s('12000060802123545', 'M', 'Green', 4.09, 37), s('12000060802123544', 'XS', 'Green', 3.39, 29), s('12000060802123548', 'XS', 'Blue', 3.19, 9),
];

describe('Dubletten-Bereinigung stele-189 (echte Daten)', () => {
  const plan = planVariantDedupe(groups, entries);
  test('24 → 12 Einträge, je Kombination genau einer', () => {
    expect(entries.length).toBe(24);
    expect(plan.newEntries.length).toBe(12);
    expect(plan.changes.length).toBe(6);
    expect(plan.unchangedCombos).toBe(6);
    expect(plan.ambiguous).toEqual([]);
    expect(plan.orphans).toEqual([]);
  });
  test('Träger übernimmt skuId und Lager des aktuellen Eintrags (123xxx), EK = höchster', () => {
    const by = Object.fromEntries(plan.changes.map(c => [c.label, c]));
    const exp: Record<string, [string, number, number]> = {
      'Size=L, Color=Green': ['12000060802123543', 4.39, 44], 'Size=XS, Color=Black': ['12000060802123547', 3.25, 6],
      'Size=S, Color=Green': ['12000060802123546', 4.09, 9], 'Size=M, Color=Green': ['12000060802123545', 4.09, 37],
      'Size=XS, Color=Green': ['12000060802123544', 3.39, 29], 'Size=XS, Color=Blue': ['12000060802123548', 3.19, 9],
    };
    for (const [label, [sku, price, stock]] of Object.entries(exp)) {
      expect(by[label]?.keeperNewSkuId).toBe(sku);
      expect(by[label]?.newPrice).toBe(price);
      expect(by[label]?.newStock).toBe(stock);
      expect(by[label]?.removedSkuIds.length).toBe(2);
    }
  });
  test('ursprüngliche Anzeige-Werte (displayValues, ebayPrice, Bild) bleiben erhalten', () => {
    const lg = plan.newEntries.find(e => e.skuId === '12000060802123543')!;
    expect(lg.displayValues).toEqual({ Size: 'L', Color: 'Green' });
    expect(lg.ebayPrice).toBe(16.95);
    expect(lg.imageUrl).toBe('img');
    expect(plan.newEntries.some(e => e.skuId.startsWith('12000060779140'))).toBe(false);
  });
  test('Sicherheitsnetz: danach nichts mehrdeutig; vorher schon', () => {
    expect(dedupeStillAmbiguous(189, groups, plan)).toEqual([]);
    const untouched = { ...plan, newEntries: entries };
    expect(dedupeStillAmbiguous(189, groups, untouched).length).toBeGreaterThan(0);
  });
  test('zweiter Lauf: nichts mehr zu bereinigen', () => {
    expect(planVariantDedupe(groups, plan.newEntries).changes.length).toBe(0);
  });
  test('stele-214 ruht', () => { expect(DEDUPE_RESTING_PRODUCT_IDS.has(214)).toBe(true); });
});
