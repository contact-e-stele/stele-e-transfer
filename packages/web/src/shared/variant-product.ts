// A-019: EINE Definition, ob ein Produkt als Varianten-Produkt behandelt wird. Vorher stand dieselbe Regel viermal inline
// (price-monitor.ts checkOne, index.ts recalculate-preview/-apply/repair) — und drei weitere Stellen (Preis-Bericht, TargetBadge,
// tier-reprice) rechneten abweichend nur "mehr als ein variantPrices-Eintrag". Folge (Live-Fund stele-95): ein Produkt mit
// Varianten-GRUPPEN, aber nur EINEM variantPrices-Eintrag (eBay: Gruppe stele-95-GROUP mit einer Variante, kein stele-95 Inventory
// Item) lief in der Preisprüfung durch den Varianten-Zweig (der NIE automatisch anhebt), während Anzeige/Vorschau/Senden es als
// Einzelartikel behandelten.
//
// Regel (unverändert gegenüber der Preisprüfung): Varianten-Produkt = mehr als ein variantPrices-Eintrag ODER mindestens eine
// Varianten-Gruppe in product.variants. `variants` darf JSON-Text oder bereits geparst sein (die Produkte-API liefert geparst).
function countJsonArray(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (typeof v !== 'string' || v === '') return 0;
  try { const p = JSON.parse(v) as unknown; return Array.isArray(p) ? p.length : 0; } catch { return 0; }
}

export function isVariantProduct(variants: unknown, variantPrices: unknown): boolean {
  return countJsonArray(variantPrices) > 1 || countJsonArray(variants) > 0;
}
