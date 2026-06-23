// AliExpress DS API — offizielle Produktdaten über IOP OAuth
// Signing: MD5 (secret + sorted_params + secret), method als eigenes Feld
// aliexpress.ds.product.get → title, images, price, specs, shipsFrom, variantPrices

import * as crypto from 'crypto';
import type { VariantPrice } from './aliexpress';

const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '535690';
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || 'Yc9AMgAmeQUB2Kc7hXsZ8qZoXtjOJWkW';
const IOP_ENDPOINT = 'https://api-sg.aliexpress.com/sync';

const OAUTH_URL = 'https://auth.aliexpress.com/oauth/authorize';

export interface AliProductData {
  title: string;
  images: string[];
  price: string;
  description: string;
  specs: Record<string, string>;
  shipsFromDE: boolean;
  shipsFrom: string;
  productId: string;
  variants: Array<{ name: string; values: string[] }>;
  variantPrices: VariantPrice[];
  seller?: string;
}

// IOP MD5 Signing: secret + sorted(key+value pairs) + secret → MD5 → uppercase
// Docs: https://openapi.aliexpress.com/doc/global-product-api.htm
function iopSign(secret: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  return crypto.createHash('md5').update(`${secret}${sorted}${secret}`, 'utf8').digest('hex').toUpperCase();
}

export function getAliExpressOAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    force_auth: 'true',
    redirect_uri: redirectUri,
    client_id: APP_KEY,
    state,
    sp: 'ae',
    view: 'web',
    from: 'aliexpress',
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
    const method = 'aliexpress.solution.oauth.token.create';
    const params: Record<string, string> = {
      app_key: APP_KEY,
      method,
      timestamp: String(Date.now()),
      format: 'json',
      sign_method: 'md5',
      v: '2.0',
      code,
      redirect_uri: redirectUri,
    };
    params.sign = iopSign(APP_SECRET, params);

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
    const method = 'aliexpress.solution.oauth.token.refresh';
    const params: Record<string, string> = {
      app_key: APP_KEY,
      method,
      timestamp: String(Date.now()),
      format: 'json',
      sign_method: 'md5',
      v: '2.0',
      refresh_token: refreshToken,
    };
    params.sign = iopSign(APP_SECRET, params);

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

// ── SKU / Varianten-Parser ─────────────────────────────────────────────────────
// aliexpress.ds.product.get gibt ae_item_sku_info_dtos zurück mit Varianten + Preisen
// Struktur: { sku_id, sku_price, sku_available_stock, ae_sku_property_dtos: { ae_sku_property: [{property_name, property_name_value}] } }

interface RawSku {
  sku_id?: string | number;
  id?: string | number;
  sku_price?: string;
  offer_sale_price?: string;
  sku_available_stock?: number;
  ae_sku_property_dtos?: {
    ae_sku_property?: Array<{
      property_name?: string;
      property_name_value?: string;
      sku_property_name?: string;
      sku_property_value?: string;
    }>;
  };
}

function parseVariantPrices(skuList: RawSku[]): { variantPrices: VariantPrice[]; variants: Array<{ name: string; values: string[] }> } {
  const variantPrices: VariantPrice[] = [];
  const variantGroups: Record<string, Set<string>> = {};

  for (const sku of skuList) {
    const skuId = String(sku.sku_id || sku.id || '');
    // offer_sale_price = tatsächlicher Rabattpreis, sku_price = Originalpreis ohne Rabatt
    const priceStr = sku.offer_sale_price || sku.offer_bulk_sale_price || sku.sku_price || '0';
    const price = parseFloat(priceStr.replace(/[^\d.]/g, ''));
    if (!price || price <= 0) continue;

    // Parse Attribute
    const attrs: Record<string, string> = {};
    const skuProps = sku.ae_sku_property_dtos?.ae_sku_property || [];
    for (const prop of skuProps) {
      const name = prop.property_name || prop.sku_property_name || '';
      const value = prop.property_name_value || prop.sku_property_value || '';
      if (name && value) {
        attrs[name] = value;
        if (!variantGroups[name]) variantGroups[name] = new Set();
        variantGroups[name].add(value);
      }
    }

    variantPrices.push({
      skuId,
      attrs,
      price,
      stock: sku.sku_available_stock,
    });
  }

  const variants = Object.entries(variantGroups).map(([name, values]) => ({
    name,
    values: [...values],
  }));

  console.log(`[AliExpress API] ${variantPrices.length} Varianten gefunden, ${variants.length} Gruppen`);
  return { variantPrices, variants };
}

// ── Hauptfunktion ──────────────────────────────────────────────────────────────
export async function getAliProductByApi(productId: string, accessToken: string): Promise<AliProductData | null> {
  try {
    const method = 'aliexpress.ds.product.get';
    const params: Record<string, string> = {
      app_key: APP_KEY,
      method,
      timestamp: String(Date.now()),
      format: 'json',
      sign_method: 'md5',
      v: '2.0',
      access_token: accessToken,
      product_id: productId,
      local_country: 'DE',
      local_language: 'de',
      ship_to_country: 'DE',
    };
    params.sign = iopSign(APP_SECRET, params);

    const res = await fetch(IOP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json() as Record<string, unknown>;

    // Log raw response (truncated) for debugging
    console.log('[AliExpress API] Raw response:', JSON.stringify(data).slice(0, 500));

    const resp = data['aliexpress_ds_product_get_response'] as Record<string, unknown> | undefined;
    if (!resp) {
      console.error('[AliExpress API] Error:', JSON.stringify(data).slice(0, 400));
      return null;
    }
    // result_code ist manchmal nicht vorhanden — prüfe ob result existiert
    const result = (resp.result as Record<string, unknown>) || resp;

    // ── Titel ──────────────────────────────────────────────────────────────────
    const subject = (result.subject as string || '').trim();
    if (!subject) { console.error('[AliExpress API] Kein Titel'); return null; }

    // ── Bilder ─────────────────────────────────────────────────────────────────
    const imageUrls = ((result.image_urls as string) || '').split(';').filter(Boolean).slice(0, 10);

    // ── SKU / Varianten-Preise ─────────────────────────────────────────────────
    // Mögliche Feldnamen je nach API-Version
    const rawSkuContainer = (
      (result.ae_item_sku_info_dtos as { ae_item_sku_info_d_t_o?: RawSku[] } | undefined)?.ae_item_sku_info_d_t_o ||
      (result.sku_list as RawSku[] | undefined) ||
      []
    );

    const { variantPrices, variants } = parseVariantPrices(rawSkuContainer);

    // ── Preis (Minimum aller Varianten) ───────────────────────────────────────
    let price = '';
    if (variantPrices.length > 0) {
      const minPrice = Math.min(...variantPrices.map(v => v.price));
      price = `${minPrice.toFixed(2)} €`;
    } else {
      // Fallback auf direktes Preisfeld
      const minSkuPrice = result.min_sku_price as string || result.min_order_amount as string || '';
      if (minSkuPrice) {
        const p = parseFloat(minSkuPrice.replace(/[^\d.]/g, ''));
        if (p > 0) price = `${p.toFixed(2)} €`;
      }
    }

    // ── Versandland ────────────────────────────────────────────────────────────
    const logisticsList = result.logistics_info_list as { ae_logistics_info?: Array<{ ship_from_country?: string }> } | undefined;
    const shipFrom = logisticsList?.ae_logistics_info?.[0]?.ship_from_country
      || (result.ship_to_country as string)
      || 'China';
    const EU_COUNTRIES = ['germany', 'spain', 'france', 'italy', 'poland', 'netherlands', 'de', 'es', 'fr', 'it', 'pl', 'nl', 'czech', 'austria', 'belgium', 'luxembourg', 'sweden'];
    const shipsFromDE = EU_COUNTRIES.some(c => shipFrom.toLowerCase().includes(c));

    // ── Eigenschaften / Specs ─────────────────────────────────────────────────
    const specs: Record<string, string> = {};
    const propContainer = result.ae_item_properties as { ae_item_property?: Array<{ property_name?: string; property_value?: string }> } | undefined;
    const props = propContainer?.ae_item_property || [];
    for (const p of props.slice(0, 15)) {
      if (p.property_name && p.property_value) specs[p.property_name] = p.property_value;
    }

    // ── Beschreibung ───────────────────────────────────────────────────────────
    const desc = (result.detail_desc as string || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);

    // ── Seller ─────────────────────────────────────────────────────────────────
    const seller = (result.store_info as { store_name?: string } | undefined)?.store_name || '';

    console.log(`[AliExpress API] OK: "${subject.slice(0, 50)}" | Preis: ${price} | Varianten: ${variantPrices.length} | shipsFrom: ${shipFrom}`);

    return {
      title: subject,
      images: imageUrls,
      price,
      description: desc,
      specs,
      shipsFrom: shipFrom,
      shipsFromDE,
      productId,
      variants,
      variantPrices,
      seller,
    };
  } catch (e) {
    console.error('[AliExpress API] getAliProductByApi error:', e);
    return null;
  }
}
