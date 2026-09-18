import { describe, expect, test } from 'bun:test';
import { buildProductLookups, findProductForSku, computeAutoBuyPrice, type ProductForSkuMatch } from './order-matching';

// Einkaufspreis-Einfrieren (2026-09-18): computeAutoBuyPrice() ist die aus index.ts:814-822
// extrahierte Berechnung (reiner Extract, identische Logik) — genutzt sowohl vom Live-Fallback
// als auch vom Freeze-Job für neue/bestehende Bestellungen. Live-Fund: löscht man das
// referenzierte Produkt, kippt der bis dahin berechenbare Einkaufspreis auf null — das ist der
// exakte Bug, den das Einfrieren beheben soll.

interface TestProduct extends ProductForSkuMatch {
  buyPrice: number | null;
  shipsFrom: string | null;
}

function lookupFor(products: TestProduct[]) {
  const lookups = buildProductLookups(products);
  return (sku: string | null) => findProductForSku(sku, lookups);
}

describe('computeAutoBuyPrice', () => {
  test('ein Line-Item, Produkt bekannt, kein China-Versand → nur buyPrice × Menge', () => {
    const find = lookupFor([{ id: 98, asin: null, buyPrice: 4.99, shipsFrom: 'Germany' }]);
    const result = computeAutoBuyPrice([{ sku: 'stele-98-WHITE-1PCS', quantity: 1 }], find);
    expect(result).toBe(4.99);
  });

  test('China-Versand → Zoll wird pro Line-Item addiert', () => {
    const find = lookupFor([{ id: 93, asin: null, buyPrice: 8.5, shipsFrom: 'China' }]);
    const result = computeAutoBuyPrice([{ sku: 'stele-93-ESSENTIAL-OILS', quantity: 1 }], find);
    expect(result).toBe(8.5 + 4); // CHINA_ZOLL_EUR = 4.00
  });

  test('mehrere Line-Items, beide bekannt → Summe', () => {
    const find = lookupFor([
      { id: 1, asin: null, buyPrice: 5, shipsFrom: 'Germany' },
      { id: 2, asin: null, buyPrice: 3, shipsFrom: 'Germany' },
    ]);
    const result = computeAutoBuyPrice([
      { sku: 'stele-1', quantity: 2 },
      { sku: 'stele-2', quantity: 1 },
    ], find);
    expect(result).toBe(5 * 2 + 3 * 1);
  });

  test('Live-Fund: Produkt wurde gelöscht (SKU zeigt ins Leere) → null, kein Teilbetrag', () => {
    const find = lookupFor([]); // Produkt 98 existiert nicht mehr in der DB
    const result = computeAutoBuyPrice([{ sku: 'stele-98-WHITE-1PCS', quantity: 1 }], find);
    expect(result).toBeNull();
  });

  test('ein Line-Item bekannt, eines nicht → gesamt null (kein Raten bei Teilinformation)', () => {
    const find = lookupFor([{ id: 1, asin: null, buyPrice: 5, shipsFrom: 'Germany' }]);
    const result = computeAutoBuyPrice([
      { sku: 'stele-1', quantity: 1 },
      { sku: 'stele-999', quantity: 1 },
    ], find);
    expect(result).toBeNull();
  });

  test('Produkt gefunden, aber buyPrice ist null → gesamt null', () => {
    const find = lookupFor([{ id: 1, asin: null, buyPrice: null, shipsFrom: 'Germany' }]);
    const result = computeAutoBuyPrice([{ sku: 'stele-1', quantity: 1 }], find);
    expect(result).toBeNull();
  });

  test('keine Line-Items → 0 (identisches Verhalten zum Original in index.ts, reiner Extract)', () => {
    const find = lookupFor([]);
    expect(computeAutoBuyPrice([], find)).toBe(0);
  });
});
