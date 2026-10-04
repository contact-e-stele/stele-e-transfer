// A-017: Tests für Stufenwechsel → neue Verkaufspreise je Variante (Formel v2). Fixture: stele-218 (Produktion, 04.10.2026,
// nur gelesen): China, Anzeige 5 %, 18 Varianten, alte VK im Feld variantPrices[].ebayPrice (Variante "200PCS / 6x8cm": EK 2,99 €,
// alter VK 14,95 €). Alle Zahlen frisch mit bun nachgerechnet; die Handrechnung steht je Test im Kommentar.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  planTierReprice, storePatchForPlan, parseTierRepriceBody, decideTierRepriceAction, TIER_REPRICE_MAX_PRODUCTS, type RepriceProduct,
  expectedFromPlan, compareExpected,
} from './tier-reprice';
import { productProfitRows } from './target-margin-bulk';
import { evaluateTargetDisplay, profitFloorFor } from './pricing';

const E: Array<[string, string, string, number, number]> = [
  ['12000056823911280', '200PCS', '6x8cm', 2.99, 14.95], ['12000056823911281', '200PCS', '8x12cm', 3.99, 16.95],
  ['12000056823911282', '200PCS', '7x10cm', 3.45, 15.95], ['12000056823911283', '200PCS', '9x13cm', 3.39, 15.95],
  ['12000056823911284', '200PCS', '5x7cm', 2.55, 14.95], ['12000056823911285', '200PCS', '10x15cm', 5.39, 17.95],
  ['12000056823911286', '200PCS', '11x16cm', 6.29, 19.95], ['12000056823911295', '200PCS', '4x6cm', 2.09, 13.95],
  ['12000056823911264', '100PCS', '6x8cm', 2.09, 13.95], ['12000056823911265', '100PCS', '8x12cm', 2.59, 14.95],
  ['12000056823911266', '100PCS', '7x10cm', 2.39, 14.95], ['12000060735059392', '200PCS', '12x17cm', 6.59, 19.95],
  ['12000056823911267', '100PCS', '9x13cm', 2.99, 14.95], ['12000060735059393', '100PCS', '12x17cm', 3.89, 15.95],
  ['12000056823911268', '100PCS', '5x7cm', 1.89, 13.95], ['12000056823911269', '100PCS', '10x15cm', 3.25, 15.95],
  ['12000056823911270', '100PCS', '11x16cm', 3.89, 15.95], ['12000056823911272', '100PCS', '4x6cm', 1.75, 13.95],
];
const stele218: RepriceProduct = {
  id: 218, variants: '[{"name":"Size","values":["200PCS","100PCS"]},{"name":"Color","values":["6x8cm"]}]', buyPrice: 1.75, sellPrice: null, shipsFrom: 'China', adRate: 5, variantSellPrices: null,
  variantPrices: JSON.stringify(E.map(([skuId, size, color, price, ebayPrice]) => ({
    skuId, attrs: { Size: size, Color: color }, price, displayValues: { Size: size, Color: color }, ebayPrice,
  }))),
};
const SKU_6X8 = '12000056823911280';
const row6x8 = (plan: ReturnType<typeof planTierReprice>) => plan.rows.find(r => r.skuId === SKU_6X8)!;

describe('stele-218, Variante "200PCS / 6x8cm" (EK 2,99 €, China, Ware < 10 €): VK + Gewinn je Stufe nach Formel v2', () => {
  // K = 2,99 + 1,99 Versand + 3,57 Einfuhrabgaben = 8,55; f = 1 − 0,20 × 1,19 = 0,762; Fix = 0,357.
  test('Stufe A (Ziel 1,00, Boden 1,00): Roh 13,00 → 12,95 hätte Gewinn 0,96 < Boden → 13,95, Gewinn 1,7229', () => {
    const r = row6x8(planTierReprice(stele218, 1.0));
    expect(r.newSell).toBe(13.95);
    expect(r.newProfit).toBeCloseTo(1.7229, 4);
    expect(12.95 * 0.762 - 0.357 - 8.55).toBeCloseTo(0.9609, 4); // Beweis: 12,95 € würde den Boden 1,00 verletzen
  });

  test('Stufe B (Ziel 1,50, Boden 1,20): 13,95 €, Gewinn 1,7229 ≥ 1,20', () => {
    const r = row6x8(planTierReprice(stele218, 1.5));
    expect(r.newSell).toBe(13.95);
    expect(r.newProfit).toBeCloseTo(1.7229, 4);
    expect(r.newProfit).toBeGreaterThanOrEqual(profitFloorFor(1.5));
  });

  test('Stufe C (Ziel 2,00, Boden 1,30): 13,95 €, Gewinn 1,7229 ≥ 1,30 (gelb: unter Ziel, über Boden)', () => {
    const r = row6x8(planTierReprice(stele218, 2.0));
    expect(r.newSell).toBe(13.95);
    expect(r.newProfit).toBeGreaterThanOrEqual(profitFloorFor(2.0));
    expect(evaluateTargetDisplay(2.0, r.newProfit).level).toBe('yellow');
  });

  test('Stufe D (Ziel 3,00, Boden 1,50): Roh 15,626 → 14,95 €, Gewinn 2,4849 (14,95 × 0,762 − 0,357 − 8,55)', () => {
    const r = row6x8(planTierReprice(stele218, 3.0));
    expect(r.newSell).toBe(14.95);
    expect(r.newProfit).toBeCloseTo(2.4849, 4);
  });

  test('alter VK 14,95 €: echter Gewinn nach Formel v2 = 2,4849 € (die alte Anzeige rechnete +8,22 € — 13 % statt 15 %, 0,45 statt 0,30, ohne Versand und Einfuhr)', () => {
    const r = row6x8(planTierReprice(stele218, 1.5));
    expect(r.oldSell).toBe(14.95);
    expect(r.oldProfit).toBeCloseTo(2.4849, 4);
    const oldDisplay = 14.95 - 14.95 * (13 + 5) / 100 * 1.19 - 0.45 * 1.19 - 2.99; // die frühere Inline-Formel aus produkte.tsx
    expect(oldDisplay).toBeCloseTo(8.2222, 4);
  });
});

describe('Stufenwechsel zieht ALLE Varianten mit', () => {
  const plan = planTierReprice(stele218, 1.5);

  test('18 Varianten im Plan, alle bekommen einen neuen VK, alle 18 weichen vom alten ebayPrice ab', () => {
    expect(plan.isVariant).toBe(true);
    expect(plan.rows).toHaveLength(18);
    expect(plan.changedCount).toBe(18);
  });

  test('jeder neue VK endet auf ,95 und liegt mit dem Gewinn nie unter dem Boden der Stufe B (1,20 €)', () => {
    for (const r of plan.rows) {
      expect(Math.round(r.newSell * 100) % 100).toBe(95);
      expect(r.newProfit).toBeGreaterThanOrEqual(profitFloorFor(1.5) - 1e-9);
    }
  });

  test('Übernahme schreibt NUR variant_sell_prices (18 Einträge), kein sellPrice/ebayPrice', () => {
    const patch = storePatchForPlan(stele218, plan);
    expect(Object.keys(patch)).toEqual(['variantSellPrices']);
    expect(Object.keys(JSON.parse(patch.variantSellPrices!))).toHaveLength(18);
    expect(JSON.parse(patch.variantSellPrices!)[SKU_6X8]).toBe(13.95);
  });

  test('nach der Übernahme zeigt die Gewinn-Spalte (productProfitRows) exakt den Plan-Gewinn — dieselbe Funktion wie "Erwartet"', () => {
    const stored = { ...stele218, variantSellPrices: storePatchForPlan(stele218, plan).variantSellPrices! };
    const rows = productProfitRows(stored).rows;
    expect(rows).toHaveLength(18);
    rows.forEach((r, i) => {
      expect(r.sellPrice).toBe(plan.rows[i].newSell);
      expect(r.profit).toBeCloseTo(plan.rows[i].newProfit, 9);
    });
    // variant_sell_prices hat Vorrang vor dem alten ebayPrice (Teil-3-Regel):
    expect(rows.find(r => r.skuId === SKU_6X8)!.sellPrice).toBe(13.95);
  });

  test('zweiter Plan über denselben Stand ändert nichts mehr (idempotent): changedCount 0', () => {
    const stored = { ...stele218, variantSellPrices: storePatchForPlan(stele218, plan).variantSellPrices! };
    expect(planTierReprice(stored, 1.5).changedCount).toBe(0);
  });

  test('Einzelartikel: ein Plan-Eintrag, Übernahme schreibt sellPrice (Ware 3,15 China, Stufe C → 13,95 €)', () => {
    const single: RepriceProduct = { id: 5, variants: '[]', buyPrice: 3.15, sellPrice: 11.95, shipsFrom: 'China', adRate: 5, variantPrices: null };
    const p = planTierReprice(single, 2.0);
    expect(p.isVariant).toBe(false);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].newSell).toBe(13.95);
    expect(p.rows[0].oldSell).toBe(11.95);
    expect(p.rows[0].oldProfit).toBeCloseTo(0.0389, 4);
    expect(storePatchForPlan(single, p)).toEqual({ sellPrice: 13.95 });
  });

  test('Zeilen ohne Einkaufspreis fehlen im Plan (nichts geraten); ganz ohne EK → leerer Plan, leerer Patch', () => {
    const leer: RepriceProduct = { id: 6, variants: '[]', buyPrice: null, sellPrice: null, adRate: 5, variantPrices: null };
    const p = planTierReprice(leer, 2.0);
    expect(p.rows).toEqual([]);
    expect(storePatchForPlan(leer, p)).toEqual({});
  });
});

describe('parseTierRepriceBody / decideTierRepriceAction — kein eBay-Zugriff ohne ausdrückliches Senden', () => {
  const ok = { productIds: [1, 2], targetMarginEur: 1.5, mode: 'preview' };

  test('gültige Vorschau; kanonischer Stufenwert; Dubletten zusammengefasst', () => {
    expect(parseTierRepriceBody({ ...ok, productIds: [1, 1, 2], targetMarginEur: 1.504 })).toEqual({
      ok: true, productIds: [1, 2], targetMarginEur: 1.5, mode: 'preview', confirm: false, sendToEbay: false,
    });
  });

  test.each([[4.5], [2.5], [0], ['2'], [undefined]])('ungültige Stufe %p wird abgelehnt (4,50 nicht wählbar)', (t) => {
    expect(parseTierRepriceBody({ ...ok, targetMarginEur: t }).ok).toBe(false);
  });

  test(`Obergrenze ${TIER_REPRICE_MAX_PRODUCTS} Produkte je Aufruf: ${TIER_REPRICE_MAX_PRODUCTS} gehen, ${TIER_REPRICE_MAX_PRODUCTS + 1} nicht`, () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    expect(parseTierRepriceBody({ ...ok, productIds: ids(TIER_REPRICE_MAX_PRODUCTS) }).ok).toBe(true);
    expect(parseTierRepriceBody({ ...ok, productIds: ids(TIER_REPRICE_MAX_PRODUCTS + 1) }).ok).toBe(false);
  });

  test('mode fehlt/unbekannt, IDs ungültig, sendToEbay kein Boolean → abgelehnt', () => {
    expect(parseTierRepriceBody({ ...ok, mode: undefined }).ok).toBe(false);
    expect(parseTierRepriceBody({ ...ok, mode: 'send' }).ok).toBe(false);
    for (const ids of [[], 'x', [0], [1.5], ['1']]) expect(parseTierRepriceBody({ ...ok, productIds: ids }).ok).toBe(false);
    expect(parseTierRepriceBody({ ...ok, mode: 'apply', confirm: true, sendToEbay: 'ja' }).ok).toBe(false);
  });

  test('apply ohne confirm:true (fehlt, false, "true") wird abgelehnt', () => {
    expect(parseTierRepriceBody({ ...ok, mode: 'apply' }).ok).toBe(false);
    expect(parseTierRepriceBody({ ...ok, mode: 'apply', confirm: false }).ok).toBe(false);
    expect(parseTierRepriceBody({ ...ok, mode: 'apply', confirm: 'true' }).ok).toBe(false);
    expect(parseTierRepriceBody({ ...ok, mode: 'apply', confirm: true }).ok).toBe(true);
  });

  test('Entscheidung: Vorschau berührt nie etwas; nicht live → nur speichern; live nur mit confirm UND sendToEbay → senden', () => {
    expect(decideTierRepriceAction({ mode: 'preview', confirm: false, sendToEbay: false, isLive: true })).toEqual({ action: 'preview' });
    expect(decideTierRepriceAction({ mode: 'preview', confirm: true, sendToEbay: true, isLive: true })).toEqual({ action: 'preview' });
    expect(decideTierRepriceAction({ mode: 'apply', confirm: true, sendToEbay: false, isLive: false })).toEqual({ action: 'store_only' });
    // W3: wer senden will, aber ein laut App nicht live gelistetes Produkt trifft, bekommt KEINE stille Nur-App-Speicherung
    expect(decideTierRepriceAction({ mode: 'apply', confirm: true, sendToEbay: true, isLive: false }).action).toBe('rejected');
    expect(decideTierRepriceAction({ mode: 'apply', confirm: true, sendToEbay: false, isLive: true }).action).toBe('rejected');
    expect(decideTierRepriceAction({ mode: 'apply', confirm: false, sendToEbay: true, isLive: true }).action).toBe('rejected');
    expect(decideTierRepriceAction({ mode: 'apply', confirm: true, sendToEbay: true, isLive: true })).toEqual({ action: 'store_and_send' });
  });
});

// f) Grep-Nachweis als Test: die alte Inline-Formel (13 % + 0,45 €) darf im Web-Code nicht zurückkehren.
describe('keine alte Gewinn-/Preisformel-Kopie im Web-Code (13 % / 0,45 €)', () => {
  const files = ['src/web/pages/produkte.tsx', 'src/web/pages/lieferanten.tsx', 'src/web/pages/index.tsx', 'src/web/pages/listings.tsx', 'src/web/components/target-badge.tsx'];
  test.each(files)('%s enthält weder "(13+" noch "0.45*1.19" noch "(13 +"', (f) => {
    const src = readFileSync(resolve(import.meta.dir, '../../', f), 'utf8');
    expect(src).not.toMatch(/\(13\s*\+/);
    expect(src).not.toMatch(/0\.45\s*\*\s*1\.19/);
  });
});

// c) "Bei eBay listen": Listing-Preise (Einzelartikel und je Variante) nutzen dieselbe v2-Rechnung wie der Stufenwechsel — nie die
// alten Rundungsmodi. (index.ts calcSellPriceForListing und ebay.ts-Fallback rufen computeMinSellPrice mit 'floor95' und dem
// targetMarginEur des Produkts auf; ein Rückfall auf 'nearest95'/'up95' würde hier auffallen.)
describe('Listing-/Preispfade rechnen mit Rundung floor95 (Formel v2), nicht mit alten Modi', () => {
  test.each(['src/api/index.ts', 'src/api/ebay.ts', 'src/api/price-monitor.ts'])('%s enthält kein rounding: nearest95/up95', (f) => {
    const src = readFileSync(resolve(import.meta.dir, '../../', f), 'utf8');
    expect(src).not.toMatch(/rounding:\s*'(nearest95|up95)'/);
    expect(src).toMatch(/rounding:\s*'floor95'/);
  });
});

// W5: bestätigte Preise (expected) — gesendet wird nur, was in der Vorschau bestätigt wurde.
describe('expected-Preise (Plan darf sich seit der Vorschau nicht geändert haben)', () => {
  const plan = planTierReprice(stele218, 1.5);

  test('expectedFromPlan → compareExpected passt (null)', () => {
    expect(compareExpected(plan, expectedFromPlan(plan))).toBeNull();
  });

  test('ohne expected keine Prüfung; geänderter Preis, fehlende und überzählige Variante werden erkannt', () => {
    expect(compareExpected(plan, undefined)).toBeNull();
    const e = expectedFromPlan(plan);
    expect(compareExpected(plan, { ...e, [SKU_6X8]: 12.95 })).toContain('seit der Vorschau geändert');
    const rest = { ...e };
    delete rest[SKU_6X8];
    expect(compareExpected(plan, rest)).toContain('seit der Vorschau geändert');
    expect(compareExpected(plan, { ...e, unbekannt: 9.95 })).toContain('seit der Vorschau geändert');
  });

  test('Einkaufspreis ändert sich nach der Vorschau (2,99 → 3,59): derselbe bestätigte Plan passt nicht mehr', () => {
    const confirmed = expectedFromPlan(plan);
    const drifted = planTierReprice({ ...stele218, variantPrices: stele218.variantPrices!.replace('"price":2.99', '"price":3.59') }, 1.5);
    expect(compareExpected(drifted, confirmed)).not.toBeNull();
  });

  test('parseTierRepriceBody: expected muss { productId: { sku: Zahl } } sein', () => {
    const base = { productIds: [1], targetMarginEur: 1.5, mode: 'apply', confirm: true, sendToEbay: true };
    expect(parseTierRepriceBody({ ...base, expected: { '1': { a: 13.95 } } }).ok).toBe(true);
    for (const bad of ['x', [], { '1': 5 }, { '1': { a: '13.95' } }, { '1': { a: NaN } }, { '1': [1] }]) {
      expect(parseTierRepriceBody({ ...base, expected: bad }).ok).toBe(false);
    }
  });
});

// A-023 (c): stele-119 (echte Daten, 04.10.2026): 100pcs doppelt in variantPrices (EK 3,15 / 3,45), Stufe B (1,50), China, Anzeige 5 %.
// Handrechnung 100pcs bei EK 3,45: K = 3,45 + 1,99 + 3,57 = 9,01; f = 1 − 0,20 × 1,19 = 0,762; roh = (9,01 + 1,50 + 0,357)/0,762 = 14,26 → ,95 darunter 13,95,
// Gewinn 13,95 × 0,762 − 0,357 − 9,01 = 1,26 ≥ Boden 1,20 → 13,95. 200pcs bei EK 4,79: K = 10,35, roh = 16,02 → 15,95, Gewinn 1,45 ≥ 1,20.
describe('A-023: Dubletten im Stufenwechsel (stele-119)', () => {
  const g119 = [{ name: 'Varianten ', values: ['200pcs', '100pcs'] }];
  const p119: RepriceProduct = {
    id: 119, buyPrice: 3.15, sellPrice: 14.95, shipsFrom: 'China', adRate: 5, variantSellPrices: null,
    variantPrices: JSON.stringify([
      { skuId: '12000050569622128', attrs: { Color: '200pcs', 'Ships From': 'China Mainland' }, price: 4.79, stock: 1965 },
      { skuId: '12000050569622130', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' }, price: 3.15, stock: 3 },
      { skuId: '12000050569622129', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' }, price: 3.45, stock: 1998 },
    ]),
  };
  test('ohne groups (bisher): drei Zeilen, 100pcs doppelt — beim Senden mehrdeutig', () => {
    expect(planTierReprice(p119, 1.5).rows).toHaveLength(3);
  });
  test('mit groups: genau eine Zeile je eBay-Variante; 100pcs rechnet mit dem HÖCHSTEN EK 3,45 (nicht 3,15), 200pcs 15,95 / 100pcs 13,95', () => {
    const plan = planTierReprice(p119, 1.5, g119);
    expect(plan.rows.map(r => [r.skuId, r.ware, r.newSell])).toEqual([['12000050569622128', 4.79, 15.95], ['12000050569622129', 3.45, 13.95]]);
    expect(plan.rows.every(r => r.newProfit >= 1.2)).toBe(true);
  });
  test('Dublette mit hohem EK zuerst (Reihenfolge egal): Zeile trägt weiter den höchsten EK', () => {
    const rev = { ...p119, variantPrices: JSON.stringify(JSON.parse(p119.variantPrices!).reverse()) };
    expect(planTierReprice(rev, 1.5, g119).rows.find(r => r.label.includes('100pcs'))!.ware).toBe(3.45);
  });
});
