// Zuordnung eBay-Bestellposition → Produkt der eigenen DB.
//
// Teil 3B (2026-09-13): aus dem Route-Handler in index.ts herausgezogen (reiner Extract, identische
// Logik), damit das Verkaufszahlen-Berichtsskript gegen GENAU dieselbe Zuordnung läuft wie die
// Bestellansicht der App. Eine zweite, leicht abweichende Kopie dieser Matching-Regeln hätte
// bedeutet, dass Bericht und App unterschiedliche Bestellungen demselben Produkt zuordnen — bei
// Zahlen, auf deren Grundlage Preise gesenkt werden sollen, ist das nicht hinnehmbar.

import { computeOrderProfit, computeAliCosts, isChinaOriginForVariant } from '../shared/pricing';
import { slugify, NON_VARIATION_ASPECTS } from '../shared/variant-resolver';

export interface ProductForSkuMatch {
  id: number;
  asin: string | null;
}

export interface ProductLookups<T extends ProductForSkuMatch> {
  byId: Map<number, T>;
  byAsin: Map<string, T>;
}

export function buildProductLookups<T extends ProductForSkuMatch>(products: T[]): ProductLookups<T> {
  return {
    byId: new Map(products.map(p => [p.id, p])),
    // `ali_`-ASINs sind interne Platzhalter (ali_<timestamp>), keine echten Artikelnummern —
    // sie dürfen nie als SKU-Match dienen.
    byAsin: new Map(
      products.filter(p => p.asin && !p.asin.startsWith('ali_')).map(p => [p.asin!.toUpperCase(), p])
    ),
  };
}

export function findProductForSku<T extends ProductForSkuMatch>(
  sku: string | null | undefined,
  lookups: ProductLookups<T>
): T | null {
  if (!sku) return null;
  const steleMatch = sku.match(/^stele-(\d+)/);
  if (steleMatch) return lookups.byId.get(parseInt(steleMatch[1])) ?? null;
  // Direkter ASIN-Match (z.B. "B0CR9RWDSW")
  const direct = lookups.byAsin.get(sku.toUpperCase());
  if (direct) return direct;
  // Base64-dekodierte ASIN (alte Ecomsniper-Listings, z.B. "QjA3UUhXM1o2Tg==" → "B07QHW3Z6N")
  try {
    const decoded = Buffer.from(sku, 'base64').toString('utf8');
    if (/^[A-Z0-9]{8,12}$/.test(decoded)) {
      return lookups.byAsin.get(decoded.toUpperCase()) ?? null;
    }
  } catch { /* kein gültiges Base64 */ }
  return null;
}

// Warum eine Bestellposition keiner Varianten-SKU zugeordnet werden konnte — für die
// Abgleich-Pflicht aus Teil 3B (#5: nicht zuordenbare Positionen getrennt ausweisen, mit Grund;
// stillschweigend verwerfen ist nicht zulässig).
export type UnmatchedReason =
  | 'keine_sku_an_position'      // eBay lieferte für die Position gar keine SKU
  | 'produkt_nicht_gefunden'     // SKU zeigt auf kein Produkt der DB (gelöscht/fremd/Alt-Listing)
  | 'produkt_ohne_varianten'     // Produkt existiert, hat aber nur eine Variante (nicht Teil dieses Berichts)
  | 'variante_nicht_zuordenbar'; // Produkt gefunden, aber die SKU passt zu keiner variantPrices-Zeile

export const UNMATCHED_REASON_TEXT: Record<UnmatchedReason, string> = {
  keine_sku_an_position: 'eBay lieferte für diese Position keine SKU',
  produkt_nicht_gefunden: 'SKU zeigt auf kein Produkt in der DB (gelöscht, fremd oder Alt-Listing)',
  produkt_ohne_varianten: 'Produkt hat nur eine Variante — nicht Teil dieses Berichts',
  variante_nicht_zuordenbar: 'Produkt gefunden, aber die SKU passt zu keiner variantPrices-Zeile',
};

// ─── PRIO-1-PAKET (2026-09-24): Bestellungs-Gewinn (index.ts /ebay/orders) ────────────────────
//
// Punkt "ZOLL": CHINA_ZOLL_EUR (shared/constants.ts, 4,00€) ist eine Pauschale für die
// Verkaufspreis-FORMEL (computeMinSellPrice, bleibt unverändert) — für den bereits abgeschlossenen
// Bestellungs-Einkauf gilt seit 01.07.2026 eine eigene, real gemessene Zollpauschale je
// Warenposition (2 Kassenbelege: 3,57€ bei 2,40€ und 3,58€ bei 5,99€ Warenwert, inkl.
// Einfuhrumsatzsteuer). Pflegbar wie max_variant_quantity (ebay.ts): app_settings, GET/PUT unter
// /settings, Standard 3,58, Minimum 0.
export const DEFAULT_ORDER_CHINA_ZOLL_EUR = 3.58;

export function parseOrderChinaZollEur(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : DEFAULT_ORDER_CHINA_ZOLL_EUR;
}

export async function getOrderChinaZollEur(): Promise<number> {
  try {
    const { db } = await import('../db/index');
    const { appSettings } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const row = await db.select().from(appSettings).where(eq(appSettings.key, 'order_china_zoll_eur')).get();
    return parseOrderChinaZollEur(row?.value);
  } catch {
    return DEFAULT_ORDER_CHINA_ZOLL_EUR;
  }
}

// Punkte "A9"/"ERGEBNIS": EINE Rechenstelle für den Bestellungs-Gewinn, ersetzt die bisherigen
// zwei separaten Zweige (manuell/automatisch) in index.ts — beide riefen vorher nur
// `order.total - Einkauf` auf, ohne eBay-Gebühren (computeOrderProfit trägt die nach). Reine
// Funktion (Grundgesetz Regel 2): `findProduct` wird von der Aufrufstelle injiziert, damit hier
// kein DB-Zugriff nötig ist und das Preis-Trockenlauf-Skript exakt dieselbe Logik nutzen kann statt
// sie nachzubauen (Grundgesetz Regel 8).
export interface OrderNettoInput {
  orderTotal: number;
  lineItems: Array<{ sku: string | null; quantity: number }>;
  manualBuyPrice: number | null | undefined;
  findProduct: (sku: string | null) => OrderProductInfo | null;
}

/** K-004: was der Bestellungs-Gewinn je Position braucht. id/variants/adRate sind optional (ältere Aufrufer). */
export interface OrderProductInfo {
  buyPrice: number | null;
  shipsFrom: string | null;
  id?: number;
  adRate?: number | null;
  variants?: Array<{ skuId?: string; attrs?: Record<string, string>; price?: number }>;
}

/**
 * K-004 Punkt 1: Ali-Preis + Herkunft der VERKAUFTEN Variante über die eBay-SKU (stele-{id}-{slugify(Werte)}, wie beim Listing).
 * Passen mehrere Einträge auf dieselbe SKU (Dubletten wie stele-119 "100pcs"), zählt der HÖCHSTE Preis — der Gewinn wird damit nie
 * zu hoch ausgewiesen. Keine Zuordnung → null (Aufrufer nimmt den Produkt-EK wie bisher).
 */
export function matchOrderVariant(sku: string | null, product: OrderProductInfo): { price: number; attrs: Record<string, string> } | null {
  if (!sku || product.id == null || !product.variants?.length) return null;
  const prefix = `stele-${product.id}-`;
  if (!sku.toUpperCase().startsWith(prefix.toUpperCase())) return null;
  const suffix = sku.slice(prefix.length).toUpperCase();
  const hits = product.variants.filter(v => {
    if (!(typeof v.price === 'number' && v.price > 0)) return false;
    const vals = Object.entries(v.attrs ?? {}).filter(([k]) => !NON_VARIATION_ASPECTS.has(k)).map(([, val]) => slugify(val)).filter(Boolean);
    return vals.join('-') === suffix;
  });
  if (hits.length === 0) return null;
  const best = hits.reduce((a, b) => ((b.price as number) > (a.price as number) ? b : a));
  return { price: best.price as number, attrs: best.attrs ?? {} };
}

export interface OrderNettoResult {
  nettoEinkauf: number | null;
  nettoErgebnis: number | null;
  nettoGebuehren: number | null;
  nettoQuelle: 'manuell' | 'automatisch' | null;
}

export function computeOrderNettoErgebnis(input: OrderNettoInput): OrderNettoResult {
  if (input.manualBuyPrice != null) {
    const adRate = input.lineItems.map(li => input.findProduct(li.sku)?.adRate).find(a => a != null);
    const { profit, feesDeducted } = computeOrderProfit(input.orderTotal, input.manualBuyPrice, adRate);
    return { nettoEinkauf: input.manualBuyPrice, nettoErgebnis: profit, nettoGebuehren: feesDeducted, nettoQuelle: 'manuell' };
  }

  let einkaufBekannt = true;
  let einkaufGesamt = 0;
  let adRate: number | null | undefined;
  for (const li of input.lineItems) {
    const product = input.findProduct(li.sku);
    if (!product) { einkaufBekannt = false; continue; }
    if (adRate == null && product.adRate != null) adRate = product.adRate;
    // K-004 Punkt 1: EK und Herkunft der verkauften Variante; sonst Produkt-EK (billigste Variante) wie bisher.
    const variant = matchOrderVariant(li.sku, product);
    const ware = variant ? variant.price : product.buyPrice;
    if (ware === null) { einkaufBekannt = false; continue; }
    // Code-Review-Vorschlag (PRIO-1-PAKET): dieselbe China-Erkennung wie überall sonst im Projekt
    // (isChinaShipping(), shared/pricing.ts) statt einer eigenen strikten `=== 'china'`-Prüfung —
    // die vorherige Version dieses Zweigs (index.ts) prüfte strikt und hätte z.B. "China Mainland"
    // verpasst (vgl. task.md, PR #82: ein uneindeutiger shipsFrom-Wert sprengte dort SKU-Matching).
    //
    // A-014 (Preisformel v2): Rückfall ohne manuellen Einkauf = Kosten K der Formel (computeAliCosts: Ware + Versand 1,99 €
    // wenn Ware < 10 € + Einfuhrabgaben 3,57 € bei China) — je Position als EINE AliExpress-Bestellung gerechnet (Versand und
    // Einfuhrabgaben fallen je Bestellung an, nicht je Stück). Der manuell erfasste Einkauf (manualBuyPrice = "Insgesamt"
    // laut AliExpress-Rechnung) hat weiterhin Vorrang. Die frühere Einstellung "order_china_zoll_eur" (3,58 €) fließt hier
    // nicht mehr ein (eine Quelle: ALI_EINFUHR_EUR in constants.ts).
    einkaufGesamt += computeAliCosts(ware * li.quantity, isChinaOriginForVariant(variant?.attrs, product.shipsFrom)).totalCost;
  }
  if (!einkaufBekannt) {
    return { nettoEinkauf: null, nettoErgebnis: null, nettoGebuehren: null, nettoQuelle: null };
  }
  const { profit, feesDeducted } = computeOrderProfit(input.orderTotal, einkaufGesamt, adRate);
  return { nettoEinkauf: einkaufGesamt, nettoErgebnis: profit, nettoGebuehren: feesDeducted, nettoQuelle: 'automatisch' };
}
