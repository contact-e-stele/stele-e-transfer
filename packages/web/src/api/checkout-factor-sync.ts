// K-005 Punkt 1, Weg b (Inhaber 14.10.2026): Kassen-Faktor je Produkt automatisch nachjustieren.
// Quelle: order_notes.manual_buy_price ("Insgesamt" laut AliExpress-Rechnung) + eBay-Bestellung (nur LESEN, getAllOrders) +
// Produkt-Zuordnung über DIESELBE Regel wie der Bestellungs-Gewinn (order-matching.ts, Grundgesetz 8). Rechnung: deriveCheckoutFactors
// (shared/checkout-factor.ts). Geschrieben werden NUR products.ali_checkout_factor / _at / _order — kein eBay-Schreibaufruf, keine
// Preisänderung. Alles DB-/eBay-Seitige kommt als `deps` herein (Grundgesetz 2: mit Mocks testbar).
import { deriveCheckoutFactors, type DerivedFactor, type FactorMatch, type FactorOrder, type SkippedFactor } from '../shared/checkout-factor';
import { isChinaOriginForVariant } from '../shared/pricing';
import { buildProductLookups, findProductForSku, matchOrderVariant, orderProductInfoFromRow, type OrderProductRow } from './order-matching';

export interface FactorSyncProduct extends OrderProductRow {
  asin: string | null;
  aliCheckoutFactorAt?: string | null;
  aliCheckoutFactor?: number | null;
  aliCheckoutFactorOrder?: string | null;
}
export interface FactorSyncOrder { orderId: string; orderDate: string; lineItems: Array<{ sku: string | null; quantity: number }> }
export interface FactorSyncNote { ebayOrderId: string; manualBuyPrice: number | null }

export interface CheckoutFactorSyncDeps {
  loadNotes: () => Promise<FactorSyncNote[]>;
  loadOrders: () => Promise<FactorSyncOrder[]>;
  loadProducts: () => Promise<FactorSyncProduct[]>;
  writeFactor: (productId: number, v: { factor: number | null; at: string | null; orderId: string | null }) => Promise<void>;
}

export interface CheckoutFactorSyncResult {
  geschrieben: number;
  gelöscht: number;                   // Faktoren auf null gesetzt (Rechnungsbetrag der Quell-Bestellung gelöscht/unplausibel)
  faktoren: DerivedFactor[];          // alle abgeleiteten (neuesten) Faktoren je Produkt, geschrieben oder nicht
  übersprungen: SkippedFactor[];      // Bestellungen bzw. Produkte mit Grund
}

/** SKU → Produkt-ID, App-Ware der verkauften Variante (sonst product.buyPrice) und Herkunft — wie computeOrderNettoErgebnis. */
export function buildCheckoutFactorMatcher(products: FactorSyncProduct[]): (sku: string | null) => FactorMatch | null {
  const lookups = buildProductLookups(products);
  return (sku) => {
    const product = findProductForSku(sku, lookups);
    if (!product) return null;
    const variant = matchOrderVariant(sku, orderProductInfoFromRow(product));
    const apiWare = variant ? variant.price : product.buyPrice;
    if (apiWare == null) return null;
    return { productId: product.id, apiWare, isChinaOrigin: isChinaOriginForVariant(variant?.attrs, product.shipsFrom) };
  };
}

/**
 * Reine Kernlogik: welche Faktoren werden geschrieben bzw. gelöscht.
 * - Neuere Bestellung als der gespeicherte Stand → schreiben.
 * - DIESELBE Bestellung wie gespeichert (Rechnungsbetrag korrigiert) → neu schreiben, wenn sich der Faktor ändert (Gegenprüfung B1).
 * - Gespeicherte Quell-Bestellung liefert keinen gültigen Faktor mehr (Betrag gelöscht oder jetzt unplausibel) → durch den nächstbesten
 *   abgeleiteten Faktor ersetzen, sonst auf null setzen. Fehlt die Bestellung nur in der eBay-Liste (> 90 Tage), bleibt der Stand
 *   (er läuft nach 14 Tagen ohnehin ab).
 */
export function planCheckoutFactorSync(notes: FactorSyncNote[], orders: FactorSyncOrder[], products: FactorSyncProduct[]): {
  writes: DerivedFactor[]; clears: number[]; faktoren: DerivedFactor[]; übersprungen: SkippedFactor[];
} {
  const orderById = new Map(orders.map(o => [o.orderId, o]));
  const noteById = new Map(notes.map(n => [n.ebayOrderId, n]));
  const übersprungen: SkippedFactor[] = [];
  const factorOrders: FactorOrder[] = [];
  for (const n of notes) {
    if (n.manualBuyPrice == null || !(n.manualBuyPrice > 0)) continue;
    const o = orderById.get(n.ebayOrderId);
    if (!o) { übersprungen.push({ orderId: n.ebayOrderId, reason: 'Bestellung von eBay nicht geliefert (älter als 90 Tage oder unbekannt)' }); continue; }
    factorOrders.push({ orderId: o.orderId, orderDate: o.orderDate, lineItems: o.lineItems.map(li => ({ sku: li.sku, quantity: li.quantity })), manualBuyPrice: n.manualBuyPrice });
  }
  const { factors, skipped } = deriveCheckoutFactors(factorOrders, buildCheckoutFactorMatcher(products));
  übersprungen.push(...skipped);
  const factorByProduct = new Map(factors.map(f => [f.productId, f]));
  const writes: DerivedFactor[] = [];
  const clears: number[] = [];
  for (const p of products) {
    const f = factorByProduct.get(p.id);
    const storedOrder = p.aliCheckoutFactorOrder ?? null;
    const hasStored = p.aliCheckoutFactor != null || storedOrder != null || p.aliCheckoutFactorAt != null;
    // Quell-Bestellung des gespeicherten Faktors ungültig geworden? (Betrag gelöscht, oder Bestellung da, aber kein Faktor mehr daraus)
    // Wurde die gespeicherte Quell-Bestellung von eBay geliefert, hätte sie (wenn noch gültig) diesen Faktor wieder ergeben;
    // kommt der Faktor jetzt aus einer anderen Bestellung oder gar keiner, ist sie ungültig geworden. Betrag gelöscht = immer ungültig.
    const storedNote = storedOrder != null ? noteById.get(storedOrder) : undefined;
    const storedPriceGone = storedNote != null && !((storedNote.manualBuyPrice ?? 0) > 0);
    const storedInvalid = storedOrder != null && f?.orderId !== storedOrder && (storedPriceGone || orderById.has(storedOrder));
    if (!f) {
      if (hasStored && storedInvalid) clears.push(p.id);
      continue;
    }
    if (storedOrder != null && f.orderId === storedOrder) {
      if (p.aliCheckoutFactor !== f.factor || p.aliCheckoutFactorAt !== f.at) writes.push(f);
      continue;
    }
    if (storedInvalid) { writes.push(f); continue; }
    const storedT = p.aliCheckoutFactorAt ? Date.parse(p.aliCheckoutFactorAt) : NaN;
    if (Number.isFinite(storedT) && !(Date.parse(f.at) > storedT)) {
      übersprungen.push({ orderId: f.orderId, reason: `stele-${f.productId}: gespeicherter Faktor (${p.aliCheckoutFactorAt}) ist nicht älter` });
      continue;
    }
    writes.push(f);
  }
  return { writes, clears, faktoren: factors, übersprungen };
}

// deps teilweise überschreibbar (z. B. nur loadOrders für einen lokalen End-to-End-Lauf ohne eBay-Zugang).
export async function syncCheckoutFactors(deps?: Partial<CheckoutFactorSyncDeps>): Promise<CheckoutFactorSyncResult> {
  const d: CheckoutFactorSyncDeps = deps && deps.loadNotes && deps.loadOrders && deps.loadProducts && deps.writeFactor
    ? deps as CheckoutFactorSyncDeps
    : { ...(await defaultDeps()), ...deps };
  const [notes, orders, products] = await Promise.all([d.loadNotes(), d.loadOrders(), d.loadProducts()]);
  const plan = planCheckoutFactorSync(notes, orders, products);
  let geschrieben = 0;
  for (const w of plan.writes) {
    await d.writeFactor(w.productId, { factor: w.factor, at: w.at, orderId: w.orderId });
    geschrieben++;
    console.log(`[K-005] stele-${w.productId}: Kassen-Faktor ${w.factor} (Kasse ${w.checkoutWare.toFixed(2)} € ÷ App ${w.apiWare.toFixed(2)} €, Bestellung ${w.orderId} vom ${w.at})`);
  }
  let gelöscht = 0;
  for (const id of plan.clears) {
    await d.writeFactor(id, { factor: null, at: null, orderId: null });
    gelöscht++;
    console.log(`[K-005] stele-${id}: Kassen-Faktor gelöscht (Rechnungsbetrag der Quell-Bestellung gelöscht oder unplausibel)`);
  }
  return { geschrieben, gelöscht, faktoren: plan.faktoren, übersprungen: plan.übersprungen };
}

async function defaultDeps(): Promise<CheckoutFactorSyncDeps> {
  const { db } = await import('../db/index');
  const schema = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  const { getAllOrders } = await import('./ebay');
  const p = schema.products;
  return {
    loadNotes: async () => db.select({ ebayOrderId: schema.orderNotes.ebayOrderId, manualBuyPrice: schema.orderNotes.manualBuyPrice }).from(schema.orderNotes).all(),
    loadOrders: async () => getAllOrders(), // nur Lesen
    loadProducts: async () => db.select({
      id: p.id, asin: p.asin, buyPrice: p.buyPrice, shipsFrom: p.shipsFrom, adRate: p.adRate,
      variantPrices: p.variantPrices, variants: p.variants, aliCheckoutFactorAt: p.aliCheckoutFactorAt,
      aliCheckoutFactor: p.aliCheckoutFactor, aliCheckoutFactorOrder: p.aliCheckoutFactorOrder,
    }).from(p).all(),
    // NUR die drei K-005-Spalten — bewusst kein updatedAt/sellPrice/buyPrice.
    writeFactor: async (productId, v) => {
      await db.update(p).set({ aliCheckoutFactor: v.factor, aliCheckoutFactorAt: v.at, aliCheckoutFactorOrder: v.orderId }).where(eq(p.id, productId));
    },
  };
}
