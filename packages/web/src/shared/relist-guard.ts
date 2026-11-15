// Fix 208 (Inhaber-Ja 13.11.2026): Erneutes Listen nach "Beenden" (Trading EndItem) scheiterte bei stele-208 mit
// "Cannot revise listing. Der Artikel kann weder eingestellt noch bearbeitet werden …".
// Vermutung (vor dem Senden per GET /api/products/:id/offer-status zu belegen): EndItem beendet nur das Angebot auf der
// Trading-Seite — die Inventory-Offers bleiben auf status PUBLISHED mit listing.listingId des BEENDETEN Angebots
// (listing.listingStatus ENDED). publish(_by_inventory_item_group) versucht dann, dieses beendete Angebot zu revidieren.
// Abhilfe: vor dem publish die Offers zurückziehen (withdraw → UNPUBLISHED), danach publish legt ein NEUES Angebot an.
//
// Reine Entscheidung (Regel 2): nur hier wird festgelegt, ob ein withdraw nötig ist. Laufende Angebote werden NIE angefasst.

export interface RelistOffer {
  sku: string;
  offerId: string;
  status: string | null;          // Inventory API OfferStatusEnum: PUBLISHED | UNPUBLISHED
  listingId: string | null;       // offer.listing.listingId
  listingStatus: string | null;   // offer.listing.listingStatus (ListingStatusEnum: ACTIVE, ENDED, EBAY_ENDED, INACTIVE, OUT_OF_STOCK)
}

export interface RelistGuardInput {
  offers: RelistOffer[];
  /** Listing-ID, die die App für das Produkt als AKTIV führt (ebayStatus 'listed' + ebayListingId), sonst null. */
  activeListingId: string | null;
}

export interface RelistGuardDecision {
  /** true = vor dem publish zurückziehen (withdraw). */
  withdraw: boolean;
  /** Offers, die zurückgezogen werden müssen (Einzelartikel: je offerId; Varianten: Gruppe als Ganzes). */
  offerIds: string[];
  /** Gesetzt = NICHT publishen: ein Offer hängt an einem laufenden Angebot, das die App nicht als aktiv führt. */
  blocked: string | null;
  /** Begründung je Offer (für Log/Diagnose). */
  notes: string[];
}

// Annahme (eBay-Doku ListingStatusEnum, keine Live-Prüfung möglich): ENDED / EBAY_ENDED = beendet; ACTIVE / OUT_OF_STOCK = läuft
// (OUT_OF_STOCK = Menge 0, Angebot lebt weiter). INACTIVE ist nicht eindeutig → weder withdraw noch Sperre (bisheriges Verhalten).
export const ENDED_LISTING_STATUSES = new Set(['ENDED', 'EBAY_ENDED']);
export const LIVE_LISTING_STATUSES = new Set(['ACTIVE', 'OUT_OF_STOCK']);

export function decideRelistWithdraw(input: RelistGuardInput): RelistGuardDecision {
  const notes: string[] = [];
  const offerIds: string[] = [];
  const live: string[] = [];
  const active = input.activeListingId || null;

  for (const o of input.offers) {
    if (o.status !== 'PUBLISHED') { notes.push(`${o.sku}: ${o.status ?? 'ohne Status'} – kein withdraw`); continue; }
    const ls = o.listingStatus ? o.listingStatus.toUpperCase() : null;
    // Angebot, das die App selbst als aktiv führt → nie anfassen.
    if (active && o.listingId === active) { notes.push(`${o.sku}: gehört zum aktiven Angebot ${active} – kein withdraw`); continue; }
    if (ls && LIVE_LISTING_STATUSES.has(ls)) {
      // Läuft bei eBay, App kennt es nicht als aktiv → NIE zurückziehen (würde ein laufendes Angebot beenden), stattdessen sperren.
      live.push(`${o.sku} → ${o.listingId ?? '?'} (${ls})`);
      notes.push(`${o.sku}: laufendes Angebot ${o.listingId ?? '?'} (${ls}) – kein withdraw, Sperre`);
      continue;
    }
    if (ls && ENDED_LISTING_STATUSES.has(ls)) {
      offerIds.push(o.offerId);
      notes.push(`${o.sku}: PUBLISHED an beendetem Angebot ${o.listingId ?? '?'} (${ls}) – withdraw nötig`);
      continue;
    }
    // Status unbekannt/INACTIVE: nur zurückziehen, wenn die App gar kein aktives Angebot führt UND die Listing-ID nicht die aktive ist.
    // Ohne Status-Angabe könnte es ein laufendes Angebot sein → kein withdraw (Regel "laufende nie anfassen" geht vor).
    notes.push(`${o.sku}: PUBLISHED, Angebotsstatus ${ls ?? 'unbekannt'} (${o.listingId ?? '?'}) – unklar, kein withdraw`);
  }

  if (live.length > 0) {
    return {
      withdraw: false, offerIds: [], notes,
      blocked: `Offers hängen an einem laufenden eBay-Angebot, das die App nicht als aktiv führt: ${live.join(', ')} – erst verknüpfen oder beenden, es wurde nichts veröffentlicht`,
    };
  }
  // Führt die App ein aktives Angebot, wird nie zurückgezogen (Listen-Weg erreicht das wegen Duplikat-Schutz ohnehin nicht).
  if (active) return { withdraw: false, offerIds: [], blocked: null, notes };
  return { withdraw: offerIds.length > 0, offerIds, blocked: null, notes };
}

/** Rohe Offer-Antwort (GET /sell/inventory/v1/offer?sku=…) → RelistOffer[]. */
export function parseRelistOffers(sku: string, data: unknown): Array<RelistOffer & { merchantLocationKey: string | null }> {
  const offers = (data as { offers?: unknown[] } | null)?.offers;
  if (!Array.isArray(offers)) return [];
  return offers.map((raw) => {
    const o = raw as { offerId?: unknown; status?: unknown; merchantLocationKey?: unknown; listing?: { listingId?: unknown; listingStatus?: unknown } };
    return {
      sku,
      offerId: String(o.offerId ?? ''),
      status: typeof o.status === 'string' ? o.status : null,
      listingId: o.listing?.listingId != null ? String(o.listing.listingId) : null,
      listingStatus: typeof o.listing?.listingStatus === 'string' ? o.listing.listingStatus : null,
      merchantLocationKey: typeof o.merchantLocationKey === 'string' ? o.merchantLocationKey : null,
    };
  });
}
