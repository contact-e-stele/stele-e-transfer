// OFFEN 030 Punkt 4b: Live-Angebote auf den Lagerort ihrer Herkunft umstellen (nach „ja Standort Bestand“ des Inhabers).
// Ablauf je Angebot: Ziel aus Herkunft (resolveLocation + resolveFulfillmentPolicy, dieselben Regeln wie beim Listen) →
// Lagerort sicherstellen → je Offer DIESES Angebots: GET volles Offer → nur merchantLocationKey + fulfillmentPolicyId ändern,
// Menge folgt dem Lager (Mengen-Fix B) → PUT → danach zurücklesen. Ohne confirm: nur Vorschau, nichts wird geschrieben.
// Alle eBay-/DB-Zugriffe kommen als deps herein (Grundgesetz 2: mit Mocks testbar). Preise werden NICHT angefasst.
import { resolveLocation, resolveFulfillmentPolicy, type LocationSpec, type FulfillmentPolicyInfo, type OriginLocations, type LiveShipping } from '../shared/origin-shipping';
import { offersOfListing, switchOfferBody, readBackMatches, offerPriceOf, priceMismatch, type OfferSummary, type SwitchRow, type SwitchTarget } from '../shared/origin-switch';
import type { ListingOrigin } from '../shared/listing-origin';

export interface OriginSwitchListing { itemId: string; sku: string; productId: number | null; origin: ListingOrigin | null }

export interface OriginSwitchDeps {
  policies: FulfillmentPolicyInfo[];
  locations: OriginLocations;
  readLive: (l: OriginSwitchListing) => Promise<LiveShipping | null>;
  skusOf: (listingSku: string) => Promise<string[]>;          // -GROUP → Varianten-SKUs, sonst [sku]
  offersOf: (sku: string) => Promise<OfferSummary[]>;
  getOffer: (offerId: string) => Promise<Record<string, unknown>>;
  quantityOf: (sku: string) => Promise<number | null>;
  putOffer: (offerId: string, body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  ensureLocation: (spec: LocationSpec) => Promise<'exists' | 'created'>;
  applyQuantity: (offer: Record<string, unknown>, qty: number | null) => void;
  /** Käuferpreise des Angebots (GetItem): SKU → Preis; Einzelartikel: single. null = nicht lesbar. */
  buyerPrices: (itemId: string) => Promise<{ bySku: Map<string, number>; single: number | null } | null>;
  /** K-011b: Sperr-Text, wenn das Produkt gesperrt ist, sonst null. */
  priceLocked: (sku: string) => Promise<string | null>;
  /** K-011: Sperre setzen bei Abweichung (nur beim Umstellen, nicht in der Vorschau). */
  setLock: (productId: number, row: { sku: string; buyerPrice: number; offerPrice: number }) => Promise<void>;
}

export async function runOriginSwitch(listings: OriginSwitchListing[], opts: { confirm: boolean }, deps: OriginSwitchDeps): Promise<SwitchRow[]> {
  const rows: SwitchRow[] = [];
  const ensured = new Set<string>();
  for (const l of listings) {
    const base = { steleNr: l.productId != null ? `stele-${l.productId}` : '–', itemId: l.itemId, herkunft: l.origin?.label || 'unbekannt' };
    const live = await deps.readLive(l).catch(() => null);
    const vorher = { lagerort: live?.merchantLocationKey ?? (live?.locationText ? `Standort ${live.locationText}` : null), richtlinie: live?.fulfillmentPolicyId ?? null };
    if (l.productId == null || !l.origin) { rows.push({ ...base, vorher, ziel: null, status: 'übersprungen', grund: 'Angebot nicht in der App — von Hand im Seller Hub prüfen' }); continue; }
    const loc = resolveLocation(l.origin, deps.locations);
    if (!loc.ok) { rows.push({ ...base, vorher, ziel: null, status: 'übersprungen', grund: loc.error }); continue; }
    const pol = resolveFulfillmentPolicy(l.origin, deps.policies);
    if (!pol.ok) { rows.push({ ...base, vorher, ziel: null, status: 'übersprungen', grund: pol.error }); continue; }
    const ziel: SwitchTarget = { locationKey: loc.value.key, fulfillmentPolicyId: pol.value.id };
    if (readBackMatches(live, ziel)) { rows.push({ ...base, vorher, ziel, status: 'schon richtig' }); continue; }
    try {
      // Befund 1 (Aufsicht PR 285): vor jedem vollen Offer-PUT Sperre + Käuferpreis prüfen — auch in der Vorschau (nur lesen),
      // damit uneinheitliche Preise VOR "ja Standort Bestand" sichtbar sind.
      const locked = await deps.priceLocked(l.sku);
      if (locked) { rows.push({ ...base, vorher, ziel, status: 'übersprungen', grund: locked }); continue; }
      const buyer = await deps.buyerPrices(l.itemId).catch(() => null);
      const skus = await deps.skusOf(l.sku);
      const plan: Array<{ sku: string; offerId: string; body: Record<string, unknown> }> = [];
      const problems: string[] = [];
      let unchanged = 0;
      for (const sku of skus) {
        for (const o of offersOfListing(await deps.offersOf(sku), l.itemId)) {
          const full = await deps.getOffer(o.offerId);
          const offerPrice = offerPriceOf(full);
          const buyerPrice = buyer ? (buyer.bySku.get(sku) ?? (buyer.bySku.size === 0 ? buyer.single : null)) : null;
          const mism = priceMismatch(sku, offerPrice, buyerPrice);
          if (mism) {
            problems.push(mism);
            if (opts.confirm && offerPrice != null && typeof buyerPrice === 'number') await deps.setLock(l.productId, { sku, buyerPrice, offerPrice }).catch(() => undefined);
            continue;
          }
          const { body, changed } = switchOfferBody(full, ziel);
          if (!changed) { unchanged++; continue; }
          plan.push({ sku, offerId: o.offerId, body });
        }
      }
      if (problems.length > 0) { rows.push({ ...base, vorher, ziel, status: 'übersprungen', grund: `${problems.join(' | ')}${opts.confirm ? ' — Sperre gesetzt, nichts geändert' : ''}` }); continue; }
      if (plan.length === 0) {
        rows.push({ ...base, vorher, ziel, status: 'übersprungen', grund: unchanged > 0
          ? 'Offers schon richtig, Rücklesen widerspricht — bitte im Seller Hub prüfen'
          : 'kein Inventory-Offer zu diesem Angebot gefunden (außerhalb der App eingestellt?) — von Hand im Seller Hub umstellen' });
        continue;
      }
      if (!opts.confirm) { rows.push({ ...base, vorher, ziel, offers: plan.length, status: 'vorschau', grund: `würde umstellen auf ${ziel.locationKey} / Richtlinie ${ziel.fulfillmentPolicyId}${loc.value.estimated ? ' (Ort geschätzt)' : ''} · Preise geprüft (Käufer = Angebot)` }); continue; }
      if (!ensured.has(loc.value.key)) { await deps.ensureLocation(loc.value); ensured.add(loc.value.key); }
      let touched = 0; const errors: string[] = [];
      for (const p of plan) {
        deps.applyQuantity(p.body, await deps.quantityOf(p.sku));
        const r = await deps.putOffer(p.offerId, p.body);
        if (r.ok) touched++; else errors.push(`${p.sku}: ${r.error ?? 'PUT fehlgeschlagen'}`);
      }
      const after = await deps.readLive(l).catch(() => null);
      const nachher = { lagerort: after?.merchantLocationKey ?? null, richtlinie: after?.fulfillmentPolicyId ?? null, stimmt: readBackMatches(after, ziel) };
      rows.push({ ...base, vorher, ziel, offers: touched, nachher, status: errors.length ? 'fehler' : 'umgestellt', ...(errors.length ? { grund: errors.join(' | ') } : {}) });
    } catch (e) {
      rows.push({ ...base, vorher, ziel, status: 'fehler', grund: String(e) });
    }
  }
  return rows;
}
