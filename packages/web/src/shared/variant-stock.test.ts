import { describe, expect, test } from 'bun:test';
import { stockBySkuFor } from './variant-stock';

// Echte Werte stele-224 (App-DB, 19.10.2026): Anzeigewerte SCHWARZ/GRAU/BLAU, AliExpress-attrs black/Grey/DEEP BLUE,
// Lager 23/19/19, eBay-SKUs stele-224-SCHWARZ/-GRAU/-BLAU (quantity-check live).
const groups224 = [{ name: 'Varianten', values: ['SCHWARZ', 'GRAU', 'BLAU'] }];
const entries224 = [
  { skuId: '12000056789088501', attrs: { Color: 'black' }, stock: 23, price: 12.39, displayValues: { Varianten: 'SCHWARZ' } },
  { skuId: '12000056789088502', attrs: { Color: 'Grey' }, stock: 19, price: 12.19, displayValues: { Varianten: 'GRAU' } },
  { skuId: '12000056789088503', attrs: { Color: 'DEEP BLUE' }, stock: 19, price: 12.39, displayValues: { Varianten: 'BLAU' } },
];

describe('Mengen-Lauf: Lager je echter eBay-SKU (stele-224)', () => {
  test('umbenannte Varianten treffen die eBay-SKU aus dem Anzeigewert', () => {
    const m = stockBySkuFor(224, groups224, entries224);
    expect(m.get('stele-224-SCHWARZ')).toBe(23);
    expect(m.get('stele-224-GRAU')).toBe(19);
    expect(m.get('stele-224-BLAU')).toBe(19);
  });
  test('nicht umbenannte Varianten (attrs = Anzeigewert) wie bisher', () => {
    const m = stockBySkuFor(220, [{ name: 'Color Name', values: ['GRAY'] }], [{ skuId: '1', attrs: { 'Color Name': 'GRAY' }, stock: 24, price: 12.19 }]);
    expect(m.get('stele-220-GRAY')).toBe(24);
  });
  test('ohne Gruppen: alter attrs-Weg, Versandland zählt nicht zur SKU', () => {
    const m = stockBySkuFor(5, [], [{ skuId: '1', attrs: { Color: 'Red', 'Ships From': 'China' }, stock: 7, price: 1 }]);
    expect(m.get('stele-5-RED')).toBe(7);
  });
  test('zwei Einträge mit gleichen attrs → mehrdeutig, nichts gesetzt (nichts geraten)', () => {
    const m = stockBySkuFor(6, [], [{ skuId: '1', attrs: { Color: 'Red' }, stock: 7, price: 1 }, { skuId: '2', attrs: { Color: 'Red' }, stock: 3, price: 1 }]);
    expect(m.has('stele-6-RED')).toBe(false);
  });
});

test('Mengen-Lauf und Mengen-Prüfung nutzen dieselbe Zuordnung (Grundgesetz 8)', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { resolve } = require('path') as typeof import('path');
  for (const f of ['price-monitor.ts', 'quantity-check.ts']) {
    const src = readFileSync(resolve(import.meta.dir, '..', 'api', f), 'utf-8');
    expect(src).toContain('stockBySkuFor(');
  }
});

// Live-Fund stele-119 (22.10.2026, App-DB): zwei AliExpress-Einträge "100pcs" (EK 3,25 Lager 6 / EK 4,09 Lager 1992), eBay hat EINE
// Variante stele-119-100PCS. Vorher: mehrdeutig → kein Lager → Ziel leer → Menge blieb bei 1, "2 kaufen" (Multi-Rabatt) gesperrt.
// Jetzt: dieselbe Regel wie der Dubletten-Knopf (planVariantDedupe, Grundgesetz 8) — der frischeste Eintrag trägt das Lager.
const groups119 = [{ name: 'Varianten ', values: ['200pcs', '100pcs'] }];
const entries119 = [
  { skuId: '12000050569622128', attrs: { Color: '200pcs', 'Ships From': 'China Mainland' }, price: 5.59, stock: 1954 },
  { skuId: '12000050569622130', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' }, price: 3.25, stock: 6 },
  { skuId: '12000050569622129', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' }, price: 4.09, stock: 1992 },
];
describe('Dubletten-Kombination (stele-119)', () => {
  test('Lager der Dublette kommt aus der Dubletten-Regel (frischester Eintrag)', () => {
    const m = stockBySkuFor(119, groups119, entries119);
    expect(m.get('stele-119-200PCS')).toBe(1954);
    expect(m.get('stele-119-100PCS')).toBe(1992);
  });
});
