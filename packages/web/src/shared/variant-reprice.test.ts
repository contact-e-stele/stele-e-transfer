// OFFEN 033 "Auswahl senken" — Regeln 1–4. Fixture: stele-225 aus dem DB-Backup 05.11.2026 23:35 (Ware Blue 13,59 / black+GRAY 11,99,
// VK 26,95 / 24,95 / 24,95, Anzeige 0 %, China, Kassen-Faktor 0,9733). Erwartete Gewinne frisch mit bun nachgerechnet (Grundgesetz 3):
//   Blue 26,95 → 2,60 · 25,45 → 1,37 · 24,45 → 0,55 | black 24,95 → 2,52 · 23,45 → 1,29 · 25,95 → 3,34 | GRAY 22,95 → 0,88 (ohne Faktor 0,56)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { setAliEinfuhrEur, ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR } from './constants';
// Betriebswert Einfuhr 5,95 (der Test-Preload setzt sonst 3,57 für alte Belege) — danach zurück.
beforeAll(() => setAliEinfuhrEur(ALI_EINFUHR_EUR));
afterAll(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));
import { parseVariantRepriceBody, planVariantDecrease } from './variant-reprice';
import type { RepriceProduct } from './tier-reprice';

import { BLUE, BLACK, GRAY, GROUPS, p225 } from './variant-reprice.fixture';

describe('parseVariantRepriceBody', () => {
  test('gültig; apply nur mit confirm; Preise > 0 und höchstens 2 Nachkommastellen', () => {
    expect(parseVariantRepriceBody({ productId: 225, prices: { [BLUE]: 25.45 }, mode: 'preview' })).toEqual({ ok: true, productId: 225, prices: { [BLUE]: 25.45 }, mode: 'preview', confirm: false, sendToEbay: false });
    expect(parseVariantRepriceBody({ productId: 225, prices: { [BLUE]: 25.45 }, mode: 'apply' }).ok).toBe(false);
    expect(parseVariantRepriceBody({ productId: 225, prices: { [BLUE]: 25.45 }, mode: 'apply', confirm: true, sendToEbay: true }).ok).toBe(true);
    expect(parseVariantRepriceBody({ productId: 225, prices: {}, mode: 'preview' }).ok).toBe(false);
    expect(parseVariantRepriceBody({ productId: 225, prices: { [BLUE]: -1 }, mode: 'preview' }).ok).toBe(false);
    expect(parseVariantRepriceBody({ productId: 225, prices: { [BLUE]: 25.455 }, mode: 'preview' }).ok).toBe(false);
    expect(parseVariantRepriceBody({ productId: 0, prices: { [BLUE]: 25.45 }, mode: 'preview' }).ok).toBe(false);
    expect(parseVariantRepriceBody({ productId: 225, prices: { [BLUE]: 25.45 }, mode: 'preview', sendToEbay: 'ja' }).ok).toBe(false);
  });
});

describe('planVariantDecrease – Regeln', () => {
  const plan = (prices: Record<string, number>, held?: Set<string>, over?: Partial<RepriceProduct>) => planVariantDecrease(p225(over), prices, GROUPS, held).rows;

  test('freigegebene Senkung (Senk-Bericht Schritt 1): Blue 26,95 → 25,45 (+1,37), black 24,95 → 23,45 (+1,29) = ok', () => {
    const r = plan({ [BLUE]: 25.45, [BLACK]: 23.45 });
    expect(r.map(x => [x.skuId, x.alt, x.neu, x.gewinnAlt, x.gewinnNeu, x.status])).toEqual([
      [BLUE, 26.95, 25.45, 2.6, 1.37, 'ok'],
      [BLACK, 24.95, 23.45, 2.52, 1.29, 'ok'],
    ]);
  });
  test('Regel 1: Anheben abgelehnt (black 24,95 → 25,95), gleicher Preis abgelehnt', () => {
    const r = plan({ [BLACK]: 25.95, [GRAY]: 24.95 });
    expect(r.every(x => x.status === 'abgelehnt' && x.grund!.startsWith('nur senken'))).toBe(true);
  });
  test('Regel 2: Bremse 8 % — Blue 24,45 (−9,3 %) abgelehnt; GRAY 22,95 (−8,0 %) besteht die Bremse', () => {
    const r = plan({ [BLUE]: 24.45, [GRAY]: 22.95 });
    expect(r[0].status).toBe('abgelehnt');
    expect(r[0].grund).toContain('Senkungsbremse');
    expect(r[1].grund ?? '').not.toContain('Senkungsbremse');
  });
  test('Regel 3: Gewinn unter 1,00 abgelehnt — GRAY 22,95 = 0,88 mit Faktor; ohne Faktor 0,56', () => {
    expect(plan({ [GRAY]: 22.95 })[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: 0.88 });
    expect(plan({ [GRAY]: 22.95 }, undefined, { aliCheckoutFactor: null })[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: 0.56 });
  });
  test('Regel 4: "Preis halten" → gehalten (auch wenn die Senkung sonst ok wäre)', () => {
    const r = plan({ [BLUE]: 25.45, [BLACK]: 23.45 }, new Set([BLUE]));
    expect(r[0].status).toBe('gehalten');
    expect(r[1].status).toBe('ok');
  });
  test('nichts raten: unbekannte Variante und Variante ohne eigenen VK → abgelehnt', () => {
    expect(plan({ unbekannt: 10 })[0]).toMatchObject({ status: 'abgelehnt' });
    const ohneVk = plan({ [BLUE]: 25.45 }, undefined, {
      variantSellPrices: null,
      variantPrices: JSON.stringify([{ skuId: BLUE, attrs: { 'Color Name': 'Blue' }, price: 13.59, displayValues: { Varianten: 'BLAU' } }]),
    });
    expect(ohneVk[0].status).toBe('abgelehnt');
    expect(ohneVk[0].grund).toContain('kein eigener VK');
  });
  test('Einzelartikel → abgelehnt (dieser Weg ist nur für Varianten)', () => {
    const r = planVariantDecrease({ id: 9, variants: null, buyPrice: 5, sellPrice: 15.95, shipsFrom: 'China', adRate: 5, variantPrices: null }, { x: 14.95 }, []).rows;
    expect(r[0].status).toBe('abgelehnt');
  });
});

describe('OFFEN 033b (Kalkulator 07.11. 11:05)', () => {
  // Frisch mit bun gerechnet: Blue 25,45 → mit Faktor +1,37 / ohne +1,01 · black 23,45 → +1,29 / ohne +0,97 · Blue 25,95 → +1,78
  test('Punkt 1: Mindestgewinn = max(1,00; Ziel) — Ziel 1,50: black 23,45 (+1,29) und Blue 25,45 (+1,37) abgelehnt, Blue 25,95 (+1,78) ok', () => {
    const a = planVariantDecrease(p225({ targetMarginEur: 1.5 }), { [BLUE]: 25.45, [BLACK]: 23.45 }, GROUPS).rows;
    expect(a.map(r => [r.status, r.mindestGewinn])).toEqual([['abgelehnt', 1.5], ['abgelehnt', 1.5]]);
    expect(a[1].grund).toContain('1.50');
    expect(planVariantDecrease(p225({ targetMarginEur: 1.5 }), { [BLUE]: 25.95 }, GROUPS).rows[0]).toMatchObject({ status: 'ok', gewinnNeu: 1.78 });
    expect(planVariantDecrease(p225({ targetMarginEur: 1 }), { [BLACK]: 23.45 }, GROUPS).rows[0].mindestGewinn).toBe(1);
  });
  test('Punkt 2: gewinnOhneFaktor je Zeile; unter Mindestgewinn nur WARNUNG, keine Ablehnung', () => {
    const r = planVariantDecrease(p225(), { [BLUE]: 25.45, [BLACK]: 23.45 }, GROUPS).rows;
    expect(r.map(x => [x.gewinnNeu, x.gewinnOhneFaktor, x.status])).toEqual([[1.37, 1.01, 'ok'], [1.29, 0.97, 'ok']]);
    expect(r[0].hinweis).toBeUndefined();
    expect(r[1].hinweis).toContain('ohne Kassen-Faktor nur 0.97');
  });
});
