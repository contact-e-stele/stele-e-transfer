// Teil 3B (2026-09-13): Verkäufe je Varianten-SKU aus eBay-Bestellpositionen aggregieren.
//
// Bewusst als REINE Funktion ohne DB-/Netzwerkzugriff: die Zahlen entscheiden darüber, ob Preise
// gesenkt werden, also müssen sie testbar sein. Das Berichtsskript reicht nur die Daten herein und
// formatiert das Ergebnis.

import { isChinaShipping, DEFAULT_PRICING_CONFIG } from '../shared/pricing';
import { buildVariantSku } from './price-monitor';
import { buildProductLookups, findProductForSku, type UnmatchedReason } from './order-matching';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export interface SalesOrderLineItem {
  sku: string | null;
  title: string;
  quantity: number;
  lineItemCost: number | null;
}

export interface SalesOrder {
  orderId: string;
  orderDate: string;
  lineItems: SalesOrderLineItem[];
}

export interface SalesProduct {
  id: number;
  asin: string | null;
  buyPrice: number | null;
  shippingCost: number | null;
  shipsFrom: string | null;
  adRate: number | null;
  /** buyPrice = EK DIESER Variante (variantPrices[].price), nicht der Produkt-EK */
  variants: Array<{ skuId: string; attrs?: Record<string, string>; buyPrice: number }>;
}

export interface VariantSalesAgg {
  unitsTotal: number;
  units90d: number;
  revenueTotal: number;
  revenueKnown: boolean;   // false, sobald eBay für eine Position keinen Betrag lieferte
  profitPerSale: number[]; // je verkaufter Einheit, nur wo der Gewinn berechenbar war
  notCalculable: number;   // Einheiten ohne ermittelbaren EK (P-49-Altbestand) — NICHT als 0 gerechnet
}

export interface UnmatchedLineItem {
  orderId: string;
  sku: string | null;
  title: string;
  quantity: number;
  reason: UnmatchedReason;
}

export interface VariantSalesResult {
  /** Schlüssel: `${productId}::${skuId}` */
  salesBySku: Map<string, VariantSalesAgg>;
  lineItemsTotal: number;
  lineItemsMatched: number;
  unmatched: UnmatchedLineItem[];
}

export const emptyVariantSalesAgg = (): VariantSalesAgg => ({
  unitsTotal: 0, units90d: 0, revenueTotal: 0, revenueKnown: true, profitPerSale: [], notCalculable: 0,
});

export function aggregateVariantSales(input: {
  orders: SalesOrder[];
  products: SalesProduct[];
  /** Bestellung → manuell erfasster Einkaufspreis der GESAMTEN Bestellung (order_notes) */
  manualBuyPriceByOrderId: Map<string, number | null>;
  /** Bezugszeitpunkt für das 90-Tage-Fenster (Test-Injektion) */
  now?: number;
}): VariantSalesResult {
  const { orders, products, manualBuyPriceByOrderId } = input;
  const cutoff90d = (input.now ?? Date.now()) - NINETY_DAYS_MS;

  const lookups = buildProductLookups(products);
  const productById = new Map(products.map(p => [p.id, p]));

  // Produkt-ID → echte eBay-SKU → skuId aus variantPrices. Nur Produkte mit MEHR als einer
  // Variante sind Gegenstand dieses Berichts.
  const variantSkuIndex = new Map<number, Map<string, { skuId: string; buyPrice: number }>>();
  for (const p of products) {
    if (p.variants.length <= 1) continue;
    const m = new Map<string, { skuId: string; buyPrice: number }>();
    for (const v of p.variants) m.set(buildVariantSku(p.id, v.attrs), { skuId: v.skuId, buyPrice: v.buyPrice });
    variantSkuIndex.set(p.id, m);
  }

  const salesBySku = new Map<string, VariantSalesAgg>();
  const unmatched: UnmatchedLineItem[] = [];
  let lineItemsTotal = 0;
  let lineItemsMatched = 0;

  for (const order of orders) {
    const manualBuyPrice = manualBuyPriceByOrderId.get(order.orderId) ?? null;
    const orderTime = order.orderDate ? Date.parse(order.orderDate) : NaN;
    const within90d = Number.isFinite(orderTime) && orderTime >= cutoff90d;

    for (const li of order.lineItems) {
      lineItemsTotal++;
      const base = { orderId: order.orderId, sku: li.sku, title: li.title, quantity: li.quantity };

      if (!li.sku) { unmatched.push({ ...base, reason: 'keine_sku_an_position' }); continue; }
      const matched = findProductForSku(li.sku, lookups);
      if (!matched) { unmatched.push({ ...base, reason: 'produkt_nicht_gefunden' }); continue; }
      const skuMap = variantSkuIndex.get(matched.id);
      if (!skuMap) { unmatched.push({ ...base, reason: 'produkt_ohne_varianten' }); continue; }
      const variant = skuMap.get(li.sku);
      if (!variant) { unmatched.push({ ...base, reason: 'variante_nicht_zuordenbar' }); continue; }
      const variantSkuId = variant.skuId;

      lineItemsMatched++;
      const product = productById.get(matched.id)!;
      const qty = li.quantity > 0 ? li.quantity : 1;
      const key = `${product.id}::${variantSkuId}`;
      const agg = salesBySku.get(key) ?? emptyVariantSalesAgg();

      agg.unitsTotal += qty;
      if (within90d) agg.units90d += qty;
      if (li.lineItemCost == null) agg.revenueKnown = false;
      else agg.revenueTotal += li.lineItemCost;

      // EK je Stück: ein manuell erfasster Einkaufspreis hat Vorrang (wie in der Bestellansicht der
      // App), gilt aber für die GESAMTE Bestellung — eindeutig zuordenbar nur bei genau einer
      // Position. Sonst Produkt-EK + Zoll + Lieferantenversand.
      const zoll = isChinaShipping(product.shipsFrom) ? DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur : 0;
      const versand = product.shippingCost ?? 0;
      // WICHTIG: der EK DIESER Variante, nicht der Produkt-EK — die Varianten unterscheiden sich
      // im Einkauf teils um ein Mehrfaches (stele-110: 2,15 bis 7,69 EUR). Der Produkt-EK dient nur
      // als Rueckfall, wenn die Variante keinen eigenen hat.
      const variantBuyPrice = Number.isFinite(variant.buyPrice) && variant.buyPrice > 0 ? variant.buyPrice : product.buyPrice;
      let unitCost: number | null = null;
      if (manualBuyPrice != null && order.lineItems.length === 1) unitCost = manualBuyPrice / qty + zoll + versand;
      else if (variantBuyPrice != null) unitCost = variantBuyPrice + zoll + versand;

      const unitRevenue = li.lineItemCost != null ? li.lineItemCost / qty : null;
      if (unitCost == null || unitRevenue == null) {
        // P-49-Altbestand bzw. fehlender Positionsbetrag: ausdrücklich als nicht berechenbar
        // führen statt mit 0 zu rechnen.
        agg.notCalculable += qty;
      } else {
        const feeRateGross = ((DEFAULT_PRICING_CONFIG.ebayFeeRatePercent + (product.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent)) / 100) * DEFAULT_PRICING_CONFIG.vatFactor;
        const fixedFeeGross = DEFAULT_PRICING_CONFIG.ebayFixedFeeEur * DEFAULT_PRICING_CONFIG.vatFactor;
        const profit = unitRevenue - unitCost - (unitRevenue * feeRateGross + fixedFeeGross);
        for (let i = 0; i < qty; i++) agg.profitPerSale.push(profit);
      }

      salesBySku.set(key, agg);
    }
  }

  return { salesBySku, lineItemsTotal, lineItemsMatched, unmatched };
}
