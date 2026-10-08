// K-004 (08.10.2026, Prüfauftrag Preisformel v2 des Kalkulators): die Pflicht-Testfälle des
// Auftrags in einer eigenen Datei, plus je Lücke ein Regressions-Beweis (Grundgesetz Regel 5:
// prüfen, ob die Fixture das alte Verhalten überhaupt unterscheidet).
//
// Lehr-Bestellung, auf die sich die Zahlen stützen: eBay 15-15259-56392 / AliExpress
// 3077138613237211 — Ware 3,15 + Versand 1,99 + Einfuhrabgaben 3,57 = 8,71 € (ohne Rabatt),
// eBay-Auszahlung 10,26 € → Gewinn 1,56 €; real vereinnahmt 1,61 €. Die Differenz von 0,06 € ist
// ein wechselnder AliExpress-Rabatt und wird NIE eingerechnet (Bonus, nicht planbar) — deshalb
// prüft jeder Fall die Formel gegen den gemessenen Wert mit der im Auftrag gesetzten Toleranz von
// 0,20 € je Fall.
//
// Alle Zahlen in dieser Datei sind unabhängig mit bun nachgerechnet (Grundgesetz Regel 3), nicht
// aus dem Auftrag übernommen.
import { describe, expect, test } from 'bun:test';
import {
  profitAtSellPrice, computeMinSellPrice, computeAliCosts, profitFloorFor,
  isChinaOriginForPricing, resolveShipsFrom, computeOrderProfit, DEFAULT_PRICING_CONFIG,
} from './pricing';
import { MARGIN_TIERS } from './constants';
import { computeOrderNettoErgebnis, resolveVariantEk, type OrderProductForProfit } from '../api/order-matching';

const FEES = {
  ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,
  ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
  vatFactor: DEFAULT_PRICING_CONFIG.vatFactor,
};
const ADS = 5; // beworben: Anzeigentarif 5 % (Promoted Listings)
const TOLERANZ = 0.20;

// ─── Pflicht-Teil 1: profitAtSellPrice, China, beworben 5 % ───────────────────────────────────
describe('K-004 Pflichtfälle: profitAtSellPrice (China, beworben 5 %) — Rabatte NICHT eingerechnet', () => {
  // vk · Ware · Formelwert · real gemessener Gewinn
  const faelle: Array<[number, number, number, number]> = [
    [13.95, 3.15, 1.56, 1.61],
    [14.95, 4.79, 0.68, 0.78],
    [14.95, 3.59, 1.88, 1.95],
    [13.95, 2.45, 2.26, 2.30],
    [17.95, 5.99, 1.77, 1.79],
  ];

  for (const [sellPrice, buyPrice, formel, gemessen] of faelle) {
    test(`VK ${sellPrice.toFixed(2)} € / Ware ${buyPrice.toFixed(2)} € → ${formel.toFixed(2)} € (real ${gemessen.toFixed(2)} €)`, () => {
      const p = profitAtSellPrice({ sellPrice, buyPrice, isChinaOrigin: true, ...FEES, adRatePercent: ADS });
      // Die Formel trifft den erwarteten Wert auf den Cent …
      expect(p).toBeCloseTo(formel, 2);
      // … und weicht vom real gemessenen Gewinn um höchstens 0,20 € ab (Differenz = Rabatt-Bonus).
      expect(Math.abs(p - gemessen)).toBeLessThanOrEqual(TOLERANZ);
      // Der Formelwert liegt NIE über dem real vereinnahmten Gewinn: der Rabatt ist Bonus, die
      // Rechnung darf ihn nicht vorwegnehmen.
      expect(p).toBeLessThanOrEqual(gemessen + 1e-9);
    });
  }

  test('Lehr-Bestellung 15-15259-56392: K = 3,15 + 1,99 + 3,57 = 8,71 €', () => {
    const k = computeAliCosts(3.15, true);
    expect(k.ware).toBeCloseTo(3.15, 10);
    expect(k.shipping).toBeCloseTo(1.99, 10);
    expect(k.customs).toBeCloseTo(3.57, 10);
    expect(k.totalCost).toBeCloseTo(8.71, 10);
  });
});

// ─── Pflicht-Teil 2: Stufen A–D über den gesamten Warenbereich ────────────────────────────────
//
// Auftrag: "Für Ware 1,00–15,00 in 0,05er-Schritten muss gelten: Erwartet ≥ Boden und ≤ Ziel +
// 0,76." Die 0,76 € sind der Gewinn-Zuwachs eines ganzen ,95-Schritts (1,00 € × 0,762) — mehr als
// einen Schritt über das Ziel kann 'floor95' nie hinauslaufen.
describe('K-004 Pflichtfälle: Margen-Stufen (computeMinSellPrice floor95, China, 5 %)', () => {
  const preisFuer = (ware: number, targetEur: number) => computeMinSellPrice({
    buyPrice: ware, isChinaOrigin: true, ...FEES, adRatePercent: ADS,
    targetMarginEur: targetEur, safetyBufferEur: 0, rounding: 'floor95',
  }).minSellPrice;
  const gewinnBei = (vk: number, ware: number) =>
    profitAtSellPrice({ sellPrice: vk, buyPrice: ware, isChinaOrigin: true, ...FEES, adRatePercent: ADS });

  test('Einzelfall des Auftrags: Ware 3,15 €, Stufe B → 13,95 € / Gewinn 1,56 €', () => {
    const vk = preisFuer(3.15, 1.50);
    expect(vk).toBe(13.95);
    expect(gewinnBei(vk, 3.15)).toBeCloseTo(1.56, 2);
    // Regressions-Beweis (Regel 5): die ,95-Marke darunter (12,95 €) ergäbe 0,80 € und damit
    // weniger als den Boden 1,20 € der Stufe B — die Fixture unterscheidet also, ob der
    // Boden-Nachschlag von 'floor95' überhaupt greift.
    expect(gewinnBei(12.95, 3.15)).toBeLessThan(profitFloorFor(1.50));
  });

  // Die Spannen stammen aus dem Auftrag und sind hier unabhängig nachgerechnet; der Test prüft
  // beides: die harte Invariante [Boden, Ziel + 0,76] UND dass die Spanne exakt so herauskommt.
  const spannen: Record<string, [number, number]> = {
    A: [1.00, 1.76],
    B: [1.20, 1.96],
    C: [1.30, 2.06],
    D: [2.25, 3.00],
  };

  for (const tier of MARGIN_TIERS) {
    test(`Stufe ${tier.label} (Ziel ${tier.targetEur.toFixed(2)} / Boden ${tier.floorEur.toFixed(2)}): Ware 1,00–15,00 € in 0,05er-Schritten`, () => {
      let min = Infinity;
      let max = -Infinity;
      const verstoesse: string[] = [];

      for (let ware = 1.00; ware <= 15.0001; ware = Math.round((ware + 0.05) * 100) / 100) {
        const vk = preisFuer(ware, tier.targetEur);
        const gewinn = gewinnBei(vk, ware);
        if (gewinn < tier.floorEur - 0.005) verstoesse.push(`Ware ${ware.toFixed(2)}: Gewinn ${gewinn.toFixed(2)} < Boden`);
        if (gewinn > tier.targetEur + 0.76 + 0.005) verstoesse.push(`Ware ${ware.toFixed(2)}: Gewinn ${gewinn.toFixed(2)} > Ziel + 0,76`);
        min = Math.min(min, gewinn);
        max = Math.max(max, gewinn);
      }

      expect(verstoesse).toEqual([]);
      const [sollMin, sollMax] = spannen[tier.label];
      expect(min).toBeCloseTo(sollMin, 2);
      expect(max).toBeCloseTo(sollMax, 2);
    });
  }
});

// ─── Pflicht-Teil 3: Bestellungs-Gewinn über den EK DER VERKAUFTEN VARIANTE (Lücke 1) ─────────
describe('K-004 Lücke 1: Bestellungs-Gewinn nimmt den Ali-Preis der verkauften Variante', () => {
  // Produkt 119 (echte Live-Daten, s. shared/target-margin-bulk.test.ts und den A-014-Bericht):
  // 100PCS kostet 3,15 € im Einkauf, 200PCS 4,79 €. products.buyPrice steht auf 3,15 € — das ist
  // die BILLIGSTE Variante, und genau dieser Wert wurde bisher für jede verkaufte Variante genutzt.
  const produkt119: OrderProductForProfit = {
    id: 119,
    buyPrice: 3.15,
    shipsFrom: 'China',
    adRate: 5,
    variants: '[{"name":"Menge","values":["100PCS","200PCS"]}]',
    variantPrices: JSON.stringify([
      { skuId: 'a', attrs: { Menge: '100PCS' }, price: 3.15 },
      { skuId: 'b', attrs: { Menge: '200PCS' }, price: 4.79 },
    ]),
  };
  const findProduct = () => produkt119;

  test('stele-119-200PCS löst auf den Varianten-EK 4,79 € auf, nicht auf den Produkt-EK 3,15 €', () => {
    const r = resolveVariantEk(produkt119, 'stele-119-200PCS');
    expect(r.grund).toBeNull();
    expect(r.ware).toBeCloseTo(4.79, 10);
    // Gegenprobe: die andere Variante liefert ihren eigenen, anderen EK.
    expect(resolveVariantEk(produkt119, 'stele-119-100PCS').ware).toBeCloseTo(3.15, 10);
  });

  test('Pflichtfall: SKU stele-119-200PCS, VK 14,95 € → Einkauf 10,35 €, Gewinn 0,68 €', () => {
    const r = computeOrderNettoErgebnis({
      orderTotal: 14.95,
      lineItems: [{ sku: 'stele-119-200PCS', quantity: 1 }],
      manualBuyPrice: null,
      findProduct,
    });
    expect(r.nettoQuelle).toBe('automatisch');
    expect(r.nettoEinkauf).toBeCloseTo(10.35, 10); // 4,79 + 1,99 + 3,57
    expect(r.nettoErgebnis).toBeCloseTo(0.68, 2);
    expect(r.nettoGrund).toBeNull();
  });

  // Regressions-Beweis (Grundgesetz Regel 5): mit dem Produkt-EK 3,15 € wären Einkauf 8,71 € und
  // Gewinn 2,32 € herausgekommen — 1,64 € zu viel. Die Fixture unterscheidet die beiden Verhalten
  // also eindeutig (die Varianten-EKs liegen bewusst weit auseinander).
  test('die alte Rechnung mit dem Produkt-EK ergäbe 1,64 € zu viel Gewinn', () => {
    const mitProduktEk = computeOrderProfit(14.95, computeAliCosts(3.15, true).totalCost, 5).profit;
    const mitVariantenEk = computeOrderProfit(14.95, computeAliCosts(4.79, true).totalCost, 5).profit;
    expect(mitProduktEk).toBeCloseTo(2.32, 2);
    expect(Math.round((mitProduktEk - mitVariantenEk) * 100) / 100).toBe(1.64);
  });

  // Grundgesetz Regel 4: lässt sich die SKU nicht eindeutig auflösen, wird die Lücke BENANNT —
  // es wird nicht stillschweigend auf den (zu billigen) Produkt-EK zurückgefallen.
  test('nicht auflösbare Varianten-SKU ergibt "nicht berechenbar" mit Grund, keine geratene Zahl', () => {
    const r = computeOrderNettoErgebnis({
      orderTotal: 14.95,
      lineItems: [{ sku: 'stele-119-999PCS', quantity: 1 }],
      manualBuyPrice: null,
      findProduct,
    });
    expect(r.nettoEinkauf).toBeNull();
    expect(r.nettoErgebnis).toBeNull();
    expect(r.nettoQuelle).toBeNull();
    expect(r.nettoGrund).toContain('stele-119-999PCS');
  });
});

// ─── Pflicht-Teil 4: EU-Fall (Lücke 3) ────────────────────────────────────────────────────────
describe('K-004 Lücke 3: EU-Lager — kein Versand, keine Einfuhrabgaben', () => {
  test('Pflichtfall: Ware 8,99 €, EU → Kosten 8,99 €', () => {
    const k = computeAliCosts(8.99, false);
    expect(k.shipping).toBe(0);
    expect(k.customs).toBe(0);
    expect(k.totalCost).toBeCloseTo(8.99, 10);
    // Regressions-Beweis (Regel 5): die alte Regel setzte 1,99 € Versand auch bei EU an → 10,98 €.
    expect(k.totalCost).not.toBeCloseTo(10.98, 2);
  });

  // Beleg: AliExpress-Bestellung vom 24.08. aus Polen (3076175506687211), Artikelseite
  // "Kostenloser Versand von Germany". Die Freigrenze ("Kostenloser Versand ab 10€") gilt nur
  // innerhalb von China.
  test('die 10-€-Freigrenze gilt nur für China', () => {
    expect(computeAliCosts(4.79, true).shipping).toBe(1.99);  // China, unter der Grenze
    expect(computeAliCosts(10.29, true).shipping).toBe(0);    // China, über der Grenze
    expect(computeAliCosts(4.79, false).shipping).toBe(0);    // EU, unter der Grenze
    expect(computeAliCosts(10.29, false).shipping).toBe(0);   // EU, über der Grenze
  });
});

// ─── Pflicht-Teil 5: Herkunft (Lücke 2) ───────────────────────────────────────────────────────
describe('K-004 Lücke 2: Herkunft aus dem Varianten-Attribut, unbekannt → vorsichtig China', () => {
  test('Rangfolge: Varianten-Attribut "Ships From" vor dem Produktfeld', () => {
    expect(resolveShipsFrom('China', { 'Ships From': 'Germany' })).toBe('Germany');
    expect(resolveShipsFrom(null, { 'Ships From': 'Germany' })).toBe('Germany');
    expect(resolveShipsFrom('China', {})).toBe('China');
    expect(resolveShipsFrom('China', { 'Ships From': '   ' })).toBe('China'); // leerer Wert zählt nicht
    expect(resolveShipsFrom('Versandort-Variante', { Versandort: 'Poland' })).toBe('Poland');
  });

  test('nichts bekannt → null, und null wird für die Kostenrechnung wie China behandelt', () => {
    expect(resolveShipsFrom(null, undefined)).toBeNull();
    expect(resolveShipsFrom('', {})).toBeNull();
    // Regressions-Beweis (Regel 5): genau hier lag der Fehler — die wörtliche Feld-Prüfung gibt für
    // ein leeres Feld false ("wie EU", 0 € Einfuhrabgaben), die Kostenrechnung sagt jetzt true.
    expect(isChinaOriginForPricing(null)).toBe(true);
    expect(isChinaOriginForPricing('')).toBe(true);
    expect(isChinaOriginForPricing('   ')).toBe(true);
    // Eine bekannte Herkunft wird weiterhin wörtlich gelesen.
    expect(isChinaOriginForPricing('China')).toBe(true);
    expect(isChinaOriginForPricing('China Mainland')).toBe(true);
    expect(isChinaOriginForPricing('Germany')).toBe(false);
    expect(isChinaOriginForPricing('Poland')).toBe(false);
  });

  test('Produkt 95 (Live-Fall): Produktfeld leer, Variante sagt Germany → EU, Kosten 8,99 €', () => {
    const shipsFrom = resolveShipsFrom(null, { Color: '6pcs set', 'Ships From': 'Germany' });
    expect(shipsFrom).toBe('Germany');
    const china = isChinaOriginForPricing(shipsFrom);
    expect(china).toBe(false);
    expect(computeAliCosts(8.99, china).totalCost).toBeCloseTo(8.99, 10);
    // Echter Gewinn beim heutigen VK 15,95 € — nicht die bisher angezeigten 0,8169 €.
    expect(profitAtSellPrice({ sellPrice: 15.95, buyPrice: 8.99, isChinaOrigin: china, ...FEES, adRatePercent: ADS }))
      .toBeCloseTo(2.8069, 4);
  });

  test('unbekannte Herkunft rechnet TEURER als EU — die vorsichtige Richtung', () => {
    const unbekannt = computeAliCosts(5.00, isChinaOriginForPricing(null)).totalCost;
    const eu = computeAliCosts(5.00, isChinaOriginForPricing('Germany')).totalCost;
    expect(unbekannt).toBeCloseTo(10.56, 10); // 5,00 + 1,99 + 3,57
    expect(eu).toBeCloseTo(5.00, 10);
    expect(unbekannt).toBeGreaterThan(eu);
  });
});

// ─── Pflicht-Teil 6: Anzeigentarif (Lücke 4) ──────────────────────────────────────────────────
describe('K-004 Lücke 4: Anzeigengebühr nur bei beworbenen Verkäufen', () => {
  test('adRate 0 (nicht beworben) ergibt mehr Gewinn als adRate 5 — derselbe Verkauf', () => {
    const beworben = computeOrderProfit(13.95, computeAliCosts(3.15, true).totalCost, 5).profit;
    const unbeworben = computeOrderProfit(13.95, computeAliCosts(3.15, true).totalCost, 0).profit;
    expect(beworben).toBeCloseTo(1.56, 2);
    expect(unbeworben).toBeCloseTo(2.39, 2);
    // Regressions-Beweis (Regel 5): vorher war der Satz fest 5 %, beide Aufrufe hätten 1,56 €
    // ergeben. Die Fixture unterscheidet die Verhalten also um 0,83 €.
    expect(unbeworben).toBeGreaterThan(beworben);
    expect(Math.round((unbeworben - beworben) * 100) / 100).toBe(0.83);
  });

  test('der Anzeigentarif der Bestellung kommt aus dem Produkt (0 = nicht beworben)', () => {
    const basis = {
      id: 119, buyPrice: 4.79, shipsFrom: 'China', variants: null, variantPrices: null,
    } satisfies Omit<OrderProductForProfit, 'adRate'>;
    const mit = computeOrderNettoErgebnis({
      orderTotal: 14.95, lineItems: [{ sku: 'stele-119-200PCS', quantity: 1 }], manualBuyPrice: null,
      findProduct: () => ({ ...basis, adRate: 5 }),
    });
    const ohne = computeOrderNettoErgebnis({
      orderTotal: 14.95, lineItems: [{ sku: 'stele-119-200PCS', quantity: 1 }], manualBuyPrice: null,
      findProduct: () => ({ ...basis, adRate: 0 }),
    });
    expect(mit.nettoErgebnis).toBeCloseTo(0.68, 2);
    expect(ohne.nettoErgebnis).toBeCloseTo(0.68 + 14.95 * 0.05 * 1.19, 2);
    expect(ohne.nettoErgebnis!).toBeGreaterThan(mit.nettoErgebnis!);
  });

  test('adRate null (Altbestand ohne gesetztes Feld) fällt auf den DB-Default 5 % zurück, nicht auf 0', () => {
    const r = computeOrderNettoErgebnis({
      orderTotal: 14.95, lineItems: [{ sku: 'stele-119-200PCS', quantity: 1 }], manualBuyPrice: null,
      findProduct: () => ({ id: 119, buyPrice: 4.79, shipsFrom: 'China', adRate: null, variants: null, variantPrices: null }),
    });
    expect(r.nettoErgebnis).toBeCloseTo(0.68, 2);
    expect(DEFAULT_PRICING_CONFIG.defaultAdRatePercent).toBe(5);
  });
});
