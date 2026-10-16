// Plan F (Inhaber 15.10.2026: "Nachfüllen nach jedem Verkauf nein, aber den User informieren — Restmenge je Angebot im Bestellungen-Tab"):
// Wie viele Stück sind bei eBay je verkaufter Variante noch frei? Quelle = Käuferseite (Trading GetItem: Quantity − QuantitySold), dieselbe
// Lese-Logik wie die Mengen-Prüfung (#180, parseGetItemBuyerPrices). REINE Funktionen. Unbekannt bleibt unbekannt (null) — nichts geraten.
import { parseGetItemBuyerPrices } from './ebay-buyer-price';

export type RemainingLevel = 'out' | 'last' | 'ok' | 'unknown';

/** Restmenge je SKU aus einem GetItem-XML. Einzelartikel: Schlüssel `stele-<productId>` (Item-SKU fehlt in alten Angeboten). */
export function remainingBySkuFromGetItem(xml: string, productId: number): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const p = parseGetItemBuyerPrices(xml);
  if (p.error) return out;
  for (const r of p.rows) {
    const sku = p.isVariation ? r.sku : `stele-${productId}`;
    out.set(sku, r.quantity != null && r.quantitySold != null ? Math.max(0, r.quantity - r.quantitySold) : null);
  }
  return out;
}

export function remainingLevel(n: number | null | undefined): RemainingLevel {
  if (n == null) return 'unknown';
  if (n <= 0) return 'out';
  if (n === 1) return 'last';
  return 'ok';
}

/** Anzeige-Text im Bestellungen-Tab. */
export function remainingText(n: number | null | undefined): string {
  const l = remainingLevel(n);
  if (l === 'unknown') return 'Rest bei eBay unbekannt';
  if (l === 'out') return 'AUSVERKAUFT – nachfüllen';
  if (l === 'last') return 'bei eBay noch 1 – letztes Stück';
  return `bei eBay noch ${n}`;
}
