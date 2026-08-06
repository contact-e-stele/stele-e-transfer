// eBay Inventory API + Account API Integration
// Docs: https://developer.ebay.com/api-docs/sell/inventory/

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID ?? '';
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET ?? '';
const EBAY_REFRESH_TOKEN = process.env.EBAY_REFRESH_TOKEN ?? '';
const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';

const BASE_URL = EBAY_SANDBOX
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

const AUTH_URL = EBAY_SANDBOX
  ? 'https://auth.sandbox.ebay.com'
  : 'https://auth.ebay.com';

// ─── OAuth ────────────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedAppToken: { token: string; expiresAt: number } | null = null;

/** App-Token (client_credentials) - fuer Taxonomy API */
export async function getAppToken(): Promise<string> {
  if (cachedAppToken && Date.now() < cachedAppToken.expiresAt - 60_000) {
    return cachedAppToken.token;
  }
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE_URL}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay App-Token failed: ${res.status} ${text}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedAppToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedAppToken.token;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');

  const res = await fetch(`${BASE_URL}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: EBAY_REFRESH_TOKEN,
      scope: [
        'https://api.ebay.com/oauth/api_scope/sell.inventory',
        'https://api.ebay.com/oauth/api_scope/sell.account',
        'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      ].join(' '),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay OAuth failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

// ─── OAuth URL generieren (für User-Auth) ─────────────────────────────────────

export function getOAuthUrl(state: string): string {
  // EBAY_REDIRECT_URI muss die RuName sein (z.B. stele-e-transfe-steleetr-SETDSA-mnigw)
  // NICHT die echte Callback-URL
  const params = new URLSearchParams({
    client_id: EBAY_CLIENT_ID,
    redirect_uri: process.env.EBAY_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: [
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    ].join(' '),
    state,
  });
  return `${AUTH_URL}/oauth2/authorize?${params.toString()}`;
}

// Authorization Code → Refresh Token tauschen
export async function exchangeCodeForToken(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE_URL}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.EBAY_REDIRECT_URI ?? '',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

// ─── Business Policies automatisch abrufen ────────────────────────────────────

interface PolicyCache {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  fetchedAt: number;
}
let policyCache: PolicyCache | null = null;

export async function getBusinessPolicies(): Promise<PolicyCache> {
  // Cache 1 Stunde
  if (policyCache && Date.now() - policyCache.fetchedAt < 3_600_000) {
    return policyCache;
  }

  // Zuerst aus Env nehmen wenn gesetzt
  const envFulfillment = process.env.EBAY_FULFILLMENT_POLICY_ID ?? '276306574014';
  const envPayment = process.env.EBAY_PAYMENT_POLICY_ID ?? '276306362014';
  const envReturn = process.env.EBAY_RETURN_POLICY_ID ?? '276306559014';
  if (envFulfillment && envPayment && envReturn) {
    policyCache = { fulfillmentPolicyId: envFulfillment, paymentPolicyId: envPayment, returnPolicyId: envReturn, fetchedAt: Date.now() };
    return policyCache;
  }

  const token = await getAccessToken();

  async function fetchFirstId(path: string, idKey: string): Promise<string> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept-Language': 'de-DE' },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Policy fetch failed: ${path} → ${res.status} ${t}`);
    }
    const data = await res.json() as Record<string, Array<Record<string, string>>>;
    const lists = Object.values(data);
    const list = lists.find(l => Array.isArray(l) && l.length > 0) ?? [];
    if (!list.length) throw new Error(`No policies found at ${path} — bitte Business Policies in eBay anlegen oder EBAY_FULFILLMENT_POLICY_ID etc. als Env-Var setzen`);
    const id = list[0][idKey];
    if (!id) throw new Error(`Policy ID key "${idKey}" nicht gefunden in: ${JSON.stringify(list[0])}`);
    return id;
  }

  const [fulfillmentPolicyId, paymentPolicyId, returnPolicyId] = await Promise.all([
    fetchFirstId('/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE', 'fulfillmentPolicyId'),
    fetchFirstId('/sell/account/v1/payment_policy?marketplace_id=EBAY_DE', 'paymentPolicyId'),
    fetchFirstId('/sell/account/v1/return_policy?marketplace_id=EBAY_DE', 'returnPolicyId'),
  ]);

  policyCache = { fulfillmentPolicyId, paymentPolicyId, returnPolicyId, fetchedAt: Date.now() };
  return policyCache;
}

// ─── Fulfillment Policy per Handling-Zeit ─────────────────────────────────────
// Sucht eine bestehende Policy mit passender Handling-Zeit oder erstellt eine neue.
// Wird verwendet wenn handlingTimeDays explizit gesetzt ist.
async function getOrCreateFulfillmentPolicy(days: number, token: string): Promise<string> {
  // Bestehende Policies abrufen
  const res = await fetch(`${BASE_URL}/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept-Language': 'de-DE' },
  });
  if (res.ok) {
    const data = await res.json() as { fulfillmentPolicies?: Array<{ fulfillmentPolicyId: string; handlingTime?: { value: number } }> };
    const match = data.fulfillmentPolicies?.find(p => p.handlingTime?.value === days);
    if (match) {
      console.log(`[eBay] Fulfillment Policy gefunden: ${match.fulfillmentPolicyId} (${days} Tage)`);
      return match.fulfillmentPolicyId;
    }
  }
  // Neue Policy erstellen
  const createRes = await fetch(`${BASE_URL}/sell/account/v1/fulfillment_policy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept-Language': 'de-DE',
    },
    body: JSON.stringify({
      name: `Stele ${days}d Handling`,
      marketplaceId: 'EBAY_DE',
      categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
      handlingTime: { value: days, unit: 'DAY' },
      shippingOptions: [{
        optionType: 'DOMESTIC',
        costType: 'FLAT_RATE',
        shippingServices: [{
          shippingServiceCode: 'DE_DHLPaket',
          buyerResponsibleForShipping: false,
          shippingCost: { value: '0.00', currency: 'EUR' },
        }],
      }],
      globalShipping: false,
      pickupDropOff: false,
    }),
  });
  if (!createRes.ok) {
    const txt = await createRes.text();
    console.error(`[eBay] Fulfillment Policy erstellen fehlgeschlagen: ${createRes.status} ${txt}`);
    // Fallback auf env policy
    return process.env.EBAY_FULFILLMENT_POLICY_ID ?? '276306574014';
  }
  const created = await createRes.json() as { fulfillmentPolicyId: string };
  console.log(`[eBay] Neue Fulfillment Policy erstellt: ${created.fulfillmentPolicyId} (${days} Tage)`);
  return created.fulfillmentPolicyId;
}

// ─── Inventory Item erstellen ──────────────────────────────────────────────────

export interface VariantGroup {
  name: string;   // z.B. "Farbe"
  values: string[]; // z.B. ["Rot", "Blau"]
}

export interface EbayListingInput {
  sku: string;
  title: string;
  description: string; // HTML – geht in listingDescription (Offer), max 500KB
  shortDescription?: string; // Plain-Text – geht in inventory_item description, max 4000 Zeichen
  price: number; // EUR
  quantity: number;
  condition: 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD';
  imageUrls: string[];
  categoryId?: string;
  variantGroups?: VariantGroup[]; // für Variation Listings
  variantPrices?: Array<{ sku?: string; name?: string; ebayPrice?: number; price?: number }>; // pro-Variante Preise
  specs?: Record<string, string>; // AliExpress-Specs für dynamische Aspekte
  mpn?: string; // AliExpress Produkt-ID als MPN
  ean?: string; // EAN/GTIN Barcode — falls vorhanden, sonst "Nicht zutreffend"
  adRate?: number; // Anzeigentarif % (Promoted Listings), default 5
  handlingTimeDays?: number; // Bearbeitungszeit in Tagen (Standard: 10)
  gpsr?: {         // EU Produktsicherheit — aus DB; wenn undefined → Stele-Fallback
    name: string;
    address: string;
    city: string;
    email: string;
    phone: string;
  };
}

// Gender-Wert → eBay "Abteilung" normalisieren
function normalizeAbteilung(val: string): string {
  const v = val.toLowerCase();
  if (v.includes('herr') || v.includes('men') || v.includes('male') || v === 'männer') return 'Herren';
  if (v.includes('dam') || v.includes('wom') || v.includes('female') || v === 'frauen') return 'Damen';
  return 'Unisex';
}

// Bekannte Standardwerte für häufige Pflichtfelder
// Universelle Minimal-Defaults — werden für ALLE Kategorien gesetzt
const ASPECT_DEFAULTS: Record<string, string> = {
  'Marke': 'Markenlos',
  'Herstellernummer': 'Nicht zutreffend',
  'Abteilung': 'Unisex',
};

// Kategorie-spezifische Defaults — nur wenn categoryId zu dieser Gruppe gehört
const ASPECT_DEFAULTS_GLASSES: Record<string, string> = {
  'Abteilung': 'Unisex',
  'Rahmenmaterial': 'Kunststoff',
  'Linsenfarbe': 'Schwarz',
  'Rahmenfarbe': 'Schwarz',
  'Rahmenform': 'Unbekannt',
  'Linsenmaterial': 'Kunststoff',
  'Schutzfaktor': 'UV400',
};

const ASPECT_DEFAULTS_CLOTHING: Record<string, string> = {
  'Abteilung': 'Unisex',
  'Stil': 'Unbekannt',
  'Anlass': 'Unbekannt',
  'Muster': 'Einfarbig',
  'Passform': 'Normal',
  'Pflegehinweis': 'Keine Angabe',
  'Aufschrift': 'Nein',
  'Trägertyp': 'Unbekannt',
  'Kragenart': 'Unbekannt',
  'Beinlänge': 'Unbekannt',
  'Ärmelstil': 'Unbekannt',
  'Ausschnitt': 'Unbekannt',
  'Schnittform': 'Unbekannt',
};

// eBay Brillen-Kategorien (DE): 179247, 2635, 4250, 178893, 13580
const GLASSES_CATEGORY_IDS = new Set(['179247', '2635', '4250', '178893', '13580', '131088']);
// eBay Bekleidungs-Kategorien (DE): 11450, 15724, 1059 etc.
const CLOTHING_CATEGORY_IDS = new Set(['11450', '15724', '1059', '11483', '57988', '63862', '11461', '11462']);

function getAspectDefaultsForCategory(categoryId?: string): Record<string, string> {
  const base = { ...ASPECT_DEFAULTS };
  if (!categoryId) return base;
  if (GLASSES_CATEGORY_IDS.has(categoryId)) return { ...base, ...ASPECT_DEFAULTS_GLASSES };
  if (CLOTHING_CATEGORY_IDS.has(categoryId)) return { ...base, ...ASPECT_DEFAULTS_CLOTHING };
  return base;
}

// Cache: categoryId → Pflichtaspekte (Name → erster erlaubter Wert oder null)
const aspectCache = new Map<string, Record<string, string | null>>();

// Cache: categoryId → VariationsEnabled
const variationsEnabledCache = new Map<string, boolean>();

// Prüft ob eine Kategorie Variations-Listings unterstützt (Trading API GetCategoryFeatures)
// Aktuell ungenutzt (durch hasVariations()/P-14 abgelöst) — als export erhalten statt gelöscht,
// nur für den Backend-Typecheck (P-25) als absichtlich öffentlich markiert.
export async function checkVariationsEnabled(categoryId: string, token: string): Promise<boolean> {
  if (variationsEnabledCache.has(categoryId)) return variationsEnabledCache.get(categoryId)!;
  try {
    const res = await fetch(
      `${BASE_URL}/sell/metadata/v1/marketplace/EBAY_DE/get_listing_policies?category_id=${categoryId}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    if (!res.ok) { variationsEnabledCache.set(categoryId, false); return false; }
    const data = await res.json() as { listingPolicies?: { variations?: boolean } };
    const enabled = data?.listingPolicies?.variations === true;
    variationsEnabledCache.set(categoryId, enabled);
    return enabled;
  } catch {
    variationsEnabledCache.set(categoryId, false);
    return false;
  }
}

// Bekannte eBay DE Kategorien mit VariationsEnabled=true (Fallback-Liste)
// Quelle: manuell geprüft via eBay
export const KNOWN_VARIATION_CATEGORIES: Record<string, string> = {
  // Kfz / Motorrad
  'motorrad_reifen_reparatur': '83595',   // Kfz-Werkzeuge
  'kfz_werkzeug': '83595',
  // Elektronik
  'usb': '183454',                         // USB-Hubs
  // Haushalt / Diverses
  'default': '260,',                       // Gemischte Waren
};

// Pflichtfelder für eine Kategorie per eBay API abrufen
async function getRequiredAspects(categoryId: string, token: string): Promise<Record<string, string | null>> {
  if (aspectCache.has(categoryId)) return aspectCache.get(categoryId)!;

  try {
    const res = await fetch(
      `${BASE_URL}/commerce/taxonomy/v1/category_tree/77/get_item_aspects_for_category?category_id=${categoryId}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept-Language': 'de-DE' } }
    );
    if (!res.ok) {
      console.log('[eBay] getItemAspectsForCategory failed:', res.status);
      aspectCache.set(categoryId, {});
      return {};
    }
    const data = await res.json() as {
      aspects?: Array<{
        localizedAspectName: string;
        aspectConstraint?: { aspectRequired?: boolean };
        aspectValues?: Array<{ localizedValue: string }>;
      }>;
    };

    // Aspekte die wir bewusst NICHT setzen — würden als störende Dropdown-Variante erscheinen
    const ASPECT_BLACKLIST = new Set(['Ships From', 'Versandort', 'Herstellungsland', 'Country/Region of Manufacture']);

    const required: Record<string, string | null> = {};
    for (const aspect of data.aspects ?? []) {
      if (aspect.aspectConstraint?.aspectRequired && !ASPECT_BLACKLIST.has(aspect.localizedAspectName)) {
        // Ersten erlaubten Wert nehmen oder null
        required[aspect.localizedAspectName] = aspect.aspectValues?.[0]?.localizedValue ?? null;
      }
    }
    console.log(`[eBay] Required aspects for category ${categoryId}:`, Object.keys(required));
    aspectCache.set(categoryId, required);
    return required;
  } catch (e) {
    console.error('[eBay] getItemAspectsForCategory error:', e);
    aspectCache.set(categoryId, {});
    return {};
  }
}

// Specs → eBay Aspekte (async, befüllt Pflichtfelder automatisch)
// Produkt-Identifier-Aspekte — eBay validiert diese als Barcode-Format, NICHT als Freitext.
// Der generische "Nicht angegeben"-Fallback (für normale Merkmale gedacht) besteht diese Validierung
// nicht und führt zu 400ern ("fehlende/ungültige EAN"). Hier stattdessen eBays anerkannter
// Identifier-Sentinel "Nicht zutreffend" (wie bereits bei Herstellernummer verwendet).
const IDENTIFIER_ASPECT_NAMES = new Set(['EAN', 'GTIN', 'UPC', 'ISBN']);

async function buildAspects(
  specs: Record<string, string> = {},
  mpn?: string,
  categoryId?: string,
  token?: string,
  ean?: string
): Promise<Record<string, string[]>> {
  // Key-Mapping: AliExpress Spec-Keys → eBay Aspekt-Namen (DE)
  const KEY_MAP: Record<string, string> = {
    'Marke': 'Marke', 'Brand': 'Marke', 'brand': 'Marke',
    'Farbe': 'Farbe', 'Color': 'Farbe', 'color': 'Farbe', 'Colour': 'Farbe', 'colour': 'Farbe',
    'Material': 'Material', 'material': 'Material',
    'Größe': 'Größe', 'Groesse': 'Größe', 'Size': 'Größe', 'size': 'Größe',
    'Gewicht': 'Gewicht', 'Weight': 'Gewicht', 'weight': 'Gewicht',
    'Typ': 'Typ', 'Type': 'Typ', 'type': 'Typ',
    'Stil': 'Stil', 'Style': 'Stil', 'style': 'Stil',
    'Modell': 'Modell', 'Model': 'Modell', 'model': 'Modell',
    'Gender': 'Abteilung', 'gender': 'Abteilung', 'Geschlecht': 'Abteilung',
    'geschlecht': 'Abteilung', 'Abteilung': 'Abteilung',
  };

  const aspects: Record<string, string[]> = {};

  // Specs mappen
  for (const [key, value] of Object.entries(specs)) {
    const mapped = KEY_MAP[key];
    if (mapped && value && !aspects[mapped]) {
      const finalVal = mapped === 'Abteilung' ? normalizeAbteilung(value) : value.slice(0, 100);
      aspects[mapped] = [finalVal];
    }
  }

  // Pflichtfelder per API abrufen und fehlende automatisch befüllen
  if (categoryId && token) {
    const required = await getRequiredAspects(categoryId, token);
    for (const [name, firstAllowed] of Object.entries(required)) {
      if (!aspects[name]) {
        if (IDENTIFIER_ASPECT_NAMES.has(name)) {
          // Identifier-Aspekte NIE mit Freitext-Fallback befüllen — eBay validiert das Format.
          const fallback = ean?.trim() || 'Nicht zutreffend';
          aspects[name] = [fallback];
          console.log(`[eBay] Auto-filled identifier aspect "${name}" = "${fallback}"`);
          continue;
        }
        // Priorität: 1. erster erlaubter Wert der API, 2. bekannter Default, 3. "Nicht angegeben"
        const catDefaults = getAspectDefaultsForCategory(categoryId);
        const fallback = firstAllowed ?? catDefaults[name] ?? 'Nicht angegeben';
        aspects[name] = [fallback];
        console.log(`[eBay] Auto-filled required aspect "${name}" = "${fallback}"`);
      }
    }
  }

  // Immer: Marke als Minimum
  if (!aspects['Marke']) aspects['Marke'] = ['Markenlos'];

  // Kategorie-spezifische Defaults als Fallback (nur was fehlt, nichts überschreiben)
  const catDefaults = getAspectDefaultsForCategory(categoryId);
  for (const [name, val] of Object.entries(catDefaults)) {
    if (!aspects[name]) {
      aspects[name] = [val];
    }
  }

  // MPN
  if (mpn) aspects['MPN'] = [mpn];

  // EAN — explizit setzen wenn vorhanden, auch wenn die Kategorie sie nicht als "required"
  // Aspekt listet (eBays Produkt-Identifier-Prüfung greift teils unabhängig davon)
  if (ean?.trim()) aspects['EAN'] = [ean.trim()];

  return aspects;
}

export async function createOrUpdateInventoryItem(input: EbayListingInput): Promise<void> {
  const token = await getAccessToken();

  // Inventory Item: nur Plain-Text, max 4000 Zeichen
  // Das volle HTML kommt in listingDescription (Offer)
  const plainDesc = (input.shortDescription ?? input.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 4000);

  const body = {
    availability: {
      shipToLocationAvailability: { quantity: input.quantity },
    },
    condition: input.condition,
    product: {
      title: input.title,
      description: plainDesc,
      imageUrls: input.imageUrls,
      aspects: await buildAspects(input.specs, input.mpn, input.categoryId, token, input.ean),
      ...(input.ean?.trim() ? { gtin: input.ean.trim() } : {}),
    },
  };

  const inventoryUrl = `${BASE_URL}/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`;
  console.log('[eBay] PUT inventory_item URL:', inventoryUrl);
  console.log('[eBay] PUT inventory_item body:', JSON.stringify(body, null, 2));

  const res = await fetch(inventoryUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'de-DE',
    },
    body: JSON.stringify(body),
  });

  const resText = await res.text();
  console.log('[eBay] PUT inventory_item response:', res.status, resText);

  if (!res.ok && res.status !== 204) {
    throw new Error(`createInventoryItem failed: ${res.status} ${resText}`);
  }
}

// ─── Merchant Location sicherstellen ─────────────────────────────────────────

let locationEnsured = false;

async function ensureMerchantLocation(): Promise<void> {
  if (locationEnsured) return;
  const token = await getAccessToken();

  // Erst prüfen ob Location schon existiert
  const checkRes = await fetch(`${BASE_URL}/sell/inventory/v1/location/default`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (checkRes.ok) {
    console.log('[eBay] Merchant location "default" already exists');
    locationEnsured = true;
    return;
  }

  // Anlegen
  const body = {
    location: {
      address: {
        addressLine1: 'Am Hochfeld 47',
        city: 'Wiesbaden',
        stateOrProvince: 'Hessen',
        postalCode: '65205',
        country: 'DE',
      },
    },
    locationTypes: ['WAREHOUSE'],
    name: 'Stele E-Transfer Lager',
    merchantLocationStatus: 'ENABLED',
  };

  const res = await fetch(`${BASE_URL}/sell/inventory/v1/location/default`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'de-DE',
    },
    body: JSON.stringify(body),
  });

  const resText = await res.text();
  const alreadyExists = res.status === 409 || resText.includes('already exists') || res.status === 204;
  if (!res.ok && !alreadyExists) {
    console.error('[eBay] ensureMerchantLocation failed:', res.status, resText);
    // Nicht werfen — weiter versuchen, eBay wirft ggf. seinen eigenen Fehler
  } else {
    console.log('[eBay] Merchant location "default" created/confirmed:', res.status);
  }
  locationEnsured = true;
}

// ─── Offer erstellen ──────────────────────────────────────────────────────────

// ─── Bestehende Offers für SKU löschen ───────────────────────────────────────

export async function deleteExistingOffers(sku: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(
    `${BASE_URL}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_DE`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) return; // keine Offers oder Fehler → ignorieren
  const data = await res.json() as { offers?: { offerId: string }[] };
  const offers = data.offers ?? [];
  for (const offer of offers) {
    const delRes = await fetch(`${BASE_URL}/sell/inventory/v1/offer/${offer.offerId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    console.log(`[eBay] DELETE offer ${offer.offerId}: ${delRes.status}`);
  }
}

export async function createOffer(input: EbayListingInput): Promise<string> {
  const token = await getAccessToken();
  const policies = await getBusinessPolicies();
  // Wenn handlingTimeDays explizit gesetzt → eigene Policy verwenden
  const fulfillmentPolicyId = input.handlingTimeDays != null
    ? await getOrCreateFulfillmentPolicy(input.handlingTimeDays, token)
    : policies.fulfillmentPolicyId;
  const aspects = await buildAspects(input.specs, input.mpn, input.categoryId, token, input.ean);

  // GPSR – General Product Safety Regulation (EU, Pflicht seit Dez 2024)
  const gpsrBlock = buildGpsrBlock(input.gpsr);

  const body = {
    sku: input.sku,
    marketplaceId: 'EBAY_DE',
    format: 'FIXED_PRICE',
    availableQuantity: input.quantity,
    categoryId: input.categoryId ?? '79720',
    listingDescription: input.description,
    pricingSummary: {
      price: {
        value: input.price.toFixed(2),
        currency: 'EUR',
      },
    },
    merchantLocationKey: 'default',
    listingPolicies: {
      fulfillmentPolicyId: fulfillmentPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
      returnPolicyId: policies.returnPolicyId,
    },
    // Promoted Listings Standard (Anzeigentarif)
    ...(input.adRate && input.adRate > 0 ? {
      promotedListingsBid: {
        bidPercentage: String(input.adRate.toFixed(1)),
        adRateStrategy: 'FIXED',
      },
    } : {}),
    // Artikelmerkmale direkt im Offer (eBay verlangt es beim publishOffer)
    itemSpecifics: {
      aspects: Object.fromEntries(Object.entries(aspects).map(([k, v]) => [k, v])),
    },
    // GPSR Responsible Person + Hersteller (Pflicht DE)
    productSafety: gpsrBlock,
  };

  const res = await fetch(`${BASE_URL}/sell/inventory/v1/offer`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'de-DE',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorData = await res.json() as { errors?: { errorId: number; parameters?: { name: string; value: string }[] }[] };
    const existing = errorData.errors?.find(e => e.errorId === 25002);
    const existingOfferId = existing?.parameters?.find(p => p.name === 'offerId')?.value;
    if (existingOfferId) {
      console.log(`[eBay] Offer für ${input.sku} existiert (${existingOfferId}) — update via PUT`);
      const putRes = await fetch(`${BASE_URL}/sell/inventory/v1/offer/${existingOfferId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Language': 'de-DE',
        },
        body: JSON.stringify(body),
      });
      if (!putRes.ok) {
        const putText = await putRes.text();
        throw new Error(`updateOffer failed: ${putRes.status} ${putText}`);
      }
      return existingOfferId;
    }
    throw new Error(`createOffer failed: ${res.status} ${JSON.stringify(errorData)}`);
  }

  const data = await res.json() as { offerId: string };
  return data.offerId;
}

// ─── Offer publishen ─────────────────────────────────────────────────────────

export async function publishOffer(offerId: string): Promise<string> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/sell/inventory/v1/offer/${offerId}/publish`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`publishOffer failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { listingId: string };
  return data.listingId;
}

// ─── Varianten-Gruppe publishen (ALLE Varianten auf einmal) ──────────────────
// Pflicht für Variation Listings — publishOffer(einzeln) veröffentlicht nur 1 Variante

export async function publishOfferByInventoryItemGroup(inventoryItemGroupKey: string, marketplaceId = 'EBAY_DE'): Promise<string> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/sell/inventory/v1/offer/publish_by_inventory_item_group`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inventoryItemGroupKey, marketplaceId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`publishOfferByInventoryItemGroup failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { listingId: string };
  console.log(`[eBay] Published group ${inventoryItemGroupKey} → listingId: ${data.listingId}`);
  return data.listingId;
}

// ─── Inventory Item Group (Variation Listing) erstellen ──────────────────────

// ─── GPSR Helper ─────────────────────────────────────────────────────────────
// Baut das productSafety-Objekt für eBay aus strukturierten GPSR-Feldern.
// Wenn gpsr=undefined → Stele-E-Transfer als Fallback (EU Verantwortlicher).

interface GpsrData { name: string; address: string; city: string; email: string; phone: string; }

function buildGpsrBlock(gpsr?: GpsrData) {
  const g: GpsrData = gpsr ?? {
    name:    'Stele-E-Transfer',
    address: 'Am Hochfeld 47',
    city:    '65205 Wiesbaden',
    email:   'contact@stele-e-transfer.com',
    phone:   '+4915904826737',
  };
  // city kann "65205 Wiesbaden" oder nur "Wiesbaden" sein
  const cityParts = g.city.match(/^(\d{5})\s+(.+)$/);
  const postalCode  = cityParts ? cityParts[1] : '65205';
  const cityName    = cityParts ? cityParts[2] : g.city;
  const addr = { addressLine1: g.address, city: cityName, postalCode, country: 'DE' };
  return {
    responsiblePersons: [{
      companyName: g.name,
      address: addr,
      email: g.email,
      phone: g.phone,
      types: ['EU_RESPONSIBLE_PERSON'],
    }],
    manufacturer: {
      companyName: 'Markenlos',
      address: addr,
      email: g.email,
      phone: g.phone,
    },
  };
}

function buildCombinations(groups: VariantGroup[]): Record<string, string>[] {
  // Kartesisches Produkt aller Varianten-Gruppen
  const result: Record<string, string>[] = [{}];
  for (const group of groups) {
    const next: Record<string, string>[] = [];
    for (const combo of result) {
      for (const value of group.values) {
        next.push({ ...combo, [mapVariantGroupName(group.name)]: value });
      }
    }
    result.splice(0, result.length, ...next);
  }
  return result;
}

function slugify(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
}

// Gruppennamen-Normalisierung für den VARIANT_GROUP_MAP-Lookup: Apostroph-Varianten
// (´ ' ’ `) entfernen und übrige Sonderzeichen/Mehrfach-Leerzeichen glätten.
// AliExpress liefert Gruppennamen wie "Set´s" — ohne das matcht z.B. 'set' nicht mehr,
// der Rohstring geht dann unverändert als (für eBay unbekannter) Aspektname raus.
function normalizeGroupKey(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[´'’`]/g, '')
    .replace(/[^a-zäöüß0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Varianten-Gruppen-Name → eBay Aspekt-Name mappen
// Damit funktioniert es egal wie der User die Gruppe benennt
const VARIANT_GROUP_MAP: Record<string, string> = {
  // Farbe (explizit deutsch/Rahmen)
  'farbe': 'Farbe',
  'rahmenfarbe': 'Rahmenfarbe',
  'frame color': 'Rahmenfarbe',
  'linsenfarbe': 'Linsenfarbe',
  'lens color': 'Linsenfarbe',
  // Größe
  'größe': 'Größe',
  'groesse': 'Größe',
  'size': 'Größe',
  'gr': 'Größe',
  // Material
  'material': 'Material',
  // Stil
  'stil': 'Stil',
  'style': 'Stil',
  // Menge/Set
  'menge': 'Menge',
  'anzahl': 'Menge',
  'set': 'Menge',
  'sets': 'Menge', // AliExpress "Set´s" → nach normalizeGroupKey() "sets"
  'quantity': 'Menge',
  // Variante — AliExpress "Color"/"Colour" ist oft kein echtes Farb-Attribut
  // sondern ein Set/Varianten-Name → deshalb → 'Variante'
  'color': 'Variante',
  'colour': 'Variante',
  'color/size': 'Variante',
  // Modell
  'modell': 'Modell',
  'model': 'Modell',
  // Typ
  'typ': 'Typ',
  'type': 'Typ',
};

function mapVariantGroupName(name: string): string {
  return VARIANT_GROUP_MAP[normalizeGroupKey(name)] ?? name;
}

export async function deleteInventoryItemGroup(groupKey: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(
    `${BASE_URL}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    }
  );
  console.log(`[eBay] DELETE item_group ${groupKey}: ${res.status}`);
}

export async function listOnEbayWithVariants(input: EbayListingInput): Promise<string> {
  const token = await getAccessToken();
  const groups = input.variantGroups ?? [];
  const combos = buildCombinations(groups);
  const groupSku = `${input.sku}-GROUP`;

  // Cleanup: alte Item Group + alte Offers löschen vor Re-Listing
  await deleteInventoryItemGroup(groupSku).catch(() => {});
  for (const oldSku of [
    `${input.sku}-SET1`, `${input.sku}-SET2`,
    `${input.sku}-SET3`, `${input.sku}-SET4`,
    `${input.sku}-MENGE1`, `${input.sku}-MENGE2`,
    `${input.sku}-MENGE3`, `${input.sku}-MENGE4`,
  ]) {
    await deleteExistingOffers(oldSku).catch(() => {});
  }


  // Plain-Text Beschreibung für Inventory Items (max 4000 Zeichen)
  const plainDesc = (input.shortDescription ?? input.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 4000);

  // Pflichtaspekte einmal abrufen (gilt für alle Varianten)
  // Hinweis: input.ean ist genau EIN Wert pro Produkt (kein Feld pro Variante im Datenmodell) —
  // wird hier für alle Varianten übernommen; besser als der ungültige "Nicht angegeben"-Fallback.
  const baseAspects = await buildAspects(input.specs, input.mpn, input.categoryId, token, input.ean);

  // Varianten-Aspekt-Namen (gemappt) — diese dürfen NICHT in baseAspects stecken
  // sonst hat jedes Item mehrere Werte für denselben Aspekt → eBay Fehler
  const variantAspectNames = new Set(groups.map(g => mapVariantGroupName(g.name)));

  // Aspekte die grundsätzlich nicht im Listing erscheinen sollen
  const ITEM_ASPECT_BLACKLIST = new Set(['Ships From', 'Versandort', 'Herstellungsland', 'Country/Region of Manufacture']);

  // baseAspects ohne Varianten-Aspekte und ohne Blacklist (für Items und Gruppe)
  const baseAspectsFiltered = Object.fromEntries(
    Object.entries(baseAspects).filter(([k]) => !variantAspectNames.has(k) && !ITEM_ASPECT_BLACKLIST.has(k))
  );

  // 1. Pro Kombination: Inventory Item anlegen
  const variantSkus: string[] = [];
  const variantSkuCombos: Array<{ sku: string; combo: Record<string, string> }> = [];
  for (const combo of combos) {
    const suffix = Object.values(combo).map(slugify).filter(Boolean).join('-');
    const varSku = `${input.sku}-${suffix}`;
    variantSkus.push(varSku);
    variantSkuCombos.push({ sku: varSku, combo });

    // Varianten-Aspekte: gefilterte Basis-Aspekte + spezifischer Kombo-Wert (1 Wert pro Variante)
    const variantAspects = {
      ...baseAspectsFiltered,
      ...Object.fromEntries(Object.entries(combo).map(([k, v]) => [mapVariantGroupName(k), [v]])),
    };

    // Varianten-Foto: aus variantPrices das passende Bild für diese Kombination suchen
    const comboValsLower = Object.values(combo).map(v => v.toLowerCase());
    const matchedVP = input.variantPrices?.find(vp => {
      if (!vp || typeof vp !== 'object') return false;
      const attrsVal = Object.values((vp as { attrs?: Record<string, string> }).attrs ?? {}).map(v => v.toLowerCase());
      return comboValsLower.every(cv => attrsVal.some(av => av.includes(cv) || cv.includes(av)));
    });
    const varImageUrls = (matchedVP as { imageUrl?: string } | undefined)?.imageUrl
      ? [(matchedVP as { imageUrl: string }).imageUrl, ...input.imageUrls.slice(0, 7)]
      : input.imageUrls;

    const varBody = {
      availability: { shipToLocationAvailability: { quantity: input.quantity } },
      condition: input.condition,
      product: {
        title: input.title,
        description: plainDesc,
        imageUrls: varImageUrls.filter(u => u.startsWith('http')).slice(0, 8),
        aspects: variantAspects,
        ...(input.ean?.trim() ? { gtin: input.ean.trim() } : {}),
      },
    };

    const res = await fetch(`${BASE_URL}/sell/inventory/v1/inventory_item/${encodeURIComponent(varSku)}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE',
      },
      body: JSON.stringify(varBody),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(`createVariantItem (${varSku}) failed: ${res.status} ${text}`);
    }
  }

  // 2. Inventory Item Group erstellen
  // eBay erwartet: variationInformation mit variantSKUs + variantAspectName
  const mappedGroupNames = groups.map(g => mapVariantGroupName(g.name));
  const groupBody = {
    inventoryItemGroupKey: groupSku,
    title: input.title,
    description: input.description,
    imageUrls: input.imageUrls,
    // WICHTIG: Varianten-Aspekte NICHT in aspects der Gruppe — nur in variesBy.specifications
    // sonst: eBay Fehler 25013 "Variantenmerkmale müssen sich von Artikelmerkmalen unterscheiden"
    aspects: {
      ...Object.fromEntries(Object.entries(baseAspectsFiltered).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])),
    },
    variantSKUs: variantSkus,
    variesBy: {
      aspectsImageVariesBy: mappedGroupNames.slice(0, 1), // erstes Attribut für Bildwechsel
      specifications: groups.map(g => ({
        name: mapVariantGroupName(g.name),
        values: g.values,
      })),
    },
  };

  const groupRes = await fetch(`${BASE_URL}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupSku)}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'de-DE',
    },
    body: JSON.stringify(groupBody),
  });
  if (!groupRes.ok && groupRes.status !== 204) {
    const text = await groupRes.text();
    throw new Error(`createInventoryItemGroup failed: ${groupRes.status} ${text}`);
  }

  // 3. Pro Varianten-SKU ein Offer erstellen
  // Bei Variation Listings: Offer wird pro einzelnem Inventory Item SKU erstellt (NICHT für den Group-Key)
  // eBay verknüpft automatisch alle Offers mit der Group beim publish
  const policies = await getBusinessPolicies();
  // Wenn handlingTimeDays explizit gesetzt → eigene Policy verwenden
  const varFulfillmentPolicyId = input.handlingTimeDays != null
    ? await getOrCreateFulfillmentPolicy(input.handlingTimeDays, token)
    : policies.fulfillmentPolicyId;

  const gpsr = buildGpsrBlock(input.gpsr);

  const offerIds: string[] = [];
  for (const { sku: varSku, combo: varCombo } of variantSkuCombos) {
    // Pro-Variante Preis: attrs-Werte aus combo mit variantPrices.attrs matchen
    const comboValues = Object.values(varCombo).map(v => v.toLowerCase());
    const varPriceEntry = input.variantPrices?.find(vp => {
      if (!vp || typeof vp !== 'object') return false;
      const attrsVal = Object.values((vp as { attrs?: Record<string, string> }).attrs ?? {}).map(v => v.toLowerCase());
      // Match wenn alle combo-Werte in attrs vorkommen
      return comboValues.every(cv => attrsVal.some(av => av.includes(cv) || cv.includes(av)));
    });
    const varPrice = varPriceEntry ? (varPriceEntry.ebayPrice ?? varPriceEntry.price ?? input.price) : input.price;
    console.log(`[eBay] ${varSku} → combo=${JSON.stringify(varCombo)} priceEntry=${JSON.stringify(varPriceEntry)} → price=${varPrice}`);

    const offerBody = {
      sku: varSku,
      marketplaceId: 'EBAY_DE',
      format: 'FIXED_PRICE',
      availableQuantity: input.quantity,
      categoryId: input.categoryId ?? '79720',
      listingDescription: input.description,
      pricingSummary: {
        price: { value: varPrice.toFixed(2), currency: 'EUR' },
      },
      merchantLocationKey: 'default',
      listingPolicies: {
        fulfillmentPolicyId: varFulfillmentPolicyId,
        paymentPolicyId: policies.paymentPolicyId,
        returnPolicyId: policies.returnPolicyId,
      },
      productSafety: gpsr,
    };

    const offerRes = await fetch(`${BASE_URL}/sell/inventory/v1/offer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE',
      },
      body: JSON.stringify(offerBody),
    });

    let finalOfferId: string;

    if (!offerRes.ok) {
      const errorData = await offerRes.json() as { errors?: { errorId: number; parameters?: { name: string; value: string }[] }[] };
      // Error 25002 = Offer existiert bereits — offerId aus Response extrahieren und PUT
      const existing = errorData.errors?.find(e => e.errorId === 25002);
      const existingOfferId = existing?.parameters?.find(p => p.name === 'offerId')?.value;
      if (existingOfferId) {
        console.log(`[eBay] Offer für ${varSku} existiert (${existingOfferId}) — update via PUT`);
        const putRes = await fetch(`${BASE_URL}/sell/inventory/v1/offer/${existingOfferId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Language': 'de-DE',
          },
          body: JSON.stringify(offerBody),
        });
        if (!putRes.ok) {
          const putText = await putRes.text();
          throw new Error(`updateOffer (variant ${varSku}) failed: ${putRes.status} ${putText}`);
        }
        finalOfferId = existingOfferId;
      } else {
        throw new Error(`createOffer (variant ${varSku}) failed: ${offerRes.status} ${JSON.stringify(errorData)}`);
      }
    } else {
      const offerData = await offerRes.json() as { offerId: string };
      finalOfferId = offerData.offerId;
    }

    offerIds.push(finalOfferId);
    console.log(`[eBay] Offer ready for ${varSku}: ${finalOfferId}`);
  }

  // 4. Gruppe publishen — publisht ALLE Varianten gleichzeitig
  // WICHTIG: NICHT publishOffer(einzeln) verwenden — das veröffentlicht nur 1 Variante
  if (offerIds.length === 0) throw new Error('Keine Offers erstellt');
  console.log(`[eBay] Publishing variant group ${groupSku} with ${offerIds.length} offers...`);

  // Versuche publish — bei Fehler 25005 (Kategorie unterstützt keine Varianten) → Fallback-Kategorien
  const VARIATION_CATEGORY_FALLBACKS = ['83595', '66471', '179779', '26395'];
  try {
    return await publishOfferByInventoryItemGroup(groupSku);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('25005')) throw err;

    console.log(`[eBay] Kategorie ${input.categoryId} unterstützt keine Varianten → probiere Fallback-Kategorien...`);

    for (const fallbackCat of VARIATION_CATEGORY_FALLBACKS) {
      if (fallbackCat === input.categoryId) continue;
      console.log(`[eBay] Versuche Fallback-Kategorie ${fallbackCat}...`);
      // Alle Offers mit neuer Kategorie updaten
      for (const offerId of offerIds) {
        await fetch(`${BASE_URL}/sell/inventory/v1/offer/${offerId}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Language': 'de-DE' },
          body: JSON.stringify({ categoryId: fallbackCat }),
        }).catch(() => {});
      }
      // Auch Inventory Items Kategorie updaten via Offer PUT
      for (const offerId of offerIds) {
        const getRes = await fetch(`${BASE_URL}/sell/inventory/v1/offer/${offerId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (getRes.ok) {
          const offerData = await getRes.json() as Record<string, unknown>;
          offerData.categoryId = fallbackCat;
          await fetch(`${BASE_URL}/sell/inventory/v1/offer/${offerId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Language': 'de-DE' },
            body: JSON.stringify(offerData),
          }).catch(() => {});
        }
      }
      try {
        const listingId = await publishOfferByInventoryItemGroup(groupSku);
        console.log(`[eBay] Erfolgreich mit Fallback-Kategorie ${fallbackCat}: listingId=${listingId}`);
        return listingId;
      } catch (e2: unknown) {
        const m2 = e2 instanceof Error ? e2.message : String(e2);
        if (!m2.includes('25005')) throw e2;
        console.log(`[eBay] Fallback ${fallbackCat} auch kein Varianten-Support`);
      }
    }
    throw new Error(`Keine Kategorie mit Varianten-Support gefunden. Ursprüngliche Kategorie: ${input.categoryId}. Bitte manuell eine eBay Kat-ID eintragen die Varianten unterstützt.`);
  }
}

// ─── Alles in einem ───────────────────────────────────────────────────────────

export async function listOnEbay(input: EbayListingInput): Promise<string> {
  // Merchant Location sicherstellen (wird nur einmal pro Server-Start ausgeführt)
  await ensureMerchantLocation();

  const hasVariants = input.variantGroups && input.variantGroups.length > 0 &&
    input.variantGroups.some(g => g.values.length > 0);

  if (hasVariants) {
    return listOnEbayWithVariants(input);
  }

  // Alte Offers für diese SKU löschen (verhindert Konflikte bei Re-Import)
  await deleteExistingOffers(input.sku);
  await createOrUpdateInventoryItem(input);
  const offerId = await createOffer(input);
  const listingId = await publishOffer(offerId);
  return listingId;
}

// ─── Kategorie-Vorschlag ──────────────────────────────────────────────────────

export async function suggestCategory(title: string): Promise<string | null> {
  const token = await getAccessToken();

  const res = await fetch(
    `${BASE_URL}/commerce/taxonomy/v1/category_tree/77/get_category_suggestions?q=${encodeURIComponent(title)}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept-Language': 'de-DE',
      },
    }
  );

  if (!res.ok) {
    console.log('[eBay] suggestCategory failed:', res.status, await res.text());
    return null;
  }

  const data = await res.json() as {
    categorySuggestions?: Array<{ category: { categoryId: string; categoryName: string } }>;
  };

  // Plausibilitäts-Check: offensichtlich falsche Kategorien ablehnen
  const JUNK_CATEGORY_NAMES = [
    'sonnenbrille', 'brille', 'kleidung', 'schuhe', 'schmuck', 'uhren',
    'handtasche', 'mode', 'damenmode', 'herrenmode', 'kinderkleidung',
    'spielzeug', 'lebensmittel', 'kosmetik',
  ];

  const suggestions = data.categorySuggestions ?? [];
  let picked: { categoryId: string; categoryName: string } | null = null;
  for (const s of suggestions) {
    const name = (s.category.categoryName ?? '').toLowerCase();
    const isJunk = JUNK_CATEGORY_NAMES.some(j => name.includes(j));
    if (!isJunk) {
      picked = s.category;
      break;
    }
    console.log(`[eBay] suggestCategory skipped junk: ${s.category.categoryId} ${s.category.categoryName}`);
  }

  const categoryId = picked?.categoryId ?? null;
  const categoryName = picked?.categoryName ?? null;
  console.log('[eBay] suggestCategory result:', categoryId, categoryName);
  return categoryId;
}

// ─── Policies als Info-Endpoint ───────────────────────────────────────────────

export async function getPoliciesInfo(): Promise<PolicyCache> {
  return getBusinessPolicies();
}

// ─── Alle aktiven eBay Listings abrufen (Trading API) ────────────────────────

export interface EbaySellerListing {
  itemId: string;
  title: string;
  sku: string | null;
  currentPrice: number;
  currency: string;
  quantity: number;
  quantitySold: number;
  imageUrl: string | null;
  viewItemUrl: string;
  listingType: string;
  startTime: string;
  endTime: string;
}

// ─── Listing Titel/Beschreibung live auf eBay ändern (ReviseItem Trading API) ──
// Wird sowohl vom Listings-Tab als auch vom Produkte-Tab genutzt (gemeinsame Sync-Funktion)
export async function reviseListingContent(itemId: string, input: { title?: string; htmlDescription?: string }): Promise<{ ok: boolean; error?: string }> {
  const token = await getAccessToken();
  const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const titleXml = input.title ? `<Title>${escapeXml(input.title.slice(0, 80))}</Title>` : '';
  const descXml = input.htmlDescription !== undefined
    ? `<Description><![CDATA[${input.htmlDescription}]]></Description>`
    : '';

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <ItemID>${itemId}</ItemID>
    ${titleXml}
    ${descXml}
  </Item>
</ReviseFixedPriceItemRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-SITEID': '77',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': 'ReviseFixedPriceItem',
      'X-EBAY-API-APP-NAME': EBAY_CLIENT_ID,
    },
    body: xml,
  });

  const text = await res.text();
  const hasError = text.includes('<Ack>Failure</Ack>');
  if (hasError) {
    const errMsg = text.match(/<LongMessage>([^<]*)<\/LongMessage>/)?.[1] ?? 'Unbekannter Fehler bei ReviseFixedPriceItem';
    console.error('[eBay ReviseFixedPriceItem]', errMsg, text.slice(0, 400));
    return { ok: false, error: errMsg };
  }
  return { ok: true };
}

// ─── Anzeige-Rate (Werbekosten) live setzen ────────────────────────────────────
export async function setAdRate(itemId: string, ratePercent: number): Promise<{ ok: boolean; error?: string }> {
  const token = await getAccessToken();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <ItemID>${itemId}</ItemID>
    <AdvancedMarketing>
      <BidPercentage>${ratePercent}</BidPercentage>
    </AdvancedMarketing>
  </Item>
</ReviseFixedPriceItemRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-SITEID': '77',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': 'ReviseFixedPriceItem',
      'X-EBAY-API-APP-NAME': EBAY_CLIENT_ID,
    },
    body: xml,
  });
  const text = await res.text();
  const hasError = text.includes('<Ack>Failure</Ack>');
  if (hasError) {
    const errMsg = text.match(/<LongMessage>([^<]*)<\/LongMessage>/)?.[1] ?? 'Fehler bei Anzeige-Rate';
    return { ok: false, error: errMsg };
  }
  return { ok: true };
}

// ─── Kategorie live ändern ─────────────────────────────────────────────────────
export async function reviseCategory(itemId: string, categoryId: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getAccessToken();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <ItemID>${itemId}</ItemID>
    <PrimaryCategory><CategoryID>${categoryId}</CategoryID></PrimaryCategory>
  </Item>
</ReviseFixedPriceItemRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-SITEID': '77',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': 'ReviseFixedPriceItem',
      'X-EBAY-API-APP-NAME': EBAY_CLIENT_ID,
    },
    body: xml,
  });
  const text = await res.text();
  const hasError = text.includes('<Ack>Failure</Ack>');
  if (hasError) {
    const errMsg = text.match(/<LongMessage>([^<]*)<\/LongMessage>/)?.[1] ?? 'Fehler bei Kategorie-Änderung';
    return { ok: false, error: errMsg };
  }
  return { ok: true };
}

// Prüft per Trading API GetItem, ob ein Listing ein <Variations>-Block hat (P-14).
// Variations-Listings können nicht über die einfache Item-Level-Preisänderung
// (ReviseInventoryStatus) bearbeitet werden — das muss VOR einem Preis-Update geprüft werden.
export async function hasVariations(itemId: string): Promise<boolean> {
  const token = await getAccessToken();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <OutputSelector>Variations</OutputSelector>
</GetItemRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-SITEID': '77',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': 'GetItem',
      'X-EBAY-API-APP-NAME': EBAY_CLIENT_ID,
    },
    body: xml,
  });
  const text = await res.text();
  return text.includes('<Variations>');
}

export async function getAllSellerListings(): Promise<EbaySellerListing[]> {
  const token = await getAccessToken();
  const results: EbaySellerListing[] = [];
  let page = 1;
  const pageSize = 200;

  while (true) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <ActiveList>
    <Include>true</Include>
  </ActiveList>
  <EndTimeFrom>${new Date().toISOString()}</EndTimeFrom>
  <EndTimeTo>${new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString()}</EndTimeTo>
  <Pagination>
    <EntriesPerPage>${pageSize}</EntriesPerPage>
    <PageNumber>${page}</PageNumber>
  </Pagination>
  <GranularityLevel>Fine</GranularityLevel>
  <OutputSelector>ItemID</OutputSelector>
  <OutputSelector>Title</OutputSelector>
  <OutputSelector>SKU</OutputSelector>
  <OutputSelector>SellingStatus</OutputSelector>
  <OutputSelector>Quantity</OutputSelector>
  <OutputSelector>QuantitySold</OutputSelector>
  <OutputSelector>PictureDetails</OutputSelector>
  <OutputSelector>ListingDetails</OutputSelector>
  <OutputSelector>ListingType</OutputSelector>
  <OutputSelector>TimeLeft</OutputSelector>
</GetSellerListRequest>`;

    const res = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-SITEID': '77',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'GetSellerList',
        'X-EBAY-API-APP-NAME': EBAY_CLIENT_ID,
      },
      body: xml,
    });

    const text = await res.text();
    console.log(`[eBay GetSellerList] Page ${page}, status:`, res.status, text.slice(0, 200));

    // Items extrahieren
    const itemMatches = text.matchAll(/<Item>([\s\S]*?)<\/Item>/g);
    let count = 0;

    for (const match of itemMatches) {
      const item = match[1];
      const get = (tag: string) => item.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`))?.[1]?.trim() ?? '';

      const itemId = get('ItemID');
      const title = get('Title');
      const sku = get('SKU') || null;
      const price = parseFloat(get('CurrentPrice') || get('StartPrice') || '0');
      const currency = item.match(/currencyID="([^"]+)"/)?.[1] ?? 'EUR';
      const quantity = parseInt(get('Quantity') || '0');
      const quantitySold = parseInt(get('QuantitySold') || '0');
      const imageUrl = get('GalleryURL') || get('PictureURL') || null;
      const viewItemUrl = get('ViewItemURL') || `https://www.ebay.de/itm/${itemId}`;
      const listingType = get('ListingType') || 'FixedPriceItem';
      const startTime = get('StartTime') || '';
      const endTime = get('EndTime') || '';

      if (itemId) {
        results.push({ itemId, title, sku, currentPrice: price, currency, quantity, quantitySold, imageUrl, viewItemUrl, listingType, startTime, endTime });
        count++;
      }
    }

    // Pagination prüfen
    const totalPages = parseInt(text.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)?.[1] ?? '1');
    console.log(`[eBay GetSellerList] Page ${page}/${totalPages}, items this page: ${count}`);

    if (page >= totalPages || count === 0) break;
    page++;
  }

  console.log(`[eBay GetSellerList] Total items fetched: ${results.length}`);
  return results;
}

// ─── Bestellungen (Fulfillment API) ────────────────────────────────────────────
export interface EbayOrder {
  orderId: string;
  buyerUsername: string;
  orderDate: string;
  orderFulfillmentStatus: string; // NOT_STARTED | IN_PROGRESS | FULFILLED
  orderPaymentStatus: string;     // PAID | PENDING | FAILED
  total: number;
  currency: string;
  lineItems: Array<{
    lineItemId: string;
    title: string;
    imageUrl: string | null;
    quantity: number;
    sku: string | null;
  }>;
  shippingAddress: {
    fullName: string;
    city: string;
    postalCode: string;
    countryCode: string;
  } | null;
  trackingNumber: string | null;
  carrier: string | null;
}

export async function getAllOrders(): Promise<EbayOrder[]> {
  const token = await getAccessToken();
  const results: EbayOrder[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const res = await fetch(
      `${BASE_URL}/sell/fulfillment/v1/order?limit=${limit}&offset=${offset}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error('[eBay GetOrders] Fehler:', res.status, errText.slice(0, 300));
      break;
    }
    const data = await res.json() as {
      orders?: Array<{
        orderId: string;
        buyer?: { username?: string };
        creationDate?: string;
        orderFulfillmentStatus?: string;
        orderPaymentStatus?: string;
        pricingSummary?: { total?: { value?: string; currency?: string } };
        lineItems?: Array<{
          lineItemId: string;
          title?: string;
          image?: { imageUrl?: string };
          quantity?: number;
          sku?: string;
        }>;
        fulfillmentStartInstructions?: Array<{
          shippingStep?: {
            shipTo?: { fullName?: string; contactAddress?: { city?: string; postalCode?: string; countryCode?: string } };
          };
        }>;
        fulfillmentHrefs?: string[];
      }>;
      total?: number;
    };

    const orders = data.orders ?? [];
    for (const o of orders) {
      const shipTo = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
      results.push({
        orderId: o.orderId,
        buyerUsername: o.buyer?.username ?? 'Unbekannt',
        orderDate: o.creationDate ?? '',
        orderFulfillmentStatus: o.orderFulfillmentStatus ?? 'NOT_STARTED',
        orderPaymentStatus: o.orderPaymentStatus ?? 'PENDING',
        total: parseFloat(o.pricingSummary?.total?.value ?? '0'),
        currency: o.pricingSummary?.total?.currency ?? 'EUR',
        lineItems: (o.lineItems ?? []).map(li => ({
          lineItemId: li.lineItemId,
          title: li.title ?? '',
          imageUrl: li.image?.imageUrl ?? null,
          quantity: li.quantity ?? 1,
          sku: li.sku ?? null,
        })),
        shippingAddress: shipTo ? {
          fullName: shipTo.fullName ?? '',
          city: shipTo.contactAddress?.city ?? '',
          postalCode: shipTo.contactAddress?.postalCode ?? '',
          countryCode: shipTo.contactAddress?.countryCode ?? '',
        } : null,
        trackingNumber: null, // wird separat aus Fulfillment-Details geladen, falls benötigt
        carrier: null,
      });
    }

    if (orders.length < limit) break;
    offset += limit;
    if (offset > 1000) break; // Sicherheitslimit
  }

  console.log(`[eBay GetOrders] Total orders fetched: ${results.length}`);
  return results;
}

