// OFFEN 033 "Auswahl senken" — Regeln 1–4. Fixture: stele-225 aus dem DB-Backup 05.11.2026 23:35 (Ware Blue 13,59 / black+GRAY 11,99,
// VK 26,95 / 24,95 / 24,95, Anzeige 0 %, China, Kassen-Faktor 0,9733). Erwartete Gewinne frisch mit bun nachgerechnet (Grundgesetz 3):
//   Blue 26,95 → 2,60 · 25,45 → 1,37 · 24,45 → 0,55 | black 24,95 → 2,52 · 23,45 → 1,29 · 25,95 → 3,34 | GRAY 22,95 → 0,88 (ohne Faktor 0,56)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { setAliEinfuhrEur, ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR } from './constants';
// Betriebswert Einfuhr 5,95 (der Test-Preload setzt sonst 3,57 für alte Belege) — danach zurück.
beforeAll(() => setAliEinfuhrEur(ALI_EINFUHR_EUR));
afterAll(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));
import { parseVariantRepriceBody, planVariantDecrease, planVariantReprice } from './variant-reprice';
import type { RepriceProduct } from './tier-reprice';

import { BLUE, BLACK, GRAY, GROUPS, p225 } from './variant-reprice.fixture';

// Formel je Standort (08.11.2026): China rechnet mit S 1,19 → beim echten 225-VK (26,95 / 24,95) liegt Blue ohne Faktor nur noch bei +1,33,
// black bei +1,35 — eine erlaubte Senkung mit Gewinn ≥ 1,00 gibt es dort nicht mehr. Für die Senk-Szenarien deshalb ein um 1,50 höherer
// alter VK (Eingabe geändert, frisch mit bun gerechnet): Blue 28,45 → +2,51 · black/GRAY 26,45 → +2,53.
const VSP_HOCH = JSON.stringify({ [BLUE]: 28.45, [BLACK]: 26.45, [GRAY]: 26.45 });

describe('parseVariantRepriceBody', () => {
  test('gültig; apply nur mit confirm; Preise > 0 und höchstens 2 Nachkommastellen', () => {
    expect(parseVariantRepriceBody({ productId: 225, prices: { [BLUE]: 25.45 }, mode: 'preview' })).toEqual({ ok: true, productId: 225, prices: { [BLUE]: 25.45 }, mode: 'preview', confirm: false, sendToEbay: false, direction: 'down' });
    expect(parseVariantRepriceBody({ productId: 225, prices: { [BLUE]: 27.45 }, mode: 'preview', direction: 'up' })).toMatchObject({ ok: true, direction: 'up' });
    expect(parseVariantRepriceBody({ productId: 225, prices: { [BLUE]: 27.45 }, mode: 'preview', direction: 'hoch' }).ok).toBe(false);
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

  // K-018 c1 (Kalkulator 13:05): Senken rechnet OHNE Kassen-Faktor „inkl. Rabatt“ (bun, S 1,19: Blue 26,95 → +1,33, black 24,45 → +0,96).
  test('Senken ohne Faktor (K-018 c1): Blue 28,45 → 26,95 (+1,33) ok, black 26,45 → 24,45 (+0,96) abgelehnt', () => {
    const r = plan({ [BLUE]: 26.95, [BLACK]: 24.45 }, undefined, { variantSellPrices: VSP_HOCH });
    expect(r.map(x => [x.skuId, x.alt, x.neu, x.gewinnAlt, x.gewinnNeu, x.status])).toEqual([
      [BLUE, 28.45, 26.95, 2.51, 1.33, 'ok'],
      [BLACK, 26.45, 24.45, 2.53, 0.96, 'abgelehnt'],
    ]);
  });
  test('Senken: Ergebnis mit und ohne gespeicherten Faktor gleich (Faktor wird beim Senken nicht benutzt)', () => {
    const mit = plan({ [BLUE]: 26.95, [BLACK]: 24.95 }, undefined, { variantSellPrices: VSP_HOCH });
    const ohne = plan({ [BLUE]: 26.95, [BLACK]: 24.95 }, undefined, { aliCheckoutFactor: null, variantSellPrices: VSP_HOCH });
    expect(mit.map(x => [x.gewinnNeu, x.status])).toEqual(ohne.map(x => [x.gewinnNeu, x.status]));
    expect(mit.map(x => x.gewinnNeu)).toEqual([1.33, 1.35]);
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
  test('Regel 3: Gewinn unter 1,00 abgelehnt — GRAY 22,95 = −0,22 (Senken ohne Faktor)', () => {
    expect(plan({ [GRAY]: 22.95 })[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: -0.22 });
    expect(plan({ [GRAY]: 22.95 }, undefined, { aliCheckoutFactor: null })[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: -0.22 });
  });
  test('Regel 4: "Preis halten" → gehalten (auch wenn die Senkung sonst ok wäre)', () => {
    const r = plan({ [BLUE]: 26.95, [BLACK]: 24.95 }, new Set([BLUE]), { variantSellPrices: VSP_HOCH }); // black 24,95 → +1,35 ok
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
  // Frisch mit bun gerechnet, Senken OHNE Faktor (K-018 c1), S 1,19, alter VK VSP_HOCH: Blue 26,95 → +1,33 · black 24,95 → +1,35 · Blue 27,45 → +1,72
  test('Punkt 1: Mindestgewinn = max(1,00; Ziel) — Ziel 1,50: black 24,95 (+1,35) und Blue 26,95 (+1,33) abgelehnt, Blue 27,45 (+1,72) ok', () => {
    const a = planVariantDecrease(p225({ targetMarginEur: 1.5, variantSellPrices: VSP_HOCH }), { [BLUE]: 26.95, [BLACK]: 24.95 }, GROUPS).rows;
    expect(a.map(r => [r.status, r.mindestGewinn])).toEqual([['abgelehnt', 1.5], ['abgelehnt', 1.5]]);
    expect(a[1].grund).toContain('1.50');
    expect(planVariantDecrease(p225({ targetMarginEur: 1.5, variantSellPrices: VSP_HOCH }), { [BLUE]: 27.45 }, GROUPS).rows[0]).toMatchObject({ status: 'ok', gewinnNeu: 1.72 });
    expect(planVariantDecrease(p225({ targetMarginEur: 1 }), { [BLACK]: 23.45 }, GROUPS).rows[0].mindestGewinn).toBe(1);
  });
  test('Punkt 2: gewinnOhneFaktor je Zeile; beim Senken = gewinnNeu (ohne Faktor gerechnet) → keine Warnung', () => {
    const r = planVariantDecrease(p225({ variantSellPrices: VSP_HOCH }), { [BLUE]: 26.95, [BLACK]: 24.95 }, GROUPS).rows;
    expect(r.map(x => [x.gewinnNeu, x.gewinnOhneFaktor, x.status])).toEqual([[1.33, 1.33, 'ok'], [1.35, 1.35, 'ok']]);
    expect(r.every(x => x.hinweis === undefined)).toBe(true);
  });
  // Formel je Standort: Ziel 2,70 → 2,00 (Eingabe geändert), damit „mit Faktor ≥ Ziel > ohne Faktor“ weiter gilt.
  test('Warnung „ohne Kassen-Faktor“ gibt es nur noch beim Anheben: Blue 26,95 → 27,45 mit Ziel 2,00 (mit +2,08, ohne +1,72)', () => {
    const r = planVariantReprice(p225({ targetMarginEur: 2.0 }), { [BLUE]: 27.45 }, GROUPS, new Set(), 'up').rows[0];
    expect(r).toMatchObject({ status: 'ok', gewinnNeu: 2.08, gewinnOhneFaktor: 1.72 });
    expect(r.hinweis).toContain('ohne Kassen-Faktor nur 1.72');
  });
});

describe('OFFEN 034 "Auswahl anheben" (direction up)', () => {
  // Frisch mit bun gerechnet (Backup-Fixture 225, Faktor 0,9733, Einfuhr 5,95, S 1,19): Blue 27,45 → +2,08 (ohne Faktor +1,72); black 28,95 → +16 %.
  const up = (prices: Record<string, number>, held?: Set<string>, over?: Parameters<typeof p225>[0]) => planVariantReprice(p225(over), prices, GROUPS, held, 'up').rows;
  test('anheben ok: Blue 26,95 → 27,45 (+2,08)', () => {
    expect(up({ [BLUE]: 27.45 })[0]).toMatchObject({ status: 'ok', alt: 26.95, neu: 27.45, gewinnNeu: 2.08, gewinnOhneFaktor: 1.72 });
  });
  test('nur anheben: Senken und gleicher Preis abgelehnt', () => {
    const r = up({ [BLUE]: 25.45, [BLACK]: 24.95 });
    expect(r.every(x => x.status === 'abgelehnt' && x.grund!.startsWith('nur anheben'))).toBe(true);
  });
  test('keine Senkungsbremse beim Anheben, aber Preissprung > 15 % (OFFEN 010) abgelehnt: black 24,95 → 28,95', () => {
    expect(up({ [BLACK]: 28.95 })[0].grund).toContain('Preissprung');
    expect(up({ [BLACK]: 28.45 })[0].status).toBe('ok'); // +14,0 %
  });
  // OFFEN 035 (Kalkulator 13:50): Anheben, das den Gewinn verbessert, ist auch unter max(1,00; Ziel) ok — mit Hinweis. Senken bleibt streng.
  test('OFFEN 035: Ziel 3,50 → Blue 26,95 → 27,45 (+1,69 → +2,08) ok mit Hinweis „noch unter Mindestgewinn“', () => {
    const r = up({ [BLUE]: 27.45 }, undefined, { targetMarginEur: 3.5 })[0];
    expect(r).toMatchObject({ status: 'ok', mindestGewinn: 3.5, gewinnAlt: 1.69, gewinnNeu: 2.08 });
    expect(r.hinweis).toContain('noch unter Mindestgewinn');
  });
  test('OFFEN 035: VK unter 1,00 (Blue 22,95 = −1,46, black 21,45 = −1,08) → Blue 23,45 (−1,07) und black 21,95 (−0,69) ok + Hinweis', () => {
    const vsp = JSON.stringify({ [BLUE]: 22.95, [BLACK]: 21.45 });
    const r = up({ [BLUE]: 23.45, [BLACK]: 21.95 }, undefined, { variantSellPrices: vsp });
    expect(r.map(x => [x.gewinnAlt, x.gewinnNeu, x.status])).toEqual([[-1.46, -1.07, 'ok'], [-1.08, -0.69, 'ok']]);
    expect(r.every(x => x.hinweis?.includes('noch unter Mindestgewinn'))).toBe(true);
  });
  test('OFFEN 035: Gewinn steigt nicht (gleicher Preis) → abgelehnt; Senken unter Mindestgewinn bleibt abgelehnt (Blue 22,95 → 22,45 = −2,22, ohne Faktor seit #281)', () => {
    const vsp = JSON.stringify({ [BLUE]: 22.95, [BLACK]: 21.45 });
    expect(up({ [BLUE]: 22.95 }, undefined, { variantSellPrices: vsp })[0].status).toBe('abgelehnt');
    expect(planVariantReprice(p225({ variantSellPrices: vsp }), { [BLUE]: 22.45 }, GROUPS, new Set(), 'down').rows[0]).toMatchObject({ status: 'abgelehnt', gewinnNeu: -2.22 });
  });
  test('"Preis halten" → gehalten', () => {
    expect(up({ [BLUE]: 27.45 }, new Set([BLUE]))[0].status).toBe('gehalten');
  });
});

describe('K-018 c1: Senk-Bericht rechnet ohne Kassen-Faktor „inkl. Rabatt“', () => {
  test('225 mit Faktor 0,9733 = 225 ohne Faktor (gleicher Bericht)', async () => {
    const { buildSenkBericht } = await import('./senk-kandidaten');
    // Formel je Standort: beim echten 225-VK gibt es mit S 1,19 keine Senk-Kandidaten mehr → alter VK VSP_HOCH (Eingabe geändert).
    const mit = buildSenkBericht([{ ...p225({ variantSellPrices: VSP_HOCH }), groups: GROUPS }]);
    const ohne = buildSenkBericht([{ ...p225({ aliCheckoutFactor: null, variantSellPrices: VSP_HOCH }), groups: GROUPS }]);
    expect(mit).toEqual(ohne);
    expect(mit.kandidaten.length).toBeGreaterThan(0);
  });
});
