// Zuordnung eBay-Bestellposition → Produkt der eigenen DB.
//
// Teil 3B (2026-09-13): aus dem Route-Handler in index.ts herausgezogen (reiner Extract, identische
// Logik), damit das Verkaufszahlen-Berichtsskript gegen GENAU dieselbe Zuordnung läuft wie die
// Bestellansicht der App. Eine zweite, leicht abweichende Kopie dieser Matching-Regeln hätte
// bedeutet, dass Bericht und App unterschiedliche Bestellungen demselben Produkt zuordnen — bei
// Zahlen, auf deren Grundlage Preise gesenkt werden sollen, ist das nicht hinnehmbar.

import { computeOrderProfit, isChinaShipping } from '../shared/pricing';

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
  findProduct: (sku: string | null) => { buyPrice: number | null; shipsFrom: string | null } | null;
  zollEur: number;
}

export interface OrderNettoResult {
  nettoEinkauf: number | null;
  nettoErgebnis: number | null;
  nettoGebuehren: number | null;
  nettoQuelle: 'manuell' | 'automatisch' | null;
}

export function computeOrderNettoErgebnis(input: OrderNettoInput): OrderNettoResult {
  if (input.manualBuyPrice != null) {
    const { profit, feesDeducted } = computeOrderProfit(input.orderTotal, input.manualBuyPrice);
    return { nettoEinkauf: input.manualBuyPrice, nettoErgebnis: profit, nettoGebuehren: feesDeducted, nettoQuelle: 'manuell' };
  }

  let einkaufBekannt = true;
  let einkaufGesamt = 0;
  for (const li of input.lineItems) {
    const product = input.findProduct(li.sku);
    if (!product || product.buyPrice === null) { einkaufBekannt = false; continue; }
    // Code-Review-Vorschlag (PRIO-1-PAKET): dieselbe China-Erkennung wie überall sonst im Projekt
    // (isChinaShipping(), shared/pricing.ts) statt einer eigenen strikten `=== 'china'`-Prüfung —
    // die vorherige Version dieses Zweigs (index.ts) prüfte strikt und hätte z.B. "China Mainland"
    // verpasst (vgl. task.md, PR #82: ein uneindeutiger shipsFrom-Wert sprengte dort SKU-Matching).
    const zoll = isChinaShipping(product.shipsFrom) ? input.zollEur : 0;
    einkaufGesamt += (product.buyPrice + zoll) * li.quantity;
  }
  if (!einkaufBekannt) {
    return { nettoEinkauf: null, nettoErgebnis: null, nettoGebuehren: null, nettoQuelle: null };
  }
  const { profit, feesDeducted } = computeOrderProfit(input.orderTotal, einkaufGesamt);
  return { nettoEinkauf: einkaufGesamt, nettoErgebnis: profit, nettoGebuehren: feesDeducted, nettoQuelle: 'automatisch' };
}
