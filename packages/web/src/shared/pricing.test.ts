// Teil 2A (P-27/P-28-Preis-Fundament, 2026-09-10): Tests für die neue, einzige Kalkulations-
// Kalkulationsfunktion computeMinSellPrice(). Zweck dieser Datei ist ausschließlich der Beweis,
// dass der Refactor WERTNEUTRAL ist — jede hier hinterlegte Erwartungszahl wurde VOR dem Refactor
// mit der alten, jetzt entfernten Formel berechnet und hier als feste Fixture hinterlegt (nicht
// zur Laufzeit neu berechnet), exakt wie im Auftrag gefordert.
//
// Datenherkunft der Snapshot-Fixtures (Pflichtbestandteil #4 des Auftrags): mindestens 10 reale
// Produkte, darunter stele-98/110/141/152.
//   - stele-98 (Einkaufspreis 4,99€) und die Varianten-Einkaufspreise von stele-110 (6 Stück:
//     2,15/2,55/3,35/4,19/4,99/7,69€) und stele-141 (5 Stück: 1,79/2,25/2,99/2,99/8,19€) sind
//     ECHTE, vom Nutzer in der Teil-1-Bestandsaufnahme direkt mitgeteilte AliExpress-Preise (12
//     reale Datenpunkte in Summe) — damit ist "mindestens 10 reale Produkte" für die Haupt-
//     Formel (calcSellPrice-Fall, 'up95') erfüllt. shippingCost/adRate/shipsFrom sind für diese
//     konkreten Produkte NICHT bekannt (kein Live-DB-Zugriff aus dieser Sandbox möglich) und
//     daher mit den App-Standardwerten (versand=0, adRate=5, kein China-Versand) angenommen —
//     das ist eine bewusste, dokumentierte Vereinfachung, keine Behauptung, dass dies die
//     tatsächlich gespeicherten Werte sind.
//   - stele-152 ist NICHT enthalten: dem Chat liegt keine einzige reale Zahl für dieses Produkt
//     vor (im Gegensatz zu 98/110/141, die in Teil 1 mit konkreten Preisen belegt wurden), und
//     eine erfundene Zahl wäre keine "reale" Fixture. Falls gewünscht, kann ein Nutzer die echten
//     Werte für stele-152 nachreichen oder scripts/export-pricing-fixtures.ts (siehe unten)
//     gegen die Produktions-DB laufen lassen, um sie zu ergänzen.
//   - Drei zusätzliche, klar als SYNTHETISCH gekennzeichnete Randfälle (China-Zoll, adRate=0,
//     hoher Einkaufspreis) ergänzen die realen Fälle um Grenzwert-Abdeckung.
import { describe, expect, test } from 'bun:test';
import { computeMinSellPrice, roundUpToX95, roundToNearest95, DEFAULT_PRICING_CONFIG } from './pricing';

describe('computeMinSellPrice — "up95"-Fall (bisher calcSellPrice: MIT Sicherheitspuffer, ,95 aufwärts gerundet)', () => {
  function upstreamCase(buyPrice: number, versand: number, zoll: number, adRate: number) {
    return computeMinSellPrice({
      buyPrice, supplierShipping: versand, isChinaOrigin: zoll > 0, customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: DEFAULT_PRICING_CONFIG.targetMarginEur, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
      rounding: 'up95',
    }).minSellPrice;
  }

  test('Erfolgsbedingung (identisch zur alten calcSellPrice-Testdatei): buyPrice=10, versand=2, zoll=0, adRate=5 → 20,95€', () => {
    expect(upstreamCase(10, 2, 0, 5)).toBe(20.95);
  });

  // Regression gegen die alte, jetzt entfernte price-monitor.ts-Formel — dieselben 6 Fälle wie
  // vor dem Refactor, Erwartungswerte fest hinterlegt (nicht mehr zur Laufzeit gegenberechnet,
  // da die alte Formel entfernt wurde).
  test('unverändert gegenüber der alten price-monitor.ts-Formel (6 Fälle, feste Fixtures)', () => {
    const cases: Array<[number, number, number, number, number]> = [
      [10, 2, 0, 5, 20.95],
      [4.79, 0, 0, 5, 11.95],
      [25.5, 3.2, 4.0, 8, 49.95],
      [12.95, 1.1, 0, 2, 22.95],
      [8.0, 0, 4.0, 10, 22.95],
      [100, 5, 0, 0, 129.95],
    ];
    for (const [buyPrice, versand, zoll, adRate, expected] of cases) {
      expect(upstreamCase(buyPrice, versand, zoll, adRate)).toBe(expected);
    }
  });

  // ── Snapshot-Fixtures: reale Produkte (Pflichtbestandteil #4) ────────────────────────────
  // "Vorher"-Werte wurden mit der alten calcSellPrice()-Implementierung VOR dem Refactor
  // berechnet und hier als Literal hinterlegt — dieser Test berechnet NICHTS neu gegen eine
  // Referenzformel, er prüft nur, dass computeMinSellPrice() exakt diese festen Zahlen liefert.
  test('stele-98 — reale AliExpress-Einkaufspreis 4,99€ (versand/adRate: App-Standardwerte, unbekannt)', () => {
    expect(upstreamCase(4.99, 0, 0, 5)).toBe(11.95);
  });

  test('stele-110 — 6 reale Varianten-Einkaufspreise', () => {
    const realBuyPrices: Array<[number, number]> = [
      [2.15, 7.95], [2.55, 8.95], [3.35, 9.95], [4.19, 10.95], [4.99, 11.95], [7.69, 14.95],
    ];
    for (const [buyPrice, expected] of realBuyPrices) {
      expect(upstreamCase(buyPrice, 0, 0, 5)).toBe(expected);
    }
  });

  test('stele-141 — 5 reale Varianten-Einkaufspreise', () => {
    const realBuyPrices: Array<[number, number]> = [
      [1.79, 7.95], [2.25, 8.95], [2.99, 8.95], [2.99, 8.95], [8.19, 15.95],
    ];
    for (const [buyPrice, expected] of realBuyPrices) {
      expect(upstreamCase(buyPrice, 0, 0, 5)).toBe(expected);
    }
  });

  // stele-152: bewusst NICHT enthalten — siehe Erklärung im Datei-Header. Kein erfundener Wert.

  test('synthetische Randfälle (klar gekennzeichnet, keine Live-Daten): China-Zoll, adRate=0, hoher Einkaufspreis', () => {
    expect(upstreamCase(6.50, 2.20, 4.00, 5)).toBe(21.95);   // China-Versand + Zollpauschale
    expect(upstreamCase(15.00, 0, 0, 0)).toBe(22.95);         // adRate 0 (Randfall)
    expect(upstreamCase(42.00, 3.50, 0, 8)).toBe(66.95);      // hoher Einkaufspreis + hoher adRate
  });
});

describe('computeMinSellPrice — "cent"-Fall (bisher calcImportPriceSuggestion: OHNE Sicherheitspuffer, Cent-Rundung)', () => {
  function importSuggestionCase(buyPrice: number, versand: number, zoll: number, adRate: number, minGewinn: number) {
    return computeMinSellPrice({
      buyPrice, supplierShipping: versand, isChinaOrigin: zoll > 0, customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: minGewinn, safetyBufferEur: 0,
      rounding: 'cent',
    }).minSellPrice;
  }

  test('Erfolgsbedingung (identisch zur alten calcImportPriceSuggestion-Testdatei): buyPrice=10, versand=2, zoll=0, adRate=5, minGewinn=2 → 18,50€', () => {
    expect(importSuggestionCase(10, 2, 0, 5, 2.00)).toBe(18.50);
  });

  // Regression gegen die alte, jetzt entfernte lieferanten.tsx-Formel-Kopie — bytegleiches
  // Ergebnis für alle 6 Fälle (feste Fixtures, alte Formel entfernt).
  test('bytegleich zur alten lieferanten.tsx-Formel (6 Fälle, feste Fixtures)', () => {
    const cases: Array<[number, number, number, number, number, number]> = [
      [10, 2, 0, 5, 2.00, 18.50],
      [4.79, 0, 0, 5, 2.00, 9.33],
      [25.5, 3.2, 4.0, 8, 2.00, 46.98],
      [12.95, 1.1, 0, 2, 3.00, 21.41],
      [8.0, 0, 4.0, 10, 4.00, 22.77],
      [100, 5, 0, 0, 2.00, 127.22],
    ];
    for (const [buyPrice, versand, zoll, adRate, minGewinn, expected] of cases) {
      expect(importSuggestionCase(buyPrice, versand, zoll, adRate, minGewinn)).toBe(expected);
    }
  });

  test('reale stele-98/110-Einkaufspreise, cent-gerundet (minGewinn=2)', () => {
    expect(importSuggestionCase(4.99, 0, 0, 5, 2.00)).toBe(9.58);   // stele-98
    expect(importSuggestionCase(2.15, 0, 0, 5, 2.00)).toBe(5.97);   // stele-110-v1
    expect(importSuggestionCase(2.55, 0, 0, 5, 2.00)).toBe(6.48);   // stele-110-v2
  });
});

describe('computeMinSellPrice — "nearest95"-Fall (bisher lieferanten.tsx recommendedFor(): OHNE Puffer, zur nächsten ,95-Marke)', () => {
  function variantTableCase(buyPrice: number, versand: number, zoll: number, adRate: number, minGewinn: number) {
    return computeMinSellPrice({
      buyPrice, supplierShipping: versand, isChinaOrigin: zoll > 0, customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: minGewinn, safetyBufferEur: 0,
      rounding: 'nearest95',
    }).minSellPrice;
  }

  // Fixtures: raw-Wert vor dem Refactor mit der alten Formel berechnet, roundToNearest95()
  // manuell angewendet (siehe Auftrag: "Vorher-Werte als feste Fixtures ablegen").
  test('reale stele-98/110-Einkaufspreise, zur nächsten ,95-Marke gerundet (minGewinn=2, adRate=5)', () => {
    expect(variantTableCase(4.99, 0, 0, 5, 2.00)).toBe(9.95);   // stele-98, raw≈9.5769
    expect(variantTableCase(2.15, 0, 0, 5, 2.00)).toBe(5.95);   // stele-110-v1, raw≈5.9627
    expect(variantTableCase(2.55, 0, 0, 5, 2.00)).toBe(6.95);   // stele-110-v2, raw≈6.4717
    expect(variantTableCase(3.35, 0, 0, 5, 2.00)).toBe(7.95);   // stele-110-v3, raw≈7.4898
    expect(variantTableCase(4.19, 0, 0, 5, 2.00)).toBe(8.95);   // stele-110-v4, raw≈8.5588
  });

  test('roundToNearest95 rundet nachweislich auch ABWÄRTS (Unterschied zu roundUpToX95) — genau der Punkt, der den eigenen Rundungsmodus rechtfertigt', () => {
    // raw=7.4898 liegt näher an 7.95 als an 8.95 → rundet AB auf 7.95, obwohl roundUpToX95 auf
    // 8.95 aufrunden würde. Direkter Beweis am Beispiel stele-110-v3.
    expect(roundToNearest95(7.4898)).toBe(7.95);
    expect(roundUpToX95(7.4898)).toBe(7.95); // Zufällig identisch in diesem Fall (7.4898 liegt bereits > 6.95+1)
    // Eindeutigerer Beweis: ein Wert knapp über einer ,95-Marke
    expect(roundToNearest95(8.05)).toBe(7.95); // am nächsten an 7,95
    expect(roundUpToX95(8.05)).toBe(8.95);      // rundet garantiert AUF
  });
});

describe('computeMinSellPrice — "none"-Fall (Preise-Tab-Verhandlungsrechner & Produkte-Tab-Badge: nur Gebührensätze, kein Mindestpreis)', () => {
  test('Preise-Tab: 17%-Eingabewert (Default) + Anzeigegebühr, gegen die alte index.tsx-Inline-Formel', () => {
    const anzeigegebuehrProzent = 0.05; // 5% Anzeigentarif, wie im UI-Feld eingegeben
    const result = computeMinSellPrice({
      buyPrice: 0, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: 17, ebayFixedFeeEur: 0.45, vatFactor: 1.19,
      adRatePercent: anzeigegebuehrProzent * 100, targetMarginEur: 0, safetyBufferEur: 0, rounding: 'none',
    });
    // Alte Formel: EBAY_FEE = 0.17*1.19; GESAMT_FEE = (0.17+0.05)*1.19; FIXBETRAG = 0.45*1.19
    expect(result.baseFeeRateGross).toBeCloseTo(0.17 * 1.19, 10);
    expect(result.totalFeeRateGross).toBeCloseTo((0.17 + 0.05) * 1.19, 10);
    expect(result.fixedFeeGross).toBeCloseTo(0.45 * 1.19, 10);
  });

  test('Preise-Tab: 18%-Fallback (leeres Eingabefeld)', () => {
    const result = computeMinSellPrice({
      buyPrice: 0, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: 18, ebayFixedFeeEur: 0.45, vatFactor: 1.19,
      adRatePercent: 0, targetMarginEur: 0, safetyBufferEur: 0, rounding: 'none',
    });
    expect(result.baseFeeRateGross).toBeCloseTo(0.18 * 1.19, 10);
  });

  test('Produkte-Tab-Badge: fest 18%, kein Anzeigentarif — gegen die alte Inline-Formel', () => {
    const result = computeMinSellPrice({
      buyPrice: 0, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: 18, ebayFixedFeeEur: 0.45, vatFactor: 1.19,
      adRatePercent: 0, targetMarginEur: 0, safetyBufferEur: 0, rounding: 'none',
    });
    const sell = 24.95;
    const oldFormulaFee = sell * (0.18 * 1.19) + (0.45 * 1.19);
    const newFormulaFee = sell * result.baseFeeRateGross + result.fixedFeeGross;
    expect(newFormulaFee).toBe(oldFormulaFee);
  });
});

describe('computeMinSellPrice — Regressionsschutz: falsche Rundung würde erkannt', () => {
  // Beweist, dass die Rundungs-Tests echt etwas prüfen: 'up95' und 'nearest95' liefern für
  // denselben Rohwert unterschiedliche Ergebnisse, wenn der Rohwert nicht schon exakt auf ,95
  // liegt — ein vertauschter rounding-Parameter würde also einen der obigen Tests brechen.
  test('"up95" und "nearest95" liefern für denselben Rohwert unterschiedliche Preise', () => {
    // buyPrice=3.80 ergibt einen Rohwert von ≈8,0625 — knapp über der 7,95-Marke, also näher an
    // 7,95 als an 8,95: 'nearest95' rundet AB auf 7,95, 'up95' garantiert AUF auf 8,95.
    const base = { buyPrice: 3.80, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: 13, ebayFixedFeeEur: 0.45, vatFactor: 1.19, adRatePercent: 5,
      targetMarginEur: 2.00, safetyBufferEur: 0 };
    const up = computeMinSellPrice({ ...base, rounding: 'up95' }).minSellPrice;
    const nearest = computeMinSellPrice({ ...base, rounding: 'nearest95' }).minSellPrice;
    expect(up).toBe(8.95);
    expect(nearest).toBe(7.95);
    expect(up).not.toBe(nearest);
  });
});

describe('roundUpToX95 / roundToNearest95 — reine Rundungsfunktionen', () => {
  test('roundUpToX95 rundet immer aufwärts, nie ab', () => {
    expect(roundUpToX95(10.00)).toBe(10.95);
    expect(roundUpToX95(10.94)).toBe(10.95);
    expect(roundUpToX95(10.96)).toBe(11.95);
    expect(roundUpToX95(10.95)).toBe(10.95);
  });

  test('roundToNearest95 rundet zur nächstgelegenen ,95-Marke, auch abwärts', () => {
    expect(roundToNearest95(10.00)).toBe(9.95);
    expect(roundToNearest95(10.50)).toBe(10.95);
    expect(roundToNearest95(10.95)).toBe(10.95);
  });
});
