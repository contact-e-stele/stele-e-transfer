// OFFEN 030 Punkt 4b („ja Standort Bestand“): Live-Angebote vom alten Lagerort „default“ (Wiesbaden) auf den Lagerort ihrer Herkunft
// (z. B. CN-Shenzhen) und die passende Versandrichtlinie („Versand aus China“) umstellen.
// eBay-Grundsatz Artikelstandort (Hilfe 4244): der Standort muss angeben, von wo verschickt wird (PLZ/Ort/Land); Ware aus China mit
// Standort Wiesbaden verstößt dagegen. REINE Funktionen (Grundgesetz 2): keine DB, kein fetch.

export interface SwitchTarget { locationKey: string; fulfillmentPolicyId: string }

export interface OfferSummary { offerId: string; sku: string; status?: string; listing?: { listingId?: string } }

/**
 * Nur die Offers, die zu GENAU diesem eBay-Angebot gehören (listing.listingId = eBay-Nr). Andere Offers derselben SKU
 * (Entwurf, anderes Angebot) werden nie angefasst. Nichts gefunden → leer (Aufrufer meldet "kein Inventory-Offer").
 */
export function offersOfListing(offers: OfferSummary[] | undefined, itemId: string): OfferSummary[] {
  return (offers ?? []).filter(o => o?.offerId && o.listing?.listingId === itemId);
}

/** Volles Offer (GET) → Body für PUT mit neuem Lagerort + Versandrichtlinie. Alles andere bleibt, wie eBay es geliefert hat. */
export function switchOfferBody(offer: Record<string, unknown>, target: SwitchTarget): { body: Record<string, unknown>; changed: boolean } {
  const policies = (offer.listingPolicies as Record<string, unknown> | undefined) ?? {};
  const changed = offer.merchantLocationKey !== target.locationKey || policies.fulfillmentPolicyId !== target.fulfillmentPolicyId;
  const body: Record<string, unknown> = {
    ...offer,
    merchantLocationKey: target.locationKey,
    listingPolicies: { ...policies, fulfillmentPolicyId: target.fulfillmentPolicyId },
  };
  return { body, changed };
}

export type SwitchStatus = 'umgestellt' | 'schon richtig' | 'übersprungen' | 'fehler' | 'vorschau';

export interface SwitchRow {
  steleNr: string; itemId: string; herkunft: string;
  vorher: { lagerort: string | null; richtlinie: string | null };
  ziel: SwitchTarget | null;
  status: SwitchStatus; grund?: string;
  offers?: number;                 // Anzahl angefasster Offers
  nachher?: { lagerort: string | null; richtlinie: string | null; stimmt: boolean };
}

/** Rücklesen bestätigt nur, wenn Lagerort UND Richtlinie dem Ziel entsprechen. */
export function readBackMatches(live: { merchantLocationKey: string | null; fulfillmentPolicyId: string | null } | null, target: SwitchTarget): boolean {
  return !!live && live.merchantLocationKey === target.locationKey && live.fulfillmentPolicyId === target.fulfillmentPolicyId;
}

/** Offer-Preis aus einem vollen Offer (GET). null = nicht lesbar. */
export function offerPriceOf(offer: Record<string, unknown>): number | null {
  const v = parseFloat(String((offer.pricingSummary as { price?: { value?: string } } | undefined)?.price?.value ?? ''));
  return Number.isFinite(v) ? v : null;
}

/**
 * Pflicht vor jedem vollen Offer-PUT (wie setOfferAvailableQuantity, Fund Aufsicht PR 285 Befund 1): ein voller PUT schreibt auch
 * pricingSummary zurück. Weicht der Offer-Preis vom Käuferpreis ab (Preis im Seller Hub geändert) oder ist einer unbekannt, spränge
 * der Käuferpreis still zurück → KEIN PUT. null = ok, sonst Grund.
 */
export function priceMismatch(sku: string, offerPrice: number | null, buyerPrice: number | null | undefined): string | null {
  if (typeof buyerPrice !== 'number' || !Number.isFinite(buyerPrice)) return `Käuferpreis für ${sku} unbekannt — kein Offer-PUT ohne Preisvergleich`;
  if (offerPrice == null) return `Angebotspreis für ${sku} nicht lesbar — kein Offer-PUT`;
  if (Math.abs(offerPrice - buyerPrice) > 0.01 + 1e-9) return `eBay-Preise uneinheitlich – erst angleichen (${sku}: Käufer ${buyerPrice.toFixed(2)} ≠ Angebotsdaten ${offerPrice.toFixed(2)})`;
  return null;
}
