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
  specs?: Record<string, string>; // AliExpress-Specs für dynamische Aspekte
  mpn?: string; // AliExpress Produkt-ID als MPN
}

// Gender-Wert → eBay "Abteilung" normalisieren
function normalizeAbteilung(val: string): string {
  const v = val.toLowerCase();
  if (v.includes('herr') || v.includes('men') || v.includes('male') || v === 'männer') return 'Herren';
  if (v.includes('dam') || v.includes('wom') || v.includes('female') || v === 'frauen') return 'Damen';
  return 'Unisex';
}

// Bekannte Standardwerte für häufige Pflichtfelder
const ASPECT_DEFAULTS: Record<string, string> = {
  'Abteilung': 'Unisex',
  'Marke': 'Markenlos',
  'Herstellernummer': 'Nicht zutreffend',
  'Produktart': 'Unbekannt',
  'Artikelzustand': 'Neu',
  'Stil': 'Unbekannt',
  'Anlass': 'Unbekannt',
  'Thema': 'Unbekannt',
  'Besonderheiten': 'Ohne',
  'Verschluss': 'Unbekannt',
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
  'Produktlinie': 'Unbekannt',
  'Rahmenmaterial': 'Kunststoff',
  'Linsenfarbe': 'Schwarz',
  'Rahmenfarbe': 'Schwarz',
  'Rahmenform': 'Unbekannt',
  'Linsenmaterial': 'Kunststoff',
  'Schutzfaktor': 'UV400',
  'Farbe': 'Schwarz',
  'Außenfarbe': 'Schwarz',
  'Innenfarbe': 'Schwarz',
  'Hauptfarbe': 'Schwarz',
};

// Cache: categoryId → Pflichtaspekte (Name → erster erlaubter Wert oder null)
const aspectCache = new Map<string, Record<string, string | null>>();

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

    const required: Record<string, string | null> = {};
    for (const aspect of data.aspects ?? []) {
      if (aspect.aspectConstraint?.aspectRequired) {
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
async function buildAspects(
  specs: Record<string, string> = {},
  mpn?: string,
  categoryId?: string,
  token?: string
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
        // Priorität: 1. erster erlaubter Wert der API, 2. bekannter Default, 3. "Nicht angegeben"
        const fallback = firstAllowed ?? ASPECT_DEFAULTS[name] ?? 'Nicht angegeben';
        aspects[name] = [fallback];
        console.log(`[eBay] Auto-filled required aspect "${name}" = "${fallback}"`);
      }
    }
  }

  // Immer: Marke + Abteilung als Minimum
  if (!aspects['Marke']) aspects['Marke'] = ['Markenlos'];
  if (!aspects['Abteilung']) aspects['Abteilung'] = ['Unisex'];

  // MPN
  if (mpn) aspects['MPN'] = [mpn];

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
      aspects: await buildAspects(input.specs, input.mpn, input.categoryId, token),
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

export async function createOffer(input: EbayListingInput): Promise<string> {
  const token = await getAccessToken();
  const policies = await getBusinessPolicies();

  // GPSR – General Product Safety Regulation (EU, Pflicht seit Dez 2024)
  const GPSR_RESPONSIBLE_PERSON = {
    companyName: 'Stele-E-Transfer',
    addressLine1: 'Am Hochfeld 47',
    city: 'Wiesbaden',
    postalCode: '65205',
    country: 'DE',
    email: 'contact@stele-e-transfer.com',
    phone: '+4915904826737',
  };

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
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
      returnPolicyId: policies.returnPolicyId,
    },
    // GPSR Responsible Person
    productSafety: {
      responsiblePersons: [
        {
          companyName: GPSR_RESPONSIBLE_PERSON.companyName,
          address: {
            addressLine1: GPSR_RESPONSIBLE_PERSON.addressLine1,
            city: GPSR_RESPONSIBLE_PERSON.city,
            postalCode: GPSR_RESPONSIBLE_PERSON.postalCode,
            country: GPSR_RESPONSIBLE_PERSON.country,
          },
          email: GPSR_RESPONSIBLE_PERSON.email,
          phone: GPSR_RESPONSIBLE_PERSON.phone,
          type: 'RESPONSIBLE_PERSON',
        },
      ],
    },
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
    const text = await res.text();
    throw new Error(`createOffer failed: ${res.status} ${text}`);
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

// ─── Inventory Item Group (Variation Listing) erstellen ──────────────────────

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
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '-').slice(0, 20);
}

// Varianten-Gruppen-Name → eBay Aspekt-Name mappen
// Damit funktioniert es egal wie der User die Gruppe benennt
const VARIANT_GROUP_MAP: Record<string, string> = {
  // Farbe
  'farbe': 'Rahmenfarbe',
  'color': 'Rahmenfarbe',
  'colour': 'Rahmenfarbe',
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
  'quantity': 'Menge',
  // Modell
  'modell': 'Modell',
  'model': 'Modell',
  // Typ
  'typ': 'Typ',
  'type': 'Typ',
};

function mapVariantGroupName(name: string): string {
  return VARIANT_GROUP_MAP[name.toLowerCase().trim()] ?? name;
}

export async function listOnEbayWithVariants(input: EbayListingInput): Promise<string> {
  const token = await getAccessToken();
  const groups = input.variantGroups ?? [];
  const combos = buildCombinations(groups);
  const groupSku = `${input.sku}-GROUP`;

  // Plain-Text Beschreibung für Inventory Items (max 4000 Zeichen)
  const plainDesc = (input.shortDescription ?? input.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 4000);

  // Pflichtaspekte einmal abrufen (gilt für alle Varianten)
  const baseAspects = await buildAspects(input.specs, input.mpn, input.categoryId, token);

  // 1. Pro Kombination: Inventory Item anlegen
  const variantSkus: string[] = [];
  for (const combo of combos) {
    const suffix = Object.values(combo).map(slugify).join('-');
    const varSku = `${input.sku}-${suffix}`;
    variantSkus.push(varSku);

    // Varianten-Aspekte: Basis-Aspekte + spezifische Kombo-Werte
    // Gruppen-Namen automatisch auf eBay Aspekt-Namen mappen
    const variantAspects = {
      ...baseAspects,
      ...Object.fromEntries(Object.entries(combo).map(([k, v]) => [mapVariantGroupName(k), [v]])),
    };

    const varBody = {
      availability: { shipToLocationAvailability: { quantity: input.quantity } },
      condition: input.condition,
      product: {
        title: input.title,
        description: plainDesc,
        imageUrls: input.imageUrls,
        aspects: variantAspects,
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
  const groupBody = {
    inventoryItemGroupKey: groupSku,
    title: input.title,
    description: plainDesc,
    imageUrls: input.imageUrls,
    aspects: Object.fromEntries(groups.map(g => [mapVariantGroupName(g.name), g.values])),
    variantSKUs: variantSkus,
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

  // 3. Offer für die Gruppe erstellen
  const policies = await getBusinessPolicies();
  const offerBody = {
    sku: groupSku,
    marketplaceId: 'EBAY_DE',
    format: 'FIXED_PRICE',
    availableQuantity: input.quantity * variantSkus.length,
    categoryId: input.categoryId ?? '79720',
    listingDescription: input.description,
    pricingSummary: {
      price: { value: input.price.toFixed(2), currency: 'EUR' },
    },
    merchantLocationKey: 'default',
    listingPolicies: {
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
      returnPolicyId: policies.returnPolicyId,
    },
    productSafety: {
      responsiblePersons: [{
        companyName: 'Stele-E-Transfer',
        address: {
          addressLine1: 'Am Hochfeld 47',
          city: 'Wiesbaden',
          postalCode: '65205',
          country: 'DE',
        },
        email: 'contact@stele-e-transfer.com',
        phone: '+4915904826737',
        type: 'RESPONSIBLE_PERSON',
      }],
    },
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
  if (!offerRes.ok) {
    const text = await offerRes.text();
    throw new Error(`createOffer (group) failed: ${offerRes.status} ${text}`);
  }
  const offerData = await offerRes.json() as { offerId: string };

  // 4. Offer publishen
  return publishOffer(offerData.offerId);
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
  const categoryId = data.categorySuggestions?.[0]?.category?.categoryId ?? null;
  const categoryName = data.categorySuggestions?.[0]?.category?.categoryName ?? null;
  console.log('[eBay] suggestCategory result:', categoryId, categoryName);
  return categoryId;
}

// ─── Policies als Info-Endpoint ───────────────────────────────────────────────

export async function getPoliciesInfo(): Promise<PolicyCache> {
  return getBusinessPolicies();
}
