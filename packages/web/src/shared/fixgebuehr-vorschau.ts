// AUFSICHT an 7 App 045 Teil A (09.11.2026 12:50) Punkt 4 — "wie ändert sich der Mindest-VK je Live-Angebot" durch die
// gestaffelte eBay-Fixgebühr (0,35 € bei Bestellwert ≤ 10 €, sonst 0,45 € netto, × 1,19) gegenüber dem bisher gerechneten 0,30 €.
// REIN (Grundgesetz 2): keine DB, kein eBay. Der Endpunkt GET /api/reports/fixgebuehr-vorschau liest die Produkte und ruft nur das hier.
// Zeilen = je gelistetem Produkt die bei eBay angebotenen Varianten mit eigenem VK bzw. der Einzelartikel (productProfitRows, K-014) —
// dieselbe Auswahl wie Produkte-Tab/Preisalarm, keine eigene Varianten-Logik (Grundgesetz 8).
// Mindest-VK = computeMinSellPrice (Formel v2, Rundung floor95, Stufe des Produkts, Kassen-Faktor wie im Betrieb); "alt" rechnet
// dieselbe Funktion mit EBAY_FIXED_FEE_SCHEDULE_ALT (0,30 €), "neu" mit der Betriebs-Staffel. Nichts wird geschrieben.
// Bündel A+B (Teil B): "alt" = Stand main vor PR #304 = Provision 15 % (EBAY_FEE_RATE_ALT_PERCENT) + 0,30 €; "neu" = Provision je
// eBay-Kategorie (ebayFeeRatePercentFor(products.ebayCategory)) + 0,35/0,45 €. Dieselbe Funktion nutzt scripts/mindest-vk-vergleich.ts.
import { activeCheckoutFactor } from './checkout-factor';
import {
  computeMinSellPrice, profitFloorFor, DEFAULT_PRICING_CONFIG, EBAY_FIXED_FEE_SCHEDULE, EBAY_FIXED_FEE_SCHEDULE_ALT,
  ebayFixedFeeNet, ebayOrderTotal, ebayLocationFactorFor, ebayFeeRatePercentFor, EBAY_FEE_RATE_ALT_PERCENT, type EbayFixedFeeSchedule,
} from './pricing';
import { earUmlageFor } from './electric';
import { productProfitRows, productTarget, type ProfitProduct } from './target-margin-bulk';

export interface FixgebuehrVorschauProduct extends ProfitProduct {
  title?: string | null;
  ebayStatus?: string | null;
  isElectric?: number | boolean | null; // A-029: EAR-Umlage in K wie im Betrieb (fehlt → 0)
}

export interface FixgebuehrVorschauRow {
  productId: number;
  title: string;
  variant: string;              // Varianten-Bezeichnung ('' = Einzelartikel)
  skuId: string | null;
  ware: number;                 // EK der Zeile (vor Kassen-Faktor)
  isChinaOrigin: boolean;
  ebayCategory: string | null;  // products.ebayCategory
  ratePercentOld: number;       // Provision alt (immer 15 %)
  ratePercentNew: number;       // Provision neu je Kategorie (unbekannt → 15 %)
  adRatePercent: number;
  targetMarginEur: number;
  currentSellPrice: number;     // heutiger VK der Zeile
  fixNetCurrentEur: number;     // Fixgebühr netto beim heutigen VK nach der neuen Staffel (0,35 / 0,45)
  minSellOld: number;           // Mindest-VK alt: 15 % + Fix 0,30 € (Stand main vor PR #304)
  minSellNew: number;           // Mindest-VK neu: Satz je Kategorie + gestaffelte Fixgebühr
  deltaMinSell: number;         // neu − alt
  currentBelowNewMin: boolean;  // heutiger VK < neuer Mindest-VK
}

export interface FixgebuehrVorschau {
  rows: FixgebuehrVorschauRow[];
  summary: { products: number; rows: number; minSellRaised: number; minSellLowered: number; minSellUnchanged: number; currentBelowNewMin: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function minSellWith(schedule: EbayFixedFeeSchedule, ratePercent: number, p: FixgebuehrVorschauProduct, ware: number, isChinaOrigin: boolean, adRatePercent: number, target: number): number {
  return computeMinSellPrice({
    buyPrice: ware, isChinaOrigin, ebayFeeRatePercent: ratePercent, vatFactor: DEFAULT_PRICING_CONFIG.vatFactor,
    earUmlageEur: earUmlageFor(p.isElectric ?? null),
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
      const ratePercentNew = ebayFeeRatePercentFor(p.ebayCategory);
      const minSellOld = minSellWith(EBAY_FIXED_FEE_SCHEDULE_ALT, EBAY_FEE_RATE_ALT_PERCENT, p, r.buyPrice, r.isChinaOrigin, adRatePercent, target);
      const minSellNew = minSellWith(EBAY_FIXED_FEE_SCHEDULE, ratePercentNew, p, r.buyPrice, r.isChinaOrigin, adRatePercent, target);
      rows.push({
        productId: p.id, title: p.title ?? '', variant: r.label, skuId: r.skuId ?? null, ware: r.buyPrice, isChinaOrigin: r.isChinaOrigin,
        ebayCategory: p.ebayCategory ?? null, ratePercentOld: EBAY_FEE_RATE_ALT_PERCENT, ratePercentNew,
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
      minSellLowered: rows.filter(r => r.deltaMinSell < 0).length,
      minSellUnchanged: rows.filter(r => r.deltaMinSell === 0).length,
      currentBelowNewMin: rows.filter(r => r.currentBelowNewMin).length,
    },
  };
}

// ─── Eingabe aus GET /api/products (Bündel A+B, scripts/mindest-vk-vergleich.ts) ─────────────────────────────────────────
// Die Felder, die der Vergleich je Produkt braucht — echte Feldnamen der /api/products-Antwort (products-Zeile, variants geparst):
export const MINDEST_VK_INPUT_FIELDS = [
  'id', 'ebayStatus', 'ebayCategory', 'shipsFrom', 'adRate', 'targetMarginEur', 'sellPrice', 'buyPrice',
  'variants', 'variantPrices', 'variantSellPrices', 'aliCheckoutFactor', 'aliCheckoutFactorAt', 'isElectric',
] as const;

/** Rein: Rohliste (z. B. JSON aus /api/products) → Vorschau-Produkte. Nur die Felder oben; fehlende optionale Felder = null. */
export function vorschauProductsFromApi(raw: unknown): FixgebuehrVorschauProduct[] {
  if (!Array.isArray(raw)) throw new Error('Eingabe muss eine JSON-Liste von Produkten sein');
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v));
  return raw.map((r, i) => {
    if (!r || typeof r !== 'object') throw new Error(`Eintrag ${i}: kein Objekt`);
    const o = r as Record<string, unknown>;
    if (num(o.id) == null) throw new Error(`Eintrag ${i}: id fehlt`);
    return {
      id: o.id as number,
      title: str(o.generatedTitle) ?? str(o.title) ?? '',
      ebayStatus: str(o.ebayStatus),
      ebayCategory: str(o.ebayCategory),
      shipsFrom: str(o.shipsFrom),
      adRate: num(o.adRate),
      targetMarginEur: num(o.targetMarginEur),
      sellPrice: num(o.sellPrice),
      buyPrice: num(o.buyPrice),
      variants: o.variants ?? null,
      variantPrices: str(o.variantPrices),
      variantSellPrices: str(o.variantSellPrices),
      aliCheckoutFactor: num(o.aliCheckoutFactor),
      aliCheckoutFactorAt: str(o.aliCheckoutFactorAt),
      isElectric: typeof o.isElectric === 'boolean' ? o.isElectric : num(o.isElectric),
    };
  });
}
