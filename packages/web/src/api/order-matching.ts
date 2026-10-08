// Zuordnung eBay-Bestellposition → Produkt der eigenen DB.
//
// Teil 3B (2026-09-13): aus dem Route-Handler in index.ts herausgezogen (reiner Extract, identische
// Logik), damit das Verkaufszahlen-Berichtsskript gegen GENAU dieselbe Zuordnung läuft wie die
// Bestellansicht der App. Eine zweite, leicht abweichende Kopie dieser Matching-Regeln hätte
// bedeutet, dass Bericht und App unterschiedliche Bestellungen demselben Produkt zuordnen — bei
// Zahlen, auf deren Grundlage Preise gesenkt werden sollen, ist das nicht hinnehmbar.

import {
  computeOrderProfit, computeAliCosts, isChinaOriginForPricing, resolveShipsFrom, DEFAULT_PRICING_CONFIG,
} from '../shared/pricing';
import { resolveVariantEntries, type VariantGroup, type VariantPriceEntry } from '../shared/variant-resolver';

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
// K-004 (08.10.2026): das Produkt wird jetzt mit den Feldern durchgereicht, die für den
// Varianten-EK (Lücke 1), die SKU-eigene Herkunft (Lücke 2) und den echten Anzeigentarif
// (Lücke 4) gebraucht werden. Alle drei Felder sind optional — ein Aufrufer, der sie nicht liefert
// (z.B. ein Alt-Test), verhält sich wie vorher auf Produkt-Ebene.
export interface OrderProductForProfit {
  id: number;
  buyPrice: number | null;
  shipsFrom: string | null;
  adRate?: number | null;         // Anzeigentarif % des Produkts; 0 = nicht beworben, null = Altbestand → Default
  variants?: string | null;       // JSON der Varianten-GRUPPEN (products.variants)
  variantPrices?: string | null;  // JSON der variantPrices-Einträge (EK + attrs je SKU)
}

export interface OrderNettoInput {
  orderTotal: number;
  lineItems: Array<{ sku: string | null; quantity: number }>;
  manualBuyPrice: number | null | undefined;
  findProduct: (sku: string | null) => OrderProductForProfit | null;
}

export interface OrderNettoResult {
  nettoEinkauf: number | null;
  nettoErgebnis: number | null;
  nettoGebuehren: number | null;
  nettoQuelle: 'manuell' | 'automatisch' | null;
  // K-004: warum nicht gerechnet werden konnte (null, wenn gerechnet wurde). Grundgesetz Regel 4 —
  // eine Lücke wird benannt, nicht mit dem nächstbesten Zahlenwert überdeckt.
  nettoGrund: string | null;
}

// K-004 Lücke 1: EK der VERKAUFTEN Variante zu einer echten eBay-SKU.
//
// Vorher nahm dieser Zweig product.buyPrice — das ist bei einem Varianten-Produkt der Preis der
// BILLIGSTEN Variante (so wird das Feld beim Import gesetzt). Belegt am Beispiel stele-119: die
// SKU "stele-119-200PCS" kostet 4,79 € im Einkauf, products.buyPrice steht auf 3,15 € (100PCS) —
// der angezeigte Gewinn war dadurch 1,64 € zu hoch (2,32 € statt 0,68 €).
//
// Aufgelöst wird über resolveVariantEntries() (shared/variant-resolver.ts), also über GENAU die
// Zuordnung, mit der die SKU beim Listing überhaupt entstanden ist (Grundgesetz Regel 8 — keine
// zweite, leicht abweichende Rekonstruktion). Lässt sich die SKU nicht EINDEUTIG auflösen, wird
// der Einkauf als unbekannt gemeldet statt auf product.buyPrice zurückzufallen: ein stillschweigend
// zu hoch angezeigter Gewinn ist schlechter als ein ehrliches "nicht berechenbar" (Regel 4).
export interface VariantEkResult {
  ware: number | null;
  shipsFrom: string | null;
  grund: string | null;
}

export function resolveVariantEk(product: OrderProductForProfit, sku: string | null | undefined): VariantEkResult {
  let groups: VariantGroup[] = [];
  let entries: VariantPriceEntry[] = [];
  try { groups = product.variants ? JSON.parse(product.variants) : []; } catch { groups = []; }
  try { entries = product.variantPrices ? JSON.parse(product.variantPrices) : []; } catch { entries = []; }

  // Kein Varianten-Produkt → Produkt-EK ist der richtige Wert (hier gibt es nur eine Variante).
  if (!Array.isArray(groups) || groups.length === 0 || !Array.isArray(entries) || entries.length === 0) {
    return { ware: product.buyPrice, shipsFrom: resolveShipsFrom(product.shipsFrom, null), grund: null };
  }

  if (!sku) {
    return { ware: null, shipsFrom: null, grund: UNMATCHED_REASON_TEXT.keine_sku_an_position };
  }

  const resolved = resolveVariantEntries(product.id, groups, entries);
  const hit = resolved.filter(r => r.sku === sku);
  if (hit.length !== 1) {
    return {
      ware: null, shipsFrom: null,
      grund: `${UNMATCHED_REASON_TEXT.variante_nicht_zuordenbar} (SKU "${sku}", Produkt ${product.id}, ${hit.length} Treffer)`,
    };
  }
  if (hit[0].entry == null) {
    return { ware: null, shipsFrom: null, grund: hit[0].error ?? UNMATCHED_REASON_TEXT.variante_nicht_zuordenbar };
  }
  const ek = hit[0].entry.price;
  if (ek == null) {
    return { ware: null, shipsFrom: null, grund: `Kein Einkaufspreis an der Variante (SKU "${sku}", Produkt ${product.id})` };
  }
  return { ware: ek, shipsFrom: resolveShipsFrom(product.shipsFrom, hit[0].entry.attrs), grund: null };
}

// K-004 Lücke 4: Anzeigentarif der Bestellung aus den beteiligten Produkten statt fest 5 %.
// Weichen mehrere Positionen ab, gilt der HÖCHSTE Satz (vorsichtige Richtung: mehr Gebühren →
// niedriger ausgewiesener Gewinn). Kein Produkt zuordenbar → Default der Konfiguration.
export function resolveOrderAdRatePercent(
  lineItems: Array<{ sku: string | null }>,
  findProduct: (sku: string | null) => OrderProductForProfit | null,
): number {
  const rates = lineItems
    .map(li => findProduct(li.sku))
    .filter((p): p is OrderProductForProfit => p != null)
    .map(p => p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent);
  return rates.length === 0 ? DEFAULT_PRICING_CONFIG.defaultAdRatePercent : Math.max(...rates);
}

export function computeOrderNettoErgebnis(input: OrderNettoInput): OrderNettoResult {
  const adRatePercent = resolveOrderAdRatePercent(input.lineItems, input.findProduct);

  if (input.manualBuyPrice != null) {
    const { profit, feesDeducted } = computeOrderProfit(input.orderTotal, input.manualBuyPrice, adRatePercent);
    return { nettoEinkauf: input.manualBuyPrice, nettoErgebnis: profit, nettoGebuehren: feesDeducted, nettoQuelle: 'manuell', nettoGrund: null };
  }

  const gruende: string[] = [];
  let einkaufGesamt = 0;
  for (const li of input.lineItems) {
    const product = input.findProduct(li.sku);
    if (!product) { gruende.push(`${UNMATCHED_REASON_TEXT.produkt_nicht_gefunden} (SKU "${li.sku ?? '—'}")`); continue; }

    // K-004 Lücke 1: EK der verkauften Variante, nicht der Produkt-EK (= billigste Variante).
    const variante = resolveVariantEk(product, li.sku);
    if (variante.ware == null) { gruende.push(variante.grund ?? UNMATCHED_REASON_TEXT.variante_nicht_zuordenbar); continue; }

    // K-004 Lücke 2: Herkunft aus dem Varianten-Attribut "Ships From", sonst Produktfeld, sonst
    // vorsichtig China (isChinaOriginForPricing) — vorher ergab ein leeres Feld "EU" und damit
    // 0 € Einfuhrabgaben. Die wörtliche Feld-Prüfung isChinaShipping() bleibt den Anzeige-Stellen.
    //
    // A-014 (Preisformel v2): Rückfall ohne manuellen Einkauf = Kosten K der Formel (computeAliCosts: Ware + Versand 1,99 €
    // nur bei China und Ware < 10 € + Einfuhrabgaben 3,57 € bei China) — je Position als EINE AliExpress-Bestellung gerechnet
    // (Versand und Einfuhrabgaben fallen je Bestellung an, nicht je Stück). Der manuell erfasste Einkauf (manualBuyPrice =
    // "Insgesamt" laut AliExpress-Rechnung) hat weiterhin Vorrang. Die frühere Einstellung "order_china_zoll_eur" (3,58 €)
    // fließt hier nicht mehr ein (eine Quelle: ALI_EINFUHR_EUR in constants.ts).
    einkaufGesamt += computeAliCosts(variante.ware * li.quantity, isChinaOriginForPricing(variante.shipsFrom)).totalCost;
  }
  if (gruende.length > 0) {
    return { nettoEinkauf: null, nettoErgebnis: null, nettoGebuehren: null, nettoQuelle: null, nettoGrund: gruende.join('; ') };
  }
  const { profit, feesDeducted } = computeOrderProfit(input.orderTotal, einkaufGesamt, adRatePercent);
  return { nettoEinkauf: einkaufGesamt, nettoErgebnis: profit, nettoGebuehren: feesDeducted, nettoQuelle: 'automatisch', nettoGrund: null };
}
