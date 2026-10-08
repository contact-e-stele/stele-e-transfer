// K-004 (Kalkulator, 08.10.2026): Pflicht-Tests aus dem Auftrag, wörtlich. Abweichung ≤ 0,20 €, Rabatte nicht eingerechnet.
// Alle Erwartungswerte mit bun nachgerechnet (Grundgesetz 3).
import { describe, expect, test } from 'bun:test';
import {
  profitAtSellPrice, computeMinSellPrice, computeAliCosts, computeOrderProfit, isChinaShipping, isChinaOriginForVariant, DEFAULT_PRICING_CONFIG as C,
} from './pricing';
import { MARGIN_TIERS } from './constants';
import { computeOrderNettoErgebnis, matchOrderVariant } from '../api/order-matching';

const fees = { ebayFeeRatePercent: C.ebayFeeRatePercent, ebayFixedFeeEur: C.ebayFixedFeeEur, vatFactor: C.vatFactor };
const profitChina5 = (sell: number, ware: number) => profitAtSellPrice({ ...fees, sellPrice: sell, buyPrice: ware, isChinaOrigin: true, adRatePercent: 5 });

describe('K-004 Pflicht-Tests profitAtSellPrice (China, Anzeige 5 %)', () => {
  const cases: Array<[number, number, number]> = [
    [13.95, 3.15, 1.56], [14.95, 4.79, 0.68], [14.95, 3.59, 1.88], [13.95, 2.45, 2.26], [17.95, 5.99, 1.77],
  ];
  for (const [sell, ware, exp] of cases) {
    test(`VK ${sell} / Ware ${ware} → ${exp}`, () => {
      expect(Math.abs(profitChina5(sell, ware) - exp)).toBeLessThanOrEqual(0.20);
      expect(profitChina5(sell, ware)).toBeCloseTo(exp, 1);
    });
  }
});

describe('K-004 Stufen floor95', () => {
  const minSell = (ware: number, target: number) => computeMinSellPrice({
    ...fees, buyPrice: ware, isChinaOrigin: true, adRatePercent: 5, targetMarginEur: target, safetyBufferEur: 0, rounding: 'floor95',
  }).minSellPrice;

  test('Ware 3,15 Stufe B → 13,95 / Gewinn 1,56', () => {
    expect(minSell(3.15, 1.5)).toBe(13.95);
    expect(profitChina5(13.95, 3.15)).toBeCloseTo(1.56, 2);
  });

  // Erwartet ≥ Boden und ≤ Ziel + 0,76 (Auftrag: A 1,00–1,76 · B 1,20–1,96 · C 1,30–2,06 · D 2,25–3,00)
  const ranges: Record<string, [number, number]> = { A: [1.00, 1.76], B: [1.20, 1.96], C: [1.30, 2.06], D: [2.25, 3.00] };
  for (const tier of MARGIN_TIERS) {
    test(`Stufe ${tier.label}: Ware 1,00–15,00 (0,05er) → Gewinn in ${ranges[tier.label].join('–')} und ≥ Boden ${tier.floorEur}`, () => {
      const [lo, hi] = ranges[tier.label];
      for (let c = 100; c <= 1500; c += 5) {
        const ware = c / 100;
        const g = profitChina5(minSell(ware, tier.targetEur), ware);
        expect(g).toBeGreaterThanOrEqual(tier.floorEur - 1e-9);
        expect(g).toBeGreaterThanOrEqual(lo - 0.005);
        expect(g).toBeLessThanOrEqual(hi + 0.005);
        // ,95-Schritt = 1 € VK = 0,762 € Gewinn → Obergrenze Ziel + 0,762 (Auftrag nennt gerundet 0,76; Stufe A erreicht 1,7609).
        expect(g).toBeLessThanOrEqual(tier.targetEur + 0.762 + 1e-9);
      }
    });
  }
});

describe('K-004 Punkt 2/3: Herkunft und EU-Kosten', () => {
  test('leere Herkunft rechnet wie China', () => {
    expect(isChinaShipping(null)).toBe(true);
    expect(isChinaShipping('')).toBe(true);
    expect(isChinaShipping('  ')).toBe(true);
    expect(isChinaShipping('CN')).toBe(true);
    expect(isChinaShipping('China Mainland')).toBe(true);
    expect(isChinaShipping('Spain')).toBe(false);
    expect(isChinaShipping('DE')).toBe(false);
  });
  test('Herkunft je Variante aus "Ships From", sonst Produkt', () => {
    expect(isChinaOriginForVariant({ 'Ships From': 'Germany' }, null)).toBe(false);
    expect(isChinaOriginForVariant({ 'Ships From': 'China' }, 'Spain')).toBe(true);
    expect(isChinaOriginForVariant({ Color: 'Red' }, 'Spain')).toBe(false);
    expect(isChinaOriginForVariant({ Color: 'Red' }, null)).toBe(true);
    expect(isChinaOriginForVariant(undefined, undefined)).toBe(true);
  });
  test('EU: Ware 8,99 → Kosten 8,99 (kein Versand, keine Einfuhr)', () => {
    expect(computeAliCosts(8.99, false).totalCost).toBeCloseTo(8.99, 10);
  });
  test('China: Versand nur unter 10 € (Belegwert 4,79 + 1,99 + 3,57 = 10,35)', () => {
    expect(computeAliCosts(4.79, true).totalCost).toBeCloseTo(10.35, 10);
    expect(computeAliCosts(10.29, true).shipping).toBe(0);
  });
});

describe('K-004 Punkt 1 + 4: Bestellungs-Gewinn je verkaufter Variante, Anzeigensatz des Produkts', () => {
  const p119 = {
    id: 119, buyPrice: 3.15, shipsFrom: 'China', adRate: 5,
    variants: [
      { skuId: 'a', attrs: { Farbe: '100pcs A' }, price: 3.19 },
      { skuId: 'b', attrs: { Farbe: '200PCS' }, price: 4.79 },
    ],
  };

  test('SKU stele-119-200PCS, VK 14,95 → Einkauf 10,35, Gewinn 0,68 (nicht Produkt-EK 3,15)', () => {
    const r = computeOrderNettoErgebnis({
      orderTotal: 14.95, lineItems: [{ sku: 'stele-119-200PCS', quantity: 1 }], manualBuyPrice: null, findProduct: () => p119,
    });
    expect(r.nettoEinkauf).toBeCloseTo(10.35, 10);
    expect(r.nettoErgebnis).toBe(0.68);
    expect(r.nettoQuelle).toBe('automatisch');
  });

  test('unbekannte Varianten-SKU → wie bisher Produkt-EK', () => {
    const r = computeOrderNettoErgebnis({
      orderTotal: 13.95, lineItems: [{ sku: 'stele-119-XYZ', quantity: 1 }], manualBuyPrice: null, findProduct: () => p119,
    });
    expect(r.nettoEinkauf).toBeCloseTo(3.15 + 1.99 + 3.57, 10);
  });

  test('Dubletten auf derselben SKU → höchster Preis (Gewinn nie zu hoch)', () => {
    const dup = { ...p119, variants: [{ attrs: { M: '100pcs' }, price: 3.19 }, { attrs: { M: '100pcs' }, price: 3.49 }] };
    expect(matchOrderVariant('stele-119-100PCS', dup)?.price).toBe(3.49);
  });

  test('Variante mit "Ships From: Spain" → EU-Kosten (nur Ware)', () => {
    const eu = { ...p119, variants: [{ attrs: { M: '200PCS', 'Ships From': 'Spain' }, price: 4.79 }] };
    const r = computeOrderNettoErgebnis({ orderTotal: 14.95, lineItems: [{ sku: 'stele-119-200PCS', quantity: 1 }], manualBuyPrice: null, findProduct: () => eu });
    expect(r.nettoEinkauf).toBeCloseTo(4.79, 10);
  });

  test('Anzeigensatz 0 (nicht beworben) senkt die Gebühren gegenüber 5 %', () => {
    const with5 = computeOrderProfit(14.95, 10.35, 5);
    const with0 = computeOrderProfit(14.95, 10.35, 0);
    expect(with5.profit).toBe(0.68);
    // 14,95 × (1 − 0,15 × 1,19) − 0,357 − 10,35 = 1,574425 → 1,57 (bun nachgerechnet)
    expect(with0.profit).toBe(1.57);
    expect(computeOrderProfit(14.95, 10.35).profit).toBe(0.68); // weggelassen → Default 5 %
  });
});

// ─── Review-Nachbesserung (Gegenprüfung PR #167) ──────────────────────────────────────────────
import { evaluatePriceAlarm } from './pricing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('K-004 Nachbesserung: unbekannte Herkunft + Scraper-Schlüssel', () => {
  test("'Unknown' (HTML-Fallback des Scrapers) zählt wie leer → China", () => {
    expect(isChinaShipping('Unknown')).toBe(true);
  });
  test("Varianten-Merkmal 'Ship From' / 'ShipFrom' wird erkannt", () => {
    expect(isChinaOriginForVariant({ 'Ship From': 'Poland' }, null)).toBe(false);
    expect(isChinaOriginForVariant({ ShipFrom: 'Spain' }, 'China')).toBe(false);
  });
  test('price-monitor: leeres Scrape-Versandland fällt auf das GESPEICHERTE zurück (nie still China bei EU-Produkt)', () => {
    const src = readFileSync(resolve(import.meta.dir, '..', 'api', 'price-monitor.ts'), 'utf-8');
    expect(src).toContain('const shipsFromEff = data.shipsFrom || product.shipsFrom;');
    expect(src).toContain('isChinaShipping(shipsFromEff)');
    expect(src).toContain('computeVariantPriceRows(freshVariantPricesJson, versand, shipsFromEff,');
    expect(src).not.toContain('data.shipsFrom ?? product.shipsFrom');
  });
  test('Preisalarm rechnet je Variante mit ihrer Herkunft (EU-Variante kein Fehlalarm durch China-Kosten)', () => {
    const base = { currentSellPrice: 15.95, ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.3, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2 };
    // Ware 8,99: EU → Gewinn 2,8069 (kein Alarm); als China → 15,95×0,762−0,357−14,55 = −2,7531 (Alarm)
    expect(evaluatePriceAlarm({ ...base, variants: [{ buyPrice: 8.99, isChinaOrigin: false }], isChinaOrigin: true }).isAlarm).toBe(false);
    expect(evaluatePriceAlarm({ ...base, variants: [{ buyPrice: 8.99 }], isChinaOrigin: true }).isAlarm).toBe(true);
  });
});

describe('K-004 Nachbesserung: Varianten-SKU wie beim Listing (Anzeigewerte, Gruppen-Reihenfolge)', () => {
  const groups = [{ name: 'Color', values: ['Rot'] }, { name: 'Size', values: ['XL', 'L'] }];
  const prod = {
    id: 5, buyPrice: 2.0, shipsFrom: 'China', adRate: 5, groups,
    variants: [
      { skuId: 's1', attrs: { Size: 'XL', Color: 'Red' }, displayValues: { Color: 'Rot', Size: 'XL' }, price: 6.5 },
      { skuId: 's2', attrs: { Size: 'L', Color: 'Red' }, displayValues: { Color: 'Rot', Size: 'L' }, price: 2.0 },
    ],
  };
  test('umbenannte Variante "Red"→"Rot" und attrs-Reihenfolge {Size, Color}: echte SKU stele-5-ROT-XL wird gefunden (EK 6,50)', () => {
    expect(matchOrderVariant('stele-5-ROT-XL', prod)?.price).toBe(6.5);
  });
  test('Bestellungs-Gewinn nutzt diesen Varianten-EK, nicht den billigsten Produkt-EK', () => {
    const r = computeOrderNettoErgebnis({ orderTotal: 19.95, lineItems: [{ sku: 'stele-5-ROT-XL', quantity: 1 }], manualBuyPrice: null, findProduct: () => prod });
    expect(r.nettoEinkauf).toBeCloseTo(6.5 + 1.99 + 3.57, 10);
  });
});
