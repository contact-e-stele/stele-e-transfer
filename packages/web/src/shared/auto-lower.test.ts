// K-018 PR B: automatisch senken — reine Planung. Fixtures = DB-Backup 05.11.2026 23:35 (stele-228, stele-119), Einfuhr 5,95.
// Alle Zahlen frisch mit bun gerechnet (Grundgesetz 3).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { setAliEinfuhrEur, ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR } from './constants';
import { planAutoLower, multiRabattPerPieceProblem, AUTO_LOWER_SCHWELLE_EUR, type AutoLowerProduct } from './auto-lower';
import fx228 from './auto-lower-fx/fx228.json';
import fx119 from './auto-lower-fx/fx119.json';

beforeAll(() => setAliEinfuhrEur(ALI_EINFUHR_EUR));
afterAll(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));

const PINK = '12000045241000885';     // 228 2000ml pink
const PCS100 = '12000050569622130';   // 119 100pcs
const prod = (fx: unknown): AutoLowerProduct => { const p = fx as AutoLowerProduct & { variants: string }; return { ...p, groups: JSON.parse(p.variants) }; };
const p228 = prod(fx228), p119 = prod(fx119);
const fresh = (...ps: AutoLowerProduct[]) => new Map(ps.map(p => [p.id, p.variantPrices as string]));
const base = { changedThisRun: new Set<string>(), held: new Map<number, Set<string>>(), promotions: new Map<number, { 2: number; 3: number }>() };

describe('planAutoLower – Kandidaten (Schwelle Ziel + 0,20)', () => {
  test('Schwelle ist 0,20 (eigene Konstante, Senk-Bericht bleibt 1,00)', () => expect(AUTO_LOWER_SCHWELLE_EUR).toBe(0.2));
  test('228 pink 20,45 → 19,95 (+1,50 → +1,11); 119 100pcs 16,45 → 15,45 (+1,93 → +1,11) — niedrigste Endung mit Gewinn ≥ Ziel', () => {
    const r = planAutoLower({ ...base, products: [p228, p119], freshEk: fresh(p228, p119) });
    expect(r.senken.map(s => [s.productId, s.rows.map(x => [x.skuId, x.alt, x.neu, x.gewinnAlt, x.gewinnNeu])])).toEqual([
      [119, [[PCS100, 16.45, 15.45, 1.93, 1.11]]],
      [228, [[PINK, 20.45, 19.95, 1.5, 1.11]]],
    ]);
    expect(r.nichtGesenkt).toEqual([]);
  });
});

describe('c2 EK frisch', () => {
  test('nicht in diesem Lauf gelesen → nicht gesenkt mit Grund', () => {
    const r = planAutoLower({ ...base, products: [p228], freshEk: new Map() });
    expect(r.senken).toEqual([]);
    expect(r.nichtGesenkt).toEqual([expect.objectContaining({ productId: 228, skuId: PINK, grund: expect.stringContaining('EK nicht frisch') })]);
  });
  test('es zählt der in diesem Lauf GELESENE EK, nicht der DB-Wert: pink 5,79 → 6,29 → kein Kandidat mehr', () => {
    const vp = JSON.parse(p228.variantPrices as string).map((e: { skuId: string; price: number }) => (e.skuId === PINK ? { ...e, price: e.price + 0.5 } : e));
    const r = planAutoLower({ ...base, products: [p228], freshEk: new Map([[228, JSON.stringify(vp)]]) });
    expect(r).toEqual({ senken: [], nichtGesenkt: [] });
  });
});

describe('c3 kein Hin und Her', () => {
  test('VK in diesem Lauf schon geändert → übersprungen', () => {
    const r = planAutoLower({ ...base, products: [p228], freshEk: fresh(p228), changedThisRun: new Set([`228:${PINK}`]) });
    expect(r.senken).toEqual([]);
    expect(r.nichtGesenkt[0].grund).toContain('c3');
  });
});

describe('c4 Multi-Rabatt je Stück ≥ 1,00 (LIVE-Prozent)', () => {
  test('35 %/36 %: alter VK 20,45 ok, neuer 19,95 → 2 Stück nur 0,94 € je Stück → nicht gesenkt', () => {
    const attrs = { Color: '2000ml pink' };
    expect(multiRabattPerPieceProblem(p228, 5.79, 20.45, attrs, { 2: 35, 3: 36 })).toBeNull();
    expect(multiRabattPerPieceProblem(p228, 5.79, 19.95, attrs, { 2: 35, 3: 36 })).toContain('nur 0.94 € je Stück');
    const r = planAutoLower({ ...base, products: [p228], freshEk: fresh(p228), promotions: new Map([[228, { 2: 35, 3: 36 }]]) });
    expect(r.senken).toEqual([]);
    expect(r.nichtGesenkt[0].grund).toContain('c4');
  });
  test('30 %/31 %: 19,95 bleibt ≥ 1,00 je Stück → gesenkt', () => {
    const r = planAutoLower({ ...base, products: [p228], freshEk: fresh(p228), promotions: new Map([[228, { 2: 30, 3: 31 }]]) });
    expect(r.senken[0].prices).toEqual({ [PINK]: 19.95 });
  });
});

describe('Sperren (K-011, OFFEN 010)', () => {
  test('gesperrtes Produkt → nicht gesenkt mit dem Sperr-Grund', () => {
    const r = planAutoLower({ ...base, products: [p228], freshEk: fresh(p228), gesperrt: new Map([[228, 'K-011 Käuferpreis-Sperre']]) });
    expect(r.senken).toEqual([]);
    expect(r.nichtGesenkt[0].grund).toBe('K-011 Käuferpreis-Sperre');
  });
});

describe('Preis halten', () => {
  test('gehaltene Variante → nicht gesenkt mit Grund', () => {
    const r = planAutoLower({ ...base, products: [p228], freshEk: fresh(p228), held: new Map([[228, new Set([PINK])]]) });
    expect(r.senken).toEqual([]);
    expect(r.nichtGesenkt[0].grund).toContain('Preis halten');
  });
});
