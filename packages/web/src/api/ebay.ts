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

  const res = await fetch(`${AUTH_URL}/identity/v1/oauth2/token`, {
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
  const res = await fetch(`${AUTH_URL}/identity/v1/oauth2/token`, {
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
  const envFulfillment = process.env.EBAY_FULFILLMENT_POLICY_ID;
  const envPayment = process.env.EBAY_PAYMENT_POLICY_ID;
  const envReturn = process.env.EBAY_RETURN_POLICY_ID;
  if (envFulfillment && envPayment && envReturn) {
    policyCache = { fulfillmentPolicyId: envFulfillment, paymentPolicyId: envPayment, returnPolicyId: envReturn, fetchedAt: Date.now() };
    return policyCache;
  }

  const token = await getAccessToken();

  async function fetchFirst(path: string): Promise<string> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept-Language': 'de-DE' },
    });
    if (!res.ok) throw new Error(`Policy fetch failed: ${path} → ${res.status}`);
    const data = await res.json() as { fulfillmentPolicies?: Array<{ fulfillmentPolicyId: string }>; paymentPolicies?: Array<{ paymentPolicyId: string }>; returnPolicies?: Array<{ returnPolicyId: string }> };
    const list = data.fulfillmentPolicies ?? data.paymentPolicies ?? data.returnPolicies ?? [];
    if (!list.length) throw new Error(`No policies found at ${path}`);
    const first = list[0] as Record<string, string>;
    return Object.values(first)[0];
  }

  const [fulfillmentPolicyId, paymentPolicyId, returnPolicyId] = await Promise.all([
    fetchFirst('/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE'),
    fetchFirst('/sell/account/v1/payment_policy?marketplace_id=EBAY_DE'),
    fetchFirst('/sell/account/v1/return_policy?marketplace_id=EBAY_DE'),
  ]);

  policyCache = { fulfillmentPolicyId, paymentPolicyId, returnPolicyId, fetchedAt: Date.now() };
  return policyCache;
}

// ─── Inventory Item erstellen ──────────────────────────────────────────────────

export interface EbayListingInput {
  sku: string;
  title: string;
  description: string; // HTML
  price: number; // EUR
  quantity: number;
  condition: 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD';
  imageUrls: string[];
  categoryId?: string;
}

export async function createOrUpdateInventoryItem(input: EbayListingInput): Promise<void> {
  const token = await getAccessToken();

  const body = {
    availability: {
      shipToLocationAvailability: { quantity: input.quantity },
    },
    condition: input.condition,
    product: {
      title: input.title,
      description: input.description,
      imageUrls: input.imageUrls,
    },
  };

  const res = await fetch(`${BASE_URL}/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'de-DE',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`createInventoryItem failed: ${res.status} ${text}`);
  }
}

// ─── Offer erstellen ──────────────────────────────────────────────────────────

export async function createOffer(input: EbayListingInput): Promise<string> {
  const token = await getAccessToken();
  const policies = await getBusinessPolicies();

  const body = {
    sku: input.sku,
    marketplaceId: 'EBAY_DE',
    format: 'FIXED_PRICE',
    availableQuantity: input.quantity,
    categoryId: input.categoryId ?? '11700',
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

// ─── Alles in einem ───────────────────────────────────────────────────────────

export async function listOnEbay(input: EbayListingInput): Promise<string> {
  await createOrUpdateInventoryItem(input);
  const offerId = await createOffer(input);
  const listingId = await publishOffer(offerId);
  return listingId;
}

// ─── Kategorie-Vorschlag ──────────────────────────────────────────────────────

export async function suggestCategory(title: string): Promise<string | null> {
  const token = await getAccessToken();

  const res = await fetch(
    `${BASE_URL}/commerce/taxonomy/v1/category_tree/186/get_category_suggestions?q=${encodeURIComponent(title)}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept-Language': 'de-DE',
      },
    }
  );

  if (!res.ok) return null;

  const data = await res.json() as {
    categorySuggestions?: Array<{ category: { categoryId: string } }>;
  };
  return data.categorySuggestions?.[0]?.category?.categoryId ?? null;
}

// ─── Policies als Info-Endpoint ───────────────────────────────────────────────

export async function getPoliciesInfo(): Promise<PolicyCache> {
  return getBusinessPolicies();
}
