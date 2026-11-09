// AUFSICHT an 7 App 045 Teil A (09.11.2026 12:50) Punkt 4 — "wie ändert sich der Mindest-VK je Live-Angebot" durch die
// gestaffelte eBay-Fixgebühr (0,35 € bei Bestellwert ≤ 10 €, sonst 0,45 € netto, × 1,19) gegenüber dem bisher gerechneten 0,30 €.
// REIN (Grundgesetz 2): keine DB, kein eBay. Der Endpunkt GET /api/reports/fixgebuehr-vorschau liest die Produkte und ruft nur das hier.
// Zeilen = je gelistetem Produkt die bei eBay angebotenen Varianten mit eigenem VK bzw. der Einzelartikel (productProfitRows, K-014) —
// dieselbe Auswahl wie Produkte-Tab/Preisalarm, keine eigene Varianten-Logik (Grundgesetz 8).
// Mindest-VK = computeMinSellPrice (Formel v2, Rundung floor95, Stufe des Produkts, Kassen-Faktor wie im Betrieb); "alt" rechnet
// dieselbe Funktion mit EBAY_FIXED_FEE_SCHEDULE_ALT (0,30 €), "neu" mit der Betriebs-Staffel. Nichts wird geschrieben.
import { activeCheckoutFactor } from './checkout-factor';
import {
  computeMinSellPrice, profitFloorFor, DEFAULT_PRICING_CONFIG, EBAY_FIXED_FEE_SCHEDULE, EBAY_FIXED_FEE_SCHEDULE_ALT,
  ebayFixedFeeNet, ebayOrderTotal, ebayLocationFactorFor, type EbayFixedFeeSchedule,
} from './pricing';
import { productProfitRows, productTarget, type ProfitProduct } from './target-margin-bulk';

export interface FixgebuehrVorschauProduct extends ProfitProduct {
  title?: string | null;
  ebayStatus?: string | null;
}

export interface FixgebuehrVorschauRow {
  productId: number;
  title: string;
  variant: string;              // Varianten-Bezeichnung ('' = Einzelartikel)
  skuId: string | null;
  ware: number;                 // EK der Zeile (vor Kassen-Faktor)
  isChinaOrigin: boolean;
  adRatePercent: number;
  targetMarginEur: number;
  currentSellPrice: number;     // heutiger VK der Zeile
  fixNetCurrentEur: number;     // Fixgebühr netto beim heutigen VK nach der neuen Staffel (0,35 / 0,45)
  minSellOld: number;           // Mindest-VK mit Fix 0,30 € (bisherige App-Rechnung)
  minSellNew: number;           // Mindest-VK mit gestaffelter Fixgebühr
  deltaMinSell: number;         // neu − alt
  currentBelowNewMin: boolean;  // heutiger VK < neuer Mindest-VK
}

export interface FixgebuehrVorschau {
  rows: FixgebuehrVorschauRow[];
  summary: { products: number; rows: number; minSellRaised: number; minSellUnchanged: number; currentBelowNewMin: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function minSellWith(schedule: EbayFixedFeeSchedule, p: FixgebuehrVorschauProduct, ware: number, isChinaOrigin: boolean, adRatePercent: number, target: number): number {
  return computeMinSellPrice({
    buyPrice: ware, isChinaOrigin, ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, vatFactor: DEFAULT_PRICING_CONFIG.vatFactor,
    adRatePercent, targetMarginEur: target, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur, rounding: 'floor95',
    profitFloorEur: profitFloorFor(target), checkoutFactor: activeCheckoutFactor(p.aliCheckoutFactor, p.aliCheckoutFactorAt),
    fixedFeeSchedule: schedule,
  }).minSellPrice;
}

/** Rein: Vorher/Nachher-Mindest-VK je gelisteter Variante (nur Produkte mit ebayStatus 'listed'). */
export function buildFixgebuehrVorschau(products: FixgebuehrVorschauProduct[]): FixgebuehrVorschau {
  const rows: FixgebuehrVorschauRow[] = [];
  let productCount = 0;
  for (const p of products) {
    if (p.ebayStatus !== 'listed') continue;
    productCount++;
    const adRatePercent = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
    const target = productTarget(p);
    for (const r of productProfitRows(p).rows) {
      if (r.buyPrice == null || r.isChinaOrigin == null) continue; // nichts raten
      const minSellOld = minSellWith(EBAY_FIXED_FEE_SCHEDULE_ALT, p, r.buyPrice, r.isChinaOrigin, adRatePercent, target);
      const minSellNew = minSellWith(EBAY_FIXED_FEE_SCHEDULE, p, r.buyPrice, r.isChinaOrigin, adRatePercent, target);
      rows.push({
        productId: p.id, title: p.title ?? '', variant: r.label, skuId: r.skuId ?? null, ware: r.buyPrice, isChinaOrigin: r.isChinaOrigin,
        adRatePercent, targetMarginEur: target, currentSellPrice: r.sellPrice,
        fixNetCurrentEur: ebayFixedFeeNet(ebayOrderTotal(r.sellPrice, ebayLocationFactorFor(r.isChinaOrigin))),
        minSellOld, minSellNew, deltaMinSell: round2(minSellNew - minSellOld),
        currentBelowNewMin: r.sellPrice < minSellNew - 1e-9,
      });
    }
  }
  return {
    rows,
    summary: {
      products: productCount, rows: rows.length,
      minSellRaised: rows.filter(r => r.deltaMinSell > 0).length,
      minSellUnchanged: rows.filter(r => r.deltaMinSell === 0).length,
      currentBelowNewMin: rows.filter(r => r.currentBelowNewMin).length,
    },
  };
}
