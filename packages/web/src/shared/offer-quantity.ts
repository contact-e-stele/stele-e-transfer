// Mengen-Fix A+B (Inhaber 15.10.2026 20:58 "Ja Mengen-Fix A+B"). Beweis stele-220: Offer availableQuantity GRAY/BLACK = 0, Lager 3/2 →
// Käuferseite "ausverkauft" (eBay KB 5100: die KLEINERE Menge gilt). Regel ab jetzt: die Offer-Menge folgt IMMER der Lagermenge des
// Inventory Items. REINE Funktion: setzt offerData.availableQuantity auf die Lagermenge; ist die Lagermenge unbekannt, bleibt das Offer
// unverändert (nichts geraten).
export function applyOfferQuantity(offerData: Record<string, unknown>, inventoryQty: number | null | undefined): { changed: boolean; from: unknown; to: number | null } {
  const from = offerData.availableQuantity;
  if (typeof inventoryQty !== 'number' || !Number.isFinite(inventoryQty) || inventoryQty < 0) return { changed: false, from, to: null };
  const to = Math.round(inventoryQty);
  offerData.availableQuantity = to;
  return { changed: from !== to, from, to };
}
