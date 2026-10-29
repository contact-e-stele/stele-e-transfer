// OFFEN 013 Schritt 5 (stele-220, „ja 220“ 29.10.2026): Varianten-VK von Hand setzen und an eBay senden.
// Anlass: Der Inhaber will Preise ÜBER dem Formel-Mindestpreis (24,45/24,45/25,45). Die bestehenden Wege
// (Stufenwechsel, Preisprüfung) senden nur Formelpreise. Reine Planung hier (Grundgesetz 2), Senden in api/index.ts.
// Schutzregeln: nie unter dem Formel-Mindestpreis (Formel v2 inkl. Kassen-Faktor, eine Stelle: computeMinSellPrice),
// Endung ,45/,95, höchstens +15 % je Schritt (MAX_AUTO_RAISE_PCT), nur bekannte skuIds.
import { computeMinSellPrice, DEFAULT_PRICING_CONFIG, PRICE_ENDINGS, profitAtSellPrice } from './pricing';
import { MAX_AUTO_RAISE_PCT } from './price-jump';

export interface ManualPriceEntry { skuId: string; price: number; label: string; isChinaOrigin: boolean }
export interface ManualPriceInput {
  productId: number;
  entries: ManualPriceEntry[];                 // alle AliExpress-Einträge des Produkts (price = Ware)
  currentSell: Record<string, number>;         // variantSellPrices heute
  requested: Record<string, number>;           // skuId → neuer VK
  adRatePercent: number;
  targetMarginEur: number;
  checkoutFactor: number | null;
}
export interface ManualPriceRow {
  skuId: string; label: string; oldSell: number | null; newSell: number; minSell: number;
  profitWithFactor: number; profitWithoutFactor: number;
}
export type ManualPricePlan = { ok: true; rows: ManualPriceRow[] } | { ok: false; errors: string[] };

const round2 = (n: number) => Math.round(n * 100) / 100;
export function hasPriceEnding(p: number): boolean {
  const cents = round2(p - Math.floor(p));
  return PRICE_ENDINGS.some(e => Math.abs(cents - e) < 0.001);
}

export function planManualVariantPrices(input: ManualPriceInput): ManualPricePlan {
  const errors: string[] = [];
  const rows: ManualPriceRow[] = [];
  const bySku = new Map(input.entries.map(e => [e.skuId, e]));
  const reqIds = Object.keys(input.requested);
  if (reqIds.length === 0) return { ok: false, errors: ['Keine Preise übergeben'] };
  for (const skuId of reqIds) {
    const e = bySku.get(skuId);
    const newSell = input.requested[skuId];
    if (!e) { errors.push(`skuId ${skuId} gehört nicht zu stele-${input.productId}`); continue; }
    if (typeof newSell !== 'number' || !Number.isFinite(newSell) || newSell <= 0) { errors.push(`${e.label}: ungültiger Preis`); continue; }
    if (!hasPriceEnding(newSell)) { errors.push(`${e.label}: ${newSell.toFixed(2)} endet nicht auf ,45 oder ,95`); continue; }
    const base = {
      buyPrice: e.price, isChinaOrigin: e.isChinaOrigin, ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,
      ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: input.adRatePercent,
    };
    const minSell = computeMinSellPrice({ ...base, targetMarginEur: input.targetMarginEur, safetyBufferEur: 0, rounding: 'floor95', checkoutFactor: input.checkoutFactor }).minSellPrice;
    if (newSell < minSell - 0.001) { errors.push(`${e.label}: ${newSell.toFixed(2)} liegt unter dem Mindestpreis ${minSell.toFixed(2)}`); continue; }
    const oldSell = input.currentSell[skuId] ?? null;
    if (oldSell != null && newSell > oldSell * (1 + MAX_AUTO_RAISE_PCT / 100) + 0.001) {
      errors.push(`${e.label}: ${oldSell.toFixed(2)} → ${newSell.toFixed(2)} ist mehr als +${MAX_AUTO_RAISE_PCT} % — in kleineren Schritten setzen`); continue;
    }
    rows.push({
      skuId, label: e.label, oldSell, newSell: round2(newSell), minSell,
      profitWithFactor: round2(profitAtSellPrice({ ...base, sellPrice: newSell, checkoutFactor: input.checkoutFactor })),
      profitWithoutFactor: round2(profitAtSellPrice({ ...base, sellPrice: newSell, checkoutFactor: null })),
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}
