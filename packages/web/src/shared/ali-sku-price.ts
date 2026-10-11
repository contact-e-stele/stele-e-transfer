// K-005 Punkt 1 (Kalkulator, 11.10.2026): Produkt 97 — die App liest Preise 1,00–1,20 € über der Kasse (Jasmine 13,79 statt 12,59).
// Live geprüft 11.10.2026 über /api/aliexpress/scrape: die DS-API (aliexpress.ds.product.get, ship_to_country DE, EUR) liefert selbst
// Jasmine 13,79 / Lavender 13,19 / Lemongrass 11,89 / Vanilla 11,59 / Eucalyptus 11,39 — der Unterschied entsteht also NICHT beim
// Speichern oder in der Formel, sondern im Preisfeld der API. Welches Rohfeld (offer_sale_price / offer_bulk_sale_price / sku_price)
// welchen Wert trägt, ist ohne Render-Log nicht sichtbar → diese Funktionen machen die Rohfelder sichtbar (Log + Antwort von /api/aliexpress/scrape),
// ohne die Preiswahl zu ändern (nichts geraten). Zweiter Fund: Produkt-Versandland fiel ohne logistics_info_list auf 'China',
// obwohl jede Variante "Ships From: Poland" trägt.

export interface RawSkuPriceFields {
  sku_price?: string;
  offer_sale_price?: string;
  offer_bulk_sale_price?: string;
  currency_code?: string;
}

export interface SkuPriceDiagnostic {
  skuId: string;
  used: number | null;                 // der Preis, den die App übernimmt (unverändert: offer_sale_price → bulk → sku_price)
  usedField: 'offer_sale_price' | 'offer_bulk_sale_price' | 'sku_price' | null;
  offerSalePrice: number | null;
  offerBulkSalePrice: number | null;
  skuPrice: number | null;
  currency: string | null;
}

const toNum = (s: string | undefined): number | null => {
  if (s == null || s === '') return null;
  const n = parseFloat(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Gleiche Reihenfolge wie bisher in parseVariantPrices — die Preiswahl ändert sich NICHT, nur die Rohwerte werden mitgeliefert. */
export function skuPriceDiagnostic(skuId: string, sku: RawSkuPriceFields): SkuPriceDiagnostic {
  const offer = toNum(sku.offer_sale_price);
  const bulk = toNum(sku.offer_bulk_sale_price);
  const base = toNum(sku.sku_price);
  const usedField = sku.offer_sale_price ? 'offer_sale_price' : sku.offer_bulk_sale_price ? 'offer_bulk_sale_price' : sku.sku_price ? 'sku_price' : null;
  const used = usedField === 'offer_sale_price' ? offer : usedField === 'offer_bulk_sale_price' ? bulk : usedField === 'sku_price' ? base : null;
  return { skuId, used, usedField, offerSalePrice: offer, offerBulkSalePrice: bulk, skuPrice: base, currency: sku.currency_code ?? null };
}

const SHIPS_FROM_KEYS = ['ships from', 'ship from', 'shipfrom', 'ship_from', 'versandort'];

/**
 * Produkt-Versandland: logistics_info_list (falls vorhanden) hat Vorrang. Fehlt es, und tragen ALLE Varianten dasselbe
 * "Ships From", gilt dieses (Fall stele-97: alle Poland, bisher 'China'). Sonst wie bisher 'China' (leer zählt ohnehin als China).
 */
export function deriveProductShipsFrom(
  logisticsShipFrom: string | null | undefined,
  variants: Array<{ attrs?: Record<string, string> }>,
): string {
  if (logisticsShipFrom && logisticsShipFrom.trim()) return logisticsShipFrom;
  const values = new Set<string>();
  for (const v of variants) {
    const key = Object.keys(v.attrs ?? {}).find(k => SHIPS_FROM_KEYS.includes(k.trim().toLowerCase()));
    if (!key) return 'China';
    const val = (v.attrs as Record<string, string>)[key].trim();
    if (!val) return 'China';
    values.add(val);
  }
  return values.size === 1 ? [...values][0] : 'China';
}
