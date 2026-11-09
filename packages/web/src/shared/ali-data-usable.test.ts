// AUFSICHT 045 Teil A (09.11.2026, gestaffelte eBay-Fixgebühr 0,35/0,45 statt 0,30): Erwartungswerte in dieser Datei mit bun neu gerechnet.
// Zahlen in Testnamen/Kommentaren können noch den Stand mit 0,30 zeigen — maßgeblich sind die expect-Werte. Liste alt → neu: docs/fixgebuehr-testaenderungen.md
// Fix stele-251 (Live-Fund 09.11.2026): Scrape-Fallback ohne Varianten-Preise → Weg "gespeicherter Einkaufspreis".
// Fixture 251 (echte Werte, Kalkulator 08.11.2026): 6 Varianten, EK 25,79/14,89/11,99/26,59/14,59/12,39, VK 43,45/29,45/25,45/44,95/28,95/25,95,
// China, Anzeige 5 %, Ziel 1,00 €. Erwartete Anhebungen mit planTierReprice/planVariantRaises frisch nachgerechnet (bun, Einfuhr 5,95):
//   25,79: 43,45 → 46,45 (Gewinn −0,9529 → 1,1974)   14,89: 29,45 → 31,45 (−0,0878 → 1,3457)   11,99: 25,45 → 26,95 (−0,0549 → 1,0202)
//   26,59: 44,95 → 47,45 (−0,6777 → 1,1142)          14,59: 28,95 → 30,95 (−0,1462 → 1,2873)   12,39: 25,95 → 27,95 (−0,0966 → 1,3370)
// = genau die Kalkulator-Werte 46,45/31,45/26,95/47,45/30,95/27,95 (nachgerechnet, nicht übernommen).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { aliDataUsability, effectiveShipsFrom, isUnknownShipsFrom, countPricedVariants } from './ali-data-usable';
import { resolveAbPrice } from './ab-price';
import { isChinaShipping } from './pricing';
import { setAliEinfuhrEur, ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR } from './constants';
import { explainVariantRaisePlan, planVariantRaises, runVariantRaise, describeVariantRaiseExplanation, type VariantRaiseProduct } from '../api/variant-raise';

// Live-Antwort POST /api/aliexpress/scrape für 251 (09.11.2026, HTML-Fallback, kein _source 'ds-api')
const SCRAPE_251 = { price: '73.77 €', shipsFrom: 'Unknown', variantPrices: [] as Array<{ price: number }> };

const EK = [25.79, 14.89, 11.99, 26.59, 14.59, 12.39];
const VK = [43.45, 29.45, 25.45, 44.95, 28.95, 25.95];
const SKUS = EK.map((_, i) => `12000046${i}`);
const product251 = (over: Partial<VariantRaiseProduct> = {}): VariantRaiseProduct => ({
  id: 251, variants: JSON.stringify([{ name: 'Farbe', values: SKUS.map((_, i) => `F${i}`) }]),
  buyPrice: 11.99, sellPrice: 25.45, shipsFrom: 'China', adRate: 5, targetMarginEur: 1,
  ebayStatus: 'listed', ebayListingId: '1234567890',
  variantPrices: JSON.stringify(EK.map((price, i) => ({ skuId: SKUS[i], attrs: { Farbe: `F${i}` }, price }))),
  variantSellPrices: JSON.stringify(Object.fromEntries(SKUS.map((s, i) => [s, VK[i]]))),
  ...over,
});

beforeEach(() => setAliEinfuhrEur(ALI_EINFUHR_EUR)); // Betriebswert 5,95 (Preload setzt 3,57)
afterEach(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));

describe('Fix 251: AliExpress-Daten ohne Varianten-Preise', () => {
  test('251-Scrape (Seitenpreis 73,77, keine Varianten) gilt beim Varianten-Produkt als keine Daten', () => {
    const u = aliDataUsability(true, SCRAPE_251);
    expect(u.usable).toBe(false);
    if (!u.usable) expect(u.reason).toContain('73.77');
    // Beleg für das alte Verhalten: resolveAbPrice hätte den Seitenpreis als Ab-Preis genommen
    expect(resolveAbPrice(73.77, true, [])).toEqual({ ok: true, price: 73.77, source: 'data.price' });
  });
  test('Einzelartikel: Seitenpreis bleibt brauchbar (unverändert)', () => {
    expect(aliDataUsability(false, SCRAPE_251)).toEqual({ usable: true });
  });
  test('Varianten-Produkt mit mindestens einem Varianten-Preis bleibt brauchbar', () => {
    expect(aliDataUsability(true, { price: '', shipsFrom: 'China', variantPrices: [{ price: 0 }, { price: 12.39 }] })).toEqual({ usable: true });
    expect(countPricedVariants({ variantPrices: [{ price: 0 }, { price: NaN }, { price: 12.39 }] })).toBe(1);
  });
  test('keine Daten', () => {
    expect(aliDataUsability(true, null).usable).toBe(false);
  });
});

describe("Fix 251: 'Unknown' überschreibt die gespeicherte Herkunft nicht", () => {
  test('Unknown + gespeichert Poland → Poland (kein China-Zuschlag)', () => {
    expect(effectiveShipsFrom('Unknown', 'Poland')).toBe('Poland');
    expect(isChinaShipping(effectiveShipsFrom('Unknown', 'Poland'))).toBe(false);
  });
  test('Unknown + gespeichert China → China; bekanntes Land gewinnt; beides unbekannt → China-Regel', () => {
    expect(effectiveShipsFrom('Unknown', 'China')).toBe('China');
    expect(effectiveShipsFrom('Spain', 'China')).toBe('Spain');
    expect(effectiveShipsFrom('', 'Poland')).toBe('Poland');
    expect(isChinaShipping(effectiveShipsFrom('Unknown', null))).toBe(true);
    expect(isUnknownShipsFrom(' unbekannt ')).toBe(true);
  });
});

describe('Fix 251: Weg "gespeicherter Einkaufspreis" hebt alle 6 Varianten an', () => {
  test('planVariantRaises: exakt die nachgerechneten Preise', () => {
    const r = planVariantRaises(product251());
    expect(r.map(x => [x.ware, x.oldSell, x.newSell])).toEqual([
      [25.79, 43.45, 46.45], [14.89, 29.45, 31.45], [11.99, 25.45, 27.45],
      [26.59, 44.95, 47.95], [14.59, 28.95, 30.95], [12.39, 25.95, 27.95],
    ]);
    expect(r.map(x => x.oldProfit.toFixed(4))).toEqual(['-1.1314', '-0.2663', '-0.2334', '-0.8562', '-0.3247', '-0.2751']); // AUFSICHT 045 A: je −0,1785 (Fix 0,45 statt 0,30)
    expect(r.map(x => x.newProfit.toFixed(4))).toEqual(['1.0189', '1.1672', '1.2001', '1.2941', '1.1088', '1.1585']); // AUFSICHT 045 A: Fix 0,45; Varianten 3/4 eine Endung höher (27,45 / 47,95)
  });
  test('explainVariantRaisePlan: Grund je Variante (gehalten, Gewinn ok)', () => {
    const ex = explainVariantRaisePlan(product251({
      variantSellPrices: JSON.stringify({ ...Object.fromEntries(SKUS.map((s, i) => [s, VK[i]])), [SKUS[0]]: 46.45 }),
    }), new Set([SKUS[1]]));
    expect(ex.floor).toBe(1);
    expect(ex.rows.map(r => r.reason)).toEqual(['profit_ok', 'held', 'raise', 'raise', 'raise', 'raise']);
    const lines = describeVariantRaiseExplanation(251, ex);
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain('Preis gehalten');
    expect(describeVariantRaiseExplanation(251, explainVariantRaisePlan(product251({ variantPrices: '[]', variants: '[{"name":"Farbe","values":["a"]}]' })))[0])
      .toContain('keine Variante mit gespeichertem Einkaufspreis');
  });
  test('runVariantRaise mit gespeichertem EK sendet 6 Anhebungen und speichert sie', async () => {
    const sent: string[] = []; let stored: Record<string, number> = {};
    const out = await runVariantRaise(product251(), {
      enabled: true,
      send: async (raises) => { sent.push(...raises.map(r => r.skuId)); return { resolved: true, results: raises.map(r => ({ skuId: r.skuId, ok: true })) }; },
      store: async (u) => { stored = u; },
      log: () => {},
    });
    expect(out.status).toBe('sent');
    expect(sent).toEqual(SKUS);
    expect(stored).toEqual(Object.fromEntries(SKUS.map((s, i) => [s, [46.45, 31.45, 27.45, 47.95, 30.95, 27.95][i]])));
  });
});
