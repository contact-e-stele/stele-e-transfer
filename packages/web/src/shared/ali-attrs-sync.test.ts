import { describe, expect, test } from 'bun:test';
import { planAliAttrsSync, applyAliAttrsSync } from './ali-attrs-sync';

// Echte Daten stele-119 (App 28.10.2026 / DS-API-Scrape 28.10.2026)
const STORED = [
  { skuId: '12000050569622128', attrs: { Color: '200pcs', 'Ships From': 'China Mainland' }, price: 9.29, stock: 100 },
  { skuId: '12000050569622130', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' }, price: 3.29, stock: 4 },
  { skuId: '12000050569622129', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' }, price: 24.59, stock: 99 },
  { skuId: '12000050569622127', attrs: { Color: '500PCs', 'Ships From': 'China Mainland' }, price: 11.69, stock: 98 },
];
const ALI = [
  { skuId: '12000050569622127', attrs: { Color: '500PCs', 'Ships From': 'China Mainland' } },
  { skuId: '12000050569622128', attrs: { Color: '200pcs', 'Ships From': 'China Mainland' } },
  { skuId: '12000050569622129', attrs: { Color: '1000PCs', 'Ships From': 'China Mainland' } },
  { skuId: '12000050569622130', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' } },
];

describe('OFFEN 010: AliExpress-Namen je skuId übernehmen', () => {
  test('stele-119: nur …129 wird von "100pcs" auf "1000PCs" korrigiert', () => {
    const plan = planAliAttrsSync(STORED, ALI);
    expect(plan.changes).toEqual([{ skuId: '12000050569622129', before: { Color: '100pcs', 'Ships From': 'China Mainland' }, after: { Color: '1000PCs', 'Ships From': 'China Mainland' } }]);
    const out = applyAliAttrsSync(STORED, plan);
    expect(out[2]).toEqual({ skuId: '12000050569622129', attrs: { Color: '1000PCs', 'Ships From': 'China Mainland' }, price: 24.59, stock: 99 });
    expect(out.filter(e => e.attrs.Color === '100pcs').map(e => e.skuId)).toEqual(['12000050569622130']); // 100pcs danach eindeutig
  });
  test('umbenannte Einträge (displayValues) bleiben, fehlende werden gemeldet', () => {
    const plan = planAliAttrsSync([{ skuId: 'A', attrs: { Color: 'Rot' }, displayValues: { Color: 'Rot' } }, { skuId: 'B', attrs: { Color: 'x' } }], [{ skuId: 'A', attrs: { Color: 'Red' } }]);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped.map(s => s.skuId)).toEqual(['A']);
    expect(plan.notOnAli).toEqual(['B']);
  });
});
