// Mengen-Lese-Prüfung je Variante — eBay NUR LESEN (GET inventory_item, GET offer?sku, Trading GetItem). Logik: shared/quantity-check.ts.
import { evaluateQuantityRow, type QuantityRow, type QuantityVerdict } from '../shared/quantity-check';
import { parseGetItemBuyerPrices } from '../shared/ebay-buyer-price';
import { stockBySkuFor } from '../shared/variant-stock';
import type { VariantGroup, VariantPriceEntry } from '../shared/variant-resolver';
import { resolveVariantQuantity, getInventoryItemQuantity } from './ebay';

const BASE = 'https://api.ebay.com';

export const readInventoryQty = getInventoryItemQuantity; // eine Stelle (Grundgesetz 8)

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
  variantEntries: VariantPriceEntry[];
  variantGroups?: VariantGroup[]; // product.variants — für umbenannte Anzeigewerte (stele-224)
  slug?: (s: string) => string;   // nicht mehr benutzt (SKU-Aufbau jetzt in shared/variant-stock.ts)
  maxQty: number;
  token: string;
  getItemXml: () => Promise<{ httpStatus: number; xml: string }>;
  fetchFn?: typeof fetch;
}): Promise<{ rows: QuantityVerdict[]; error?: string }> {
  const f = input.fetchFn ?? fetch;
  const g = await input.getItemXml();
  const buyer = parseGetItemBuyerPrices(g.xml);
  if (g.httpStatus !== 200 || buyer.error) return { rows: [], error: `GetItem nicht lesbar: ${buyer.error ?? 'HTTP ' + g.httpStatus}` };
  const stockBySku = stockBySkuFor(input.productId, input.variantGroups ?? [], input.variantEntries);
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
