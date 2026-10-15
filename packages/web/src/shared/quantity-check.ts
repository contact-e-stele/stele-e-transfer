// Mengen-Lese-Prüfung (Inhaber 15.10.2026 20:39 "Lese-Prüfung bauen ja"): eBay führt die Stückzahl an ZWEI Stellen — Inventory Item
// (shipToLocationAvailability.quantity) und Offer (availableQuantity). Laut eBay (KB 5100) gilt die KLEINERE. Die App setzt die Offer-Menge
// nur beim Listen. Diese reine Funktion stellt je Variante gegenüber: Lager (Inventory), Offer, Käuferseite (GetItem Quantity − QuantitySold)
// und das AliExpress-Lager der App, und benennt die Ursache, wenn die Käuferseite 0 zeigt. Nichts wird geschrieben.

export interface QuantityRow {
  sku: string;
  label: string;
  inventoryQty: number | null;     // Inventory Item shipToLocationAvailability.quantity
  offerQty: number | null;         // Offer availableQuantity (null = nicht gesetzt)
  listingQty: number | null;       // GetItem Variation Quantity (gesamt, inkl. verkauft)
  soldQty: number | null;          // GetItem QuantitySold
  aliStock: number | null;         // AliExpress-Lager laut App (variantPrices.stock)
  targetQty: number | null;        // Ziel der App: MIN(aliStock, Obergrenze)
  error?: string;
}

export interface QuantityVerdict extends QuantityRow { buyerAvailable: number | null; note: string }

export function evaluateQuantityRow(r: QuantityRow): QuantityVerdict {
  const buyerAvailable = r.listingQty != null ? Math.max(0, r.listingQty - (r.soldQty ?? 0)) : null;
  let note = 'ok';
  if (r.error) note = r.error;
  else if (buyerAvailable === 0 && (r.inventoryQty ?? 0) > 0 && r.offerQty != null && r.offerQty <= (r.soldQty ?? 0))
    note = `Offer-Menge ${r.offerQty} deckelt (Lager ${r.inventoryQty}) — kleinere Menge gilt`;
  else if (buyerAvailable === 0 && (r.inventoryQty ?? 0) > 0) note = `Käuferseite 0 trotz Lager ${r.inventoryQty} — Ursache offen`;
  else if (buyerAvailable === 0) note = 'ausverkauft (Lager 0)';
  else if (r.targetQty != null && r.inventoryQty != null && r.inventoryQty !== r.targetQty) note = `Lager ${r.inventoryQty} ≠ App-Ziel ${r.targetQty} (nächster Lauf setzt ${r.targetQty})`;
  return { ...r, buyerAvailable, note };
}
