// OFFEN 024 NACHTRAG (Inhaber 03.11.2026 08:26): Listings-Tab "Anzeige-Rate" 5 % ↔ 0 % nimmt das Angebot bei eBay aus der Kampagne
// (bzw. nimmt es auf) UND rechnet die Variantenpreise um: neuer VK = alter VK × f(alt) / f(neu), auf x,95 AUFgerundet.
// f(Satz) = 1 − (eBay-Gebühr + Anzeige) × MwSt = 0,762 bei 5 %, 0,8215 bei 0 %. Reine Regeln (Grundgesetz 2), kein eBay-Aufruf.
import { DEFAULT_PRICING_CONFIG, profitAtSellPrice, profitFloorFor, ebayLocationFactorFor } from './pricing';

/** Anteil des VK, der nach eBay-Gebühr + Anzeige (inkl. MwSt) bleibt: 5 % → 0,762 · 0 % → 0,8215. */
// Formel je Standort (08.11.): bei China-Herkunft/-Standort S = 1,19 auf den Prozent-Anteil (CN: 0,7168 / 0,7876). Weggelassen = 1 (DE/EU).
export function netFactor(adRatePercent: number, locationFactor = 1): number {
  return 1 - ((DEFAULT_PRICING_CONFIG.ebayFeeRatePercent + adRatePercent) / 100) * DEFAULT_PRICING_CONFIG.vatFactor * locationFactor;
}

/** Kleinster Preis mit Endung ,95, der ≥ x ist (14,795 → 14,95 · 15,95 → 15,95 · 15,96 → 16,95). */
export function roundUpTo95(x: number): number {
  const n = Math.ceil(x - 0.95 - 1e-9);
  return Math.round((n + 0.95) * 100) / 100;
}

export interface AdSwitchRowInput { skuId: string; label: string; buyPrice: number; sellPrice: number }
export interface AdSwitchInput {
  fromRate: number; toRate: number;
  rows: AdSwitchRowInput[];
  isChinaOrigin: boolean;
  checkoutFactor?: number | null;
  targetMarginEur?: number | null;
}
export interface AdSwitchRow {
  skuId: string; label: string; buyPrice: number;
  oldVk: number; newVk: number;
  profitOld: number;  // beim alten Satz und alten VK
  profitNew: number;  // beim neuen Satz und neuen VK
  floorEur: number;
  send: boolean;      // true = neuer Preis darf gesetzt werden
  reason?: string;
}

const profit = (sell: number, buy: number, rate: number, i: AdSwitchInput) => profitAtSellPrice({
  sellPrice: sell, buyPrice: buy, isChinaOrigin: i.isChinaOrigin,
  ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
  vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: rate, checkoutFactor: i.checkoutFactor ?? null,
});

/**
 * Vorschau je Variante. Sperre (Gesetz 61 / Freigabe 03.11.): der neue Gewinn darf nicht unter dem Boden der Stufe liegen —
 * AUSSER er ist mindestens so hoch wie der heutige (Freigabe-Tabelle: "Gewinn ≥ heute"). Sonst bleibt der alte Preis (send=false).
 */
export function planAdRateSwitch(i: AdSwitchInput): AdSwitchRow[] {
  const floorEur = profitFloorFor(i.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur);
  const sLoc = ebayLocationFactorFor(i.isChinaOrigin);
  const ratio = netFactor(i.fromRate, sLoc) / netFactor(i.toRate, sLoc);
  return i.rows.map(r => {
    const newVk = roundUpTo95(r.sellPrice * ratio);
    const profitOld = profit(r.sellPrice, r.buyPrice, i.fromRate, i);
    const profitNew = profit(newVk, r.buyPrice, i.toRate, i);
    const base = { skuId: r.skuId, label: r.label, buyPrice: r.buyPrice, oldVk: r.sellPrice, newVk, profitOld, profitNew, floorEur };
    if (!(r.sellPrice > 0) || !(r.buyPrice > 0)) return { ...base, newVk: r.sellPrice, send: false, reason: 'VK oder EK fehlt' };
    if (Math.abs(newVk - r.sellPrice) < 0.005) return { ...base, send: false, reason: 'Preis bleibt gleich' };
    if (profitNew < floorEur - 0.005 && profitNew < profitOld - 0.005) {
      return { ...base, send: false, reason: `Gewinn ${profitNew.toFixed(2)} € unter Boden ${floorEur.toFixed(2)} € und unter heute ${profitOld.toFixed(2)} € — nicht gesetzt` };
    }
    return { ...base, send: true };
  });
}

/**
 * Abgleich eBay ↔ App (Inhaber 03.11.2026 13:19: "wenn das in der App steht, muss es auch bei eBay so stehen").
 * Die App ist maßgeblich: weicht der Satz bei eBay ab, wird eBay beim Umstellen mit angeglichen (Preise rechnen vom App-Satz).
 * ebayRate: Satz laut eBay (0 = nicht beworben), null = andere Werbeart als Kosten-pro-Verkauf, undefined = nicht gelesen.
 * block: nur bei unbekannter Werbeart oder nicht lesbarem Status → dann nichts ändern.
 */
export function ebayRateCheck(appRate: number, ebayRate: number | null | undefined): { block: string | null; differs: boolean; note: string | null } {
  if (ebayRate === undefined) return { block: 'eBay-Werbestatus nicht lesbar — nichts geändert', differs: false, note: null };
  if (ebayRate === null) return { block: 'bei eBay andere Werbeart als Kosten-pro-Verkauf — erst im Seller Hub prüfen', differs: false, note: null };
  const differs = Math.abs(ebayRate - appRate) > 1e-9;
  return { block: null, differs, note: differs ? `Abgleich: bei eBay ${ebayRate} %, in der App ${appRate} % — eBay wird mit angeglichen` : null };
}
