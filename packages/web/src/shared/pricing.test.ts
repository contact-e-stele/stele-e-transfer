// Teil 2A+2B (P-27/P-28-Preis-Fundament, 2026-09-10): Tests für die einzige Kalkulationsfunktion
// computeMinSellPrice(). Teil 2A bewies WERTNEUTRALITÄT des reinen Struktur-Refactors (alte 13%/
// 0,45€-Annahme unverändert). Teil 2B korrigiert DEFAULT_PRICING_CONFIG auf die real gemessenen
// Werte (15% + 0,30€, aus 13 realen Bestellungen ermittelt) — die Fixture-Erwartungszahlen in
// diesem Test wurden darum NEU mit der korrigierten Formel berechnet (nicht mehr mit 13%/0,45€)
// und als feste Literale hinterlegt, exakt wie im Auftrag gefordert ("Vorher-Werte als feste
// Fixtures ablegen, nicht frisch berechnen" — hier sind es die "Nachher"-Werte nach Teil 2B).
//
// Datenherkunft der Snapshot-Fixtures: mindestens 10 reale Produkte, darunter stele-98/110/141
// (12 reale Einkaufspreis-Datenpunkte in Summe, vom Nutzer in Teil 1 direkt mitgeteilt).
// shippingCost/adRate/shipsFrom für diese konkreten Produkte sind ohne Live-DB-Zugriff nicht
// bekannt und mit den App-Standardwerten angenommen (versand=0, adRate=5, kein China-Versand) —
// bewusst dokumentierte Vereinfachung, keine Behauptung realer Feldwerte. stele-152 bleibt NICHT
// enthalten (keine reale Zahl dafür im Chat verfügbar, siehe Teil-2A-Testdatei-Historie).
import { describe, expect, test } from 'bun:test';
import { computeMinSellPrice, roundUpToX95, roundToNearest95, DEFAULT_PRICING_CONFIG, AUTO_PRICE_WRITE_ENABLED } from './pricing';

describe('DEFAULT_PRICING_CONFIG — Teil 2B: real gemessene Werte', () => {
  test('Gebührensatz, Fixbetrag und MwSt-Faktor entsprechen den in 13 realen Bestellungen gemessenen Werten', () => {
    expect(DEFAULT_PRICING_CONFIG.ebayFeeRatePercent).toBe(15);
    expect(DEFAULT_PRICING_CONFIG.ebayFixedFeeEur).toBe(0.30);
    expect(DEFAULT_PRICING_CONFIG.vatFactor).toBe(1.19);
  });

  // SICHERHEITSKRITISCH (Pflichtbestandteil der strikten Grenzen): solange die neue Formel nicht
  // manuell freigegeben ist, darf kein automatischer Pfad einen damit berechneten Preis schreiben.
  test('AUTO_PRICE_WRITE_ENABLED ist standardmäßig false (automatische Schreibpfade bleiben stillgelegt)', () => {
    expect(AUTO_PRICE_WRITE_ENABLED).toBe(false);
  });
});

describe('computeMinSellPrice — "up95"-Fall (price-monitor.ts/index.ts: MIT Sicherheitspuffer, ,95 aufwärts gerundet)', () => {
  function upstreamCase(buyPrice: number, versand: number, zoll: number, adRate: number) {
    return computeMinSellPrice({
      buyPrice, supplierShipping: versand, isChinaOrigin: zoll > 0, customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: DEFAULT_PRICING_CONFIG.targetMarginEur, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
      rounding: 'up95',
    }).minSellPrice;
  }

  test('Erfolgsbedingung: buyPrice=10, versand=2, zoll=0, adRate=5 → 20,95€ (bei 15%/0,30€ zufällig identisch zum alten 13%/0,45€-Ergebnis)', () => {
    expect(upstreamCase(10, 2, 0, 5)).toBe(20.95);
  });

  // 6 Fälle, neu berechnet mit 15%/0,30€ (vorher, mit 13%/0,45€: 11.95/49.95→jetzt50.95/22.95/22.95/129.95→jetzt132.95 —
  // zwei der sechs Fälle bleiben nach ,95-Rundung zufällig gleich, vier ändern sich sichtbar).
  test('mit den real gemessenen Gebühren-Konstanten (15%/0,30€) neu berechnet', () => {
    const cases: Array<[number, number, number, number, number]> = [
      [10, 2, 0, 5, 20.95],
      [4.79, 0, 0, 5, 11.95],
      [25.5, 3.2, 4.0, 8, 50.95],
      [12.95, 1.1, 0, 2, 22.95],
      [8.0, 0, 4.0, 10, 22.95],
      [100, 5, 0, 0, 132.95],
    ];
    for (const [buyPrice, versand, zoll, adRate, expected] of cases) {
      expect(upstreamCase(buyPrice, versand, zoll, adRate)).toBe(expected);
    }
  });

  // ── Snapshot-Fixtures: reale Produkte (Pflichtbestandteil #4 aus Teil 2A, hier mit den neuen
  // Teil-2B-Werten fortgeschrieben) ──
  test('stele-98 — realer AliExpress-Einkaufspreis 4,99€', () => {
    expect(upstreamCase(4.99, 0, 0, 5)).toBe(11.95);
  });

  test('stele-110 — 6 reale Varianten-Einkaufspreise (v6=7,69€ ändert sich ggü. Teil 2A von 14,95€ auf 15,95€)', () => {
    const realBuyPrices: Array<[number, number]> = [
      [2.15, 7.95], [2.55, 8.95], [3.35, 9.95], [4.19, 10.95], [4.99, 11.95], [7.69, 15.95],
    ];
    for (const [buyPrice, expected] of realBuyPrices) {
      expect(upstreamCase(buyPrice, 0, 0, 5)).toBe(expected);
    }
  });

  test('stele-141 — 5 reale Varianten-Einkaufspreise (v3/v4=2,99€ ändern sich ggü. Teil 2A von 8,95€ auf 9,95€)', () => {
    const realBuyPrices: Array<[number, number]> = [
      [1.79, 7.95], [2.25, 8.95], [2.99, 9.95], [2.99, 9.95], [8.19, 15.95],
    ];
    for (const [buyPrice, expected] of realBuyPrices) {
      expect(upstreamCase(buyPrice, 0, 0, 5)).toBe(expected);
    }
  });

  // stele-152: bewusst NICHT enthalten — kein realer Wert im Chat verfügbar, siehe Datei-Header.

  test('synthetische Randfälle (klar gekennzeichnet, keine Live-Daten): China-Zoll, adRate=0, hoher Einkaufspreis', () => {
    expect(upstreamCase(6.50, 2.20, 4.00, 5)).toBe(21.95);   // China-Versand + Zollpauschale (unverändert ggü. Teil 2A)
    expect(upstreamCase(15.00, 0, 0, 0)).toBe(23.95);         // adRate 0 — ändert sich ggü. Teil 2A von 22,95€
    expect(upstreamCase(42.00, 3.50, 0, 8)).toBe(68.95);      // hoher EK + hoher adRate — ändert sich ggü. Teil 2A von 66,95€
  });
});

describe('computeMinSellPrice — "cent"-Fall (lieferanten.tsx Einzelbutton: OHNE Sicherheitspuffer, Cent-Rundung)', () => {
  function importSuggestionCase(buyPrice: number, versand: number, zoll: number, adRate: number, minGewinn: number) {
    return computeMinSellPrice({
      buyPrice, supplierShipping: versand, isChinaOrigin: zoll > 0, customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: minGewinn, safetyBufferEur: 0,
      rounding: 'cent',
    }).minSellPrice;
  }

  test('Erfolgsbedingung: buyPrice=10, versand=2, zoll=0, adRate=5, minGewinn=2 → 18,85€ (ändert sich ggü. Teil 2A von 18,50€)', () => {
    expect(importSuggestionCase(10, 2, 0, 5, 2.00)).toBe(18.85);
  });

  test('mit den real gemessenen Gebühren-Konstanten (15%/0,30€) neu berechnet (6 Fälle)', () => {
    const cases: Array<[number, number, number, number, number, number]> = [
      [10, 2, 0, 5, 2.00, 18.85],
      [4.79, 0, 0, 5, 2.00, 9.38],
      [25.5, 3.2, 4.0, 8, 2.00, 48.27],
      [12.95, 1.1, 0, 2, 3.00, 21.83],
      [8.0, 0, 4.0, 10, 4.00, 23.29],
      [100, 5, 0, 0, 2.00, 130.69],
    ];
    for (const [buyPrice, versand, zoll, adRate, minGewinn, expected] of cases) {
      expect(importSuggestionCase(buyPrice, versand, zoll, adRate, minGewinn)).toBe(expected);
    }
  });

  test('reale stele-98/110-Einkaufspreise, cent-gerundet (minGewinn=2)', () => {
    expect(importSuggestionCase(4.99, 0, 0, 5, 2.00)).toBe(9.65);   // stele-98
    expect(importSuggestionCase(2.15, 0, 0, 5, 2.00)).toBe(5.92);   // stele-110-v1
    expect(importSuggestionCase(2.55, 0, 0, 5, 2.00)).toBe(6.44);   // stele-110-v2
  });
});

describe('computeMinSellPrice — "nearest95"-Fall (lieferanten.tsx Varianten-Tabelle: OHNE Puffer, zur nächsten ,95-Marke)', () => {
  function variantTableCase(buyPrice: number, versand: number, zoll: number, adRate: number, minGewinn: number) {
    return computeMinSellPrice({
      buyPrice, supplierShipping: versand, isChinaOrigin: zoll > 0, customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: minGewinn, safetyBufferEur: 0,
      rounding: 'nearest95',
    }).minSellPrice;
  }

  test('reale stele-98/110-Einkaufspreise, zur nächsten ,95-Marke gerundet (minGewinn=2, adRate=5)', () => {
    expect(variantTableCase(4.99, 0, 0, 5, 2.00)).toBe(9.95);   // stele-98
    expect(variantTableCase(2.15, 0, 0, 5, 2.00)).toBe(5.95);   // stele-110-v1
    // stele-110-v2 rundet mit den neuen Werten AB auf 5,95€ (vorher, mit 13%/0,45€: 6,95€) —
    // genau das Rundungsverhalten, das roundToNearest95() von roundUpToX95() unterscheidet.
    expect(variantTableCase(2.55, 0, 0, 5, 2.00)).toBe(5.95);   // stele-110-v2
    expect(variantTableCase(3.35, 0, 0, 5, 2.00)).toBe(7.95);   // stele-110-v3
    expect(variantTableCase(4.19, 0, 0, 5, 2.00)).toBe(8.95);   // stele-110-v4
  });

  test('roundToNearest95 rundet nachweislich auch ABWÄRTS (Unterschied zu roundUpToX95)', () => {
    expect(roundToNearest95(8.05)).toBe(7.95); // am nächsten an 7,95
    expect(roundUpToX95(8.05)).toBe(8.95);      // rundet garantiert AUF
  });
});

describe('computeMinSellPrice — "none"-Fall (Preise-Tab-Verhandlungsrechner & Produkte-Tab-Badge: nur Gebührensätze, kein Mindestpreis)', () => {
  // Diese Tests bleiben gegenüber Teil 2A UNVERÄNDERT: der Preise-Tab-Rechner übergibt weiterhin
  // seinen eigenen, frei editierbaren Gebührensatz (Default jetzt 15%, s. index.tsx) statt
  // DEFAULT_PRICING_CONFIG direkt — die reine Rechenfunktion selbst wurde nicht verändert.
  test('Preise-Tab: 15%-Default (ehem. 17%) + Anzeigegebühr aus adRate', () => {
    const adRatePercent = 5; // jetzt aus dem adRate-Feld eines ausgewählten Produkts, nicht mehr manuell getippt
    const result = computeMinSellPrice({
      buyPrice: 0, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: 15, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: 1.19,
      adRatePercent, targetMarginEur: 0, safetyBufferEur: 0, rounding: 'none',
    });
    expect(result.baseFeeRateGross).toBeCloseTo(0.15 * 1.19, 10);
    expect(result.totalFeeRateGross).toBeCloseTo((0.15 + 0.05) * 1.19, 10);
    expect(result.fixedFeeGross).toBeCloseTo(0.30 * 1.19, 10);
  });

  test('Preise-Tab: Fallback bei leerem Eingabefeld ist jetzt ebenfalls 15% (vorher 18%)', () => {
    const result = computeMinSellPrice({
      buyPrice: 0, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: 1.19,
      adRatePercent: 0, targetMarginEur: 0, safetyBufferEur: 0, rounding: 'none',
    });
    expect(result.baseFeeRateGross).toBeCloseTo(0.15 * 1.19, 10);
  });

  test('Produkte-Tab-Badge: eigenes 18%-Literal entfernt, nutzt jetzt DEFAULT_PRICING_CONFIG (15%/0,30€)', () => {
    const result = computeMinSellPrice({
      buyPrice: 0, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: 1.19,
      adRatePercent: 0, targetMarginEur: 0, safetyBufferEur: 0, rounding: 'none',
    });
    const sell = 24.95;
    const newFormulaFee = sell * result.baseFeeRateGross + result.fixedFeeGross;
    const oldLiteralFee = sell * (0.18 * 1.19) + (0.45 * 1.19); // Teil-1/2A-Zustand, zum Vergleich
    expect(newFormulaFee).not.toBe(oldLiteralFee); // beweist: die Korrektur wirkt sich sichtbar aus
    expect(newFormulaFee).toBeCloseTo(sell * (0.15 * 1.19) + (0.30 * 1.19), 10);
  });
});

describe('computeMinSellPrice — Regressionsschutz: falsche Rundung würde erkannt', () => {
  test('"up95" und "nearest95" liefern für denselben Rohwert unterschiedliche Preise', () => {
    // buyPrice=3.80 ergibt mit den neuen Konstanten (15%/0,30€) einen Rohwert knapp über einer
    // ,95-Marke: 'nearest95' rundet AB, 'up95' garantiert AUF.
    const base = { buyPrice: 3.80, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: 1.19, adRatePercent: 5,
      targetMarginEur: 2.00, safetyBufferEur: 0 };
    const up = computeMinSellPrice({ ...base, rounding: 'up95' }).minSellPrice;
    const nearest = computeMinSellPrice({ ...base, rounding: 'nearest95' }).minSellPrice;
    expect(up).toBe(8.95);
    expect(nearest).toBe(7.95);
    expect(up).not.toBe(nearest);
  });
});

describe('roundUpToX95 / roundToNearest95 — reine Rundungsfunktionen (unverändert gegenüber Teil 2A)', () => {
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
