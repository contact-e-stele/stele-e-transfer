// eBay Trading API / Inventory API Integration
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
      scope: 'https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment',
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
    scope: 'https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment',
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

// ─── Inventory Item erstellen ──────────────────────────────────────────────────

export interface EbayListingInput {
  sku: string; // z.B. ASIN
  title: string;
  description: string; // HTML
  price: number; // in EUR
  quantity: number;
  condition: 'NEW' | 'USED_EXCELLENT' | 'USED_GOOD';
  imageUrls: string[];
  categoryId?: string; // eBay Kategorie-ID
}

export async function createOrUpdateInventoryItem(input: EbayListingInput): Promise<void> {
  const token = await getAccessToken();

  const body = {
    availability: {
      shipToLocationAvailability: {
        quantity: input.quantity,
      },
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
      'Accept-Language': 'de-DE',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`createInventoryItem failed: ${res.status} ${text}`);
  }
}

// ─── Offer erstellen / publishen ──────────────────────────────────────────────

export async function createOffer(input: EbayListingInput): Promise<string> {
  const token = await getAccessToken();

  const body = {
    sku: input.sku,
    marketplaceId: 'EBAY_DE',
    format: 'FIXED_PRICE',
    availableQuantity: input.quantity,
    categoryId: input.categoryId ?? '11700', // Fallback: Sonstiges
    listingDescription: input.description,
    pricingSummary: {
      price: {
        value: input.price.toFixed(2),
        currency: 'EUR',
      },
    },
    merchantLocationKey: 'default',
    listingPolicies: {
      fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID ?? '',
      paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID ?? '',
      returnPolicyId: process.env.EBAY_RETURN_POLICY_ID ?? '',
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

// ─── Alles in einem: Item anlegen + Offer erstellen + publishen ───────────────

export async function listOnEbay(input: EbayListingInput): Promise<string> {
  await createOrUpdateInventoryItem(input);
  const offerId = await createOffer(input);
  const listingId = await publishOffer(offerId);
  return listingId;
}

// ─── Kategorie-Suche ──────────────────────────────────────────────────────────

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
