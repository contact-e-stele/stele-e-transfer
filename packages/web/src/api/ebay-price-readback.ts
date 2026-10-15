// eBay-Preise je Variante zurücklesen und die App-Preise (variant_sell_prices / sellPrice) darauf setzen.
// Anlass (Inhaber 15.10.2026 18:58, "Ja App-Preise 220 = eBay"): stele-220 hatte in der App je Variante 1,00 € mehr gespeichert als bei
// eBay (App 20,95/22,95/21,95, eBay 19,95/21,95/20,95). "Preis halten" (K-008) hält den App-Preis — er muss also dem eBay-Preis entsprechen.
// Zugleich Baustein für K-007 Punkt 4 (Rücklesen nach dem Senden).
// eBay wird NUR gelesen (GET offer?sku=…). Geschrieben wird nur die App-Datenbank, und nur im Modus apply.
// Zuordnung skuId → eBay-SKU über DENSELBEN Resolver wie beim Listen/Anheben (resolveVariantEntries, Grundgesetz 8); mehrdeutig → nichts.
import { resolveVariantEntries, type VariantGroup, type VariantPriceEntry } from '../shared/variant-resolver';

export interface EbayPriceRow { skuId: string | null; sku: string; label: string; ebayPrice: number | null; appPrice: number | null; error?: string }
export interface EbayPriceReadback { ok: boolean; reason?: string; isVariant: boolean; rows: EbayPriceRow[] }

const EBAY_API_BASE = 'https://api.ebay.com';

/** Live-Preis eines Offers per SKU (nur GET). Mehrere Offers mit verschiedenen Preisen → null + Fehler (nichts geraten). */
export async function readOfferPrice(sku: string, token: string, fetchFn: typeof fetch = fetch): Promise<{ price: number | null; error?: string }> {
  const res = await fetchFn(`${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_DE`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { price: null, error: `GET offer?sku=${sku}: ${res.status}` };
  const data = await res.json() as { offers?: Array<{ pricingSummary?: { price?: { value?: string } } }> };
  const prices = (data.offers ?? []).map(o => parseFloat(String(o.pricingSummary?.price?.value ?? ''))).filter(Number.isFinite);
  if (prices.length === 0) return { price: null, error: `Kein Offer/Preis für SKU ${sku}` };
  const uniq = [...new Set(prices.map(p => p.toFixed(2)))];
  if (uniq.length > 1) return { price: null, error: `SKU ${sku}: mehrere Offers mit verschiedenen Preisen (${uniq.join(', ')})` };
  return { price: prices[0] };
}

export async function readEbaySellPrices(input: {
  productId: number;
  groups: VariantGroup[];
  entries: VariantPriceEntry[];
  isVariant: boolean;
  appSellPrices: Record<string, number>;   // variant_sell_prices
  appSellPrice: number | null;             // Einzelartikel
  token: string;
  getGroupSkus: (groupSku: string) => Promise<string[]>;
  fetchFn?: typeof fetch;
}): Promise<EbayPriceReadback> {
  const f = input.fetchFn ?? fetch;
  if (!input.isVariant) {
    const sku = `stele-${input.productId}`;
    const r = await readOfferPrice(sku, input.token, f);
    return { ok: r.price != null, reason: r.error, isVariant: false, rows: [{ skuId: null, sku, label: '', ebayPrice: r.price, appPrice: input.appSellPrice, error: r.error }] };
  }
  const resolved = resolveVariantEntries(input.productId, input.groups, input.entries);
  const ambiguous = resolved.filter(r => r.error?.startsWith('Mehrdeutig'));
  if (ambiguous.length > 0) return { ok: false, reason: `${ambiguous.length} mehrdeutige Kombination(en) — nichts gelesen`, isVariant: true, rows: [] };
  const realSkus = await input.getGroupSkus(`stele-${input.productId}-GROUP`);
  const rows: EbayPriceRow[] = [];
  for (const r of resolved) {
    if (!r.entry || r.error) continue;
    const skuId = r.entry.skuId;
    const base = { skuId, sku: r.sku, label: Object.values(r.displayValues ?? {}).join(' / '), appPrice: input.appSellPrices[skuId] ?? null };
    if (!realSkus.includes(r.sku)) { rows.push({ ...base, ebayPrice: null, error: `SKU ${r.sku} nicht in der eBay-Gruppe` }); continue; }
    const p = await readOfferPrice(r.sku, input.token, f);
    rows.push({ ...base, ebayPrice: p.price, error: p.error });
  }
  return { ok: rows.length > 0 && rows.every(r => r.ebayPrice != null), isVariant: true, rows,
    reason: rows.length === 0 ? 'keine zuordenbare Variante' : rows.some(r => r.ebayPrice == null) ? 'nicht alle Varianten lesbar' : undefined };
}

/** Neue App-Preise aus der Rücklesung (nur Zeilen mit gelesenem eBay-Preis; bestehende andere Einträge bleiben). */
export function applyEbayPrices(appSellPrices: Record<string, number>, rows: EbayPriceRow[]): { variantSellPrices: Record<string, number>; changed: Array<{ skuId: string; from: number | null; to: number }> } {
  const out = { ...appSellPrices };
  const changed: Array<{ skuId: string; from: number | null; to: number }> = [];
  for (const r of rows) {
    if (r.skuId == null || r.ebayPrice == null) continue;
    if (r.appPrice == null || Math.abs(r.appPrice - r.ebayPrice) > 0.004) changed.push({ skuId: r.skuId, from: r.appPrice, to: r.ebayPrice });
    out[r.skuId] = r.ebayPrice;
  }
  return { variantSellPrices: out, changed };
}
