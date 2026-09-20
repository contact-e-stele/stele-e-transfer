import { describe, expect, test } from 'bun:test';
import {
  resolveVariantEntries, findOrphanedVariantEntries, syncDisplayValuesOnRename,
  slugify, type VariantGroup, type VariantPriceEntry,
} from './variant-resolver';

describe('resolveVariantEntries — Grundfälle (NACHWEIS)', () => {
  test('exakter Treffer über attrs', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['Rot', 'Blau'] }];
    const prices: VariantPriceEntry[] = [
      { skuId: 'A', attrs: { Color: 'Rot' }, price: 3 },
      { skuId: 'B', attrs: { Color: 'Blau' }, price: 4 },
    ];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result).toEqual([
      { displayValues: { Farbe: 'Rot' }, sku: 'stele-1-ROT', entry: { skuId: 'A', price: 3, ebayPrice: undefined, stock: undefined, imageUrl: undefined }, error: null },
      { displayValues: { Farbe: 'Blau' }, sku: 'stele-1-BLAU', entry: { skuId: 'B', price: 4, ebayPrice: undefined, stock: undefined, imageUrl: undefined }, error: null },
    ]);
  });

  test('Groß/Klein-Schreibung spielt beim Matching keine Rolle', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['rot'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: 'ROT' }, price: 3 }];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toEqual({ skuId: 'A', price: 3, ebayPrice: undefined, stock: undefined, imageUrl: undefined });
  });

  test('führende/nachgestellte Leerzeichen werden getrimmt', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: [' Rot '] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: 'Rot' }, price: 3 }];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toEqual({ skuId: 'A', price: 3, ebayPrice: undefined, stock: undefined, imageUrl: undefined });
  });

  test('Size-Blacklist (NON_VARIATION_ASPECTS): "ONE SIZE" in attrs darf kein Farb-Match verhindern', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['Rot'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: 'Rot', 'Ships From': 'CHINA' }, price: 3 }];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].error).toBeNull();
  });

  test('Dublette: zwei Einträge mit demselben Wert → harter Fehler, kein "erster Treffer"', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['Rot'] }];
    const prices: VariantPriceEntry[] = [
      { skuId: 'A', attrs: { Color: 'Rot' }, price: 3 },
      { skuId: 'B', attrs: { Color: 'Rot' }, price: 5 },
    ];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toBeNull();
    expect(result[0].error).toContain('Mehrdeutig');
    expect(result[0].error).toContain('A');
    expect(result[0].error).toContain('B');
    expect(result[0].error).toContain('3.00');
    expect(result[0].error).toContain('5.00');
  });

  test('fehlender Wert: kein Eintrag passt → harter Fehler, namentlich', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['Grün'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: 'Rot' }, price: 3 }];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toBeNull();
    expect(result[0].error).toContain('Grün');
  });

  test('kein EK: Eintrag ohne price/ebayPrice → harter Fehler', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['Rot'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: 'Rot' } }];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toBeNull();
    expect(result[0].error).toContain('Einkaufspreis');
  });

  test('explizite displayValues gewinnen über attrs (überlebt Umbenennung)', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['Silber-Optik'] }];
    const prices: VariantPriceEntry[] = [
      { skuId: 'A', attrs: { Color: '1PCS' }, price: 3, displayValues: { Farbe: 'Silber-Optik' } },
    ];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toEqual({ skuId: 'A', price: 3, ebayPrice: undefined, stock: undefined, imageUrl: undefined });
  });

  test('displayValues verhindert ein falsches attrs-Fallback-Match für denselben Eintrag', () => {
    // Eintrag A hat displayValues="Gold" gesetzt — obwohl sein attrs-Wert "1PCS" zufällig zu
    // einer anderen Kombination passen KÖNNTE, wird A nur noch über displayValues geprüft.
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['1PCS'] }];
    const prices: VariantPriceEntry[] = [
      { skuId: 'A', attrs: { Color: '1PCS' }, price: 3, displayValues: { Farbe: 'Gold' } },
    ];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toBeNull();
    expect(result[0].error).toContain('Kein variantPrices-Eintrag');
  });

  test('mehrere Varianten-Gruppen (Kombinationen): jede Achse muss exakt matchen', () => {
    const variants: VariantGroup[] = [
      { name: 'Farbe', values: ['Rot', 'Blau'] },
      { name: 'Größe', values: ['S', 'M'] },
    ];
    const prices: VariantPriceEntry[] = [
      { skuId: 'RS', attrs: { Color: 'Rot', Size: 'S' }, price: 1 },
      { skuId: 'RM', attrs: { Color: 'Rot', Size: 'M' }, price: 2 },
      { skuId: 'BS', attrs: { Color: 'Blau', Size: 'S' }, price: 3 },
      { skuId: 'BM', attrs: { Color: 'Blau', Size: 'M' }, price: 4 },
    ];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result.map(r => r.entry?.skuId)).toEqual(['RS', 'RM', 'BS', 'BM']);
    expect(result.every(r => r.error === null)).toBe(true);
  });
});

describe('resolveVariantEntries — Live-Befund-Reproduktionen (20.09.2026)', () => {
  test('stele-141-Muster: "50pcs" darf NICHT mehr auf "150pcs" matchen (vorher Substring-Bug)', () => {
    const variants: VariantGroup[] = [{ name: 'Varianten', values: ['50pcs'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: '150pcs' }, price: 3 }];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toBeNull(); // kein falscher Substring-Treffer mehr — echte Lücke sichtbar
  });

  test('stele-162-Muster: "1" darf NICHT mehr auf "10" matchen', () => {
    const variants: VariantGroup[] = [{ name: 'Varianten', values: ['1'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: '10' }, price: 3 }];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toBeNull();
  });

  test('stele-132-Muster: "Indigo Pink" darf NICHT mehr auf "Indigo Pink Base Set" matchen', () => {
    const variants: VariantGroup[] = [{ name: 'Varianten', values: ['Indigo Pink'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: 'Indigo Pink Base Set' }, price: 3 }];
    const result = resolveVariantEntries(1, variants, prices);
    expect(result[0].entry).toBeNull(); // exakt ungleich → keine Lücke wird verschleiert
  });
});

describe('findOrphanedVariantEntries', () => {
  test('ein Eintrag ohne passenden Anzeigewert wird gemeldet', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['Rot'] }];
    const prices: VariantPriceEntry[] = [
      { skuId: 'A', attrs: { Color: 'Rot' }, price: 3 },
      { skuId: 'B', attrs: { Color: 'Verwaist' }, price: 5 },
    ];
    const errors = findOrphanedVariantEntries(1, variants, prices);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('B');
    expect(errors[0]).toContain('verwaister Eintrag');
  });

  test('keine verwaisten Einträge → leeres Array', () => {
    const variants: VariantGroup[] = [{ name: 'Farbe', values: ['Rot'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: 'Rot' }, price: 3 }];
    expect(findOrphanedVariantEntries(1, variants, prices)).toEqual([]);
  });
});

describe('syncDisplayValuesOnRename', () => {
  test('reine Umbenennung (gleiche Struktur): displayValues wird für den passenden Eintrag gesetzt', () => {
    const oldVariants: VariantGroup[] = [{ name: 'Farbe', values: ['1PCS', 'Gold'] }];
    const newVariants: VariantGroup[] = [{ name: 'Farbe', values: ['Silber-Optik', 'Gold-Optik'] }];
    const prices: VariantPriceEntry[] = [
      { skuId: 'A', attrs: { Color: '1PCS' }, price: 3 },
      { skuId: 'B', attrs: { Color: 'Gold' }, price: 4 },
    ];
    const result = syncDisplayValuesOnRename(70, oldVariants, newVariants, prices);
    expect(result.find(e => e.skuId === 'A')?.displayValues).toEqual({ Farbe: 'Silber-Optik' });
    expect(result.find(e => e.skuId === 'B')?.displayValues).toEqual({ Farbe: 'Gold-Optik' });
  });

  test('die neue Zuordnung löst danach korrekt über resolveVariantEntries auf', () => {
    const oldVariants: VariantGroup[] = [{ name: 'Farbe', values: ['1PCS'] }];
    const newVariants: VariantGroup[] = [{ name: 'Farbe', values: ['Silber-Optik'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: '1PCS' }, price: 3 }];
    const synced = syncDisplayValuesOnRename(70, oldVariants, newVariants, prices);
    const resolved = resolveVariantEntries(70, newVariants, synced);
    expect(resolved[0].entry).toEqual({ skuId: 'A', price: 3, ebayPrice: undefined, stock: undefined, imageUrl: undefined });
  });

  test('unterschiedliche Struktur (Wert hinzugefügt) → NICHTS wird geschrieben, kein Raten', () => {
    const oldVariants: VariantGroup[] = [{ name: 'Farbe', values: ['Rot'] }];
    const newVariants: VariantGroup[] = [{ name: 'Farbe', values: ['Rot', 'Blau'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: 'Rot' }, price: 3 }];
    const result = syncDisplayValuesOnRename(1, oldVariants, newVariants, prices);
    expect(result).toEqual(prices); // unverändert
  });

  test('kein Treffer beim alten Stand (Eintrag schon vorher fehlerhaft) → für ihn wird nichts geschrieben', () => {
    const oldVariants: VariantGroup[] = [{ name: 'Farbe', values: ['Grün'] }]; // "Grün" passt auf KEINEN Eintrag
    const newVariants: VariantGroup[] = [{ name: 'Farbe', values: ['Türkis'] }];
    const prices: VariantPriceEntry[] = [{ skuId: 'A', attrs: { Color: 'Rot' }, price: 3 }];
    const result = syncDisplayValuesOnRename(1, oldVariants, newVariants, prices);
    expect(result[0].displayValues).toBeUndefined();
  });
});

describe('slugify (unverändert aus ebay.ts übernommen, s. Regel 8)', () => {
  test('Großbuchstaben, Sonderzeichen ersetzt, Bindestriche normalisiert', () => {
    expect(slugify('Indigo Pink!')).toBe('INDIGO-PINK');
  });
});
