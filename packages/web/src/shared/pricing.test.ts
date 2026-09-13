// Teil 2A+2B+2C (P-27/P-28-Preis-Fundament, 2026-09-10): Tests für die einzige Kalkulationsfunktion
// computeMinSellPrice(). Teil 2A bewies WERTNEUTRALITÄT des reinen Struktur-Refactors. Teil 2B
// korrigierte DEFAULT_PRICING_CONFIG auf die real gemessenen Werte (15% + 0,30€). Teil 2C
// ("Zielgewinn trifft exakt") entfernt den Sicherheitspuffer (safetyBufferEur jetzt fest 0, vorher
// 1,50€ zusätzlich zum Zielgewinn) und stellt alle automatischen Aufrufstellen von 'up95'
// (rundet IMMER aufwärts) auf 'nearest95' (rundet zur nächsten ,95-Marke, auch abwärts) um — beides
// zusammen war die Ursache dafür, dass aus einem gewünschten 2,00€-Zielgewinn real 3,50-4,25€
// wurden. Alle Fixture-Erwartungszahlen in diesem Test wurden darum NEU mit der Teil-2C-Formel
// berechnet (nicht mehr mit Sicherheitspuffer/up95) und als feste Literale hinterlegt.
//
// Datenherkunft der Snapshot-Fixtures: mindestens 10 reale Produkte, darunter stele-98/110/141
// (12 reale Einkaufspreis-Datenpunkte in Summe, vom Nutzer in Teil 1 direkt mitgeteilt).
// shippingCost/adRate/shipsFrom für diese konkreten Produkte sind ohne Live-DB-Zugriff nicht
// bekannt und mit den App-Standardwerten angenommen (versand=0, adRate=5, kein China-Versand) —
// bewusst dokumentierte Vereinfachung, keine Behauptung realer Feldwerte. stele-152 bleibt NICHT
// enthalten (keine reale Zahl dafür im Chat verfügbar, siehe Teil-2A-Testdatei-Historie).
import { describe, expect, test } from 'bun:test';
import { computeMinSellPrice, applyDecreaseCap, planCappedPriceSteps, computeVariantSellPrices, profitAtSellPrice, parseVariantSellPrices, serializeVariantSellPrices, resolveVariantSellPrice, roundUpToX95, roundToNearest95, DEFAULT_PRICING_CONFIG, AUTO_PRICE_WRITE_ENABLED } from './pricing';
import { MAX_PRICE_DECREASE_PERCENT } from './constants';

describe('DEFAULT_PRICING_CONFIG — Teil 2B/2C: real gemessene Werte, kein Sicherheitspuffer mehr', () => {
  test('Gebührensatz, Fixbetrag und MwSt-Faktor entsprechen den in 13 realen Bestellungen gemessenen Werten', () => {
    expect(DEFAULT_PRICING_CONFIG.ebayFeeRatePercent).toBe(15);
    expect(DEFAULT_PRICING_CONFIG.ebayFixedFeeEur).toBe(0.30);
    expect(DEFAULT_PRICING_CONFIG.vatFactor).toBe(1.19);
  });

  // Teil 2C, Ursache 1 der Zielgewinn-Abweichung: der Sicherheitspuffer wurde ZUSÄTZLICH zum
  // Zielgewinn addiert. Ab jetzt fest 0 — PRICE_SAFETY_BUFFER_EUR (shared/constants.ts) bleibt
  // als Konstante bestehen, wird aber von keiner Kalkulation mehr referenziert.
  test('safetyBufferEur ist 0 (Teil 2C — vorher 1,50€, Ursache der Zielgewinn-Abweichung)', () => {
    expect(DEFAULT_PRICING_CONFIG.safetyBufferEur).toBe(0);
  });

  // SICHERHEITSKRITISCH (Pflichtbestandteil der strikten Grenzen): solange die neue Formel nicht
  // manuell freigegeben ist, darf kein automatischer Pfad einen damit berechneten Preis schreiben.
  test('AUTO_PRICE_WRITE_ENABLED ist standardmäßig false (automatische Schreibpfade bleiben stillgelegt)', () => {
    expect(AUTO_PRICE_WRITE_ENABLED).toBe(false);
  });
});

describe('computeMinSellPrice — "nearest95"-Fall, automatische Preisprüfung (price-monitor.ts/index.ts/ebay.ts): Teil 2C, OHNE Sicherheitspuffer, zur nächsten ,95-Marke gerundet', () => {
  function automaticCheckCase(buyPrice: number, versand: number, zoll: number, adRate: number, targetMarginEur: number = DEFAULT_PRICING_CONFIG.targetMarginEur) {
    return computeMinSellPrice({
      buyPrice, supplierShipping: versand, isChinaOrigin: zoll > 0, customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
      rounding: 'nearest95',
    }).minSellPrice;
  }

  test('Erfolgsbedingung: buyPrice=10, versand=2, zoll=0, adRate=5, Zielgewinn=2 → 18,95€ (Teil 2B/up95+Puffer: 20,95€)', () => {
    expect(automaticCheckCase(10, 2, 0, 5)).toBe(18.95);
  });

  test('mit den Teil-2C-Werten (kein Puffer, nearest95) neu berechnet (6 Fälle)', () => {
    const cases: Array<[number, number, number, number, number]> = [
      [10, 2, 0, 5, 18.95],
      [4.79, 0, 0, 5, 8.95],
      [25.5, 3.2, 4.0, 8, 47.95],
      [12.95, 1.1, 0, 2, 20.95],
      [8.0, 0, 4.0, 10, 19.95],
      [100, 5, 0, 0, 130.95],
    ];
    for (const [buyPrice, versand, zoll, adRate, expected] of cases) {
      expect(automaticCheckCase(buyPrice, versand, zoll, adRate)).toBe(expected);
    }
  });

  // ── Snapshot-Fixtures: reale Produkte (Pflichtbestandteil #4 aus Teil 2A, hier mit den
  // Teil-2C-Werten fortgeschrieben — targetMarginEur=2,00 = globaler Default) ──
  test('stele-98 — realer AliExpress-Einkaufspreis 4,99€', () => {
    expect(automaticCheckCase(4.99, 0, 0, 5)).toBe(9.95);
  });

  test('stele-110 — 6 reale Varianten-Einkaufspreise', () => {
    const realBuyPrices: Array<[number, number]> = [
      [2.15, 5.95], [2.55, 5.95], [3.35, 7.95], [4.19, 8.95], [4.99, 9.95], [7.69, 12.95],
    ];
    for (const [buyPrice, expected] of realBuyPrices) {
      expect(automaticCheckCase(buyPrice, 0, 0, 5)).toBe(expected);
    }
  });

  test('stele-141 — 5 reale Varianten-Einkaufspreise', () => {
    const realBuyPrices: Array<[number, number]> = [
      [1.79, 4.95], [2.25, 5.95], [2.99, 6.95], [2.99, 6.95], [8.19, 13.95],
    ];
    for (const [buyPrice, expected] of realBuyPrices) {
      expect(automaticCheckCase(buyPrice, 0, 0, 5)).toBe(expected);
    }
  });

  // stele-152: bewusst NICHT enthalten — kein realer Wert im Chat verfügbar, siehe Datei-Header.

  test('synthetische Randfälle (klar gekennzeichnet, keine Live-Daten): China-Zoll, adRate=0, hoher Einkaufspreis', () => {
    expect(automaticCheckCase(6.50, 2.20, 4.00, 5)).toBe(19.95);
    expect(automaticCheckCase(15.00, 0, 0, 0)).toBe(20.95);
    expect(automaticCheckCase(42.00, 3.50, 0, 8)).toBe(65.95);
  });

  // Teil 2C, Ursache 2: der beim Import gewählte Zielgewinn wird jetzt pro Produkt (product.
  // targetMarginEur) durchgereicht statt immer auf den globalen Default zurückzufallen — Beweis,
  // dass ein abweichender Wert (hier 4€ statt 2€) wirklich durchschlägt (Pflichtbestandteil #6).
  test('Zielgewinn=4€ statt des globalen Defaults (2€) schlägt sichtbar durch (3 reale Produkte)', () => {
    expect(automaticCheckCase(4.99, 0, 0, 5, 4.00)).toBe(11.95);  // stele-98
    expect(automaticCheckCase(2.15, 0, 0, 5, 4.00)).toBe(8.95);   // stele-110-v1
    expect(automaticCheckCase(7.69, 0, 0, 5, 4.00)).toBe(15.95);  // stele-110-v6
    // zum Vergleich: derselbe Einkaufspreis mit dem globalen 2€-Default ergibt einen niedrigeren VK
    expect(automaticCheckCase(4.99, 0, 0, 5, 4.00)).toBeGreaterThan(automaticCheckCase(4.99, 0, 0, 5, 2.00));
  });
});

describe('computeMinSellPrice — "cent"-Fall (lieferanten.tsx Einzelbutton: OHNE Sicherheitspuffer, Cent-Rundung) — unverändert seit Teil 2B, da schon ohne Puffer', () => {
  function importSuggestionCase(buyPrice: number, versand: number, zoll: number, adRate: number, minGewinn: number) {
    return computeMinSellPrice({
      buyPrice, supplierShipping: versand, isChinaOrigin: zoll > 0, customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: minGewinn, safetyBufferEur: 0,
      rounding: 'cent',
    }).minSellPrice;
  }

  test('Erfolgsbedingung: buyPrice=10, versand=2, zoll=0, adRate=5, minGewinn=2 → 18,85€', () => {
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

describe('computeMinSellPrice — "nearest95"-Fall (lieferanten.tsx Varianten-Tabelle: OHNE Puffer, zur nächsten ,95-Marke) — unverändert seit Teil 2B, da schon ohne Puffer/mit nearest95', () => {
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
    expect(variantTableCase(2.55, 0, 0, 5, 2.00)).toBe(5.95);   // stele-110-v2 — rundet AB (Beweis nearest95 vs. up95)
    expect(variantTableCase(3.35, 0, 0, 5, 2.00)).toBe(7.95);   // stele-110-v3
    expect(variantTableCase(4.19, 0, 0, 5, 2.00)).toBe(8.95);   // stele-110-v4
  });

  test('roundToNearest95 rundet nachweislich auch ABWÄRTS (Unterschied zu roundUpToX95)', () => {
    expect(roundToNearest95(8.05)).toBe(7.95); // am nächsten an 7,95
    expect(roundUpToX95(8.05)).toBe(8.95);      // rundet garantiert AUF
  });
});

describe('computeMinSellPrice — "none"-Fall (Preise-Tab-Verhandlungsrechner & Produkte-Tab-Badge: nur Gebührensätze, kein Mindestpreis)', () => {
  // Diese Tests bleiben gegenüber Teil 2A/2B UNVERÄNDERT: der Preise-Tab-Rechner übergibt weiterhin
  // seinen eigenen, frei editierbaren Gebührensatz statt DEFAULT_PRICING_CONFIG direkt — die reine
  // Rechenfunktion selbst und diese beiden Aufrufstellen sind von Teil 2C (Puffer/Rundung) nicht
  // betroffen, weil hier ohnehin kein Mindestpreis berechnet wird (rounding: 'none').
  test('Preise-Tab: 15%-Default (ehem. 17%) + Anzeigegebühr aus adRate', () => {
    const adRatePercent = 5; // aus dem adRate-Feld eines ausgewählten Produkts, nicht manuell getippt
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
    // buyPrice=3.80 ergibt mit den Teil-2C-Werten (kein Puffer, 15%/0,30€) einen Rohwert knapp
    // über einer ,95-Marke: 'nearest95' rundet AB, 'up95' garantiert AUF.
    const base = { buyPrice: 3.80, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: 1.19, adRatePercent: 5,
      targetMarginEur: 2.00, safetyBufferEur: 0 };
    const up = computeMinSellPrice({ ...base, rounding: 'up95' }).minSellPrice;
    const nearest = computeMinSellPrice({ ...base, rounding: 'nearest95' }).minSellPrice;
    expect(up).toBe(8.95);
    expect(nearest).toBe(7.95);
    expect(up).not.toBe(nearest);
  });

  // Teil 2C, Ursache 1: beweist konkret, wie viel der Sicherheitspuffer+up95-Kombination ausmachte
  // — derselbe Rohfall wie die automatische-Preisprüfung-Erfolgsbedingung oben, einmal mit der
  // ALTEN (Teil-2B) Kombination und einmal mit der NEUEN (Teil-2C).
  test('Sicherheitspuffer+up95 (Teil 2B) vs. kein Puffer+nearest95 (Teil 2C): 2,00€ Differenz bei buyPrice=10', () => {
    const base = { buyPrice: 10, supplierShipping: 2, isChinaOrigin: false, customsFlat: 0,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: 1.19, adRatePercent: 5,
      targetMarginEur: 2.00 };
    const teil2b = computeMinSellPrice({ ...base, safetyBufferEur: 1.50, rounding: 'up95' }).minSellPrice;
    const teil2c = computeMinSellPrice({ ...base, safetyBufferEur: 0, rounding: 'nearest95' }).minSellPrice;
    expect(teil2b).toBe(20.95);
    expect(teil2c).toBe(18.95);
    expect(Math.round((teil2b - teil2c) * 100) / 100).toBe(2.00);
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

describe('applyDecreaseCap — Teil 2D "Senkungsbremse": computeMinSellPrice() liefert eine Untergrenze, kein Zielpreis', () => {
  test('MAX_PRICE_DECREASE_PERCENT ist 8 (Vorgabe des Nutzers, 2026-09-10)', () => {
    expect(MAX_PRICE_DECREASE_PERCENT).toBe(8);
  });

  // a) Anheben, weil der aktuelle Preis unter dem Mindestpreis liegt — darf NICHT gedeckelt werden
  test('a) Anheben wird NIE gedeckelt (schützt vor Verlust)', () => {
    const result = applyDecreaseCap(15.00, 18.95, MAX_PRICE_DECREASE_PERCENT);
    expect(result).toEqual({ price: 18.95, wasCapped: false, uncappedPrice: 18.95 });
  });

  // b) Absenken um mehr als 8% — muss auf 8% begrenzt werden (reale Beispiele aus dem Auftrag)
  test('b) Absenken um mehr als 8% wird begrenzt — real beobachtete Fälle stele-141/stele-110', () => {
    // stele-141: eBay aktuell 23,95€, berechneter Mindestpreis 10,95€ (−54,3%, weit über 8%)
    const stele141 = applyDecreaseCap(23.95, 10.95, MAX_PRICE_DECREASE_PERCENT);
    expect(stele141.wasCapped).toBe(true);
    expect(stele141.uncappedPrice).toBe(10.95);
    expect(stele141.price).toBe(22.95);
    expect((23.95 - stele141.price) / 23.95).toBeLessThanOrEqual(0.08);

    // stele-110: eBay aktuell 20,95€, berechneter Mindestpreis 10,95€ (−47,7%, weit über 8%)
    const stele110 = applyDecreaseCap(20.95, 10.95, MAX_PRICE_DECREASE_PERCENT);
    expect(stele110.wasCapped).toBe(true);
    expect(stele110.uncappedPrice).toBe(10.95);
    expect(stele110.price).toBe(19.95);
    expect((20.95 - stele110.price) / 20.95).toBeLessThanOrEqual(0.08);
  });

  // Regressionsschutz für die Rundungs-Präzisierung (s. Kommentar in pricing.ts): eine naive
  // roundToNearest95()-Anwendung auf den 8%-Grenzwert selbst würde hier 21,95€ ergeben — das wäre
  // bereits 8,35% Absenkung, eine Verletzung der 8%-Bremse. Beweist, dass die Zwei-Modi-Rundung
  // (roundUpToX95 als Fallback) das tatsächlich verhindert.
  test('Regressionsschutz: eine reine roundToNearest95()-Rundung des Grenzwerts würde die 8%-Bremse verletzen', () => {
    const naiveFloor = 23.95 * (1 - 8 / 100);
    const naiveRounded = roundToNearest95(naiveFloor);
    expect(naiveRounded).toBe(21.95); // würde die Bremse verletzen, s.u.
    expect((23.95 - naiveRounded) / 23.95).toBeGreaterThan(0.08); // 8,35% — genau der Bug, den applyDecreaseCap vermeidet
    // applyDecreaseCap() selbst bleibt innerhalb der Bremse (Test b oben: 22,95€, 4,18%).
  });

  // c) Absenken um weniger als 8% — muss unveraendert durchgehen
  test('c) Absenken um weniger als 8% bleibt unverändert (kein unnötiges Runden/Verändern)', () => {
    const result = applyDecreaseCap(20.00, 19.00, MAX_PRICE_DECREASE_PERCENT); // −5%
    expect(result).toEqual({ price: 19.00, wasCapped: false, uncappedPrice: 19.00 });
  });

  test('currentPrice null/undefined (Erst-Listing, kein bisheriger Preis) — computedMinPrice unverändert', () => {
    expect(applyDecreaseCap(null, 12.95, MAX_PRICE_DECREASE_PERCENT)).toEqual({ price: 12.95, wasCapped: false, uncappedPrice: 12.95 });
    expect(applyDecreaseCap(undefined, 12.95, MAX_PRICE_DECREASE_PERCENT)).toEqual({ price: 12.95, wasCapped: false, uncappedPrice: 12.95 });
  });

  test('computedMinPrice === currentPrice — keine Änderung, kein Deckeln (Grenzfall, kein Absinken)', () => {
    expect(applyDecreaseCap(18.95, 18.95, MAX_PRICE_DECREASE_PERCENT)).toEqual({ price: 18.95, wasCapped: false, uncappedPrice: 18.95 });
  });

  test('gedeckelter Preis überschreitet die 8%-Bremse in keinem der Testfälle (a/b/c + Regressionsfall)', () => {
    const cases: Array<[number, number]> = [[15.00, 18.95], [23.95, 10.95], [20.95, 10.95], [20.00, 19.00]];
    for (const [currentPrice, computedMinPrice] of cases) {
      const { price } = applyDecreaseCap(currentPrice, computedMinPrice, MAX_PRICE_DECREASE_PERCENT);
      if (price < currentPrice) {
        expect((currentPrice - price) / currentPrice).toBeLessThanOrEqual(MAX_PRICE_DECREASE_PERCENT / 100);
      }
    }
  });
});

describe('computeVariantSellPrices — Teil 3: Varianten mit eigenen Preisen (Anker = teuerste Variante)', () => {
  // Reale Daten stele-110 (Varianten-Einkaufspreise vom Nutzer in Teil 1 mitgeteilt, heutiger
  // sellPrice 19,95€). Der Auftrag gibt die erwarteten Preise explizit vor (Pflichtpunkt 7) —
  // dieser Test hält sie als Fixture fest.
  const stele110Eks = [7.69, 4.99, 4.19, 3.35, 2.55, 2.15];
  const stele110Variants = stele110Eks.map((ek, i) => ({ skuId: `stele-110-v${i + 1}`, buyPrice: ek }));

  function planForStele110(customsFlat: number) {
    return computeVariantSellPrices({
      variants: stele110Variants,
      anchorSellPrice: 19.95,
      supplierShipping: 0,
      isChinaOrigin: customsFlat > 0,
      customsFlat,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,
      ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor,
      adRatePercent: DEFAULT_PRICING_CONFIG.defaultAdRatePercent,
      targetMarginEur: DEFAULT_PRICING_CONFIG.targetMarginEur,
    });
  }

  test('Pflichtpunkt 7: stele-110 ergibt exakt 19,95 / 15,95 / 14,95 / 13,95 / 12,95 / 12,95', () => {
    const plan = planForStele110(DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur);
    expect(plan.rows.map(r => r.sellPrice)).toEqual([19.95, 15.95, 14.95, 13.95, 12.95, 12.95]);
    expect(plan.anchorSkuId).toBe('stele-110-v1'); // teuerste Variante (EK 7,69€)
    expect(plan.targetProfitSource).toBe('anchor');
  });

  // Die Zollpauschale ist für alle Varianten desselben Produkts gleich und kürzt sich in der
  // Gleich-Gewinn-Rechnung heraus: sie senkt den Ankergewinn um denselben Betrag, um den sie die
  // Kosten jeder Variante erhöht. Deshalb ergeben China- und EU-Herkunft dieselben Preise —
  // erklärt, warum Punkt 7 unabhängig von der (aus der Sandbox nicht einsehbaren) shipsFrom-Angabe
  // von stele-110 zutrifft.
  test('Zollpauschale kürzt sich heraus — dieselben Preise mit und ohne China-Zoll', () => {
    expect(planForStele110(0).rows.map(r => r.sellPrice))
      .toEqual(planForStele110(DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur).rows.map(r => r.sellPrice));
  });

  // Gegenprobe zum BEFUND des Auftrags ("stele-110: 3,15 bis 8,69 EUR", Spanne 5,54): beim heutigen
  // EINHEITSPREIS 19,95€ driften die Gewinne genau so auseinander. Reproduziert die Zahlen des
  // Nutzers unabhängig nach und belegt damit die Annahmen (sellPrice 19,95€, Zoll 4,00€, adRate 5%).
  test('Befund des Auftrags reproduziert: Einheitspreis 19,95€ ergibt Gewinne 3,15 … 8,69€', () => {
    const profits = stele110Eks.map(ek => profitAtSellPrice({
      sellPrice: 19.95, buyPrice: ek, supplierShipping: 0,
      isChinaOrigin: true, customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,
      ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor,
      adRatePercent: DEFAULT_PRICING_CONFIG.defaultAdRatePercent,
    }));
    expect(Math.min(...profits)).toBeCloseTo(3.15, 2);
    expect(Math.max(...profits)).toBeCloseTo(8.69, 2);
    expect(Math.max(...profits) - Math.min(...profits)).toBeCloseTo(5.54, 2);
  });

  test('nach der Neuberechnung liegen alle Varianten-Gewinne dicht am Ankergewinn (nur ,95-Rundungsdrift)', () => {
    const plan = planForStele110(DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur);
    for (const row of plan.rows) {
      expect(Math.abs(row.profit - plan.targetProfit)).toBeLessThanOrEqual(0.40);
    }
  });

  test('Anker behält EXAKT den heutigen Preis, auch ohne ,95-Endung (keine Nachrundung)', () => {
    const plan = computeVariantSellPrices({
      variants: [{ skuId: 'a', buyPrice: 7.69 }, { skuId: 'b', buyPrice: 2.15 }],
      anchorSellPrice: 20.00, supplierShipping: 0, isChinaOrigin: true, customsFlat: 4.00,
      ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2.00,
    });
    expect(plan.rows[0].sellPrice).toBe(20.00);
    expect(plan.rows[0].isAnchor).toBe(true);
    expect(plan.rows[1].sellPrice).toBe(12.95);
  });

  test('harte Schranke: kein Variantenpreis über dem heutigen sellPrice (nie erhöhen)', () => {
    // Zwei Varianten mit identischem höchsten EK: die Gleich-Gewinn-Rechnung der zweiten landet bei
    // 19,95€ und damit ÜBER dem heutigen Preis 19,50€ — muss auf 19,50€ begrenzt werden.
    const plan = computeVariantSellPrices({
      variants: [{ skuId: 'a', buyPrice: 7.69 }, { skuId: 'b', buyPrice: 7.69 }],
      anchorSellPrice: 19.50, supplierShipping: 0, isChinaOrigin: true, customsFlat: 4.00,
      ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2.00,
    });
    expect(plan.rows[1].sellPrice).toBe(19.50);
    expect(plan.rows[1].limitedByAnchorPrice).toBe(true);
    for (const row of plan.rows) expect(row.sellPrice).toBeLessThanOrEqual(19.50);
  });

  test('harte Schranke: liegt der Ankergewinn unter targetMarginEur, gilt targetMarginEur', () => {
    const plan = computeVariantSellPrices({
      variants: [{ skuId: 'a', buyPrice: 15.00 }, { skuId: 'b', buyPrice: 2.15 }],
      anchorSellPrice: 19.95, supplierShipping: 0, isChinaOrigin: true, customsFlat: 4.00,
      ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2.00,
    });
    expect(plan.targetProfitSource).toBe('targetMargin');
    expect(plan.targetProfit).toBe(2.00);
    expect(plan.anchorProfit).toBeCloseTo(-4.1551, 3); // Anker verkauft heute mit Verlust …
    expect(plan.rows[0].sellPrice).toBe(19.95);        // … behält aber seinen Preis (nie erhöhen)
    expect(plan.rows[1].sellPrice).toBe(10.95);        // die andere Variante rechnet auf 2,00€ Zielgewinn
  });

  test('leere Variantenliste ergibt einen leeren Plan statt eines Absturzes', () => {
    const plan = computeVariantSellPrices({
      variants: [], anchorSellPrice: 19.95, supplierShipping: 0, isChinaOrigin: false, customsFlat: 4.00,
      ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2.00,
    });
    expect(plan.rows).toEqual([]);
  });

  test('profitAtSellPrice entspricht der Formel aus dem Auftrag', () => {
    // Gewinn = Preis − (EK + Versand + Zoll) − (Preis × (15% + adRate) × 1,19 + 0,30 × 1,19)
    const sellPrice = 19.95, buyPrice = 7.69, versand = 0, zoll = 4.00, adRate = 5;
    const erwartet = sellPrice - (buyPrice + versand + zoll) - (sellPrice * ((15 + adRate) / 100) * 1.19 + 0.30 * 1.19);
    expect(profitAtSellPrice({
      sellPrice, buyPrice, supplierShipping: versand, isChinaOrigin: true, customsFlat: zoll,
      ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: adRate,
    })).toBeCloseTo(erwartet, 10);
  });
});

describe('variant_sell_prices — Teil 3: eigene Spalte für den VK je Variante + Vorrang-Regel', () => {
  test('parseVariantSellPrices liest eine gültige Map', () => {
    expect(parseVariantSellPrices('{"v1":19.95,"v2":12.95}')).toEqual({ v1: 19.95, v2: 12.95 });
  });

  test('parseVariantSellPrices ist tolerant: null/leer/kaputt/Array ergibt eine leere Map statt Absturz', () => {
    expect(parseVariantSellPrices(null)).toEqual({});
    expect(parseVariantSellPrices(undefined)).toEqual({});
    expect(parseVariantSellPrices('')).toEqual({});
    expect(parseVariantSellPrices('{kaputt')).toEqual({});
    expect(parseVariantSellPrices('[1,2,3]')).toEqual({});
  });

  test('parseVariantSellPrices verwirft nicht-numerische und unplausible Werte einzeln', () => {
    // Ein Schrottwert darf nicht als Preis durchrutschen — die übrigen bleiben gültig.
    expect(parseVariantSellPrices('{"v1":19.95,"v2":"12,95","v3":null,"v4":0,"v5":-5}')).toEqual({ v1: 19.95 });
  });

  test('serializeVariantSellPrices erzeugt genau das Format, das parseVariantSellPrices wieder liest', () => {
    const rows = [{ skuId: 'v1', sellPrice: 19.95 }, { skuId: 'v2', sellPrice: 12.95 }];
    expect(parseVariantSellPrices(serializeVariantSellPrices(rows))).toEqual({ v1: 19.95, v2: 12.95 });
  });

  // Die Vorrang-Regel ist der eigentliche Schutz davor, dass die neue Spalte und das alte
  // ebayPrice-Feld zu zwei konkurrierenden Wahrheiten werden.
  test('Vorrang 1: die neue Spalte gewinnt gegen das alte ebayPrice-Feld', () => {
    expect(resolveVariantSellPrice('v1', { v1: 15.95 }, { ebayPrice: 19.95 }))
      .toEqual({ sellPrice: 15.95, source: 'column' });
  });

  test('Vorrang 2: ohne Spaltenwert greift der Altbestand ebayPrice', () => {
    expect(resolveVariantSellPrice('v1', {}, { ebayPrice: 19.95 }))
      .toEqual({ sellPrice: 19.95, source: 'legacy' });
  });

  test('Vorrang 3: ohne beides kein gespeicherter VK — die Aufrufstelle muss rechnen', () => {
    expect(resolveVariantSellPrice('v1', {}, null)).toEqual({ sellPrice: null, source: 'none' });
    expect(resolveVariantSellPrice('v1', {}, {})).toEqual({ sellPrice: null, source: 'none' });
    expect(resolveVariantSellPrice('v1', {}, { ebayPrice: 0 })).toEqual({ sellPrice: null, source: 'none' });
  });

  test('ein Plan aus computeVariantSellPrices lässt sich verlustfrei in die Spalte schreiben und zurücklesen', () => {
    const plan = computeVariantSellPrices({
      variants: [{ skuId: 'v1', buyPrice: 7.69 }, { skuId: 'v2', buyPrice: 2.15 }],
      anchorSellPrice: 19.95, supplierShipping: 0, isChinaOrigin: true, customsFlat: 4.00,
      ebayFeeRatePercent: 15, ebayFixedFeeEur: 0.30, vatFactor: 1.19, adRatePercent: 5, targetMarginEur: 2.00,
    });
    const wieder = parseVariantSellPrices(serializeVariantSellPrices(plan.rows));
    expect(wieder).toEqual({ v1: 19.95, v2: 12.95 });
    for (const row of plan.rows) {
      expect(resolveVariantSellPrice(row.skuId, wieder, null).sellPrice).toBe(row.sellPrice);
    }
  });
});

describe('planCappedPriceSteps — Teil 3: Varianten-Umstellung unter der 8-%-Bremse (Entscheidung des Nutzers)', () => {
  test('grösster stele-110-Sprung (19,95 → 12,95) braucht 7 Läufe, der erste setzt 18,95', () => {
    expect(planCappedPriceSteps(19.95, 12.95, MAX_PRICE_DECREASE_PERCENT))
      .toEqual({ nextPrice: 18.95, runsToTarget: 7, reachesTarget: true });
  });

  test('kleinere Sprünge brauchen entsprechend weniger Läufe', () => {
    expect(planCappedPriceSteps(19.95, 15.95, MAX_PRICE_DECREASE_PERCENT).runsToTarget).toBe(4);
    expect(planCappedPriceSteps(19.95, 14.95, MAX_PRICE_DECREASE_PERCENT).runsToTarget).toBe(5);
    expect(planCappedPriceSteps(19.95, 13.95, MAX_PRICE_DECREASE_PERCENT).runsToTarget).toBe(6);
  });

  test('kein Schritt der Kette überschreitet die 8-%-Bremse', () => {
    let price = 19.95;
    const target = 12.95;
    for (let i = 0; i < 20 && price > target; i++) {
      const next = planCappedPriceSteps(price, target, MAX_PRICE_DECREASE_PERCENT).nextPrice;
      expect((price - next) / price).toBeLessThanOrEqual(MAX_PRICE_DECREASE_PERCENT / 100);
      price = next;
    }
    expect(price).toBe(target);
  });

  test('Anheben ist nie gedeckelt und daher in einem Lauf erledigt', () => {
    expect(planCappedPriceSteps(15.00, 18.95, MAX_PRICE_DECREASE_PERCENT))
      .toEqual({ nextPrice: 18.95, runsToTarget: 1, reachesTarget: true });
  });

  test('Zielpreis gleich aktueller Preis: nichts zu tun', () => {
    expect(planCappedPriceSteps(19.95, 19.95, MAX_PRICE_DECREASE_PERCENT))
      .toEqual({ nextPrice: 19.95, runsToTarget: 0, reachesTarget: true });
  });

  test('kein Fortschritt möglich → Abbruch statt Endlosschleife (reachesTarget false)', () => {
    // Bei niedrigen Preisen liegt die nächste ,95-Marke unterhalb des 8-%-Grenzwerts, die Bremse
    // hält den Preis deshalb auf dem Ausgangswert fest: 1,95€ → Grenzwert 1,794€ → gerundet wieder
    // 1,95€. Der Zielpreis 1,00€ ist so nie erreichbar; die Funktion muss das melden statt endlos
    // zu drehen.
    const plan = planCappedPriceSteps(1.95, 1.00, MAX_PRICE_DECREASE_PERCENT);
    expect(plan).toEqual({ nextPrice: 1.95, runsToTarget: 0, reachesTarget: false });
  });
});
