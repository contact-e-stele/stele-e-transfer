// P-27/P-28-Konsolidierung (2026-09-08, PR #74): committete Testfälle für die zentrale
// Preisformel. Persistiert exakt die Fälle, die während der Konsolidierung als Wegwerf-Skript
// durchgerechnet wurden — keine neuen Zahlen, nur festgeschrieben.
import { describe, expect, test } from 'bun:test';
import { calcSellPrice, calcSellPriceCore, calcImportPriceSuggestion, roundUpToX95 } from './pricing';

describe('calcSellPrice (laufende Preisprüfung/Listing, MIT Sicherheitspuffer)', () => {
  test('Erfolgsbedingung: buyPrice=10, versand=2, zoll=0, adRate=5 → 20,95€', () => {
    expect(calcSellPrice(10, 2, 0, 5)).toBe(20.95);
  });

  // Regression gegen die alte price-monitor.ts-Version (vor der Konsolidierung), dieselben
  // 6 Fälle wie im Import-Vorschlag-Regressionstest unten.
  test('unverändert gegenüber der alten price-monitor.ts-Formel', () => {
    const PRICE_SAFETY_BUFFER_EUR = 1.50;
    const MIN_GEWINN_EUR = 2.00;
    function oldCalcSellPrice(buyPrice: number, versand: number, zoll: number, adRate: number): number {
      const feeRate = (13 + adRate) / 100 * 1.19;
      const minPrice = (buyPrice + versand + zoll + MIN_GEWINN_EUR + PRICE_SAFETY_BUFFER_EUR + 0.45 * 1.19) / (1 - feeRate);
      return roundUpToX95(minPrice);
    }
    const cases: Array<[number, number, number, number]> = [
      [10, 2, 0, 5],
      [4.79, 0, 0, 5],
      [25.5, 3.2, 4.0, 8],
      [12.95, 1.1, 0, 2],
      [8.0, 0, 4.0, 10],
      [100, 5, 0, 0],
    ];
    for (const [buyPrice, versand, zoll, adRate] of cases) {
      expect(calcSellPrice(buyPrice, versand, zoll, adRate)).toBe(oldCalcSellPrice(buyPrice, versand, zoll, adRate));
    }
  });
});

describe('calcImportPriceSuggestion (Import-Vorschlag, OHNE Sicherheitspuffer)', () => {
  test('Erfolgsbedingung: buyPrice=10, versand=2, zoll=0, adRate=5, minGewinn=2 → 18,50€', () => {
    expect(calcImportPriceSuggestion(10, 2, 0, 5, 2.00)).toBe(18.50);
  });

  test('entspricht calcSellPriceCore mit safetyBuffer:false, roundToX95:false', () => {
    expect(calcImportPriceSuggestion(10, 2, 0, 5, 2.00))
      .toBe(calcSellPriceCore(10, 2, 0, 5, { safetyBuffer: false, roundToX95: false }));
  });

  // Regression gegen die alte, jetzt entfernte Formel-Kopie in lieferanten.tsx (vor der
  // Konsolidierung) — bytegleiches Ergebnis für alle 6 Fälle, damit sich der Import-Preisvorschlag
  // für den Nutzer NICHT ändert (explizite Anforderung).
  test('bytegleich zur alten lieferanten.tsx-Formel für alle Testfälle', () => {
    function oldLieferantenFormula(einkauf: number, versand: number, chinaZoll: number, adRate: number, minGewinn: number): number {
      const feeRate = (13 + adRate) / 100 * 1.19;
      return Math.ceil(((einkauf + versand + chinaZoll + minGewinn + 0.45 * 1.19) / (1 - feeRate)) * 100) / 100;
    }
    const cases: Array<[number, number, number, number, number]> = [
      [10, 2, 0, 5, 2.00],       // Standardfall aus der Erfolgsbedingung (ohne Puffer)
      [4.79, 0, 0, 5, 2.00],     // stele-98-artiger Fall (kleiner Einkaufspreis)
      [25.5, 3.2, 4.0, 8, 2.00], // China-Zoll + hoher adRate
      [12.95, 1.1, 0, 2, 3.00],  // anderer Mindestgewinn (Nutzer-Auswahl 3€)
      [8.0, 0, 4.0, 10, 4.00],   // China + hoher adRate + Mindestgewinn 4€
      [100, 5, 0, 0, 2.00],      // adRate 0 (Randfall)
    ];
    for (const [einkauf, versand, zoll, adRate, minGewinn] of cases) {
      expect(calcImportPriceSuggestion(einkauf, versand, zoll, adRate, minGewinn))
        .toBe(oldLieferantenFormula(einkauf, versand, zoll, adRate, minGewinn));
    }
  });
});
