// OFFEN 014 (stele-234/235, 29.10.2026): Ändert man den Artikel-VK (PATCH /products/:id/sellprice) bei einem Varianten-Produkt,
// blieben die Varianten-VK leer bzw. auf altem ebayPrice — die Karte zeigte "Erwartet −0,50 / −1,12".
// Regel (rein, Grundgesetz 2): Für NICHT gelistete Varianten-Produkte wird der neue Artikel-VK auf jede bei eBay ANGEBOTENE Variante
// (Kombination aus product.variants) übernommen — aber nur, wo er den Formel-Mindestpreis dieser Variante erreicht (nie darunter).
// Nicht angebotene Einträge bleiben unberührt. Gelistete Produkte: nichts (eBay-Preise ändern sich nur über die bestehenden Sende-Wege).
import { buildCombinations, entryMatchesCombo, type VariantGroup, type VariantPriceEntry } from './variant-resolver';
import { computeMinSellPrice, DEFAULT_PRICING_CONFIG, isChinaOriginForVariant, parseVariantSellPrices } from './pricing';

export interface ArticleVkEntry { skuId: string; attrs?: Record<string, string>; displayValues?: Record<string, string>; price: number }
export interface ArticleVkInput {
  sellPrice: number;
  groups: VariantGroup[];
  entries: ArticleVkEntry[];
  variantSellPricesJson: string | null | undefined;
  shipsFrom: string | null | undefined;
  adRatePercent: number;
  targetMarginEur: number;
  checkoutFactor: number | null;
}
export interface ArticleVkResult {
  variantSellPrices: Record<string, number>;
  set: Array<{ skuId: string; label: string; from: number | null; to: number }>;
  belowMin: Array<{ skuId: string; label: string; minSell: number }>;
}

export function planArticleVkToVariants(input: ArticleVkInput): ArticleVkResult {
  const combos = buildCombinations(input.groups);
  const next = { ...parseVariantSellPrices(input.variantSellPricesJson ?? null) };
  const set: ArticleVkResult['set'] = [];
  const belowMin: ArticleVkResult['belowMin'] = [];
  for (const e of input.entries) {
    if (!e.skuId || typeof e.price !== 'number' || e.price <= 0) continue;
    if (!combos.some(c => entryMatchesCombo(c, e as unknown as VariantPriceEntry))) continue; // nicht bei eBay angeboten
    const label = Object.values(e.displayValues ?? e.attrs ?? {}).filter(Boolean).join(' / ') || e.skuId;
    const minSell = computeMinSellPrice({
      buyPrice: e.price, isChinaOrigin: isChinaOriginForVariant(e.attrs, input.shipsFrom),
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: input.adRatePercent, targetMarginEur: input.targetMarginEur,
      safetyBufferEur: 0, rounding: 'floor95', checkoutFactor: input.checkoutFactor,
    }).minSellPrice;
    if (input.sellPrice < minSell - 0.001) { belowMin.push({ skuId: e.skuId, label, minSell }); continue; }
    set.push({ skuId: e.skuId, label, from: next[e.skuId] ?? null, to: input.sellPrice });
    next[e.skuId] = input.sellPrice;
  }
  return { variantSellPrices: next, set, belowMin };
}
