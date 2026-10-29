// OFFEN 013 (stele-220, 28.10.2026): Schutz gegen versehentliches Beenden und Doppel-Listen.
// Reine Funktionen (Grundgesetz 2) — die Routen in api/index.ts und der Listings-Tab nutzen nur diese Regeln.
//
// Vorfall: "Ende" im Listings-Tab hat 198712713157 (17 verkauft, 15 Beobachter) mit einem einfachen
// Ja/Nein beendet; "Bei eBay listen" hat danach ein neues Angebot 198752857838 angelegt — Historie weg.
// Zusätzlich löste DELETE /ebay/listings/:itemId die Verknüpfung in der App AUCH dann, wenn eBay das
// Beenden abgelehnt hatte (nur "warning"), und der Listings-Tab behandelte die Warnung wie Erfolg.

/** SKU-Präfix der App: stele-<Produkt-Nr> bzw. stele-<Nr>-GROUP / stele-<Nr>-<Variante>. */
export function productIdFromSku(sku: string | null | undefined): number | null {
  const m = (sku ?? '').trim().match(/^stele-(\d+)(?:-|$)/i);
  return m ? parseInt(m[1], 10) : null;
}

/** AliExpress-Artikelnummer aus der Quell-URL (…/item/<Nr>.html). */
export function aliItemIdFromUrl(url: string | null | undefined): string | null {
  return (url ?? '').match(/item\/(\d+)/)?.[1] ?? null;
}

/**
 * eBay-Antwort auf EndItem, bei der das Angebot sicher NICHT mehr läuft, obwohl Ack=Failure kam
 * (bereits beendet / abgelaufen). Nur dann darf die Verknüpfung trotzdem gelöst werden.
 * Wortlaut nach eBay-Fehler 1047 ("Die Auktion wurde bereits beendet." / "The auction has already been closed.");
 * live nicht belegt — im Zweifel bleibt die Verknüpfung bestehen (sicherer Fehlerfall).
 */
export function isAlreadyEndedError(error: string | null | undefined): boolean {
  return /bereits beendet|already (?:been )?(?:closed|ended)|has ended|ist beendet/i.test(error ?? '');
}

/** Regel 6a: Verknüpfung nur lösen, wenn eBay das Ende bestätigt hat (ok) oder das Angebot nachweislich schon beendet war. */
export function shouldUnlinkAfterEnd(result: { ok: boolean; error?: string | null }): boolean {
  return result.ok === true || isAlreadyEndedError(result.error);
}

export interface ActiveListingLite { itemId: string; sku: string | null; title?: string }
export interface ProductLite { id: number; ebayListingId: string | null; ebayStatus: string | null; sourceUrl: string | null }

export interface ListingConflict { itemId: string; reason: 'gleiche-sku' | 'gleiche-aliexpress-nr'; otherProductId: number | null; message: string }

/**
 * Regel 6b: Vor "Bei eBay listen" prüfen, ob für dieses Produkt schon ein aktives eBay-Angebot läuft —
 * a) ein aktives Angebot mit SKU stele-<id>… (auch wenn die App-Verknüpfung fehlt), oder
 * b) ein aktives Angebot, das mit einem ANDEREN App-Produkt mit derselben AliExpress-Nr verknüpft ist.
 * Liefert den ersten Konflikt (oder null).
 */
export function findActiveListingConflict(
  product: { id: number; sourceUrl: string | null },
  activeListings: ActiveListingLite[],
  products: ProductLite[],
): ListingConflict | null {
  for (const l of activeListings) {
    if (productIdFromSku(l.sku) === product.id) {
      return {
        itemId: l.itemId, reason: 'gleiche-sku', otherProductId: null,
        message: `Für stele-${product.id} läuft bei eBay schon das Angebot #${l.itemId} (SKU ${l.sku}). Nicht neu listen — erst verknüpfen (Listings-Tab → „Angebot verknüpfen“).`,
      };
    }
  }
  const ali = aliItemIdFromUrl(product.sourceUrl);
  if (ali) {
    const activeIds = new Set(activeListings.map(l => l.itemId));
    const other = products.find(p => p.id !== product.id && p.ebayListingId && activeIds.has(p.ebayListingId) && aliItemIdFromUrl(p.sourceUrl) === ali);
    if (other) {
      return {
        itemId: other.ebayListingId!, reason: 'gleiche-aliexpress-nr', otherProductId: other.id,
        message: `Dieselbe AliExpress-Nr ist schon als stele-${other.id} bei eBay aktiv (Angebot #${other.ebayListingId}). Nicht doppelt listen — Dublette prüfen.`,
      };
    }
  }
  return null;
}

/**
 * Regel 6c: Texte der Bestätigungen vor "Ende". Erste Frage immer; eine ZWEITE nur, wenn das Angebot
 * Verkäufe oder Beobachter hat (beides geht beim Beenden + Neueinstellen verloren).
 */
export function endConfirmSteps(listing: { itemId: string; title?: string; quantitySold?: number | null; watchCount?: number | null }): string[] {
  const sold = listing.quantitySold ?? 0;
  const watch = listing.watchCount ?? 0;
  const steps = [`eBay-Angebot #${listing.itemId} wirklich beenden?`];
  if (sold > 0 || watch > 0) {
    const parts = [sold > 0 ? `${sold}× verkauft` : null, watch > 0 ? `${watch} Beobachter` : null].filter(Boolean).join(' und ');
    steps.push(
      `ACHTUNG: Dieses Angebot hat ${parts}.\n\n` +
      `Beim Beenden gehen Verkaufshistorie und Beobachter verloren — ein neues Angebot startet bei 0.\n` +
      `Preis oder Menge ändern geht OHNE Beenden.\n\nWirklich endgültig beenden?`,
    );
  }
  return steps;
}
