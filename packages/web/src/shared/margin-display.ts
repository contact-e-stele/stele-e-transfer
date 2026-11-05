// OFFEN 020 (Aufsicht 02.11.2026): Margen-Anzeige im Listings- und Produkte-Tab war nicht verlässlich.
// Listings-Tab rechnete (VK − EK) / VK — ohne Gebühren, Anzeige, Versand und Einfuhr. Live-Fund 30.10.2026 stele-229:
// Anzeige 84,4 % bei echt −1,36 € je Verkauf. Jetzt: dieselbe Formel v2 wie überall (profitAtSellPrice, Grundgesetz 8).
import { profitAtSellPrice, isChinaShipping, DEFAULT_PRICING_CONFIG } from './pricing';
import { productProfitRows, type ProfitProduct } from './target-margin-bulk';

export interface MarginDisplayInput {
  sellPrice: number | null | undefined;
  buyPrice: number | null | undefined;
  shipsFrom?: string | null;
  adRatePercent?: number | null;   // null/undefined → DB-Standard 5 %
  checkoutFactor?: number | null;  // K-005, nur wenn aktiv bekannt
}

export interface MarginDisplay { profitEur: number; marginPct: number; tone: 'loss' | 'thin' | 'ok'; buyPriceEur?: number }

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

/**
 * K-017 Punkt 6 (Kalkulator 05.11.2026, stele-225): Karte „Gewinn X € (Y %)“ im Listings-Tab aus DERSELBEN Quelle wie „Erwartet“
 * (productProfitRows: VK/EK je gelisteter Variante, Herkunft je Variante, Kassen-Faktor) — schlechteste Zeile, wie „Erwartet“.
 * Vorher: eBay-Artikelpreis mit products.buyPrice (alter/billigster EK) → 225 zeigte 1,50 € statt Erwartet 2,52 €.
 * Keine zählende Zeile → null (keine Anzeige statt einer geratenen Zahl).
 */
export function cardMarginDisplay(p: ProfitProduct): MarginDisplay | null {
  const { rows } = productProfitRows(p);
  if (rows.length === 0) return null;
  const worst = rows.reduce((a, b) => (b.profit < a.profit ? b : a));
  if (!(worst.sellPrice > 0)) return null;
  const tone = worst.profit < 0 ? 'loss' : worst.profit < 1 ? 'thin' : 'ok';
  // K-017 Bedingung 3 (Kalkulator 21:40): EK neben dem Gewinn = EK genau dieser Zeile (nicht products.buyPrice).
  return { profitEur: worst.profit, marginPct: worst.profit / worst.sellPrice * 100, tone, buyPriceEur: worst.buyPrice };
}
