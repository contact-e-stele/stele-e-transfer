// Teil 2A (P-27/P-28-Preis-Fundament, 2026-09-10): EINE einzige Kalkulations-Quelle.
//
// Vorher gab es sieben (tatsächlich acht — ebay.ts's Varianten-Listing-Fallback wurde in der
// Teil-1-Bestandsaufnahme übersehen) unabhängige Formel-Stellen im Code, dazu drei verschiedene
// eBay-Gebühren-Annahmen (13% / 17% / 18%), keine trifft die real gemessenen ~15% + 0,30 EUR.
// Dieser Refactor ist bewusst WERTNEUTRAL — er ändert an keiner Aufrufstelle das Rechenergebnis,
// er ersetzt nur sieben-plus-eins unabhängige Kopien der Rechenlogik durch Aufrufe derselben
// Funktion. Die abweichenden Gebühren-Annahmen bleiben deshalb absichtlich als von der
// Aufrufstelle übergebene Parameter erhalten (mit TODO-Kommentar), nicht als versteckter Default
// in dieser Datei — die Korrektur auf die real gemessenen Werte ist Teil 2B, hier NICHT enthalten.
//
// Standort: `shared/`, weil sowohl Backend (price-monitor.ts, ebay.ts, index.ts) als auch
// Frontend (index.tsx, produkte.tsx, lieferanten.tsx) die Funktion brauchen — exakt der Grund,
// aus dem die Vorgänger-Version dieser Datei (P-27/P-28-Konsolidierung, 08.09.) hier lag. Der im
// Teil-2A-Auftrag vorgeschlagene Pfad `src/lib/pricing.ts` existiert in diesem Projekt nicht
// (nur `src/web/lib/`, ausschließlich Frontend) — `shared/pricing.ts` ist der bereits etablierte,
// von beiden Seiten importierbare Ort und wird hier in-place ersetzt statt eine zweite,
// parallele Datei anzulegen.

import { MIN_GEWINN_EUR, PRICE_SAFETY_BUFFER_EUR, CHINA_ZOLL_EUR } from './constants';

export type RoundingMode = 'up95' | 'nearest95' | 'cent' | 'none';

// Rundet AUFWÄRTS zur nächsten ,95-Endung (P-11). Für Mindestpreis-Berechnungen, bei denen ein
// Abrunden die Gewinn-Garantie brechen könnte (laufende Preisprüfung, Erst-/Re-Listing).
export function roundUpToX95(price: number): number {
  return Math.round((Math.ceil(price - 0.95) + 0.95) * 100) / 100;
}

// Rundet zur NÄCHSTEN ,95-Endung (auf oder ab) — P-74, bewusst anders als roundUpToX95: im
// manuellen Varianten-Import-Modal (lieferanten.tsx) darf der Preis auch knapp unter den
// berechneten Mindestpreis fallen.
export function roundToNearest95(price: number): number {
  const nearestInt = Math.round(price - 0.95);
  return Math.round((nearestInt + 0.95) * 100) / 100;
}

function applyRounding(price: number, mode: RoundingMode): number {
  switch (mode) {
    case 'up95': return roundUpToX95(price);
    case 'nearest95': return roundToNearest95(price);
    case 'cent': return Math.ceil(price * 100) / 100;
    case 'none': return price;
  }
}

// Alle Eingaben sind PFLICHT — bewusst keine Default-Werte in dieser Datei (Teil-2A-Vorgabe).
// Defaults für die "echte" Formel (13% Basis-Gebühr, 0,45€ Fixbetrag, Mindestgewinn,
// Sicherheitspuffer, China-Zollpauschale) leben separat in DEFAULT_PRICING_CONFIG weiter unten —
// Aufrufstellen, die bewusst ANDERE Werte verwenden (Preise-Tab: 17/18%, Produkte-Tab-Badge:
// 18%), übergeben ihre eigenen Literale statt der Defaults und markieren das mit einem TODO.
export interface PricingInput {
  buyPrice: number;          // Einkaufspreis
  supplierShipping: number;  // Versandkosten Lieferant
  isChinaOrigin: boolean;    // Herkunft: China (Zoll wird angesetzt) oder EU/sonstige (kein Zoll)
  customsFlat: number;       // Zollpauschale — wird nur angesetzt, wenn isChinaOrigin=true
  ebayFeeRatePercent: number; // eBay-Gebührensatz in % (z.B. 13, 17 oder 18 — je nach Aufrufstelle)
  ebayFixedFeeEur: number;    // eBay-Fixbetrag in EUR, netto (vor MwSt)
  vatFactor: number;          // MwSt-Faktor (z.B. 1.19 = 19% MwSt.)
  adRatePercent: number;      // Anzeigentarif in % (Promoted Listings)
  targetMarginEur: number;    // Zielmarge/Mindestgewinn in EUR
  safetyBufferEur: number;    // zusätzlicher Sicherheitspuffer in EUR (0, wenn an dieser Stelle nicht verwendet)
  rounding: RoundingMode;     // Rundungsmodus für minSellPrice
}

export interface PricingResult {
  totalCost: number;         // buyPrice + supplierShipping + customs
  customs: number;           // tatsächlich angesetzter Zollbetrag (0 oder customsFlat)
  baseFeeRateGross: number;  // ebayFeeRatePercent/100 × vatFactor — OHNE Anzeigentarif
  totalFeeRateGross: number; // (ebayFeeRatePercent + adRatePercent)/100 × vatFactor — MIT Anzeigentarif
  fixedFeeGross: number;     // ebayFixedFeeEur × vatFactor
  rawMinSellPrice: number;   // Mindest-Verkaufspreis vor Rundung
  minSellPrice: number;      // Mindest-Verkaufspreis nach `rounding`
}

// Die eine zentrale Kalkulationsfunktion (Teil-2A-Vorgabe: "genau eine exportierte
// Kalkulationsfunktion"). Berechnet den Mindest-Verkaufspreis aus den Kosten-Eingaben; das
// Ergebnis enthält zusätzlich die Zwischenwerte (Gebührensätze, Fixbetrag, Gesamtkosten), damit
// Aufrufstellen, die NICHT direkt einen Mindestpreis brauchen, sondern z.B. bei einem gegebenen
// Verkaufspreis die Marge/Gebühren zeigen wollen (Preise-Tab-Verhandlungsrechner,
// Produkte-Tab-Badge), dieselben Gebühren-Konstanten wiederverwenden können, statt sie ein
// zweites Mal selbst zu berechnen.
export function computeMinSellPrice(input: PricingInput): PricingResult {
  const customs = input.isChinaOrigin ? input.customsFlat : 0;
  const totalCost = input.buyPrice + input.supplierShipping + customs;
  const baseFeeRateGross = (input.ebayFeeRatePercent / 100) * input.vatFactor;
  const totalFeeRateGross = ((input.ebayFeeRatePercent + input.adRatePercent) / 100) * input.vatFactor;
  const fixedFeeGross = input.ebayFixedFeeEur * input.vatFactor;
  const rawMinSellPrice = (totalCost + input.targetMarginEur + input.safetyBufferEur + fixedFeeGross) / (1 - totalFeeRateGross);
  const minSellPrice = applyRounding(rawMinSellPrice, input.rounding);
  return { totalCost, customs, baseFeeRateGross, totalFeeRateGross, fixedFeeGross, rawMinSellPrice, minSellPrice };
}

// ─── Konstanten-Konfiguration (Teil-2A-Vorgabe: Defaults gehören hierher, nicht in die Funktion) ──
//
// Das sind die Werte der "echten" Formel (price-monitor.ts, index.ts recalculate-*/list/
// check-all-prices, ebay.ts, lieferanten.tsx-Einzelbutton) — unverändert gegenüber der
// Vorgänger-Datei. 13% Basis-Gebühr und 0,45€ Fixbetrag waren dort bisher als Literale INNERHALB
// der Formel verdrahtet; hier jetzt sichtbar benannt, aber NICHT korrigiert (Teil 2B).
export const DEFAULT_PRICING_CONFIG = {
  // TODO Teil 2B: auf gemessene 15% + 0,30 EUR umstellen (siehe Bestandsaufnahme Teil 1, Abschnitt 3)
  ebayFeeRatePercent: 13,
  // TODO Teil 2B: auf gemessene 15% + 0,30 EUR umstellen
  ebayFixedFeeEur: 0.45,
  vatFactor: 1.19,
  defaultAdRatePercent: 5,                    // DB-Default (schema.ts ad_rate.default(5))
  targetMarginEur: MIN_GEWINN_EUR,            // 2,00 €
  safetyBufferEur: PRICE_SAFETY_BUFFER_EUR,   // 1,50 €
  chinaCustomsFlatEur: CHINA_ZOLL_EUR,        // 4,00 €
} as const;

export function isChinaShipping(shipsFrom?: string | null): boolean {
  if (!shipsFrom) return false;
  return shipsFrom.toLowerCase().includes('china');
}
