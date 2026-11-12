// AUFTRAG 048 (Inhaber-Ja 12.11.2026 11:54): Ein Varianten-Angebot, dessen Offers schon den richtigen Lagerort haben, dessen
// veröffentlichtes Angebot aber noch den alten Artikelstandort zeigt (Live-Fund 047: stele-208 Offer CN-Shenzhen, Artikelseite
// "Wiesbaden"), wird mit publish_by_inventory_item_group neu übernommen. Reine Prüfung, ob das gefahrlos geht.
// Publish überträgt ALLE Offer-Daten (auch Preise) → nur wenn alle Offers denselben Lagerort haben und KEIN Offer-Preis vom
// Käuferpreis abweicht (sonst würde publish still einen Preis ändern – dafür gibt es "Käuferpreis heben/Angleichen").

export interface RepublishOffer {
  sku: string;
  merchantLocationKey: string | null;
  offerPrice: number | null;
  buyerPrice: number | null;
}

export interface RepublishInput {
  productId: number;
  ebayStatus: string | null;
  ebayListingId: string | null;
  isVariant: boolean;
  offers: RepublishOffer[];
  liveLocation: string | null; // GetItem Location, Country
}

export interface RepublishPlan {
  ok: boolean;
  groupKey: string;
  reason?: string;
  locationKey: string | null;
  liveLocation: string | null;
  offers: RepublishOffer[];
}

export function planRepublish(input: RepublishInput): RepublishPlan {
  const groupKey = `stele-${input.productId}-GROUP`;
  const base = { groupKey, liveLocation: input.liveLocation, offers: input.offers };
  const fail = (reason: string): RepublishPlan => ({ ok: false, reason, locationKey: null, ...base });
  if (input.ebayStatus !== 'listed' || !input.ebayListingId) return fail('Produkt ist nicht live bei eBay gelistet');
  if (!input.isVariant) return fail('Nur Varianten-Angebote (Gruppe) – Einzelartikel werden hiermit nicht neu veröffentlicht');
  if (input.offers.length === 0) return fail('Keine Offers der Gruppe lesbar');
  const keys = [...new Set(input.offers.map(o => o.merchantLocationKey))];
  if (keys.length !== 1 || keys[0] == null) {
    return fail(`Offers haben nicht denselben Lagerort (${keys.map(k => k ?? 'keiner').join(', ')}) – erst "Bestand umstellen"`);
  }
  const drift = input.offers.filter(o => o.offerPrice == null || o.buyerPrice == null || Math.round(o.offerPrice * 100) !== Math.round(o.buyerPrice * 100));
  if (drift.length > 0) {
    return fail(`Preis-Abweichung Käufer ↔ Angebotsdaten bei ${drift.map(o => `${o.sku} (${o.buyerPrice ?? '–'} / ${o.offerPrice ?? '–'})`).join(', ')} – publish würde den Preis ändern; erst angleichen oder heben`);
  }
  return { ok: true, locationKey: keys[0], ...base };
}
