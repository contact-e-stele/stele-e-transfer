// AliExpress DS API — offizielle Produktdaten über IOP OAuth
// Zwei Gateways/Signierverfahren:
// - /sync (TOP-Legacy, MD5): aliexpress.ds.product.get → title, images, price, specs, shipsFrom, variantPrices
// - /auth/token/create, /auth/token/refresh (IOP-REST, HMAC-SHA256): OAuth Token Create/Refresh

import * as crypto from 'crypto';
import type { VariantPrice, GpsrInfo } from './aliexpress';

const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '535690';
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || 'Yc9AMgAmeQUB2Kc7hXsZ8qZoXtjOJWkW';
const IOP_ENDPOINT = 'https://api-sg.aliexpress.com/sync';
// Neueres IOP-REST-Gateway — für OAuth Token-Create/Refresh. Das alte /sync-Gateway mit
// method=aliexpress.solution.oauth.token.create liefert dort "InvalidApiPath".
// aliexpress.ds.product.get läuft weiterhin über IOP_ENDPOINT/iopSign — nicht angefasst.
const IOP_REST_ENDPOINT = 'https://api-sg.aliexpress.com/rest';

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
  gpsr?: GpsrInfo; // DS API liefert kein HTML — GPSR kommt aus dem HTML-Scraper falls DS API nicht reicht
  reviewCount?: number; // Anzahl Bewertungen (ae_item_base_info_dto.evaluation_count)
  rating?: number;      // Durchschnittliche Sternebewertung 0-5 (ae_item_base_info_dto.avg_evaluation_rating)
  shippingCost?: number; // Versandkosten laut AliExpress (aliexpress.ds.freight.query) — undefined wenn nicht ermittelbar
}

// IOP MD5 Signing: secret + sorted(key+value pairs) + secret → MD5 → uppercase
// Docs: https://openapi.aliexpress.com/doc/global-product-api.htm
function iopSign(secret: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  return crypto.createHash('md5').update(`${secret}${sorted}${secret}`, 'utf8').digest('hex').toUpperCase();
}

// IOP REST Signing (neueres Gateway, z.B. /auth/token/create):
// HMAC-SHA256(secret, apiPath + sortierte "key+value"-Verkettung aller Params außer "sign") → hex → uppercase.
// Pfad wird vorangestellt, da er mit "/" beginnt (Alibaba/AliExpress IOP-SDK-Konvention).
function iopRestSign(secret: string, apiPath: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  const base = apiPath.startsWith('/') ? apiPath + sorted : sorted;
  return crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex').toUpperCase();
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
    const apiPath = '/auth/token/create';
    const params: Record<string, string> = {
      app_key: APP_KEY,
      code,
      redirect_uri: redirectUri,
      timestamp: String(Date.now()),
      sign_method: 'sha256',
      simplify: 'true',
    };
    params.sign = iopRestSign(APP_SECRET, apiPath, params);

    const res = await fetch(`${IOP_REST_ENDPOINT}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    const rawText = await res.text();
    console.log(`[AliExpress OAuth] Token exchange HTTP ${res.status}, Body:`, rawText.slice(0, 1000));

    let data: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch (parseErr) {
      console.error('[AliExpress OAuth] Token exchange: Antwort ist kein gültiges JSON:', parseErr);
    }

    if (!data) {
      console.error(`[AliExpress OAuth] Token exchange fehlgeschlagen — HTTP ${res.status}, kein verwertbares JSON-Objekt. Roh-Body:`, rawText.slice(0, 1000));
      return null;
    }

    // Neuer REST-Pfad liefert Felder vermutlich flach (kein "...response.result"-Wrapper
    // wie beim alten TOP-Gateway) — auf beide Formen prüfen, bis in echten Logs bestätigt.
    const flat = data['access_token'] ? data : undefined;
    const nested = (data['aliexpress_solution_oauth_token_create_response'] as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    const result = flat ?? nested;

    if (result?.access_token) {
      return {
        access_token: String(result.access_token),
        refresh_token: String(result.refresh_token || ''),
        expires_in: Number(result.expires_in || result.expire_time || 0),
        refresh_token_valid_time: Number(result.refresh_expires_in || result.refresh_token_valid_time || 0),
      };
    }
    console.error('[AliExpress OAuth] Token exchange fehlgeschlagen — Response:', JSON.stringify(data).slice(0, 1000));
    return null;
  } catch (e) {
    console.error('[AliExpress OAuth] Token exchange error:', e);
    return null;
  }
}

export async function refreshAliToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  try {
    const apiPath = '/auth/token/refresh';
    const params: Record<string, string> = {
      app_key: APP_KEY,
      refresh_token: refreshToken,
      timestamp: String(Date.now()),
      sign_method: 'sha256',
      simplify: 'true',
    };
    params.sign = iopRestSign(APP_SECRET, apiPath, params);

    const res = await fetch(`${IOP_REST_ENDPOINT}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    const rawText = await res.text();
    console.log(`[AliExpress OAuth] Token refresh HTTP ${res.status}, Body:`, rawText.slice(0, 1000));

    let data: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch (parseErr) {
      console.error('[AliExpress OAuth] Token refresh: Antwort ist kein gültiges JSON:', parseErr);
    }

    if (!data) {
      console.error(`[AliExpress OAuth] Token refresh fehlgeschlagen — HTTP ${res.status}, kein verwertbares JSON-Objekt. Roh-Body:`, rawText.slice(0, 1000));
      return null;
    }

    const flat = data['access_token'] ? data : undefined;
    const nested = (data['aliexpress_solution_oauth_token_refresh_response'] as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    const result = flat ?? nested;

    if (result?.access_token) {
      // AliExpress rotiert den Refresh-Token bei jedem Refresh (neuer Wert in der Response) —
      // der alte wird danach ungültig. Falls die Response ausnahmsweise keinen liefert,
      // den bisherigen Refresh-Token als Fallback weiterverwenden.
      return {
        access_token: String(result.access_token),
        refresh_token: result.refresh_token ? String(result.refresh_token) : refreshToken,
        expires_in: Number(result.expires_in || result.expire_time || 0),
      };
    }
    console.error('[AliExpress OAuth] Token refresh fehlgeschlagen — Response:', JSON.stringify(data).slice(0, 1000));
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
  offer_bulk_sale_price?: string;
  currency_code?: string;
  sku_available_stock?: number;
  ae_sku_property_dtos?: {
    ae_sku_property?: Array<{
      property_name?: string;
      property_name_value?: string;
      sku_property_name?: string;
      sku_property_value?: string;
      property_value_definition_name?: string;
    }>;
    ae_sku_property_d_t_o?: Array<{
      property_name?: string;
      property_name_value?: string;
      sku_property_name?: string;
      sku_property_value?: string;
      property_value_definition_name?: string;
      sku_image?: string;
    }>;
  };
}

function parseVariantPrices(skuList: RawSku[]): { variantPrices: VariantPrice[]; variants: Array<{ name: string; values: string[] }> } {
  const variantPrices: VariantPrice[] = [];
  const variantGroups: Record<string, Set<string>> = {};

  // Verifikations-Log: zeigt einmalig die volle Roh-Struktur der ersten SKU,
  // damit sich in den Render-Logs prüfen lässt, ob "sku_image" in der echten
  // DS-API-Antwort überhaupt vorkommt.
  if (skuList.length > 0) {
    console.log('[AliExpress API] Erste SKU (Rohdaten, Bild-Feld-Diagnose):', JSON.stringify(skuList[0]));
  }

  for (const sku of skuList) {
    const skuId = String(sku.sku_id || sku.id || '');
    // offer_sale_price = tatsächlicher Rabattpreis, sku_price = Originalpreis ohne Rabatt
    const priceStr = sku.offer_sale_price || sku.offer_bulk_sale_price || sku.sku_price || '0';
    const price = parseFloat(priceStr.replace(/[^\d.]/g, ''));
    if (!price || price <= 0) continue;

    // Parse Attribute — API gibt ae_sku_property_d_t_o oder ae_sku_property zurück
    const attrs: Record<string, string> = {};
    let imageUrl = '';
    const skuProps = sku.ae_sku_property_dtos?.ae_sku_property_d_t_o || sku.ae_sku_property_dtos?.ae_sku_property || [];
    for (const prop of skuProps) {
      const name = prop.sku_property_name || prop.property_name || '';
      const value = prop.property_value_definition_name || prop.property_name_value || prop.sku_property_value || '';
      if (!imageUrl && (prop as Record<string, unknown>).sku_image) imageUrl = String((prop as Record<string, unknown>).sku_image);
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
      imageUrl: imageUrl || undefined,
    });
  }

  const variants = Object.entries(variantGroups).map(([name, values]) => ({
    name,
    values: [...values],
  }));

  console.log(`[AliExpress API] ${variantPrices.length} Varianten gefunden, ${variants.length} Gruppen`);
  return { variantPrices, variants };
}

// ── Versandkosten (P-69) ─────────────────────────────────────────────────────
// aliexpress.ds.product.get liefert KEIN Frachtfeld (verifiziert per Live-Call —
// logistics_info_dto enthält nur delivery_time/ship_to_country). Versandpreis kommt
// über die separate Dropshipper-Methode aliexpress.ds.freight.query, die pro SKU
// die vom Käufer zu zahlende Versandoption(en) inkl. Preis zurückgibt.
export async function getFreightCost(productId: string, skuId: string, accessToken: string): Promise<number | undefined> {
  try {
    const params: Record<string, string> = {
      app_key: APP_KEY,
      method: 'aliexpress.ds.freight.query',
      timestamp: String(Date.now()),
      format: 'json',
      sign_method: 'md5',
      v: '2.0',
      access_token: accessToken,
      queryDeliveryReq: JSON.stringify({
        quantity: 1,
        shipToCountry: 'DE',
        productId: Number(productId),
        selectedSkuId: skuId,
        currency: 'EUR',
        locale: 'de_DE',
        language: 'de',
      }),
    };
    params.sign = iopSign(APP_SECRET, params);

    const res = await fetch(IOP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json() as Record<string, unknown>;
    const resp = data['aliexpress_ds_freight_query_response'] as Record<string, unknown> | undefined;
    const result = resp?.result as Record<string, unknown> | undefined;
    if (!result?.success) {
      console.log('[AliExpress API] Freight-Query ohne Ergebnis:', JSON.stringify(data).slice(0, 300));
      return undefined;
    }
    const options = (result.delivery_options as { delivery_option_d_t_o?: Array<{
      shipping_fee_cent?: string; free_shipping?: boolean;
    }> } | undefined)?.delivery_option_d_t_o || [];
    if (options.length === 0) return undefined;

    // Günstigste Versandoption verwenden (Käufer wählt i.d.R. die billigste)
    const fees = options.map(o => o.free_shipping ? 0 : parseFloat(o.shipping_fee_cent ?? '')).filter(f => Number.isFinite(f));
    if (fees.length === 0) return undefined;
    return Math.min(...fees);
  } catch (e) {
    console.error('[AliExpress API] getFreightCost error:', e);
    return undefined;
  }
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
      target_currency: 'EUR',
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
    const baseInfo = result.ae_item_base_info_dto as Record<string, unknown> | undefined;
    const subject = (
      (baseInfo?.subject as string) ||
      (result.subject as string) ||
      ''
    ).trim();
    if (!subject) { console.error('[AliExpress API] Kein Titel — result keys:', Object.keys(result).join(',')); return null; }

    // ── Bewertungen ────────────────────────────────────────────────────────────
    // API liefert evaluation_count/avg_evaluation_rating als Strings (verifiziert per Live-Call)
    const reviewCountRaw = parseInt(String(baseInfo?.evaluation_count ?? ''), 10);
    const reviewCount = Number.isFinite(reviewCountRaw) ? reviewCountRaw : undefined;
    const ratingRaw = parseFloat(String(baseInfo?.avg_evaluation_rating ?? ''));
    const rating = Number.isFinite(ratingRaw) ? ratingRaw : undefined;

    // ── Bilder ─────────────────────────────────────────────────────────────────
    const multimediaInfo = result.ae_multimedia_info_dto as Record<string, unknown> | undefined;
    const imageRaw = (multimediaInfo?.image_urls as string) || (result.image_urls as string) || '';
    const imageUrls = imageRaw.split(';').filter(Boolean).slice(0, 10);

    // ── SKU / Varianten-Preise ─────────────────────────────────────────────────
    // Mögliche Feldnamen je nach API-Version
    const rawSkuContainer = (
      (result.ae_item_sku_info_dtos as { ae_item_sku_info_d_t_o?: RawSku[] } | undefined)?.ae_item_sku_info_d_t_o ||
      (result.sku_list as RawSku[] | undefined) ||
      []
    );

    const { variantPrices, variants } = parseVariantPrices(rawSkuContainer);

    // ── Versandkosten ──────────────────────────────────────────────────────────
    // Eine repräsentative SKU reicht — der Versand fällt pro Bestellung an, nicht pro Variante.
    const shippingCost = variantPrices.length > 0
      ? await getFreightCost(productId, variantPrices[0].skuId, accessToken)
      : undefined;

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

    console.log(`[AliExpress API] OK: "${subject.slice(0, 50)}" | Preis: ${price} | Varianten: ${variantPrices.length} | shipsFrom: ${shipFrom} | Versand: ${shippingCost ?? 'unbekannt'}`);

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
      reviewCount,
      rating,
      shippingCost,
    };
  } catch (e) {
    console.error('[AliExpress API] getAliProductByApi error:', e);
    return null;
  }
}