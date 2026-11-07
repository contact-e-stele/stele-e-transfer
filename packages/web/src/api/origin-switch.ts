// OFFEN 030 Punkt 4b: Live-Angebote auf den Lagerort ihrer Herkunft umstellen (nach „ja Standort Bestand“ des Inhabers).
// Ablauf je Angebot: Ziel aus Herkunft (resolveLocation + resolveFulfillmentPolicy, dieselben Regeln wie beim Listen) →
// Lagerort sicherstellen → je Offer DIESES Angebots: GET volles Offer → nur merchantLocationKey + fulfillmentPolicyId ändern,
// Menge folgt dem Lager (Mengen-Fix B) → PUT → danach zurücklesen. Ohne confirm: nur Vorschau, nichts wird geschrieben.
// Alle eBay-/DB-Zugriffe kommen als deps herein (Grundgesetz 2: mit Mocks testbar). Preise werden NICHT angefasst.
import { resolveLocation, resolveFulfillmentPolicy, type LocationSpec, type FulfillmentPolicyInfo, type OriginLocations, type LiveShipping } from '../shared/origin-shipping';
import { offersOfListing, switchOfferBody, readBackMatches, type OfferSummary, type SwitchRow, type SwitchTarget } from '../shared/origin-switch';
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
    if (!opts.confirm) { rows.push({ ...base, vorher, ziel, status: 'vorschau', grund: `würde umstellen auf ${ziel.locationKey} / Richtlinie ${ziel.fulfillmentPolicyId}${loc.value.estimated ? ' (Ort geschätzt)' : ''}` }); continue; }
    try {
      if (!ensured.has(loc.value.key)) { await deps.ensureLocation(loc.value); ensured.add(loc.value.key); }
      const skus = await deps.skusOf(l.sku);
      let touched = 0; const errors: string[] = [];
      for (const sku of skus) {
        for (const o of offersOfListing(await deps.offersOf(sku), l.itemId)) {
          const full = await deps.getOffer(o.offerId);
          const { body, changed } = switchOfferBody(full, ziel);
          if (!changed) continue;
          deps.applyQuantity(body, await deps.quantityOf(sku));
          const r = await deps.putOffer(o.offerId, body);
          if (r.ok) touched++; else errors.push(`${sku}: ${r.error ?? 'PUT fehlgeschlagen'}`);
        }
      }
      if (touched === 0 && errors.length === 0) {
        rows.push({ ...base, vorher, ziel, status: 'übersprungen', grund: 'kein Inventory-Offer zu diesem Angebot gefunden (außerhalb der App eingestellt?) — von Hand im Seller Hub umstellen' });
        continue;
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
