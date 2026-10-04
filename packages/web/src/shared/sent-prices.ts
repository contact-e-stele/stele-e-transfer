// A-021 (Live-Fund stele-193): "Bei eBay listen" rechnet die Verkaufspreise je Variante frisch nach Formel v2 und sendet sie — die App
// speicherte sie aber nicht (variant_sell_prices = null, Spalte "eBay" zeigte die alten variantPrices[].ebayPrice, die Gewinn-Spalte rechnete
// mit den falschen Preisen). Nach ERFOLGREICHEM Listing werden genau die gesendeten Preise gespeichert: Varianten → variant_sell_prices
// (Map skuId → Preis), Einzelartikel → sellPrice. REINE Funktion, keine Neuberechnung, keine Formel.
import { parseVariantSellPrices, serializeVariantSellPrices } from './pricing';

export interface SentPrice { skuId: string | null; sku: string; price: number }

// currentVariantSellPrices = FRISCHER DB-Stand der Spalte (kurz vor dem Schreiben gelesen): gesendete Preise werden darübergelegt ({...cur, ...sent}),
// damit eine parallel laufende Preisprüfung/ein Stufenwechsel während des (langen) Listings nicht überschrieben wird.
export function sentPricesToPatch(sent: SentPrice[], currentVariantSellPrices?: string | null): { variantSellPrices?: string; sellPrice?: number } {
  const valid = sent.filter(s => Number.isFinite(s.price) && s.price > 0);
  if (valid.length === 0) return {};
  const variants = valid.filter(s => s.skuId != null && s.skuId !== '');
  if (variants.length > 0) {
    // Bei doppelter skuId gewinnt der zuletzt gesendete Preis (so steht es auch bei eBay). Bestehende Einträge anderer skuIds bleiben erhalten.
    const map = new Map<string, number>(Object.entries(parseVariantSellPrices(currentVariantSellPrices)));
    for (const v of variants) map.set(v.skuId as string, v.price);
    return { variantSellPrices: serializeVariantSellPrices([...map.entries()].map(([skuId, sellPrice]) => ({ skuId, sellPrice }))) };
  }
  const single = valid.find(s => s.skuId == null);
  return single ? { sellPrice: single.price } : {};
}
