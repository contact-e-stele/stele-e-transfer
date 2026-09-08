// Zentrale eBay-Verkaufspreis-Formel (P-27/P-28-Konsolidierung, 2026-09-08).
//
// Vorher gab es DREI unabhängige Kopien dieser Formel im Code, die über die Zeit auseinander-
// gelaufen waren: price-monitor.ts (mit Sicherheitspuffer + ,95-Rundung, korrekt), index.ts
// /products/check-all-prices (fester 18%-Gebührensatz, kein Sicherheitspuffer, keine Bestell-
// gebühr, falsche Rundung — pushte automatisch falsche Preise live an eBay) und lieferanten.tsx
// (Import-Preisvorschlag, bewusst OHNE Sicherheitspuffer, Cent- statt ,95-Rundung). Diese Datei
// ist jetzt die einzige Stelle, die die Formel kennt. In `shared/`, weil sowohl Backend
// (price-monitor.ts, ebay.ts, index.ts) als auch Frontend (lieferanten.tsx) sie brauchen.
import { MIN_GEWINN_EUR, PRICE_SAFETY_BUFFER_EUR } from './constants';

export function isChinaShipping(shipsFrom?: string | null): boolean {
  if (!shipsFrom) return false;
  return shipsFrom.toLowerCase().includes('china');
}

// Rundet AUFWÄRTS zur nächsten ,95-Endung (P-11). Bewusst kein "nächstgelegen"-Runden: die Formel
// liefert einen Mindestpreis — würde man zur nächstgelegenen ,95-Marke runden, könnte der
// tatsächliche Preis unter den berechneten Mindestpreis fallen und die Gewinn-Garantie brechen.
export function roundUpToX95(price: number): number {
  return Math.round((Math.ceil(price - 0.95) + 0.95) * 100) / 100;
}

export interface CalcSellPriceOptions {
  // Sicherheitspuffer: bewusst NUR für die laufende Preisprüfung/das (Re-)Listing gedacht, NICHT
  // für den initialen Import-Vorschlag (mit Puffer würden Import-Vorschläge sichtbar teurer als
  // heute — das ist explizit nicht gewollt, siehe calcImportPriceSuggestion). Default true =
  // bisheriges calcSellPrice()-Verhalten für alle bestehenden Aufrufer, unverändert.
  safetyBuffer?: boolean;
  // Der Import-Vorschlag rundete bisher nur auf den vollen Cent, nicht auf ,95. Default true =
  // bisheriges calcSellPrice()-Verhalten, unverändert.
  roundToX95?: boolean;
  // Mindestgewinn — im Import-Vorschlag vom Nutzer frei wählbar (lieferanten.tsx-State), sonst
  // immer der globale Default.
  minGewinn?: number;
}

// feeRate = (13% eBay + adRate%) × 1.19 MwSt
// sellPrice = (buyPrice + versand + zoll + minGewinn [+ Sicherheitspuffer] + 0.45€ Bestellgebühr × 1.19 MwSt) / (1 - feeRate)
export function calcSellPriceCore(
  buyPrice: number, versand: number, zoll: number, adRate: number,
  opts: CalcSellPriceOptions = {}
): number {
  const { safetyBuffer = true, roundToX95 = true, minGewinn = MIN_GEWINN_EUR } = opts;
  const feeRate = (13 + adRate) / 100 * 1.19;
  const buffer = safetyBuffer ? PRICE_SAFETY_BUFFER_EUR : 0;
  const minPrice = (buyPrice + versand + zoll + minGewinn + buffer + 0.45 * 1.19) / (1 - feeRate);
  return roundToX95 ? roundUpToX95(minPrice) : Math.ceil(minPrice * 100) / 100;
}

// Laufende Preisprüfung + (Re-)Listing: MIT Sicherheitspuffer, ,95-Rundung, globaler Mindestgewinn.
// Signatur/Verhalten unverändert gegenüber der bisherigen price-monitor.ts-Version.
export function calcSellPrice(buyPrice: number, versand: number, zoll: number, adRate: number): number {
  return calcSellPriceCore(buyPrice, versand, zoll, adRate);
}

// Import-Preisvorschlag (lieferanten.tsx "≥X€ Gewinn"-Button): OHNE Sicherheitspuffer, Cent- statt
// ,95-Rundung, Mindestgewinn vom Nutzer wählbar — bytegleich zur bisherigen, jetzt entfernten
// Formel-Kopie in lieferanten.tsx (regressionsgetestet).
export function calcImportPriceSuggestion(buyPrice: number, versand: number, zoll: number, adRate: number, minGewinn: number): number {
  return calcSellPriceCore(buyPrice, versand, zoll, adRate, { safetyBuffer: false, roundToX95: false, minGewinn });
}
