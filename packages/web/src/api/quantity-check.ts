// Mengen-Lese-Prüfung je Variante — eBay NUR LESEN (GET inventory_item, GET offer?sku, Trading GetItem). Logik: shared/quantity-check.ts.
import { evaluateQuantityRow, type QuantityRow, type QuantityVerdict } from '../shared/quantity-check';
import { parseGetItemBuyerPrices } from '../shared/ebay-buyer-price';
import { resolveVariantQuantity } from './ebay';

const BASE = 'https://api.ebay.com';

export async function readInventoryQty(sku: string, token: string, f: typeof fetch = fetch): Promise<number | null> {
  const r = await f(`${BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const d = await r.json() as { availability?: { shipToLocationAvailability?: { quantity?: number } } };
  const q = d.availability?.shipToLocationAvailability?.quantity;
  return typeof q === 'number' ? q : null;
}

export async function readOfferQty(sku: string, token: string, f: typeof fetch = fetch): Promise<{ qty: number | null; offers: number }> {
  const r = await f(`${BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_DE`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { qty: null, offers: 0 };
  const d = await r.json() as { offers?: Array<{ availableQuantity?: number }> };
  const offers = d.offers ?? [];
  const q = offers.map(o => o.availableQuantity).find(x => typeof x === 'number');
  return { qty: typeof q === 'number' ? q : null, offers: offers.length };
}

export async function runQuantityCheck(input: {
  productId: number;
  ebayListingId: string;
  variantEntries: Array<{ attrs?: Record<string, string>; stock?: number }>;
  slug: (s: string) => string;
  maxQty: number;
  token: string;
  getItemXml: () => Promise<{ httpStatus: number; xml: string }>;
  fetchFn?: typeof fetch;
}): Promise<{ rows: QuantityVerdict[]; error?: string }> {
  const f = input.fetchFn ?? fetch;
  const g = await input.getItemXml();
  const buyer = parseGetItemBuyerPrices(g.xml);
  if (g.httpStatus !== 200 || buyer.error) return { rows: [], error: `GetItem nicht lesbar: ${buyer.error ?? 'HTTP ' + g.httpStatus}` };
  const stockBySku = new Map<string, number | undefined>();
  for (const v of input.variantEntries) {
    const suffix = Object.values(v.attrs ?? {}).map(input.slug).filter(Boolean).join('-');
    stockBySku.set(`stele-${input.productId}-${suffix}`, v.stock);
  }
  const rows: QuantityVerdict[] = [];
  for (const b of buyer.rows) {
    const sku = b.sku || `stele-${input.productId}`;
    const [inv, off] = await Promise.all([readInventoryQty(sku, input.token, f), readOfferQty(sku, input.token, f)]);
    const aliStock = stockBySku.has(sku) ? (stockBySku.get(sku) ?? null) : null;
    const row: QuantityRow = {
      sku, label: sku.replace(`stele-${input.productId}-`, ''), inventoryQty: inv, offerQty: off.qty, listingQty: b.quantity, soldQty: b.quantitySold,
      aliStock, targetQty: aliStock != null ? resolveVariantQuantity(aliStock, 0, input.maxQty) : null,
      error: off.offers > 1 ? `${off.offers} Offers für ${sku}` : undefined,
    };
    rows.push(evaluateQuantityRow(row));
  }
  return { rows };
}
