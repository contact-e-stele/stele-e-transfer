// 051 (Gesetz Nr 94, Inhaber „ja“ 17.11. 22:24; geändert auf 2 durch Inhaber 17.11. 23:19): Mindestlager 2. Hat eine Variante
// beim Lieferanten weniger als 2 Stück (oder ist das Lager unbekannt), bietet eBay sie mit Menge 0 an. Die Variante bleibt im
// Angebot. Steigt das Lager wieder auf ≥ 2, setzt der nächste Abgleich die normale Menge (MIN(Lager, Obergrenze)). EINE Stelle für alle Mengen-Schreiber.
export const MIN_STOCK_FOR_EBAY = 2;

/** eBay-Menge aus dem AliExpress-Lager: < MIN_STOCK_FOR_EBAY (2) oder unbekannt → 0, sonst MIN(Lager, Obergrenze). */
export function ebayQuantityForStock(stock: number | null | undefined, maxQuantity: number): number {
  if (typeof stock !== 'number' || !Number.isFinite(stock)) return 0;
  const s = Math.max(Math.round(stock), 0);
  if (s < MIN_STOCK_FOR_EBAY) return 0;
  return Math.min(s, maxQuantity);
}

/** Für die Anzeige: Variante wird wegen Mindestlager mit 0 angeboten. */
export function belowMinStock(stock: number | null | undefined): boolean {
  return typeof stock !== 'number' || !Number.isFinite(stock) || Math.round(stock) < MIN_STOCK_FOR_EBAY;
}
