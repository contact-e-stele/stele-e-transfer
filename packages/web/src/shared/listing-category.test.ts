// OFFEN 020 Befund 2: stele-248 (Hausschuhe) — keine eigene Kategorie, eBay-Vorschlag verworfen → früher still 79720.
import { describe, expect, test } from 'bun:test';
import { resolveListingCategory } from './listing-category';

describe('Kategorie fürs Listen (OFFEN 020)', () => {
  test('eigene Kategorie hat Vorrang', () => {
    expect(resolveListingCategory('11511', '12345')).toEqual({ ok: true, categoryId: '11511', source: 'produkt' });
  });
  test('ohne eigene → eBay-Vorschlag', () => {
    expect(resolveListingCategory(null, '12345')).toEqual({ ok: true, categoryId: '12345', source: 'vorschlag' });
  });
  test('stele-248: weder eigene noch Vorschlag → Fehler, NICHT 79720', () => {
    const r = resolveListingCategory(null, null);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('79720');
  });
  test('leere Zeichenkette zählt als fehlend', () => {
    expect(resolveListingCategory('  ', '')).toMatchObject({ ok: false });
  });
});

import { requireCategoryId } from './listing-category';
describe('requireCategoryId', () => {
  test('ohne Kategorie wird geworfen', () => {
    expect(() => requireCategoryId(undefined)).toThrow('Keine eBay-Kategorie');
    expect(requireCategoryId('11511')).toBe('11511');
  });
});
