// OFFEN 030 Teil 2 (04.11.2026): Herkunft → eBay-Lagerort, Versandrichtlinie, Lieferschätzung, Ampel, Bestandsliste.
//
// Reine Funktionen (Grundgesetz 2): kein fetch, keine DB. ebay.ts / index.ts liefern die Daten, hier wird nur entschieden.
// Herkunft kommt aus shared/listing-origin.ts (EINE Quelle, Grundgesetz 8).
//
// Regeln (OFFEN 030 Punkt 2 + NACHTRAG 11:55 + ANTWORT AUFSICHT 20:50 / 21:30):
//  - Ein Angebot = ein Lagerort = eine Herkunft. Ohne Herkunft, gemischt oder ohne Lagerort: NICHT listen (Klartext).
//  - China: Standardort Shenzhen, Guangdong — nur weil der Lieferant keinen Ort nennt, als "Ort geschätzt" markiert
//    (OFFEN 030 1b erlaubt genau diesen Standardort). Deutschland/EU-Land: nur mit einem in den Einstellungen
//    eingetragenen Ort. Nie "Wiesbaden" für Ware, die nicht aus Wiesbaden kommt.
//  - Versandrichtlinie: wird NUR aus dem eBay-Konto GELESEN und per Name zugeordnet ("Versand aus China" /
//    "Versand aus EU-Lager"). Fehlt sie → nicht listen. Die App legt keine Richtlinie an (kein Knopf vor "b").
//  - Lieferschätzung: eBays Min/Max-Datum wird in Werktage (Mo–Fr) ab heute umgerechnet und mit der Fußzeile verglichen.
//    Grün nur, wenn eBays Spanne innerhalb der Fußzeilen-Spanne liegt. Feiertage werden NICHT abgezogen (benannte Lücke).

import { deliveryTimeFor, mixedOriginError, type DeliveryTimes, type ListingOrigin } from './listing-origin';

export const POLICY_NAME_CN = 'Versand aus China';
export const POLICY_NAME_EU = 'Versand aus EU-Lager';

/** Ländername (wie AliExpress "Ships From" ihn liefert) → ISO-2. Nur Länder, die isEuShipFrom kennt, plus China. */
const COUNTRY_ISO: Array<[RegExp, string]> = [
  [/^(cn|china( mainland)?|mainland china)$/i, 'CN'],
  [/^(de|germany|deutschland)$/i, 'DE'],
  [/^(es|spain|spanien)$/i, 'ES'],
  [/^(fr|france|frankreich)$/i, 'FR'],
  [/^(it|italy|italien)$/i, 'IT'],
  [/^(pl|poland|polen)$/i, 'PL'],
  [/^(nl|netherlands|niederlande)$/i, 'NL'],
  [/^(cz|czech republic|czechia|tschechien)$/i, 'CZ'],
  [/^(at|austria|österreich)$/i, 'AT'],
  [/^(be|belgium|belgien)$/i, 'BE'],
  [/^(lu|luxembourg|luxemburg)$/i, 'LU'],
  [/^(se|sweden|schweden)$/i, 'SE'],
  [/^(pt|portugal)$/i, 'PT'],
  [/^(hu|hungary|ungarn)$/i, 'HU'],
];

export function countryIso(label: string | null | undefined): string | null {
  const s = (label ?? '').trim();
  if (!s) return null;
  for (const [re, iso] of COUNTRY_ISO) if (re.test(s)) return iso;
  return null;
}

/** ISO-2 des Angebots (aus der einheitlichen Herkunft) oder null. */
export function originIso(origin: ListingOrigin): string | null {
  if (origin.mixed) return null;
  if (origin.kind === 'CN') return 'CN';
  if (origin.kind === 'DE') return 'DE';
  if (origin.kind === 'EU') return countryIso(origin.label);
  return null;
}

// ─── Lagerorte ─────────────────────────────────────────────────────────────────

export interface OriginLocationSetting { city: string; postalCode?: string; stateOrProvince?: string }
/** app_settings "origin_locations": ISO-2 → Ort. CN darf fehlen (dann Standardort Shenzhen, geschätzt). */
export type OriginLocations = Record<string, OriginLocationSetting>;

export const CN_DEFAULT_LOCATION: OriginLocationSetting = { city: 'Shenzhen', stateOrProvince: 'Guangdong' };

export function parseOriginLocations(raw: string | null | undefined): OriginLocations {
  const out: OriginLocations = {};
  try {
    const j = raw ? JSON.parse(raw) : {};
    if (!j || typeof j !== 'object') return out;
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const iso = k.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(iso) || !v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      const city = typeof o.city === 'string' ? o.city.trim() : '';
      if (!city || city.length > 60) continue;
      const postalCode = typeof o.postalCode === 'string' && o.postalCode.trim() ? o.postalCode.trim().slice(0, 12) : undefined;
      const stateOrProvince = typeof o.stateOrProvince === 'string' && o.stateOrProvince.trim() ? o.stateOrProvince.trim().slice(0, 60) : undefined;
      out[iso] = { city, ...(postalCode ? { postalCode } : {}), ...(stateOrProvince ? { stateOrProvince } : {}) };
    }
  } catch { /* leer */ }
  return out;
}

export interface LocationSpec {
  key: string;              // merchantLocationKey, z. B. "CN-Shenzhen"
  name: string;             // Anzeigename bei eBay
  country: string;          // ISO-2
  city: string;
  stateOrProvince?: string;
  postalCode?: string;
  estimated: boolean;       // true = Ort nicht vom Lieferanten, sondern Standardort (nur China)
}

/** merchantLocationKey: nur A–Z, a–z, 0–9, "-" (eBay erlaubt max. 36 Zeichen). Umlaute werden umgeschrieben. */
export function locationKey(iso: string, city: string): string {
  const ascii = city.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/ø/g, 'o').replace(/Ø/g, 'O')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '');
  return `${iso}-${ascii}`.slice(0, 36);
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

export const NO_ORIGIN_ERROR = 'Herkunft fehlt — ohne Herkunft wird nicht gelistet (OFFEN 030). Bitte "Versand aus" am Produkt eintragen.';

/** Lagerort des Angebots aus der Herkunft. Fehler im Klartext, wenn nicht eindeutig bestimmbar. */
export function resolveLocation(origin: ListingOrigin, locations: OriginLocations): Resolved<LocationSpec> {
  const mixed = mixedOriginError(origin);
  if (mixed) return { ok: false, error: mixed };
  if (origin.kind === 'UNKNOWN') return { ok: false, error: NO_ORIGIN_ERROR };
  const iso = originIso(origin);
  if (!iso) return { ok: false, error: `Herkunft "${origin.label}" wird nicht unterstützt (nur China, Deutschland, EU-Länder) — nicht gelistet.` };
  if (iso === 'CN') {
    const own = locations.CN;
    const loc = own ?? CN_DEFAULT_LOCATION;
    return { ok: true, value: { key: locationKey('CN', loc.city), name: `Versand aus China (${loc.city})`, country: 'CN', city: loc.city, ...(loc.stateOrProvince ? { stateOrProvince: loc.stateOrProvince } : {}), ...(loc.postalCode ? { postalCode: loc.postalCode } : {}), estimated: !own } };
  }
  const loc = locations[iso];
  if (!loc) return { ok: false, error: `Kein Lagerort für Herkunft ${iso} hinterlegt (Einstellungen › Lagerorte: Ort + PLZ des Lieferanten-Lagers) — nicht gelistet, kein Ort wird geraten.` };
  if (!loc.postalCode && !loc.stateOrProvince) return { ok: false, error: `Lagerort ${iso} unvollständig: eBay braucht PLZ oder Region zum Ort "${loc.city}".` };
  return { ok: true, value: { key: locationKey(iso, loc.city), name: `Versand aus ${iso} (${loc.city})`, country: iso, city: loc.city, ...(loc.stateOrProvince ? { stateOrProvince: loc.stateOrProvince } : {}), ...(loc.postalCode ? { postalCode: loc.postalCode } : {}), estimated: false } };
}

/** Body für POST /sell/inventory/v1/location/{key}. */
export function locationCreateBody(spec: LocationSpec) {
  return {
    location: { address: { city: spec.city, ...(spec.stateOrProvince ? { stateOrProvince: spec.stateOrProvince } : {}), ...(spec.postalCode ? { postalCode: spec.postalCode } : {}), country: spec.country } },
    locationTypes: ['WAREHOUSE'],
    name: spec.name,
    merchantLocationStatus: 'ENABLED',
  };
}

// ─── Versandrichtlinien (nur lesen) ───────────────────────────────────────────

export interface FulfillmentPolicyInfo {
  id: string;
  name: string;
  handlingDays: number | null;
  services: string[];        // shippingServiceCode je Service
  freeShipping: boolean;     // alle Services kostenlos
}

/** GET /sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE → Liste. */
export function parseFulfillmentPolicies(json: unknown): FulfillmentPolicyInfo[] {
  const list = (json as { fulfillmentPolicies?: unknown })?.fulfillmentPolicies;
  if (!Array.isArray(list)) return [];
  return list.flatMap((p: Record<string, unknown>) => {
    const id = typeof p.fulfillmentPolicyId === 'string' ? p.fulfillmentPolicyId : null;
    if (!id) return [];
    const ht = p.handlingTime as { value?: unknown; unit?: unknown } | undefined;
    const handlingDays = typeof ht?.value === 'number' && (ht.unit === 'DAY' || ht.unit === 'BUSINESS_DAY' || ht.unit === undefined) ? ht.value : null;
    const services: Array<{ code: string; free: boolean }> = [];
    for (const o of (Array.isArray(p.shippingOptions) ? p.shippingOptions : []) as Array<{ shippingServices?: Array<Record<string, unknown>> }>) {
      for (const s of o.shippingServices ?? []) {
        const code = typeof s.shippingServiceCode === 'string' ? s.shippingServiceCode : '';
        const cost = (s.shippingCost as { value?: unknown } | undefined)?.value;
        const free = s.freeShipping === true || (cost !== undefined && Number(cost) === 0);
        if (code) services.push({ code, free });
      }
    }
    return [{ id, name: typeof p.name === 'string' ? p.name : '', handlingDays, services: services.map(s => s.code), freeShipping: services.length > 0 && services.every(s => s.free) }];
  });
}

export function policyNameFor(origin: ListingOrigin): string | null {
  if (origin.mixed) return null;
  if (origin.kind === 'CN') return POLICY_NAME_CN;
  if (origin.kind === 'DE' || origin.kind === 'EU') return POLICY_NAME_EU;
  return null;
}

/** Richtlinie je Herkunft aus den GELESENEN Konto-Richtlinien (Name exakt, Groß/klein egal). */
export function resolveFulfillmentPolicy(origin: ListingOrigin, policies: FulfillmentPolicyInfo[]): Resolved<FulfillmentPolicyInfo> {
  const want = policyNameFor(origin);
  if (!want) return { ok: false, error: origin.kind === 'UNKNOWN' && !origin.mixed ? NO_ORIGIN_ERROR : (mixedOriginError(origin) ?? `Keine Versandrichtlinie für Herkunft "${origin.label}".`) };
  const hits = policies.filter(p => p.name.trim().toLowerCase() === want.toLowerCase());
  if (hits.length === 0) return { ok: false, error: `Versandrichtlinie "${want}" fehlt im eBay-Konto — die App legt keine an (Entscheidung Inhaber Weg a/b). Nicht gelistet.` };
  if (hits.length > 1) return { ok: false, error: `Versandrichtlinie "${want}" gibt es ${hits.length}× im eBay-Konto (${hits.map(h => h.id).join(', ')}) — nicht eindeutig, nicht gelistet.` };
  return { ok: true, value: hits[0] };
}

// ─── Lieferschätzung ─────────────────────────────────────────────────────────

export interface DayRange { min: number; max: number }

/** "7–12 Werktage" / "7-12" / "3 bis 5 Werktage" → {min,max}; einzelne Zahl → {n,n}; sonst null. */
export function parseDayRange(text: string | null | undefined): DayRange | null {
  const m = (text ?? '').match(/(\d+)\s*(?:[–-]|bis)\s*(\d+)/);
  if (m) { const a = Number(m[1]), b = Number(m[2]); return a <= b ? { min: a, max: b } : null; }
  const one = (text ?? '').match(/(\d+)/);
  return one ? { min: Number(one[1]), max: Number(one[1]) } : null;
}

/** Datum "YYYY-MM-DD" (UTC-Tag) aus ISO-String. */
function dayOf(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Werktage (Mo–Fr) nach `from` bis einschließlich `to` (Feiertage NICHT abgezogen). to ≤ from → 0. */
export function businessDaysAfter(fromIso: string, toIso: string): number | null {
  const a = dayOf(fromIso), b = dayOf(toIso);
  if (a === null || b === null) return null;
  let n = 0;
  for (let t = a + 86_400_000; t <= b; t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export interface DeliveryEstimate { minDate: string; maxDate: string }

/** Browse API Item (getItemByLegacyId / getItemsByItemGroup.items[i]) → früheste Min/Max-Schätzung der Versandoptionen. */
export function parseBrowseDeliveryEstimate(item: unknown): DeliveryEstimate | null {
  const opts = (item as { shippingOptions?: unknown })?.shippingOptions;
  if (!Array.isArray(opts)) return null;
  for (const o of opts as Array<Record<string, unknown>>) {
    const min = typeof o.minEstimatedDeliveryDate === 'string' ? o.minEstimatedDeliveryDate : null;
    const max = typeof o.maxEstimatedDeliveryDate === 'string' ? o.maxEstimatedDeliveryDate : null;
    if (min && max) return { minDate: min, maxDate: max };
  }
  return null;
}

export type AmpelColor = 'green' | 'red' | 'grey';

export interface DeliveryComparison {
  color: AmpelColor;
  footer: DayRange | null;
  ebay: DayRange | null;
  text: string;
}

/** Fußzeile (Herkunft) gegen eBays Lieferschätzung, beide in Werktagen ab `todayIso`. */
export function compareDeliveryEstimate(footerTime: string | null | undefined, estimate: DeliveryEstimate | null, todayIso: string): DeliveryComparison {
  const footer = parseDayRange(footerTime);
  if (!estimate) return { color: 'grey', footer, ebay: null, text: 'eBay-Lieferschätzung nicht lesbar' };
  const min = businessDaysAfter(todayIso, estimate.minDate), max = businessDaysAfter(todayIso, estimate.maxDate);
  if (min === null || max === null) return { color: 'grey', footer, ebay: null, text: 'eBay-Lieferschätzung ungültig' };
  const ebay = { min, max };
  const ebayTxt = `eBay ${min}–${max} Werktage (${estimate.minDate.slice(0, 10)} bis ${estimate.maxDate.slice(0, 10)})`;
  if (!footer) return { color: 'red', footer, ebay, text: `Fußzeile ohne Lieferzeit-Zahl · ${ebayTxt}` };
  const inside = ebay.min >= footer.min && ebay.max <= footer.max;
  return { color: inside ? 'green' : 'red', footer, ebay, text: `Fußzeile ${footer.min}–${footer.max} Werktage · ${ebayTxt}` };
}

// ─── Ampel Standort/Lieferzeit ───────────────────────────────────────────────

export interface OriginAmpel {
  standort: AmpelColor;
  standortText: string;
  location: LocationSpec | null;
  policy: FulfillmentPolicyInfo | null;
  deliveryTime: string | null;   // Fußzeilen-Text aus der Herkunft
  blockError: string | null;     // gesetzt → Listen gesperrt
}

/**
 * Vor dem Listen: Herkunft eindeutig, Lagerort bestimmbar, Richtlinie im Konto gefunden → grün.
 * Bei schon gelisteten Angeboten zusätzlich: tatsächlicher Lagerort/Richtlinie (gelesen) muss passen, sonst rot.
 * policies = null → Richtlinien nicht lesbar → rot (sperrt).
 */
export function originAmpel(input: {
  origin: ListingOrigin;
  locations: OriginLocations;
  policies: FulfillmentPolicyInfo[] | null;
  deliveryTimes?: DeliveryTimes;
  live?: { merchantLocationKey: string | null; fulfillmentPolicyId: string | null } | null;
}): OriginAmpel {
  const deliveryTime = deliveryTimeFor(input.origin, input.deliveryTimes);
  const loc = resolveLocation(input.origin, input.locations);
  if (!loc.ok) return { standort: 'red', standortText: loc.error, location: null, policy: null, deliveryTime, blockError: loc.error };
  if (!input.policies) {
    const e = 'Versandrichtlinien des eBay-Kontos nicht lesbar — zur Sicherheit nicht gelistet.';
    return { standort: 'red', standortText: e, location: loc.value, policy: null, deliveryTime, blockError: e };
  }
  const pol = resolveFulfillmentPolicy(input.origin, input.policies);
  if (!pol.ok) return { standort: 'red', standortText: pol.error, location: loc.value, policy: null, deliveryTime, blockError: pol.error };
  if (input.live) {
    const wrong: string[] = [];
    if (input.live.merchantLocationKey !== loc.value.key) wrong.push(`Lagerort bei eBay "${input.live.merchantLocationKey ?? '–'}", passend wäre "${loc.value.key}"`);
    if (input.live.fulfillmentPolicyId !== pol.value.id) wrong.push(`Versandrichtlinie bei eBay ${input.live.fulfillmentPolicyId ?? '–'}, passend wäre ${pol.value.id} "${pol.value.name}"`);
    if (wrong.length) return { standort: 'red', standortText: wrong.join(' · '), location: loc.value, policy: pol.value, deliveryTime, blockError: null };
  }
  const est = loc.value.estimated ? ' (Ort geschätzt: Lieferant nennt keinen Ort)' : '';
  return { standort: 'green', standortText: `Lagerort ${loc.value.key}${est} · Richtlinie "${pol.value.name}" (${pol.value.id})`, location: loc.value, policy: pol.value, deliveryTime, blockError: null };
}

// ─── Bestandsliste (nur lesen) ───────────────────────────────────────────────

export interface InventoryRow {
  steleNr: string;
  itemId: string;
  herkunft: string;                 // Klartext
  heuteLagerort: string;            // gelesen (merchantLocationKey) oder "nicht lesbar"
  neuerLagerort: string;            // aus Herkunft oder Fehlergrund
  heuteRichtlinie: string;
  neueRichtlinie: string;
  umstellungNoetig: boolean | null; // null = nicht entscheidbar (Fehler)
}

export function inventoryRow(input: {
  productId: number; itemId: string; origin: ListingOrigin; locations: OriginLocations; policies: FulfillmentPolicyInfo[];
  live: { merchantLocationKey: string | null; fulfillmentPolicyId: string | null } | null;
}): InventoryRow {
  const o = input.origin;
  const herkunft = o.mixed ? `gemischt (${[...new Set(o.perVariant.map(v => v.label || 'unbekannt'))].join(', ')})` : (o.label || 'unbekannt');
  const loc = resolveLocation(o, input.locations);
  const pol = resolveFulfillmentPolicy(o, input.policies);
  const policyName = (id: string | null) => id ? `${id}${(n => n ? ` "${n}"` : '')(input.policies.find(p => p.id === id)?.name)}` : '–';
  const heuteLagerort = input.live ? (input.live.merchantLocationKey ?? '–') : 'nicht lesbar';
  const heuteRichtlinie = input.live ? policyName(input.live.fulfillmentPolicyId) : 'nicht lesbar';
  const decidable = loc.ok && pol.ok && !!input.live;
  return {
    steleNr: `stele-${input.productId}`,
    itemId: input.itemId,
    herkunft,
    heuteLagerort,
    neuerLagerort: loc.ok ? loc.value.key + (loc.value.estimated ? ' (Ort geschätzt)' : '') : `— ${loc.error}`,
    heuteRichtlinie,
    neueRichtlinie: pol.ok ? policyName(pol.value.id) : `— ${pol.error}`,
    umstellungNoetig: decidable ? (input.live!.merchantLocationKey !== (loc as { value: LocationSpec }).value.key || input.live!.fulfillmentPolicyId !== (pol as { value: FulfillmentPolicyInfo }).value.id) : null,
  };
}

