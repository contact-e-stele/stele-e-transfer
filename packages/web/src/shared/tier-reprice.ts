// A-017: Stufenwechsel A–D → neue Verkaufspreise je Variante/Einzelartikel nach Preisformel v2. REINE Funktionen (kein DB-,
// kein eBay-Zugriff) — die EINE Rechenstelle für Produkte-Tab, "Bei eBay listen"-Vergleich und Listings-Tab ist
// computeMinSellPrice (shared/pricing.ts, Rundung 'floor95' mit Boden der Stufe), dieselbe Funktion wie Preisprüfung/Listing.
//
// Quelle des Varianten-VK (im Code geklärt): `products.variant_sell_prices` (Teil 3, 13.09.2026) ist die gültige Quelle und hat
// Vorrang vor dem alten `variantPrices[].ebayPrice` (resolveVariantSellPrice). Neue Schreibvorgänge gehen deshalb NUR in
// variant_sell_prices (Einzelartikel: sellPrice); das alte ebayPrice wird weiter nur gelesen, nie neu geschrieben.
import { MARGIN_TIERS } from './constants';
import { isVariantProduct } from './variant-product';
import { collapseDuplicateEntries } from './variant-dedupe';
import type { VariantGroup } from './variant-resolver';
import {
  computeMinSellPrice, profitAtSellPrice, isChinaShipping, parseVariantSellPrices, resolveVariantSellPrice,
  serializeVariantSellPrices, DEFAULT_PRICING_CONFIG,
} from './pricing';

export interface RepriceProduct {
  id: number;
  variants: unknown;                  // product.variants (JSON-Text oder geparst) — für isVariantProduct (A-019)
  buyPrice: number | null;
  sellPrice: number | null;
  shipsFrom?: string | null;
  adRate: number | null;
  variantPrices: string | null;       // JSON [{skuId, attrs, price, ebayPrice?, displayValues?}]
  variantSellPrices?: string | null;  // JSON {skuId: VK}
}

export interface TierPlanRow {
  skuId: string | null;               // null bei Einzelartikel
  label: string;                      // '' bei Einzelartikel
  attrs?: Record<string, string>;
  displayValues?: Record<string, string>;
  ware: number;
  oldSell: number | null;
  newSell: number;
  oldProfit: number | null;           // Gewinn beim alten VK nach Formel v2
  newProfit: number;                  // Gewinn beim neuen VK nach Formel v2
}

export interface TierPlan {
  productId: number;
  isVariant: boolean;
  targetMarginEur: number;
  rows: TierPlanRow[];
  changedCount: number;               // Zeilen, in denen newSell != oldSell (oldSell null zählt als Änderung)
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Plan für den Wechsel auf `newTargetEur`: je Variante (Einzelartikel: eine Zeile) der Formelpreis nach v2. Zeilen ohne
// Einkaufspreis fehlen (nichts geraten). Alter VK: variant_sell_prices → altes ebayPrice → Produkt-VK; Einzelartikel: sellPrice.
// groups (A-023): Varianten-Gruppen des Produkts. Mit groups werden Dubletten (dieselbe Kombination mehrfach in variantPrices) zu EINER Zeile
// mit dem höchsten EK zusammengelegt — sonst ist die Zuordnung beim Senden mehrdeutig (Live-Fund stele-119).
export function planTierReprice(p: RepriceProduct, newTargetEur: number, groups?: VariantGroup[]): TierPlan {
  const china = isChinaShipping(p.shipsFrom);
  const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
  const fees = {
    isChinaOrigin: china, ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,
    ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
  };
  const newSellFor = (ware: number) => computeMinSellPrice({
    ...fees, buyPrice: ware, targetMarginEur: newTargetEur, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur, rounding: 'floor95',
  }).minSellPrice;
  const mkRow = (base: Pick<TierPlanRow, 'skuId' | 'label' | 'attrs' | 'displayValues'>, ware: number, oldSell: number | null): TierPlanRow => {
    const newSell = newSellFor(ware);
    return {
      ...base, ware, oldSell, newSell,
      oldProfit: oldSell != null ? profitAtSellPrice({ ...fees, sellPrice: oldSell, buyPrice: ware }) : null,
      newProfit: profitAtSellPrice({ ...fees, sellPrice: newSell, buyPrice: ware }),
    };
  };

  let entries: Array<{ skuId: string; attrs?: Record<string, string>; displayValues?: Record<string, string>; price: number; ebayPrice?: number }> = [];
  try { entries = p.variantPrices ? JSON.parse(p.variantPrices) : []; } catch { entries = []; }
  // isVariant VOR dem Zusammenlegen, über die EINE Definition (A-019, variant-product.ts): ein Produkt mit einer einzigen Kombination und Dubletten bleibt ein Varianten-Produkt.
  const isVariant = isVariantProduct(p.variants, p.variantPrices);
  if (groups) entries = collapseDuplicateEntries(groups, entries).entries;
  const rows: TierPlanRow[] = [];
  if (isVariant) {
    const stored = parseVariantSellPrices(p.variantSellPrices);
    for (const e of entries) {
      if (typeof e.price !== 'number' || e.price <= 0) continue;
      const label = Object.values(e.attrs ?? {}).join(' / ') || `…${e.skuId.slice(-6)}`;
      rows.push(mkRow(
        { skuId: e.skuId, label, attrs: e.attrs, displayValues: e.displayValues },
        e.price, resolveVariantSellPrice(e.skuId, stored, e).sellPrice ?? p.sellPrice,
      ));
    }
  } else if (p.buyPrice != null && p.buyPrice > 0) {
    rows.push(mkRow({ skuId: null, label: '' }, p.buyPrice, p.sellPrice));
  }
  const changedCount = rows.filter(r => r.oldSell == null || round2(r.oldSell) !== round2(r.newSell)).length;
  return { productId: p.id, isVariant, targetMarginEur: newTargetEur, rows, changedCount };
}

// Was in die DB geschrieben wird, wenn der Plan übernommen wird: Varianten → variant_sell_prices (bestehende Einträge anderer
// SKUs bleiben, geplante überschreiben); Einzelartikel → sellPrice. Nichts anderes (kein ebayPrice, kein buyPrice).
export function storePatchForPlan(p: RepriceProduct, plan: TierPlan): { variantSellPrices?: string; sellPrice?: number } {
  if (plan.rows.length === 0) return {};
  if (!plan.isVariant) return { sellPrice: plan.rows[0].newSell };
  const merged = parseVariantSellPrices(p.variantSellPrices);
  for (const r of plan.rows) if (r.skuId) merged[r.skuId] = r.newSell;
  return { variantSellPrices: serializeVariantSellPrices(Object.entries(merged).map(([skuId, sellPrice]) => ({ skuId, sellPrice }))) };
}

export const TIER_REPRICE_MAX_PRODUCTS = 10;

export type TierRepriceMode = 'preview' | 'apply';

// Die in der Vorschau bestätigten Preise: productId (als Text) → { skuId bzw. '' bei Einzelartikel → neuer VK }. Der Server rechnet bei
// 'apply' neu und lehnt ab, wenn sich der Plan seit der Vorschau geändert hat (z. B. Einkaufspreis per Scrape) — gesendet wird nur,
// was bestätigt wurde.
export type ExpectedPrices = Record<string, Record<string, number>>;

export const expectedKey = (skuId: string | null): string => skuId ?? '';
export function expectedFromPlan(plan: TierPlan): Record<string, number> {
  return Object.fromEntries(plan.rows.map(r => [expectedKey(r.skuId), r.newSell]));
}
// null = passt; sonst Klartext, was abweicht.
export function compareExpected(plan: TierPlan, expected: Record<string, number> | undefined): string | null {
  if (!expected) return null;
  const keys = new Set([...plan.rows.map(r => expectedKey(r.skuId)), ...Object.keys(expected)]);
  for (const k of keys) {
    const row = plan.rows.find(r => expectedKey(r.skuId) === k);
    const exp = expected[k];
    if (!row || typeof exp !== 'number' || Math.round(row.newSell * 100) !== Math.round(exp * 100)) {
      return `Der Preisplan hat sich seit der Vorschau geändert (${k === '' ? 'Artikel' : 'Variante ' + k}: bestätigt ${exp ?? '–'}, jetzt ${row ? row.newSell : '–'}) — bitte Vorschau neu laden.`;
    }
  }
  return null;
}
export type TierRepriceParse =
  | { ok: true; productIds: number[]; targetMarginEur: number; mode: TierRepriceMode; confirm: boolean; sendToEbay: boolean; expected?: ExpectedPrices }
  | { ok: false; error: string };

// Validierung für POST /products/tier-reprice. Nur Stufen A–D (4,50 nicht wählbar, kanonischer Wert), max. 10 Produkte je Aufruf,
// 'apply' nur mit confirm === true (strikt). sendToEbay nur als echtes Boolean.
export function parseTierRepriceBody(body: unknown): TierRepriceParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body fehlt' };
  const b = body as Record<string, unknown>;
  const tier = typeof b.targetMarginEur === 'number' ? MARGIN_TIERS.find(x => Math.abs(x.targetEur - (b.targetMarginEur as number)) < 0.005) : undefined;
  if (!tier) return { ok: false, error: '"targetMarginEur" muss eine Margen-Stufe sein (1,00 / 1,50 / 2,00 / 3,00)' };
  if (b.mode !== 'preview' && b.mode !== 'apply') return { ok: false, error: '"mode" muss "preview" oder "apply" sein' };
  const ids = b.productIds;
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: '"productIds" muss eine nicht-leere Liste sein' };
  if (ids.length > TIER_REPRICE_MAX_PRODUCTS) return { ok: false, error: `Höchstens ${TIER_REPRICE_MAX_PRODUCTS} Produkte je Aufruf (übergeben: ${ids.length})` };
  if (!ids.every(i => typeof i === 'number' && Number.isInteger(i) && i > 0)) return { ok: false, error: '"productIds" darf nur positive ganze Zahlen enthalten' };
  if (b.sendToEbay !== undefined && typeof b.sendToEbay !== 'boolean') return { ok: false, error: '"sendToEbay" muss true oder false sein' };
  let expected: ExpectedPrices | undefined;
  if (b.expected !== undefined) {
    const e = b.expected;
    const valid = !!e && typeof e === 'object' && !Array.isArray(e) && Object.values(e as Record<string, unknown>).every(m =>
      !!m && typeof m === 'object' && !Array.isArray(m) && Object.values(m as Record<string, unknown>).every(v => typeof v === 'number' && Number.isFinite(v)));
    if (!valid) return { ok: false, error: '"expected" muss { productId: { skuId: Preis } } sein' };
    expected = e as ExpectedPrices;
  }
  const confirm = b.confirm === true;
  if (b.mode === 'apply' && !confirm) return { ok: false, error: '"confirm": true fehlt — Preise werden nur nach ausdrücklicher Bestätigung gespeichert/gesendet' };
  return { ok: true, productIds: [...new Set(ids as number[])], targetMarginEur: tier.targetEur, mode: b.mode, confirm, sendToEbay: b.sendToEbay === true, expected };
}

export type TierRepriceAction =
  | { action: 'preview' }
  | { action: 'store_only' }          // nicht live gelistet: Preise in der App speichern, nichts an eBay
  | { action: 'store_and_send' }      // live gelistet + ausdrücklich sendToEbay: erst an eBay, nur bei vollem Erfolg danach speichern
  | { action: 'rejected'; error: string };

// EINE Entscheidungsstelle, ob eBay überhaupt berührt werden darf: nur 'apply' + confirm + sendToEbay + live. Ein live gelistetes
// Produkt wird NIE ohne sendToEbay angefasst (kein automatisches Senden, keine App-Preise, die von eBay abweichen).
export function decideTierRepriceAction(input: { mode: TierRepriceMode; confirm: boolean; sendToEbay: boolean; isLive: boolean }): TierRepriceAction {
  if (input.mode === 'preview') return { action: 'preview' };
  if (!input.confirm) return { action: 'rejected', error: 'confirm fehlt' };
  // Wer ausdrücklich an eBay senden will, aber ein Produkt trifft, das laut App NICHT live gelistet ist (Status/ListingId), bekommt keine
  // stille Nur-App-Speicherung (sonst weichen App-Preise unbemerkt von eBay ab).
  if (!input.isLive && input.sendToEbay) return { action: 'rejected', error: 'Laut App nicht live gelistet (Status/ListingId) — nichts gesendet, nichts gespeichert. Listing in der App verknüpfen oder ohne Senden speichern.' };
  if (!input.isLive) return { action: 'store_only' };
  if (!input.sendToEbay) return { action: 'rejected', error: 'Live gelistet: Preise nur mit sendToEbay:true (ausdrückliches Senden an eBay) — sonst nur das Ziel setzen' };
  return { action: 'store_and_send' };
}
