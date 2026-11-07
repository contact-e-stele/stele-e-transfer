// K-018 PR B: echte Abhängigkeiten für runVariantReprice (eBay senden, App speichern, zurücklesen) — reiner Extract aus der Route
// POST /products/variant-reprice (Grundgesetz 8), damit „Auswahl senken/anheben“ und „automatisch senken“ GENAU denselben Weg nutzen.
import { eq } from 'drizzle-orm';
import type { VariantRepriceDeps } from './variant-reprice';

export function buildVariantRepriceDeps(product: Parameters<typeof import('../shared/price-hold').resolvePriceHolds>[0]): VariantRepriceDeps {
  return {
    heldSkuIds: async (pr) => {
      const { getPriceHolds } = await import('./price-holds');
      const { resolvePriceHolds } = await import('../shared/price-hold');
      const holds = await getPriceHolds(); // nicht lesbar → Fehler (lieber nichts senken als "Preis halten" übergehen)
      return resolvePriceHolds(product, holds[String(pr.id)]).heldKeys;
    },
    send: async (id, groups, entries, changes, direction) => {
      const { sendVariantPriceChanges } = await import('./price-monitor');
      const { getAccessToken } = await import('./ebay');
      return sendVariantPriceChanges(id, groups, entries, changes, await getAccessToken(), fetch, direction === 'up' ? 'raise' : 'lower');
    },
    store: async (id, json) => {
      const { db } = await import('../db/index');
      const schema = await import('../db/schema');
      await db.update(schema.products).set({ variantSellPrices: json, updatedAt: new Date().toISOString() }).where(eq(schema.products.id, id));
    },
    readBack: async (pr) => {
      const { parseVariantGroupsJson } = await import('./price-monitor');
      const { getAccessToken, getInventoryItemGroupSkus, getItemBuyerPricesXml } = await import('./ebay');
      const { readEbaySellPrices } = await import('./ebay-price-readback');
      const { parseGetItemBuyerPrices } = await import('../shared/ebay-buyer-price');
      const { isVariantProduct } = await import('../shared/variant-product');
      const { parseVariantSellPrices } = await import('../shared/pricing');
      const token = await getAccessToken();
      let entries: Array<{ skuId: string; attrs?: Record<string, string>; price: number }> = [];
      try { const pv = pr.variantPrices ? JSON.parse(pr.variantPrices) : []; entries = Array.isArray(pv) ? pv : []; } catch { entries = []; }
      const rb = await readEbaySellPrices({
        productId: pr.id, groups: parseVariantGroupsJson(pr.variants), entries: entries as never,
        isVariant: isVariantProduct(pr.variants, pr.variantPrices), appSellPrices: parseVariantSellPrices(pr.variantSellPrices), appSellPrice: pr.sellPrice,
        token, getGroupSkus: (g) => getInventoryItemGroupSkus(g, token),
        getBuyerPrices: async () => {
          const r = await getItemBuyerPricesXml(pr.ebayListingId as string);
          if (r.httpStatus !== 200) return { isVariation: false, rows: [], error: `GetItem HTTP ${r.httpStatus}` };
          return parseGetItemBuyerPrices(r.xml);
        },
      });
      return { ok: rb.ok, reason: rb.reason, prices: Object.fromEntries(rb.rows.filter(r => r.skuId).map(r => [r.skuId as string, r.ebayPrice])) };
    },
  };
}
