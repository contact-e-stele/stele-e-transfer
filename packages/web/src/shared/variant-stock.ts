// Mengen-Lauf: AliExpress-Lager je ECHTER eBay-Varianten-SKU (Live-Fund stele-224, 19.10.2026).
// Vorher bauten Mengen-Lauf (price-monitor.ts) und Mengen-Prüfung (quantity-check.ts) die SKU aus den ORIGINAL-attrs
// (z.B. "Grey" → stele-224-GREY), eBay hat aber die SKU aus dem umbenannten ANZEIGEWERT (stele-224-GRAU). Kein Treffer → die Menge
// wurde nie nachgefüllt; jeder Verkauf zog sie bis 0 herunter. Gemessen 19.10.2026: 64 gelistete Varianten-Produkte, 252 Varianten,
// alter Weg trifft 210, 11 Produkte teilweise/ganz blind (u.a. 70, 110, 141, 166, 224, 225).
// Jetzt: dieselbe Zuordnung wie beim Listen (resolveVariantEntries, Grundgesetz 8); nur wo sie keinen eindeutigen Eintrag
// liefert, der alte attrs-Weg (der bisher funktionierte). Nichts geraten: ohne eindeutigen Treffer kein Eintrag.
import { resolveVariantEntries, slugify, NON_VARIATION_ASPECTS, type VariantGroup, type VariantPriceEntry } from './variant-resolver';

export function stockBySkuFor(productId: number, groups: VariantGroup[], entries: VariantPriceEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  // alter Weg (attrs) zuerst …
  const legacy = new Map<string, number[]>();
  for (const e of entries) {
    if (typeof e.stock !== 'number' || isNaN(e.stock)) continue;
    const suffix = Object.entries(e.attrs ?? {}).filter(([k]) => !NON_VARIATION_ASPECTS.has(k)).map(([, v]) => slugify(v)).filter(Boolean).join('-');
    if (!suffix) continue;
    const sku = `stele-${productId}-${suffix}`;
    legacy.set(sku, [...(legacy.get(sku) ?? []), e.stock]);
  }
  for (const [sku, s] of legacy) if (s.length === 1) out.set(sku, s[0]); // doppelt = mehrdeutig → nicht setzen
  // … dann die Listing-Zuordnung (überschreibt, weil sie die echte eBay-SKU erzeugt).
  if (groups.length > 0) {
    for (const r of resolveVariantEntries(productId, groups, entries)) {
      if (r.entry && typeof r.entry.stock === 'number' && !isNaN(r.entry.stock)) out.set(r.sku, r.entry.stock);
    }
  }
  return out;
}
