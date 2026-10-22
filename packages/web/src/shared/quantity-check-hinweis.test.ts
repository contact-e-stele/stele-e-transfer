import { describe, expect, test } from 'bun:test';
import { evaluateQuantityRow, type QuantityRow } from './quantity-check';

// Echte Zeile stele-119 100PCS (Mengen-Vorschau live 22.10.2026): Lager 1, Offer null, Listing 5, verkauft 4, AliExpress-Lager unbekannt.
const row119: QuantityRow = { sku: 'stele-119-100PCS', label: '100PCS', inventoryQty: 1, offerQty: null, listingQty: 5, soldQty: 4, aliStock: null, targetQty: null };

describe('Mengen-Hinweis: nie "ok", wenn etwas fehlt (stele-119)', () => {
  test('Ziel unbekannt → roter Hinweis statt ok', () => {
    expect(evaluateQuantityRow(row119).note).toContain('AliExpress-Lager unbekannt');
  });
  test('Offer-Menge null = nicht gesetzt (Lager gilt) → kein Fehler', () => {
    expect(evaluateQuantityRow({ ...row119, aliStock: 1992, targetQty: 4, inventoryQty: 4, listingQty: 8 }).note).toBe('ok');
  });
  test('nur 1 frei → Multi-Rabatt gesperrt', () => {
    expect(evaluateQuantityRow({ ...row119, offerQty: 1, aliStock: 1, targetQty: 1 }).note).toContain('Multi-Rabatt');
  });
  test('alles bekannt und ≥ 2 frei → ok', () => {
    expect(evaluateQuantityRow({ sku: 's', label: 'x', inventoryQty: 4, offerQty: 4, listingQty: 8, soldQty: 4, aliStock: 1954, targetQty: 4 }).note).toBe('ok');
  });
});
