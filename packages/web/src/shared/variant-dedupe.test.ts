// A-015: Tests mit den ECHTEN Daten von stele-194 (Produktion, 04.10.2026, nur gelesen): 38 variantPrices-Einträge zu 22 Kombinationen
// (Size 5m/3m × 11 Farben) — 22 ursprüngliche Einträge (mit displayValues/ebayPrice/imageUrl, skuIds ...59958844332–353) plus
// 16 später angehängte Scrape-Einträge (skuIds ...60727277997–000, ...60780948001–004, ...60793086376–383). Erwartungen wurden vorab
// von Hand aus den Rohdaten abgeleitet und dann gegen den Trockenlauf des Skripts bestätigt (Grundgesetz Regel 3).
import { describe, expect, test } from 'bun:test';
import { planVariantDedupe, renderDedupeMarkdown, type DedupeEntry } from './variant-dedupe';
import { resolveVariantEntries } from './variant-resolver';

const GROUPS = [
  { name: 'Size', values: ['5m', '3m'] },
  { name: 'Color', values: ['WHITE', 'Yellow Gray', 'Red', 'Pink', 'Black Gray', 'Blue Gray', 'Rose Gray', 'Coffee', 'Red Gray', 'green', 'Blue'] },
];

// [skuId-Suffix nach 12000059958844, Size, Color, EK, Lager, ebayPrice]
const ORIG: Array<[string, string, string, number, number, number]> = [
  ['342', '5m', 'WHITE', 6.39, 497, 17.95], ['343', '3m', 'Yellow Gray', 3.89, 5, 15.95], ['340', '3m', 'WHITE', 4.79, 497, 16.95],
  ['341', '5m', 'Yellow Gray', 5.29, 0, 17.95], ['338', '3m', 'Red', 5.09, 500, 16.95], ['339', '5m', 'Red', 5.89, 3, 17.95],
  ['336', '3m', 'Pink', 4.19, 9, 16.95], ['337', '5m', 'Pink', 6.09, 18, 18.95], ['350', '3m', 'Black Gray', 4.69, 23, 17.95],
  ['351', '5m', 'Black Gray', 5.99, 28, 18.95], ['348', '3m', 'Blue Gray', 4.39, 3, 16.95], ['349', '5m', 'Blue Gray', 5.99, 11, 18.95],
  ['346', '3m', 'Rose Gray', 4.09, 15, 16.95], ['347', '5m', 'Rose Gray', 5.99, 18, 18.95], ['344', '3m', 'Coffee', 4.69, 11, 17.95],
  ['345', '5m', 'Coffee', 5.19, 0, 17.95], ['352', '3m', 'Red Gray', 4.59, 9, 16.95], ['353', '5m', 'Red Gray', 5.29, 0, 17.95],
  ['334', '3m', 'green', 4.19, 8, 16.95], ['335', '5m', 'green', 5.99, 13, 18.95], ['332', '3m', 'Blue', 4.09, 16, 16.95],
  ['333', '5m', 'Blue', 5.59, 16, 18.95],
];
// Scrape-Einträge in der Reihenfolge, in der sie in der DB stehen (ältester zuerst): [volle skuId, Size, Color, EK, Lager]
const FRESH: Array<[string, string, string, number, number]> = [
  ['12000060727278000', '5m', 'Yellow', 6.59, 500], ['12000060780948004', '5m', 'Pink', 6.29, 499], ['12000060727277997', '3m', 'Pink', 4.79, 496],
  ['12000060780948002', '5m', 'Blue', 6.49, 499], ['12000060780948003', '3m', 'Blue', 4.79, 499], ['12000060727277999', '3m', 'Green', 4.99, 500],
  ['12000060727277998', '5m', 'Green', 6.59, 500], ['12000060780948001', '3m', 'Yellow', 4.79, 498], ['12000060793086381', '5m', 'Blue', 6.59, 499],
  ['12000060793086380', '3m', 'Yellow', 4.89, 498], ['12000060793086383', '5m', 'Pink', 6.39, 499], ['12000060793086382', '3m', 'Blue', 4.89, 499],
  ['12000060793086377', '5m', 'Green', 6.69, 500], ['12000060793086376', '3m', 'Pink', 4.79, 496], ['12000060793086379', '5m', 'Yellow', 6.69, 500],
  ['12000060793086378', '3m', 'Green', 5.09, 500],
];
const original = (): DedupeEntry[] => ORIG.map(([sfx, size, color, price, stock, ebayPrice]) => ({
  skuId: '12000059958844' + sfx, attrs: { Size: size, Color: color }, price, stock, imageUrl: `https://img/${sfx}.jpg`,
  displayValues: { Size: size, Color: color }, ebayPrice,
}));
const scraped = (): DedupeEntry[] => FRESH.map(([skuId, size, color, price, stock]) => ({ skuId, attrs: { Size: size, Color: color }, price, stock }));
const ALL = (): DedupeEntry[] => [...original(), ...scraped()];

describe('planVariantDedupe — stele-194 (echte Daten)', () => {
  const plan = planVariantDedupe(GROUPS, ALL());

  test('38 Einträge → 26 (22 Kombinationen + 4 nicht zugeordnete "Yellow"); 6 Kombinationen bereinigt, 16 unverändert, 0 mehrdeutig', () => {
    expect(ALL()).toHaveLength(38);
    expect(plan.newEntries).toHaveLength(26);
    expect(plan.changes).toHaveLength(6);
    expect(plan.unchangedCombos).toBe(16);
    expect(plan.ambiguous).toEqual([]);
  });

  test('die 6 Kombinationen: skuId/Lager vom frischesten Scrape-Eintrag, EK = höchster Scrape-EK', () => {
    const byLabel = Object.fromEntries(plan.changes.map(c => [c.label, c]));
    const expectChange = (label: string, oldSku: string, newSku: string, oldPrice: number, newPrice: number, newStock: number, removed: string[]) => {
      const c = byLabel[label];
      expect(c).toBeDefined();
      expect([c.keeperOldSkuId, c.keeperNewSkuId, c.oldPrice, c.newPrice, c.newStock]).toEqual([oldSku, newSku, oldPrice, newPrice, newStock]);
      expect(c.removedSkuIds).toEqual(removed);
    };
    expectChange('Size=5m, Color=Pink', '12000059958844337', '12000060793086383', 6.09, 6.39, 499, ['12000060780948004', '12000060793086383']);
    expectChange('Size=5m, Color=green', '12000059958844335', '12000060793086377', 5.99, 6.69, 500, ['12000060727277998', '12000060793086377']);
    expectChange('Size=5m, Color=Blue', '12000059958844333', '12000060793086381', 5.59, 6.59, 499, ['12000060780948002', '12000060793086381']);
    expectChange('Size=3m, Color=Pink', '12000059958844336', '12000060793086376', 4.19, 4.79, 496, ['12000060727277997', '12000060793086376']);
    expectChange('Size=3m, Color=green', '12000059958844334', '12000060793086378', 4.19, 5.09, 500, ['12000060727277999', '12000060793086378']);
    expectChange('Size=3m, Color=Blue', '12000059958844332', '12000060793086382', 4.09, 4.89, 499, ['12000060780948003', '12000060793086382']);
  });

  test('"Green" (frisch) wird der Kombination "green" zugeordnet (Groß-/Kleinschreibung egal)', () => {
    const e = plan.newEntries.find(x => x.attrs.Color === 'green' && x.attrs.Size === '5m')!;
    expect(e.price).toBe(6.69);
    expect(plan.newEntries.some(x => x.attrs.Color === 'Green')).toBe(false);
  });

  test('ebayPrice, imageUrl, displayValues und attrs des ursprünglichen Eintrags bleiben unverändert', () => {
    const e = plan.newEntries.find(x => x.skuId === '12000060793086383')!; // 5m Pink
    expect(e.ebayPrice).toBe(18.95);
    expect(e.imageUrl).toBe('https://img/337.jpg');
    expect(e.displayValues).toEqual({ Size: '5m', Color: 'Pink' });
    expect(e.attrs).toEqual({ Size: '5m', Color: 'Pink' });
    expect(e.stock).toBe(499);
  });

  test('"Yellow" hat kein Gegenstück in product.variants (nur "Yellow Gray"): NICHT zugeordnet, 4 Einträge nur aufgelistet und unverändert behalten', () => {
    expect(plan.orphans.map(o => o.skuId)).toEqual(['12000060727278000', '12000060780948001', '12000060793086380', '12000060793086379']);
    for (const o of plan.orphans) expect(plan.newEntries).toContainEqual(o);
    // "Yellow Gray" (ursprünglich, ohne Dublette) bleibt unberührt:
    expect(plan.newEntries.find(x => x.skuId === '12000059958844343')!.price).toBe(3.89);
  });

  test('Kombinationen ohne Dublette bleiben Byte-für-Byte gleich', () => {
    const before = original().filter(e => !['336', '337', '332', '333', '334', '335'].some(s => e.skuId.endsWith(s)));
    for (const b of before) expect(plan.newEntries).toContainEqual(b);
  });

  test('NACH der Bereinigung löst resolveVariantEntries alle 22 Kombinationen eindeutig auf (vorher: 6× "Mehrdeutig")', () => {
    const before = resolveVariantEntries(194, GROUPS, ALL() as never);
    expect(before.filter(r => r.error?.startsWith('Mehrdeutig'))).toHaveLength(6);
    const after = resolveVariantEntries(194, GROUPS, plan.newEntries as never);
    expect(after).toHaveLength(22);
    expect(after.filter(r => r.error)).toEqual([]);
  });

  test('idempotent: ein zweiter Lauf über das Ergebnis ändert nichts mehr', () => {
    const again = planVariantDedupe(GROUPS, plan.newEntries);
    expect(again.changes).toEqual([]);
    expect(again.newEntries).toEqual(plan.newEntries);
  });

  test('Markdown (Trockenlauf) nennt vorher/nachher je Kombination, die 4 nicht zugeordneten Einträge und "nichts geschrieben"', () => {
    const md = renderDedupeMarkdown(194, plan, 38, false, '2026-10-04T00:00:00Z');
    expect(md).toContain('TROCKENLAUF — nichts geschrieben');
    expect(md).toContain('Einträge vorher: 38, nachher: 26');
    expect(md).toContain('| Size=5m, Color=Pink | 12000059958844337 → 12000060793086383 | 6,09 → 6,39 | 18 → 499 |');
    expect(md).toContain('"Color":"Yellow"');
  });
});

describe('planVariantDedupe — Randfälle', () => {
  const g = [{ name: 'Color', values: ['Rot', 'Blau'] }];
  const orig = (skuId: string, color: string, price: number): DedupeEntry => ({ skuId, attrs: { Color: color }, price, stock: 1, ebayPrice: 9.95, displayValues: { Color: color } });
  const fresh = (skuId: string, color: string, price: number): DedupeEntry => ({ skuId, attrs: { Color: color }, price, stock: 7 });

  test('im Zweifel höherer EK: frischester Eintrag billiger als ein älterer Scrape-Eintrag → Maximum, mit Hinweis', () => {
    const p = planVariantDedupe(g, [orig('O', 'Rot', 2.0), fresh('F1', 'Rot', 3.5), fresh('F2', 'Rot', 3.0)]);
    expect(p.changes[0].keeperNewSkuId).toBe('F2');
    expect(p.changes[0].newPrice).toBe(3.5);
    expect(p.changes[0].priceNote).toContain('höherer EK');
  });

  test('frischester Eintrag ist zugleich der teuerste → kein Hinweis', () => {
    const p = planVariantDedupe(g, [orig('O', 'Rot', 2.0), fresh('F1', 'Rot', 3.0), fresh('F2', 'Rot', 3.5)]);
    expect(p.changes[0].priceNote).toBeNull();
  });

  test('keine Dublette → nichts geändert; Kombination ohne ursprünglichen Eintrag → mehrdeutig, nichts geändert', () => {
    expect(planVariantDedupe(g, [orig('O', 'Rot', 2.0), orig('P', 'Blau', 2.5)]).changes).toEqual([]);
    const p = planVariantDedupe(g, [fresh('F1', 'Rot', 3.0), fresh('F2', 'Rot', 3.5)]);
    expect(p.changes).toEqual([]);
    expect(p.ambiguous).toHaveLength(1);
    expect(p.newEntries).toHaveLength(2);
  });

  test('zwei ursprüngliche Einträge derselben Kombination → mehrdeutig, nichts geändert', () => {
    const p = planVariantDedupe(g, [orig('O1', 'Rot', 2.0), orig('O2', 'Rot', 2.2), fresh('F', 'Rot', 3.0)]);
    expect(p.changes).toEqual([]);
    expect(p.ambiguous[0].reason).toContain('2 ursprüngliche');
    expect(p.newEntries).toHaveLength(3);
  });

  test('ohne Varianten-Gruppen wird nichts angefasst (keine Sammel-Kombination)', () => {
    const p = planVariantDedupe([], [orig('O', 'Rot', 2.0), fresh('F', 'Blau', 3.0)]);
    expect(p.changes).toEqual([]);
    expect(p.newEntries).toHaveLength(2);
  });

  test('Zuordnung wie beim Listing: nach Umbenennung der Gruppe (Größe statt Size) greifen displayValues des Originals, Scrape-Einträge nur über Werte', () => {
    const gg = [{ name: 'Farbe', values: ['Rot'] }];
    const o = { skuId: 'O', attrs: { Color: 'Rot' }, price: 2, stock: 1, ebayPrice: 9.95, displayValues: { Farbe: 'Rot' } } as DedupeEntry;
    const f = { skuId: 'F', attrs: { Color: 'rot' }, price: 3, stock: 7 } as DedupeEntry;
    const p = planVariantDedupe(gg, [o, f]);
    expect(p.changes).toHaveLength(1);
    expect(p.newEntries).toHaveLength(1);
    expect(p.newEntries[0].skuId).toBe('F');
  });

  test('Versand-Attribut (Ships From) unterscheidet Kombinationen nicht', () => {
    const e = { skuId: 'F', attrs: { Color: 'Rot', 'Ships From': 'China' }, price: 3.0, stock: 2 };
    const p = planVariantDedupe(g, [orig('O', 'Rot', 2.0), e]);
    expect(p.changes).toHaveLength(1);
    expect(p.newEntries).toHaveLength(1);
  });
});
