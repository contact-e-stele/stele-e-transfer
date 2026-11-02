// OFFEN 020 (Aufsicht 02.11.2026): Margen-Anzeige im Listings- und Produkte-Tab war nicht verlässlich.
// Listings-Tab rechnete (VK − EK) / VK — ohne Gebühren, Anzeige, Versand und Einfuhr. Live-Fund 30.10.2026 stele-229:
// Anzeige 84,4 % bei echt −1,36 € je Verkauf. Jetzt: dieselbe Formel v2 wie überall (profitAtSellPrice, Grundgesetz 8).
import { profitAtSellPrice, isChinaShipping, DEFAULT_PRICING_CONFIG } from './pricing';

export interface MarginDisplayInput {
  sellPrice: number | null | undefined;
  buyPrice: number | null | undefined;
  shipsFrom?: string | null;
  adRatePercent?: number | null;   // null/undefined → DB-Standard 5 %
  checkoutFactor?: number | null;  // K-005, nur wenn aktiv bekannt
}

export interface MarginDisplay { profitEur: number; marginPct: number; tone: 'loss' | 'thin' | 'ok' }

/** Gewinn je Verkauf nach Formel v2 (Ware × Faktor, Versand 1,99 unter 10 €, Einfuhr, 15 % + 0,30 €, Anzeige, MwSt). */
export function marginDisplay(i: MarginDisplayInput): MarginDisplay | null {
  const sell = i.sellPrice ?? 0, buy = i.buyPrice ?? 0;
  if (!(sell > 0) || !(buy > 0)) return null;
  const profitEur = profitAtSellPrice({
    sellPrice: sell, buyPrice: buy, isChinaOrigin: isChinaShipping(i.shipsFrom),
    ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: i.adRatePercent ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent,
    checkoutFactor: i.checkoutFactor ?? null,
  });
  const tone = profitEur < 0 ? 'loss' : profitEur < 1 ? 'thin' : 'ok';
  return { profitEur, marginPct: profitEur / sell * 100, tone };
}

/** Anzeige-Text, z. B. "−1,36 € (−11,9 %)". */
export function formatMarginDisplay(m: MarginDisplay): string {
  const eur = (Math.round(m.profitEur * 100) / 100).toFixed(2).replace('.', ',').replace('-', '−');
  const pct = (Math.round(m.marginPct * 10) / 10).toFixed(1).replace('.', ',').replace('-', '−');
  return `${eur} € (${pct} %)`;
}
