// Zuordnung eBay-Bestellposition → Produkt der eigenen DB.
//
// Teil 3B (2026-09-13): aus dem Route-Handler in index.ts herausgezogen (reiner Extract, identische
// Logik), damit das Verkaufszahlen-Berichtsskript gegen GENAU dieselbe Zuordnung läuft wie die
// Bestellansicht der App. Eine zweite, leicht abweichende Kopie dieser Matching-Regeln hätte
// bedeutet, dass Bericht und App unterschiedliche Bestellungen demselben Produkt zuordnen — bei
// Zahlen, auf deren Grundlage Preise gesenkt werden sollen, ist das nicht hinnehmbar.

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
