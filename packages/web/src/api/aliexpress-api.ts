// AliExpress DS API — offizielle Produktdaten über IOP OAuth
// Signing: HMAC-SHA256, method als Prefix

import * as crypto from 'crypto';

const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '535690';
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || 'Yc9AMgAmeQUB2Kc7hXsZ8qZoXtjOJWkW';
const IOP_ENDPOINT = 'https://api-sg.aliexpress.com/sync';

// OAuth
const OAUTH_URL = 'https://oauth.aliexpress.com/authorize';
const TOKEN_URL = 'https://oauth.aliexpress.com/token';

export interface AliProductData {
  title: string;
  images: string[];
  price: string;
  description: string;
  specs: Record<string, string>;
  shipsFromDE: boolean;
  shipsFrom: string;
  productId: string;
}

function iopSign(secret: string, method: string, params: Record<string, string>): string {
  const sortedStr = method + Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', secret).update(sortedStr, 'utf8').digest('hex').toUpperCase();
}

export function getAliExpressOAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    force_auth: 'true',
    redirect_uri: redirectUri,
    client_id: APP_KEY,
    state,
  });
  return `${OAUTH_URL}?${params}`;
}

export async function exchangeAliCodeForToken(code: string, redirectUri: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_valid_time: number;
} | null> {
  try {
    const params: Record<string, string> = {
      app_key: APP_KEY,
      timestamp: String(Date.now()),
      format: 'json',
      sign_method: 'sha256',
      v: '2.0',
      code,
      redirect_uri: redirectUri,
    };
    const method = 'aliexpress.solution.oauth.token.create';
    params.sign = iopSign(APP_SECRET, method, params);
    params.method = method;

    const res = await fetch(IOP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    const data = await res.json() as Record<string, unknown>;
    console.log('[AliExpress OAuth] Token exchange response:', JSON.stringify(data).slice(0, 300));
    const result = (data['aliexpress_solution_oauth_token_create_response'] as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    if (result?.access_token) {
      return {
        access_token: String(result.access_token),
        refresh_token: String(result.refresh_token || ''),
        expires_in: Number(result.expire_time || 0),
        refresh_token_valid_time: Number(result.refresh_token_valid_time || 0),
      };
    }
    return null;
  } catch (e) {
    console.error('[AliExpress OAuth] Token exchange error:', e);
    return null;
  }
}

export async function refreshAliToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const params: Record<string, string> = {
      app_key: APP_KEY,
      timestamp: String(Date.now()),
      format: 'json',
      sign_method: 'sha256',
      v: '2.0',
      refresh_token: refreshToken,
    };
    const method = 'aliexpress.solution.oauth.token.refresh';
    params.sign = iopSign(APP_SECRET, method, params);
    params.method = method;

    const res = await fetch(IOP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    const data = await res.json() as Record<string, unknown>;
    const result = (data['aliexpress_solution_oauth_token_refresh_response'] as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    if (result?.access_token) {
      return { access_token: String(result.access_token), expires_in: Number(result.expire_time || 0) };
    }
    return null;
  } catch (e) {
    console.error('[AliExpress OAuth] Token refresh error:', e);
    return null;
  }
}

export async function getAliProductByApi(productId: string, accessToken: string): Promise<AliProductData | null> {
  try {
    const params: Record<string, string> = {
      app_key: APP_KEY,
      timestamp: String(Date.now()),
      format: 'json',
      sign_method: 'sha256',
      v: '2.0',
      access_token: accessToken,
      product_id: productId,
      local_country: 'DE',
      local_language: 'de',
    };
    const method = 'aliexpress.ds.product.get';
    params.sign = iopSign(APP_SECRET, method, params);
    params.method = method;

    const res = await fetch(IOP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json() as Record<string, unknown>;
    const resp = data['aliexpress_ds_product_get_response'] as Record<string, unknown> | undefined;
    if (!resp || resp.result_code !== '200') {
      console.error('[AliExpress API] Error:', JSON.stringify(data).slice(0, 300));
      return null;
    }
    const result = resp.result as Record<string, unknown>;

    // Extract product info
    const subject = result.subject as string || '';
    const imageUrls = ((result.image_urls as string) || '').split(';').filter(Boolean);
    const skuList = result.sku_list as { ae_sku_property_dtos?: unknown; sku_price?: string }[] | undefined;
    
    // Price: get lowest sku price
    let price = '';
    if (skuList && skuList.length > 0) {
      const prices = skuList.map(s => parseFloat(s.sku_price || '0')).filter(p => p > 0);
      if (prices.length > 0) {
        const minPrice = Math.min(...prices);
        price = `${minPrice.toFixed(2)} €`;
      }
    }
    if (!price) {
      const priceModule = result.price_module as Record<string, unknown> | undefined;
      const priceVal = priceModule?.formated_min_price as string || priceModule?.min_activity_amount?.toString() || '';
      if (priceVal) price = priceVal.replace('US $', '').trim() + ' $';
    }

    // Ship from country
    const logisticsModule = result.logistics_info_list as { ship_from_country?: string }[] | undefined;
    const shipFrom = logisticsModule?.[0]?.ship_from_country || 'China';
    const euCountries = ['germany', 'spain', 'france', 'italy', 'poland', 'netherlands', 'de', 'es', 'fr', 'it', 'pl', 'nl', 'czech', 'austria', 'belgium'];
    const shipsFromDE = euCountries.some(c => shipFrom.toLowerCase().includes(c));

    // Specs from properties
    const specs: Record<string, string> = {};
    const props = result.props as { name?: string; value?: string }[] | undefined;
    if (props) {
      for (const p of props.slice(0, 15)) {
        if (p.name && p.value) specs[p.name] = p.value;
      }
    }

    const desc = (result.detail_desc as string || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);

    return {
      title: subject,
      images: imageUrls.slice(0, 10),
      price,
      description: desc,
      specs,
      shipsFrom: shipFrom,
      shipsFromDE,
      productId,
    };
  } catch (e) {
    console.error('[AliExpress API] getAliProduct error:', e);
    return null;
  }
}
