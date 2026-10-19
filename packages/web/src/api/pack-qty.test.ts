import { describe, expect, test } from 'bun:test';
import { applyAliUnitValues, setPackQty, normalizePackQty, aliOrderQuantity } from '../shared/pack-qty';
import { computeAliCosts, profitAtSellPrice } from '../shared/pricing';
// price-monitor.ts lädt db/index.ts → Dummy-URL vor dem dynamischen Import (wie price-monitor.test.ts).
process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/pack-qty-test.db';
const { mergeFreshVariantPrices } = await import('./price-monitor');

// Echte Einträge stele-213 (App-DB 18.10.2026): Blue 1,49 € / Lager 43, Purple 1,29 € / Lager 50.
// HINWEIS: Echte AliExpress-Daten der Aufsicht-Nummern 223/239/242 liegen der App nicht vor (noch nicht importiert) —
// die Pack-Fälle unten rechnen deshalb mit den stele-213-Stückwerten als 2er-Pack (Rechenweg, keine erfundenen Produktdaten).
const blue = { skuId: '12000043169280438', attrs: { Color: 'Blue' }, price: 1.49, stock: 43 };
const purple = { skuId: '12000043169280442', attrs: { Color: 'Purple' }, price: 1.29, stock: 50 };

describe('Packmenge (OFFEN 007)', () => {
  test('normalize: nur ganze Zahlen 1–20, sonst 1', () => {
    expect(normalizePackQty(2)).toBe(2);
    expect(normalizePackQty('3')).toBe(3);
    expect(normalizePackQty(0)).toBe(1);
    expect(normalizePackQty(2.5)).toBe(1);
    expect(normalizePackQty(undefined)).toBe(1);
  });
  test('2er-Pack: Ware 2,98 €, Lager ⌊43/2⌋ = 21, Stückwerte bleiben', () => {
    const p = setPackQty(blue, 2);
    expect(p).toMatchObject({ packQty: 2, unitPrice: 1.49, unitStock: 43, price: 2.98, stock: 21 });
  });
  test('zurück auf 1 → exakt die Stückwerte, keine Pack-Felder', () => {
    const p = setPackQty(setPackQty(blue, 2), 1);
    expect(p).toEqual(blue);
  });
  test('Versand/Einfuhr nur einmal: Kosten 2er-Pack ≠ 2 × Einzelkosten', () => {
    const one = computeAliCosts(1.49, true).totalCost;
    const pack = computeAliCosts(setPackQty(blue, 2).price, true).totalCost;
    expect(pack).toBeCloseTo(2.98 + 1.99 + 3.57, 6);
    expect(pack).toBeLessThan(2 * one);
  });
  test('Preis-Lauf setzt die Packmenge NICHT zurück (mergeFreshVariantPrices)', () => {
    const existing = JSON.stringify([setPackQty(blue, 2), purple]);
    const merged = JSON.parse(mergeFreshVariantPrices(existing, [
      { skuId: blue.skuId, attrs: blue.attrs, price: 1.59, stock: 40 },
      { skuId: purple.skuId, attrs: purple.attrs, price: 1.35, stock: 48 },
    ]).json!);
    expect(merged[0]).toMatchObject({ packQty: 2, unitPrice: 1.59, unitStock: 40, price: 3.18, stock: 20 });
    expect(merged[1]).toEqual({ ...purple, price: 1.35, stock: 48 }); // 1-Stück-Regressionsprobe: genau wie vorher
  });
  test('ohne frischen Bestand bleibt der Pack-Bestand', () => {
    const p = applyAliUnitValues(setPackQty(blue, 2), 1.59, undefined);
    expect(p).toMatchObject({ price: 3.18, stock: 21, unitStock: 43 });
  });
  test('AliExpress-Bestellmenge = eBay-Menge × Packmenge', () => {
    expect(aliOrderQuantity(3, 2)).toBe(6);
    expect(aliOrderQuantity(1, undefined)).toBe(1);
  });
  test('Gewinn eines 2er-Packs rechnet mit Pack-Ware (Formel v2)', () => {
    const p = setPackQty(blue, 2);
    const g = profitAtSellPrice({ sellPrice: 12.95, buyPrice: p.price, isChinaOrigin: true, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.3, vatFactor: 1.19, adRatePercent: 5 });
    const g1 = profitAtSellPrice({ sellPrice: 12.95, buyPrice: 1.49, isChinaOrigin: true, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.3, vatFactor: 1.19, adRatePercent: 5 });
    expect(g1 - g).toBeCloseTo(1.49, 6); // genau ein Stückpreis mehr Einkauf, Nebenkosten unverändert
  });
});
