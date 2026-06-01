import crypto from 'crypto';

const APP_KEY = process.env.ALIEXPRESS_APP_KEY!;
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET!;
const API_URL = 'https://api-sg.aliexpress.com/sync';

// Nur Lager in Deutschland + angrenzende EU-Staaten
const ALLOWED_SHIP_FROM = ['DE', 'AT', 'CH', 'FR', 'NL', 'PL', 'CZ', 'BE', 'LU'];

function sign(params: Record<string, string>): string {
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  return crypto.createHmac('sha256', APP_SECRET).update(APP_SECRET + sorted + APP_SECRET).digest('hex').toUpperCase();
}

function buildParams(method: string, extra: Record<string, string>): Record<string, string> {
  const params: Record<string, string> = {
    method,
    app_key: APP_KEY,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    format: 'json',
    v: '2.0',
    sign_method: 'sha256',
    ...extra,
  };
  params.sign = sign(params);
  return params;
}

async function callApi(method: string, extra: Record<string, string>) {
  const params = buildParams(method, extra);
  const body = new URLSearchParams(params);
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json() as Record<string, unknown>;
  return json;
}

export interface AliProduct {
  productId: string;
  title: string;
  price: string;
  imageUrl: string;
  productUrl: string;
  shipFrom: string;
  orders: number;
  rating: string;
}

export async function searchProducts(keyword: string, page = 1): Promise<AliProduct[]> {
  const data = await callApi('aliexpress.affiliate.product.query', {
    keywords: keyword,
    page_no: String(page),
    page_size: '50',
    ship_to_country: 'DE',
    target_currency: 'EUR',
    target_language: 'DE',
    tracking_id: 'stele2024',
  });

  // Pfad durch Response
  const result = (data as Record<string, Record<string, Record<string, Record<string, unknown[]>>>>)
    ?.['aliexpress_affiliate_product_query_response']
    ?.['resp_result']
    ?.['result']
    ?.['products']
    ?.['product'] as Record<string, unknown>[] | undefined;

  if (!result) return [];

  const products: AliProduct[] = [];

  for (const p of result) {
    const shipFrom = String(p['shop_url'] || '');
    const logisticsInfo = (p['logistics_info'] as Record<string, unknown>) || {};
    const shipFromCountry = String(logisticsInfo['ship_from_country'] || p['ship_from_country'] || '');

    // Filter: nur erlaubte Länder
    if (shipFromCountry && !ALLOWED_SHIP_FROM.includes(shipFromCountry.toUpperCase())) {
      continue;
    }

    const priceInfo = (p['target_sale_price'] || p['sale_price'] || '0') as string;
    const images = (p['product_main_image_url'] || p['product_small_image_urls'] as Record<string, string[]> || '') as string;

    products.push({
      productId: String(p['product_id']),
      title: String(p['product_title'] || ''),
      price: String(priceInfo),
      imageUrl: typeof images === 'string' ? images : '',
      productUrl: String(p['product_detail_url'] || `https://www.aliexpress.com/item/${p['product_id']}.html`),
      shipFrom: shipFromCountry || 'DE',
      orders: Number(p['lastest_volume'] || 0),
      rating: String(p['evaluate_rate'] || ''),
    });
  }

  return products;
}

export async function getProductDetail(productId: string): Promise<{
  title: string;
  description: string;
  images: string[];
  price: string;
  variants: string[];
  shipFrom: string;
} | null> {
  const data = await callApi('aliexpress.affiliate.productdetail.get', {
    product_ids: productId,
    target_currency: 'EUR',
    target_language: 'DE',
    tracking_id: 'stele2024',
  });

  const result = (data as Record<string, Record<string, Record<string, Record<string, Record<string, unknown>[]>>>>)
    ?.['aliexpress_affiliate_productdetail_get_response']
    ?.['resp_result']
    ?.['result']
    ?.['products']
    ?.['product']?.[0] as Record<string, unknown> | undefined;

  if (!result) return null;

  const shipFromCountry = String(
    (result['logistics_info'] as Record<string, unknown>)?.['ship_from_country'] || ''
  );

  if (shipFromCountry && !ALLOWED_SHIP_FROM.includes(shipFromCountry.toUpperCase())) {
    return null; // Nicht aus erlaubtem Land
  }

  const imageList = result['product_small_image_urls'] as { string: string[] } | string[] | undefined;
  const images: string[] = Array.isArray(imageList) ? imageList : (imageList as { string: string[] })?.string || [];

  return {
    title: String(result['product_title'] || ''),
    description: String(result['product_description'] || ''),
    images,
    price: String(result['target_sale_price'] || result['sale_price'] || '0'),
    variants: [],
    shipFrom: shipFromCountry || 'DE',
  };
}
