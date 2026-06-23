// AliExpress URL Scraper — DS API (primary, instant) + Playwright fallback + HTML fallbacks
// Priority: 1) AliExpress DS API (aliexpress.ds.product.get) → 2) Playwright → 3) HTML

const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY || '';
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY || '';
const ZENROWS_API_KEY = process.env.ZENROWS_API_KEY || '';
const PLAYWRIGHT_AVAILABLE = process.env.PLAYWRIGHT_AVAILABLE === 'true';

const DIRECT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
  'Cookie': 'aep_usuc_f=site=glo&c_tp=EUR&region=DE&b_locale=de_DE',
};

export interface VariantPrice {
  skuId: string;
  attrs: Record<string, string>; // z.B. {Farbe: "Rot", Größe: "M"}
  imageUrl?: string;             // Variantenbild (z.B. Farbswatch)
  price: number;
  originalPrice?: number;
  stock?: number;
}

export interface GpsrInfo {
  name: string;       // Hersteller/EU-Verantwortlicher Name
  address: string;    // Adresse
  email: string;      // E-Mail
  phone: string;      // Telefon
  productId?: string; // Produktkennzeichnung (EAN/GTIN etc.)
}

export interface ScrapedProduct {
  title: string;
  images: string[];
  price: string;
  description: string;
  specs: Record<string, string>;
  shipsFromDE: boolean;   // true wenn Versand aus DE/EU erkannt
  shipsFrom: string;      // z.B. "Germany", "Spain", "China"
  variants: Array<{ name: string; values: string[] }>; // z.B. [{name:"Farbe", values:["Schwarz","Blau"]}]
  variantPrices: VariantPrice[]; // alle Varianten mit SKU-ID + Preis
  seller?: string;        // AliExpress Shopname für GPSR
  gpsr?: GpsrInfo;        // GPSR-Daten von AliExpress (Hersteller/EU-Verantwortlicher)
}

// ── GPSR Extraktor ─────────────────────────────────────────────────────────────
// Parst den "Informationen zur Produktkonformität" Block aus AliExpress HTML
// Sowohl aus window.__INIT_DATA__ JSON als auch aus raw HTML-Text
function extractGpsr(html: string): GpsrInfo | undefined {
  // Versuch 1: JSON in window.__INIT_DATA__ oder window.runParams
  const jsonPatterns = [
    /window\.__INIT_DATA__\s*=\s*(\{[\s\S]*?\});\s*(?:window|<\/script>)/,
    /window\.runParams\s*=\s*(\{[\s\S]*?\});\s*(?:window|<\/script>|var )/,
  ];
  for (const pat of jsonPatterns) {
    const m = html.match(pat);
    if (m) {
      try {
        const raw = m[1];
        // GPSR keys suchen
        const nameM = raw.match(/"(?:manufacturerName|euResponsiblePartyName|name)"\s*:\s*"([^"]{3,100})"/);
        const addrM = raw.match(/"(?:manufacturerAddress|euResponsiblePartyAddress|address)"\s*:\s*"([^"]{5,200})"/);
        const emailM = raw.match(/"(?:manufacturerEmail|euResponsiblePartyEmail|email)"\s*:\s*"([^"]{3,100})"/);
        const phoneM = raw.match(/"(?:manufacturerPhone|euResponsiblePartyPhone|phone|telephone)"\s*:\s*"([^"]{5,30})"/);
        const idM = raw.match(/"(?:productId|gtin|ean|productIdentification)"\s*:\s*"([^"]{5,50})"/);
        if (nameM || addrM) {
          return {
            name: nameM?.[1]?.trim() || '',
            address: addrM?.[1]?.trim() || '',
            email: emailM?.[1]?.trim() || '',
            phone: phoneM?.[1]?.trim() || '',
            productId: idM?.[1]?.trim(),
          };
        }
      } catch { /* ignore */ }
    }
  }

  // Versuch 2: Parst aus sichtbarem Text des HTML (wie im User-Beispiel)
  // Sucht Block "Informationen zur Produktkonformität" oder "Informationen zum EU-Verantwortlichen"
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

  // Suche nach "Name:" Zeile nach GPSR-Heading
  const gpsrSection = text.match(
    /(?:Informationen (?:zur Produktkonformit|zum (?:Hersteller|EU-Verantwortlichen))[äÄ\w\s]*)([\s\S]{0,800}?)(?:Produktkennzeichnung|$)/i
  );

  if (gpsrSection) {
    const section = gpsrSection[1];
    const nameM    = section.match(/Name\s*:\s*([^\n\r]{3,100})/i);
    const addrM    = section.match(/Adresse\s*:\s*([^\n\r]{5,200})/i);
    const emailM   = section.match(/E-Mail(?:-Adresse)?\s*:\s*([^\n\r]{3,100})/i);
    const phoneM   = section.match(/Telefon(?:nummer)?\s*:\s*([^\n\r]{5,30})/i);

    // Produktkennzeichnung
    const idSection = text.match(/Produktkennzeichnung[\s\S]{0,50}([\d\-]{8,30})/i);

    if (nameM || addrM) {
      return {
        name:      nameM?.[1]?.trim() || '',
        address:   addrM?.[1]?.trim() || '',
        email:     emailM?.[1]?.trim() || '',
        phone:     phoneM?.[1]?.trim() || '',
        productId: idSection?.[1]?.trim(),
      };
    }
  }

  // Versuch 3: Direkte Regex ohne Abschnitts-Heading (robuster Fallback)
  const nameM  = text.match(/(?:Hersteller|EU-Verantwortlichen|Verantwortlicher)\s*[\r\n]+\s*Name\s*:\s*([^\r\n]{3,100})/i)
               || text.match(/Name\s*:\s*([\w\s\-\.&]{3,80} (?:GmbH|UG|AG|Ltd|KG|OHG|e\.K\.))/i);
  const addrM  = text.match(/Adresse\s*:\s*([^\r\n]{5,200})/i);
  const emailM = text.match(/E-Mail(?:-Adresse)?\s*:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  const phoneM = text.match(/Telefon(?:nummer)?\s*:\s*([\d\s\+\-\/\(\)]{5,20})/i);

  if (nameM || emailM) {
    return {
      name:    nameM?.[1]?.trim() || '',
      address: addrM?.[1]?.trim() || '',
      email:   emailM?.[1]?.trim() || '',
      phone:   phoneM?.[1]?.trim() || '',
    };
  }

  return undefined;
}

// Formatiert GpsrInfo als lesbaren Text für das GPSR-Textfeld
export function formatGpsrText(gpsr: GpsrInfo): string {
  const lines: string[] = [];
  if (gpsr.name)      lines.push(`Name: ${gpsr.name}`);
  if (gpsr.address)   lines.push(`Adresse: ${gpsr.address}`);
  if (gpsr.email)     lines.push(`E-Mail: ${gpsr.email}`);
  if (gpsr.phone)     lines.push(`Telefon: ${gpsr.phone}`);
  if (gpsr.productId) lines.push(`Produktkennzeichnung: ${gpsr.productId}`);
  return lines.join('\n');
}

// ── AliExpress DS API — product.get (schnellste Methode, keine Browser nötig) ──
async function scrapeWithDsApi(productId: string): Promise<ScrapedProduct | null> {
  const { createHash } = await import('node:crypto');
  const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '535690';
  const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || 'Yc9AMgAmeQUB2Kc7hXsZ8qZoXtjOJWkW';
  const IOP_EP = 'https://api-sg.aliexpress.com/sync';

  // Access Token aus DB/ENV holen
  let accessToken = process.env.ALIEXPRESS_ACCESS_TOKEN || '';
  if (!accessToken) {
    try {
      const { db } = await import('../db/index');
      const { settings } = await import('../db/schema');
      const { eq } = await import('drizzle-orm');
      const row = await db.select().from(settings).where(eq(settings.key, 'aliexpress_access_token')).limit(1);
      accessToken = row[0]?.value || '';
    } catch { /* ignore */ }
  }
  if (!accessToken) {
    console.log('[DS API] Kein Access Token — übersprungen');
    return null;
  }

  function sign(secret: string, params: Record<string, string>): string {
    const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
    return createHash('md5').update(`${secret}${sorted}${secret}`, 'utf8').digest('hex').toUpperCase();
  }

  try {
    const params: Record<string, string> = {
      app_key: APP_KEY,
      method: 'aliexpress.ds.product.get',
      timestamp: String(Date.now()),
      format: 'json',
      sign_method: 'md5',
      v: '2.0',
      access_token: accessToken,
      product_id: productId,
      ship_from_country: 'DE',
      ship_to_country: 'DE',
      target_currency: 'EUR',
      target_language: 'DE',
    };
    params.sign = sign(APP_SECRET, params);

    console.log(`[DS API] Rufe product.get für ${productId} auf...`);
    const res = await fetch(IOP_EP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15000),
    });
    const raw = await res.json() as Record<string, unknown>;
    console.log('[DS API] Response:', JSON.stringify(raw).slice(0, 300));

    // Response-Struktur: aliexpress_ds_product_get_response.result
    const resp = raw['aliexpress_ds_product_get_response'] as Record<string, unknown> | undefined;
    if (!resp) { console.log('[DS API] Kein aliexpress_ds_product_get_response'); return null; }
    const result = resp['result'] as Record<string, unknown> | undefined;
    if (!result) { console.log('[DS API] Kein result'); return null; }

    const detail = result as {
      subject?: string;
      product_id?: string | number;
      image_urls?: string[];
      ae_item_base_info_dto?: {
        subject?: string;
        evaluation_count?: number;
        avg_evaluation_rating?: string;
      };
      ae_multimedia_info_dto?: { image_urls?: string[] };
      ae_item_sku_info_dtos?: {
        ae_item_sku_info_d_t_o?: Array<{
          sku_id?: string;
          sku_price?: string;
          offer_sale_price?: string;
          offer_bulk_sale_price?: string;
          sku_available_stock?: number;
          id?: string;
          ae_sku_property_dtos?: {
            ae_sku_property_d_t_o?: Array<{
              sku_property_name?: string;
              property_value_definition_name?: string;
              sku_image?: string;
            }>;
          };
        }>;
      };
      ae_store_info?: { store_name?: string };
      logistics_info_list?: {
        ae_item_logistics_info?: Array<{ ship_from_country?: string }>;
      };
    };

    // Titel
    const title = cleanTitle(detail.ae_item_base_info_dto?.subject || (result['subject'] as string) || '');
    if (!title) { console.log('[DS API] Kein Titel'); return null; }

    // Bilder
    const images: string[] = [];
    const rawImgs = detail.ae_multimedia_info_dto?.image_urls || (result['image_urls'] as string[]) || [];
    if (typeof rawImgs === 'string') {
      images.push(...(rawImgs as string).split(';').filter(Boolean).map((u: string) => u.startsWith('http') ? u : 'https:' + u));
    } else if (Array.isArray(rawImgs)) {
      images.push(...rawImgs.map((u: string) => u.startsWith('http') ? u : 'https:' + u));
    }

    // Varianten
    const skuDtos = detail.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o || [];
    const variantPrices: VariantPrice[] = [];
    const variantGroupMap: Record<string, Set<string>> = {};

    for (const sku of skuDtos) {
      const skuId = String(sku.sku_id || sku.id || '');
      // offer_sale_price = tatsächlicher Rabattpreis, sku_price = Originalpreis ohne Rabatt
      const priceRaw = sku.offer_sale_price || sku.offer_bulk_sale_price || sku.sku_price || '';
      const priceNum = parseFloat(priceRaw.replace(/[^\d.]/g, ''));
      if (!priceNum || priceNum <= 0) continue;

      const attrs: Record<string, string> = {};
      let imageUrl = '';
      const props = sku.ae_sku_property_dtos?.ae_sku_property_d_t_o || [];
      for (const prop of props) {
        const name = prop.sku_property_name || '';
        const val = prop.property_value_definition_name || '';
        if (name && val) {
          attrs[name] = val;
          if (!variantGroupMap[name]) variantGroupMap[name] = new Set();
          variantGroupMap[name].add(val);
        }
        if (prop.sku_image && !imageUrl) {
          imageUrl = prop.sku_image.startsWith('http') ? prop.sku_image : 'https:' + prop.sku_image;
        }
      }

      variantPrices.push({ skuId, attrs, imageUrl: imageUrl || undefined, price: priceNum, stock: sku.sku_available_stock });
    }

    const variants = Object.entries(variantGroupMap).map(([name, vals]) => ({ name, values: [...vals] }));

    // Mindestpreis
    const allPrices = variantPrices.map(v => v.price);
    const minP = allPrices.length > 0 ? Math.min(...allPrices) : 0;
    const price = minP > 0 ? `${minP.toFixed(2)} €` : '';

    // Versandland
    const logisticsList = detail.logistics_info_list?.ae_item_logistics_info || [];
    let shipsFrom = '';
    for (const l of logisticsList) {
      if (l.ship_from_country) { shipsFrom = l.ship_from_country; break; }
    }
    const EU_COUNTRIES = ['germany', 'de', 'spain', 'france', 'italy', 'poland', 'netherlands', 'czech', 'austria', 'belgium', 'sweden'];
    const shipsFromDE = EU_COUNTRIES.some(c => shipsFrom.toLowerCase().includes(c));

    const seller = detail.ae_store_info?.store_name || '';

    console.log(`[DS API] Erfolg: "${title.slice(0, 40)}" | ${variantPrices.length} Varianten | ${price} | shipsFrom=${shipsFrom}`);

    return {
      title,
      images: images.slice(0, 10),
      price,
      description: '',
      specs: {},
      shipsFromDE,
      shipsFrom,
      variants,
      variantPrices,
      seller,
      gpsr: undefined, // DS API liefert kein HTML — GPSR kommt aus HTML-Scraper falls DS API nicht reicht
    };
  } catch (e) {
    console.log(`[DS API] Fehler: ${e}`);
    return null;
  }
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*-\s*AliExpress\s*$/i, '')
    .replace(/\s*\|\s*AliExpress\s*$/i, '')
    .replace(/\s+\d{1,3}\s*$/, '')      // trailing " 15" artifact
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractImages(html: string, jsonLdImages: string[]): string[] {
  const all = new Set<string>(jsonLdImages);

  // Regex: all AliCDN image URLs in the page
  const re = /https?:\/\/ae[a-z0-9]*\.alicdn\.com\/kf\/[^"'\s<>]+?\.jpg/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    // Skip tiny thumbnails (usually contain "_50x50" or "_x100")
    if (!/_\d{2}x\d{2}/.test(m[0])) {
      all.add(m[0].replace(/\\u002F/g, '/'));
    }
  }

  // Also grab og:image
  const ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
  if (ogImg) all.add(ogImg[1]);

  return [...all].slice(0, 10);
}

function extractPrice(html: string): string {
  // 1) AliExpress window.__INIT_DATA__ or _dida_config_ with price fields
  const initDataPatterns = [
    /"actPrice"\s*:\s*([\d.]+)/,
    /"originalPrice"\s*:\s*([\d.]+)/,
    /"salePrice"\s*:\s*([\d.]+)/,
    /"minPrice"\s*:\s*([\d.]+)/,
    /"formattedPrice"\s*:\s*"EUR\s*([\d.]+)"/i,
    /"discountedPrice"\s*:\s*([\d.]+)/,
    /"maxActivityAmount"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/,
    /"minActivityAmount"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/,
    /"amount"\s*:\s*"([\d.]+)"/,
  ];
  for (const pattern of initDataPatterns) {
    const m = html.match(pattern);
    if (m) {
      const num = parseFloat(m[1]);
      if (!isNaN(num) && num > 0.5 && num < 10000) return `${num.toFixed(2)} €`;
    }
  }

  // 2) JSON-LD offers.price
  const ldMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/);
  if (ldMatch) {
    const num = parseFloat(ldMatch[1]);
    if (!isNaN(num) && num > 0.5) return `${num.toFixed(2)} €`;
  }

  // 3) EUR price in text — both "€ 9,99" and "9,99 €" formats
  const eurMatch = html.match(/€\s*([\d]+[,.][\d]{2})/) || html.match(/([\d]+[,.][\d]{2})\s*€/);
  if (eurMatch) return `${eurMatch[1].replace(',', '.')} €`;

  // 4) data-price attribute
  const dataPrice = html.match(/data-price="([\d.]+)"/);
  if (dataPrice) return `${parseFloat(dataPrice[1]).toFixed(2)} €`;

  return '';
}

// Holt ALLE Preise aus dem HTML und gibt den günstigsten zurück (Varianten-aware)
function extractSteleData(html: string): { minPrice: string; variantPrices: VariantPrice[] } {
  // ── Weg 1: JS-injiziertes data-stele-prices Attribut (ScrapingAnt + Snippet) ──
  const steelPricesMatch = html.match(/data-stele-prices="([^"]+)"/);
  if (steelPricesMatch) {
    try {
      const decoded = steelPricesMatch[1].replace(/&quot;/g, '"');
      const data = JSON.parse(decoded) as {
        minAmount?: number;
        maxAmount?: number;
        minActivityAmount?: number;
        maxActivityAmount?: number;
        skuPrices?: string[];
        variants?: Array<{ skuId: string; attrs: Record<string, string>; imageUrl?: string; price: string; originalPrice?: string; stock?: number }>;
      };
      const variantPrices: VariantPrice[] = [];
      if (data.variants && data.variants.length > 0) {
        for (const v of data.variants) {
          const price = parseFloat(v.price);
          if (!isNaN(price) && price > 0.5) {
            variantPrices.push({ skuId: String(v.skuId), attrs: v.attrs ?? {}, imageUrl: v.imageUrl || undefined, price, originalPrice: v.originalPrice ? parseFloat(v.originalPrice) : undefined, stock: v.stock });
          }
        }
        console.log(`[AliExpress] extractSteleData (snippet): ${variantPrices.length} Varianten`);
      }
      const allPrices: number[] = variantPrices.map(v => v.price);
      if (data.skuPrices && allPrices.length === 0) {
        for (const p of data.skuPrices) { const num = parseFloat(p); if (!isNaN(num) && num > 0.5 && num < 10000) allPrices.push(num); }
      }
      if (allPrices.length === 0) { const fb = data.minActivityAmount ?? data.minAmount; if (fb && fb > 0.5) allPrices.push(fb); }
      const minPrice = allPrices.length > 0 ? `${Math.min(...allPrices).toFixed(2)} €` : '';
      if (variantPrices.length > 0 || minPrice) return { minPrice, variantPrices };
    } catch (e) {
      console.log('[AliExpress] data-stele-prices parse error:', e);
    }
  }

  // ── Weg 2: Direkt aus HTML-JSON — skuPriceList + productSKUPropertyList ──
  // AliExpress bettet diese Daten in window.runParams oder __INIT_DATA__ ein
  try {
    // Suche nach skuPriceList im rohen HTML
    const skuPriceListMatch = html.match(/"skuPriceList"\s*:\s*(\[[\s\S]{10,50000}?\])\s*[,}]/);
    const propListMatch = html.match(/"productSKUPropertyList"\s*:\s*(\[[\s\S]{10,50000}?\])\s*[,}]/);

    if (skuPriceListMatch) {
      type SkuPrice = { skuId?: string; skuAttr?: string; skuVal?: { actSkuCalPrice?: string; skuCalPrice?: string; availQuantity?: number } };
      type PropList = Array<{ skuPropertyId?: number; skuPropertyName?: string; skuPropertyValues?: Array<{ propertyValueId?: number; propertyValueDisplayName?: string; propertyValueName?: string; skuPropertyImagePath?: string; skuPropertyImagePathRetina?: string }> }>;

      const skuMap = JSON.parse(skuPriceListMatch[1]) as SkuPrice[];
      const propList: PropList = propListMatch ? JSON.parse(propListMatch[1]) : [];

      // Bild-Map: propId:valId -> imageUrl
      const imgMap: Record<string, string> = {};
      for (const prop of propList) {
        for (const val of (prop.skuPropertyValues ?? [])) {
          const img = val.skuPropertyImagePath || val.skuPropertyImagePathRetina || '';
          if (img) {
            const k = String(prop.skuPropertyId) + ':' + String(val.propertyValueId);
            imgMap[k] = img.startsWith('http') ? img : 'https:' + img;
          }
        }
      }

      const variantPrices: VariantPrice[] = [];
      for (const s of skuMap) {
        const priceStr = s.skuVal?.actSkuCalPrice ?? s.skuVal?.skuCalPrice;
        const price = parseFloat(priceStr ?? '0');
        if (isNaN(price) || price <= 0.5) continue;

        // Attribute + Bild aus skuAttr ("pid:vid;pid:vid")
        const attrs: Record<string, string> = {};
        let imageUrl = '';
        if (s.skuAttr && propList.length > 0) {
          const pairs = s.skuAttr.split(';');
          for (const pair of pairs) {
            const parts = pair.split(':');
            const propId = parts[0]?.trim();
            const valId = parts[1]?.split('#')[0]?.trim();
            if (!propId || !valId) continue;
            const imgKey = propId + ':' + valId;
            if (imgMap[imgKey] && !imageUrl) imageUrl = imgMap[imgKey];
            const prop = propList.find(p => String(p.skuPropertyId) === propId);
            if (!prop) continue;
            const val = (prop.skuPropertyValues ?? []).find(v => String(v.propertyValueId) === valId);
            if (val) attrs[prop.skuPropertyName ?? propId] = val.propertyValueDisplayName ?? val.propertyValueName ?? valId;
          }
        }

        variantPrices.push({
          skuId: String(s.skuId ?? ''),
          attrs,
          imageUrl: imageUrl || undefined,
          price,
          originalPrice: s.skuVal?.skuCalPrice ? parseFloat(s.skuVal.skuCalPrice) : undefined,
          stock: s.skuVal?.availQuantity,
        });
      }

      if (variantPrices.length > 0) {
        const minPrice = `${Math.min(...variantPrices.map(v => v.price)).toFixed(2)} €`;
        console.log(`[AliExpress] extractSteleData (html-regex): ${variantPrices.length} Varianten, min=${minPrice}`);
        return { minPrice, variantPrices };
      }
    }
  } catch (e) {
    console.log('[AliExpress] html-regex skuPriceList parse error:', e);
  }

  // ── Weg 3: Nur günstigsten Preis aus actSkuCalPrice Werten ──
  try {
    const allPriceMatches = [...html.matchAll(/"actSkuCalPrice"\s*:\s*"([\d.]+)"/g)];
    if (allPriceMatches.length > 0) {
      const prices = allPriceMatches.map(m => parseFloat(m[1])).filter(p => !isNaN(p) && p > 0.5 && p < 10000);
      if (prices.length > 0) {
        const minPrice = `${Math.min(...prices).toFixed(2)} €`;
        console.log(`[AliExpress] extractSteleData (actSkuCalPrice-only): ${prices.length} Preise, min=${minPrice}`);
        return { minPrice, variantPrices: [] };
      }
    }
  } catch { /* ignore */ }

  return { minPrice: '', variantPrices: [] };
}

function extractMinPrice(html: string): string {
  const allPrices: number[] = [];

  // ── Priorität 1: JS-injiziertes data-stele-prices Attribut ──
  const { minPrice } = extractSteleData(html);
  if (minPrice) {
    console.log(`[AliExpress] extractMinPrice (JS-injected): ${minPrice}`);
    return minPrice;
  }

  // ── Priorität 2: Alle Preismuster aus HTML (Fallback) ──
  const patterns = [
    /"actPrice"\s*:\s*([\d.]+)/g,
    /"salePrice"\s*:\s*([\d.]+)/g,
    /"minPrice"\s*:\s*([\d.]+)/g,
    /"minActivityAmount"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/g,
    /"actSkuCalPrice"\s*:\s*"([\d.]+)"/g,
    /"skuAmount"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/g,
  ];

  for (const pattern of patterns) {
    const matches = [...html.matchAll(pattern)];
    for (const m of matches) {
      const num = parseFloat(m[1]);
      if (!isNaN(num) && num > 0.5 && num < 10000) allPrices.push(num);
    }
  }

  if (allPrices.length > 0) {
    const minPrice = Math.min(...allPrices);
    console.log(`[AliExpress] extractMinPrice (HTML-patterns): ${allPrices.length} Preise, günstigster: ${minPrice.toFixed(2)}€`);
    return `${minPrice.toFixed(2)} €`;
  }

  // ── Priorität 3: Standard extractPrice ──
  return extractPrice(html);
}

function extractShipsFrom(html: string): { shipsFrom: string; shipsFromDE: boolean } {
  // AliExpress speichert "shipFromCountry" oder "ship from" im HTML/JSON
  const patterns = [
    /ship(?:s)?\s*from[^:]*:\s*([A-Za-z ]+)/i,
    /"shipFromCountry"\s*:\s*"([^"]+)"/i,
    /"countryCode"\s*:\s*"([A-Z]{2})"/i,
    /fromCountry[^>]*>\s*([A-Za-z ]+)\s*</i,
    /data-shipping-from="([^"]+)"/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const country = m[1].trim();
      const euCountries = ['germany', 'spain', 'france', 'italy', 'poland', 'netherlands', 'de', 'es', 'fr', 'it', 'pl', 'nl', 'czech', 'cz'];
      const shipsFromDE = euCountries.some(c => country.toLowerCase().includes(c));
      return { shipsFrom: country, shipsFromDE };
    }
  }

  // Kein Versandland gefunden → unbekannt (NICHT als China annehmen)
  return { shipsFrom: 'Unknown', shipsFromDE: true };
}

// Schlüsselwörter die auf Navigation/Müll hinweisen → rausfiltern
const SPEC_BLACKLIST = [
  'hilfe', 'streitigkeiten', 'berichte', 'melden', 'käuferschutz', 'sicherheit',
  'datenschutz', 'nutzungsbedingungen', 'impressum', 'kontakt', 'newsletter',
  'anmelden', 'registrieren', 'warenkorb', 'wunschliste', 'vergleichen',
  'bewertung', 'frage stellen', 'seller', 'shop', 'feedback', 'report',
  'dispute', 'protection', 'policy', 'terms', 'privacy', 'cookie',
  'help', 'support', 'contact', 'login', 'sign in', 'register',
];

function isSpecJunk(key: string, value: string): boolean {
  const kl = key.toLowerCase();
  const vl = value.toLowerCase();
  // Zu lang → Navigation
  if (key.length > 60 || value.length > 150) return true;
  // Enthält URLs
  if (value.includes('http') || value.includes('www.')) return true;
  // Blacklist
  if (SPEC_BLACKLIST.some(b => kl.includes(b) || vl.includes(b))) return true;
  // Nur Zahlen/Sonderzeichen als Key
  if (/^[\d\s\W]+$/.test(key)) return true;
  return false;
}

function extractSpecs(html: string): Record<string, string> {
  const specs: Record<string, string> = {};

  // 1) AliExpress JSON props (most reliable)
  const jsonProps = html.match(/"properties"\s*:\s*\[([^\]]+)\]/);
  if (jsonProps) {
    try {
      const arr = JSON.parse(`[${jsonProps[1]}]`) as Array<{name?: string; value?: string}>;
      for (const item of arr) {
        if (item.name && item.value && !isSpecJunk(item.name, item.value)) {
          specs[item.name] = item.value;
          if (Object.keys(specs).length >= 15) break;
        }
      }
    } catch { /* ignore */ }
  }

  // 2) Table rows: <th>Key</th><td>Value</td>
  if (Object.keys(specs).length === 0) {
    const tableRe = /<tr[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
    let m;
    while ((m = tableRe.exec(html)) !== null) {
      const k = m[1].replace(/<[^>]*>/g, '').trim();
      const v = m[2].replace(/<[^>]*>/g, '').trim();
      if (k && v && !isSpecJunk(k, v)) specs[k] = v;
      if (Object.keys(specs).length >= 15) break;
    }
  }

  // 3) dt/dd pairs
  if (Object.keys(specs).length === 0) {
    const dtRe = /<dt[^>]*>([\s\S]*?)<\/dt>[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    let m;
    while ((m = dtRe.exec(html)) !== null) {
      const k = m[1].replace(/<[^>]*>/g, '').trim();
      const v = m[2].replace(/<[^>]*>/g, '').trim();
      if (k && v && !isSpecJunk(k, v)) specs[k] = v;
      if (Object.keys(specs).length >= 15) break;
    }
  }

  return specs;
}

async function fetchWithFallbacks(targetUrl: string): Promise<string | null> {
  // Attempt 1: Direct fetch (may work on some IPs)
  try {
    const res = await fetch(targetUrl, { headers: DIRECT_HEADERS, redirect: 'follow' });
    if (res.ok) {
      const html = await res.text();
      if (html.length > 5000 && (html.includes('og:title') || html.includes('application/ld+json') || html.includes('productTitle'))) {
        console.log(`[AliExpress] Direct fetch OK (${html.length} chars)`);
        return html;
      }
      console.log(`[AliExpress] Direct fetch got shell page (${html.length} chars), trying ScrapingAnt...`);
    }
  } catch (e) {
    console.log(`[AliExpress] Direct fetch failed:`, e);
  }

  // Attempt 2: ScrapingAnt with browser=true (JS-rendered, residential DE proxy)
  if (SCRAPINGANT_API_KEY) {
    // JS-Snippet: liest window.runParams aus → alle Varianten + Preise + Attribute
    const jsSnippet = encodeURIComponent(`
      try {
        var rp = window.runParams || window._dida_config_ || window.__INIT_DATA__ || window.__pc_config__ || {};
        var pm = (rp.data && rp.data.priceModule) || rp.priceModule || {};
        var skuModule = (rp.data && rp.data.skuModule) || {};
        var skuMap = skuModule.skuPriceList || [];
        var propList = skuModule.productSKUPropertyList || [];

        // Alle Varianten mit Attributen + Preis + Bild
        // Bild-Map: propId:valId -> imageUrl
        var imgMap = {};
        propList.forEach(function(prop) {
          (prop.skuPropertyValues || []).forEach(function(val) {
            var img = val.skuPropertyImagePath || val.skuPropertyImagePathRetina || '';
            if (img) {
              var k = String(prop.skuPropertyId) + ':' + String(val.propertyValueId);
              imgMap[k] = img.startsWith('http') ? img : 'https:' + img;
            }
          });
        });

        var variants = skuMap.map(function(s) {
          var attrs = {};
          var imageUrl = '';
          var propIds = (s.skuAttr || '').split(';');
          propIds.forEach(function(pair) {
            var parts = pair.split(':');
            var propId = parts[0];
            var valId = parts[1] ? parts[1].split('#')[0] : null;
            if (!propId || !valId) return;
            var imgKey = propId + ':' + valId;
            if (imgMap[imgKey] && !imageUrl) imageUrl = imgMap[imgKey];
            propList.forEach(function(prop) {
              if (String(prop.skuPropertyId) === String(propId)) {
                (prop.skuPropertyValues || []).forEach(function(val) {
                  if (String(val.propertyValueId) === String(valId)) {
                    attrs[prop.skuPropertyName] = val.propertyValueDisplayName || val.propertyValueName;
                  }
                });
              }
            });
          });
          return {
            skuId: s.skuId,
            attrs: attrs,
            imageUrl: imageUrl,
            price: s.skuVal && s.skuVal.actSkuCalPrice,
            originalPrice: s.skuVal && s.skuVal.skuCalPrice,
            stock: s.skuVal && s.skuVal.availQuantity
          };
        }).filter(function(v) { return v.price; });

        var result = {
          minAmount: pm.minAmount && pm.minAmount.value,
          maxAmount: pm.maxAmount && pm.maxAmount.value,
          minActivityAmount: pm.minActivityAmount && pm.minActivityAmount.value,
          maxActivityAmount: pm.maxActivityAmount && pm.maxActivityAmount.value,
          skuPrices: skuMap.map(function(s){ return s.skuVal && s.skuVal.actSkuCalPrice; }).filter(Boolean),
          variants: variants
        };
        document.body.setAttribute('data-stele-prices', JSON.stringify(result));
      } catch(e) {}
    `);

    // Two tries: first with JS-snippet (runParams), then without (fallback)
    const attempts = [
      `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${SCRAPINGANT_API_KEY}&browser=true&proxy_country=DE&js_snippet=${jsSnippet}&wait_for_selector=.sku-property`,
      `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${SCRAPINGANT_API_KEY}&browser=true&proxy_country=DE&wait_for_selector=.sku-property`,
      `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${SCRAPINGANT_API_KEY}&browser=true&proxy_country=DE`,
    ];
    for (const antUrl of attempts) {
      try {
        console.log(`[AliExpress] ScrapingAnt attempt: ${antUrl.slice(0, 120)}...`);
        const res = await fetch(antUrl, { signal: AbortSignal.timeout(60000) });
        if (res.ok) {
          const html = await res.text();
          const hasProduct = html.includes('application/ld+json') || html.includes('og:title') || html.includes('pdp-info-main') || html.includes('product-title');
          if (html.length > 10000 && hasProduct) {
            console.log(`[AliExpress] ScrapingAnt browser OK (${html.length} chars)`);
            return html;
          }
          console.log(`[AliExpress] ScrapingAnt response insufficient (${html.length} chars, hasProduct=${hasProduct}), trying next...`);
        } else {
          const errText = await res.text().catch(() => '');
          console.log(`[AliExpress] ScrapingAnt HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }
      } catch (e) {
        console.log(`[AliExpress] ScrapingAnt attempt failed:`, e);
      }
    }
  }

  // Attempt 3: allorigins.win (free CORS proxy, no key needed)
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const html = await res.text();
      if (html.length > 5000) {
        console.log(`[AliExpress] allorigins proxy OK (${html.length} chars)`);
        return html;
      }
    }
  } catch (e) {
    console.log(`[AliExpress] allorigins failed:`, e);
  }

  // Attempt 4: ScraperAPI (premium mode, JS rendering)
  if (SCRAPERAPI_KEY) {
    const scraperAttempts = [
      `https://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(targetUrl)}&render=true&premium=true&country_code=de`,
      `https://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(targetUrl)}&render=true&country_code=de`,
    ];
    for (const scraperUrl of scraperAttempts) {
      try {
        console.log(`[AliExpress] ScraperAPI attempt...`);
        const res = await fetch(scraperUrl, { signal: AbortSignal.timeout(60000) });
        if (res.ok) {
          const html = await res.text();
          const hasProduct = html.includes('application/ld+json') || html.includes('og:title') || html.includes('pdp-info-main') || html.includes('productTitle') || html.includes('product-title');
          if (html.length > 10000 && hasProduct) {
            console.log(`[AliExpress] ScraperAPI OK (${html.length} chars)`);
            return html;
          }
          console.log(`[AliExpress] ScraperAPI insufficient (${html.length} chars, hasProduct=${hasProduct})`);
        } else {
          const err = await res.text().catch(() => '');
          console.log(`[AliExpress] ScraperAPI HTTP ${res.status}: ${err.slice(0, 200)}`);
        }
      } catch (e) {
        console.log(`[AliExpress] ScraperAPI failed:`, e);
      }
    }
  }

  // Attempt 5: ZenRows (JS rendering + premium proxies)
  if (ZENROWS_API_KEY) {
    const zenAttempts = [
      `https://api.zenrows.com/v1/?apikey=${ZENROWS_API_KEY}&url=${encodeURIComponent(targetUrl)}&js_render=true&premium_proxy=true&proxy_country=de`,
      `https://api.zenrows.com/v1/?apikey=${ZENROWS_API_KEY}&url=${encodeURIComponent(targetUrl)}&js_render=true&proxy_country=de`,
    ];
    for (const zenUrl of zenAttempts) {
      try {
        console.log(`[AliExpress] ZenRows attempt...`);
        const res = await fetch(zenUrl, { signal: AbortSignal.timeout(60000) });
        if (res.ok) {
          const html = await res.text();
          const hasProduct = html.includes('application/ld+json') || html.includes('og:title') || html.includes('pdp-info-main') || html.includes('productTitle') || html.includes('product-title');
          if (html.length > 10000 && hasProduct) {
            console.log(`[AliExpress] ZenRows OK (${html.length} chars)`);
            return html;
          }
          console.log(`[AliExpress] ZenRows insufficient (${html.length} chars, hasProduct=${hasProduct})`);
        } else {
          const err = await res.text().catch(() => '');
          console.log(`[AliExpress] ZenRows HTTP ${res.status}: ${err.slice(0, 200)}`);
        }
      } catch (e) {
        console.log(`[AliExpress] ZenRows failed:`, e);
      }
    }
  }

  return null;
}

function extractVariants(html: string): Array<{ name: string; values: string[] }> {
  const variants: Array<{ name: string; values: string[] }> = [];

  // Versuch 0: Gerenderte DOM-Elemente (wenn ScrapingAnt JS ausgeführt hat)
  // Format: <div class="sku-property"> <div class="sku-property-title">Farbe</div> <span class="sku-property-item-skew-title">Schwarz</span> ...
  const skuPropBlocks = html.match(/<div[^>]+class="[^"]*sku-property[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g) ?? [];
  if (skuPropBlocks.length > 0) {
    for (const block of skuPropBlocks) {
      const titleMatch = block.match(/sku-property-title[^>]*>([^<]+)</);
      if (!titleMatch) continue;
      const name = titleMatch[1].trim();
      const valueMatches = [...block.matchAll(/sku-property-item[^>]*title="([^"]+)"/g)];
      const values = valueMatches.map(m => m[1].trim()).filter(Boolean);
      if (name && values.length > 0) variants.push({ name, values });
    }
    if (variants.length > 0) return variants;
  }

  // Versuch 0b: data-sku-id Buttons im gerenderten HTML
  const skuTitleMatches = [...html.matchAll(/<div[^>]+class="[^"]*skuTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];
  if (skuTitleMatches.length > 0) {
    for (const m of skuTitleMatches) {
      const name = m[1].replace(/<[^>]+>/g, '').trim();
      // Suche zugehörige Werte in benachbartem Block
      const idx = m.index ?? 0;
      const nextChunk = html.slice(idx, idx + 2000);
      const vals = [...nextChunk.matchAll(/skuPropertyItemTitle[^>]*>\s*([^<]{1,50})\s*</g)].map(v => v[1].trim()).filter(Boolean);
      if (name && vals.length > 0) variants.push({ name, values: [...new Set(vals)] });
    }
    if (variants.length > 0) return variants;
  }

  // AliExpress speichert Varianten in window.runParams oder skuInfoMap JSON
  // Versuch 1: skuAttr / skuPropertyList im JS
  const skuMatch = html.match(/"skuPropertyList"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (skuMatch) {
    try {
      const list = JSON.parse(skuMatch[1]) as Array<{ skuPropertyName: string; skuPropertyValues: Array<{ propertyValueName: string }> }>;
      for (const group of list) {
        const name = group.skuPropertyName?.trim();
        const values = (group.skuPropertyValues ?? []).map(v => v.propertyValueName?.trim()).filter(Boolean);
        if (name && values.length > 0) variants.push({ name, values });
      }
      if (variants.length > 0) return variants;
    } catch { /* ignore */ }
  }

  // Versuch 2: runParams.data.skuInfoMap oder props
  const runParamsMatch = html.match(/window\.runParams\s*=\s*(\{[\s\S]{100,50000}\});?\s*\n/);
  if (runParamsMatch) {
    try {
      const data = JSON.parse(runParamsMatch[1]) as Record<string, unknown>;
      const skuList = (data?.['data'] as Record<string, unknown>)?.['skuInfoMap'];
      if (Array.isArray(skuList)) {
        for (const group of skuList as Array<{ name: string; values: string[] }>) {
          if (group.name && Array.isArray(group.values)) {
            variants.push({ name: group.name, values: group.values });
          }
        }
        if (variants.length > 0) return variants;
      }
    } catch { /* ignore */ }
  }

  // Versuch 3: "props" Array im JSON-LD Produkt
  const propsMatch = html.match(/"additionalProperty"\s*:\s*(\[[\s\S]*?\])/);
  if (propsMatch) {
    try {
      const props = JSON.parse(propsMatch[1]) as Array<{ name: string; value: string }>;
      const grouped: Record<string, string[]> = {};
      for (const p of props) {
        if (!grouped[p.name]) grouped[p.name] = [];
        if (p.value && !grouped[p.name].includes(p.value)) grouped[p.name].push(p.value);
      }
      for (const [name, values] of Object.entries(grouped)) {
        if (values.length > 0) variants.push({ name, values });
      }
      if (variants.length > 0) return variants;
    } catch { /* ignore */ }
  }

  // Versuch 4: Specs als Varianten-Hinweise (Farbe, Größe aus specs)
  // Suche nach typischen Varianten-Keywords im HTML
  const colorMatch = html.match(/["'](?:Color|Farbe|Colour)["']\s*[,:]\s*["']([^"']{2,50})["']/gi);
  const sizeMatch = html.match(/["'](?:Size|Größe|Groesse)["']\s*[,:]\s*["']([^"']{1,30})["']/gi);
  if (colorMatch || sizeMatch) {
    if (colorMatch) {
      const values = [...new Set(colorMatch.map(m => m.replace(/.*[,:]\s*["']/, '').replace(/["'].*/, '').trim()))].slice(0, 10);
      if (values.length > 0) variants.push({ name: 'Farbe', values });
    }
    if (sizeMatch) {
      const values = [...new Set(sizeMatch.map(m => m.replace(/.*[,:]\s*["']/, '').replace(/["'].*/, '').trim()))].slice(0, 10);
      if (values.length > 0) variants.push({ name: 'Größe', values });
    }
  }

  return variants;
}

// ── Playwright Scraper ────────────────────────────────────────────────────────
// Intercepts mtop.aliexpress.pdp.pc.query to get all variant prices accurately
// Uses @sparticuz/chromium for serverless-compatible headless Chrome
async function scrapeWithPlaywright(url: string): Promise<ScrapedProduct | null> {
  if (!PLAYWRIGHT_AVAILABLE) return null;
  let browser;
  try {
    const { chromium: playwrightChromium } = await import('playwright-core');

    // Prefer explicit path (e.g. system Chrome or playwright-installed chromium)
    // PLAYWRIGHT_CHROMIUM_PATH env overrides all
    let execPath: string | undefined = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
    const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

    if (!execPath) {
      // Try @sparticuz/chromium (serverless-compatible, self-extracting)
      try {
        const sparticuzMod = await import('@sparticuz/chromium');
        const { setupLambdaEnvironment } = sparticuzMod;
        const sparticuzChromium = sparticuzMod.default;
        setupLambdaEnvironment();
        execPath = await sparticuzChromium.executablePath();
        launchArgs.push(...sparticuzChromium.args);
      } catch {
        // sparticuz not available — use playwright's default (if installed)
        execPath = undefined;
      }
    }

    console.log(`[Playwright] Using chromium: ${execPath || 'playwright default'}`);

    browser = await playwrightChromium.launch({
      headless: true,
      executablePath: execPath,
      args: launchArgs,
    });
    const context = await browser.newContext({
      locale: 'de-DE',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    let mtopResult: Record<string, unknown> | null = null;

    page.on('response', async (response) => {
      if (response.url().includes('mtop.aliexpress.pdp.pc.query') && !mtopResult) {
        try {
          const body = await response.body();
          const text = body.toString('utf-8');
          const m = text.match(/^[^(]+\(([\s\S]*)\)$/);
          const raw = m ? m[1] : text;
          const parsed = JSON.parse(raw) as { data?: { result?: Record<string, unknown> } };
          const r = parsed?.data?.result;
          if (r && Object.keys(r).length > 5) {
            mtopResult = r;
          }
        } catch { /* ignore */ }
      }
    });

    try {
      // domcontentloaded ist viel schneller als networkidle (AliExpress lädt permanent nach)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (gotoErr) {
      console.log(`[Playwright] goto error (non-fatal): ${gotoErr}`);
    }
    // Kurz warten damit mtop-Request ankommen kann, aber max 8s
    const waited = await Promise.race([
      new Promise<'mtop'>(resolve => {
        const check = setInterval(() => { if (mtopResult) { clearInterval(check); resolve('mtop'); } }, 200);
      }),
      page.waitForTimeout(8000).then(() => 'timeout' as const),
    ]);

    if (!mtopResult) {
      console.log('[Playwright] No mtop data captured');
      await browser.close();
      return null;
    }

    const result = mtopResult;

    // Title
    const globalData = (result.GLOBAL_DATA as { globalData?: { subject?: string } } | undefined)?.globalData;
    const rawTitle = globalData?.subject || '';
    if (!rawTitle) { await browser.close(); return null; }
    const title = cleanTitle(rawTitle);

    // Images
    const headerImg = result.HEADER_IMAGE_PC as { imgList?: string[]; imagePathList?: string[] } | undefined;
    const images = (headerImg?.imgList || headerImg?.imagePathList || []).slice(0, 10);

    // Variant prices via SKU + PRICE modules
    const skuModule = result.SKU as { skuPaths?: Array<{ skuIdStr?: string; skuAttr?: string; skuStock?: number }>; productSKUPropertyList?: Array<{ skuPropertyId?: number; skuPropertyName?: string; skuPropertyValues?: Array<{ propertyValueId?: number; propertyValueDisplayName?: string; propertyValueName?: string; skuPropertyImagePath?: string; skuPropertyImagePathRetina?: string }> }> } | undefined;
    const skuPaths = skuModule?.skuPaths || [];
    const propListPW = skuModule?.productSKUPropertyList || [];
    const priceModule = result.PRICE as { skuIdStrPriceInfoMap?: Record<string, { salePriceString?: string; originalPrice?: { value?: number } }> } | undefined;
    const priceMap = priceModule?.skuIdStrPriceInfoMap || {};

    // Bild-Map: propId:valId -> imageUrl
    const imgMapPW: Record<string, string> = {};
    for (const prop of propListPW) {
      for (const val of (prop.skuPropertyValues ?? [])) {
        const img = val.skuPropertyImagePath || val.skuPropertyImagePathRetina || '';
        if (img) {
          const k = String(prop.skuPropertyId) + ':' + String(val.propertyValueId);
          imgMapPW[k] = img.startsWith('http') ? img : 'https:' + img;
        }
      }
    }

    const variantPrices: VariantPrice[] = skuPaths.map(sku => {
      const skuId = sku.skuIdStr || '';
      const priceInfo = priceMap[skuId] || {};
      const salePriceStr = priceInfo.salePriceString || '';
      const priceMatch = salePriceStr.match(/[\d.]+/);
      const priceUSD = priceMatch ? parseFloat(priceMatch[0]) : 0;
      const priceEUR = Math.round(priceUSD * 0.92 * 100) / 100;

      // Parse attrs + Bild aus skuAttr: "14:691#100pcs;200007763:201336101"
      const attrs: Record<string, string> = {};
      let imageUrl = '';
      (sku.skuAttr || '').split(';').forEach(part => {
        const hashIdx = part.indexOf('#');
        const colonIdx = part.indexOf(':');
        const propId = part.substring(0, colonIdx);
        const valId = colonIdx >= 0 ? part.substring(colonIdx + 1).split('#')[0] : '';
        const imgKey = propId + ':' + valId;
        if (imgMapPW[imgKey] && !imageUrl) imageUrl = imgMapPW[imgKey];
        if (hashIdx >= 0) {
          attrs[propId || 'attr'] = part.substring(hashIdx + 1);
        }
      });

      return {
        skuId,
        attrs,
        imageUrl: imageUrl || undefined,
        price: priceEUR,
        originalPrice: priceInfo.originalPrice?.value,
        stock: sku.skuStock,
      };
    }).filter(v => v.price > 0);

    const minPriceEUR = variantPrices.length > 0 ? Math.min(...variantPrices.map(v => v.price)) : 0;
    const price = minPriceEUR > 0 ? `${minPriceEUR.toFixed(2)} €` : '';

    // Ships from
    const shippingMod = result.SHIPPING as { deliveryLayoutInfo?: Array<{ bizData?: { shipFrom?: string } }> } | undefined;
    let shipsFrom = 'China';
    for (const d of shippingMod?.deliveryLayoutInfo || []) {
      if (d.bizData?.shipFrom) { shipsFrom = d.bizData.shipFrom; break; }
    }
    const EU_COUNTRIES = ['germany', 'spain', 'france', 'italy', 'poland', 'netherlands', 'czech', 'austria', 'belgium', 'sweden', 'denmark'];
    const shipsFromDE = EU_COUNTRIES.some(c => shipsFrom.toLowerCase().includes(c));

    // Specs
    const propMod = result.PRODUCT_PROP_PC as { showedProps?: Array<{ attrName: string; attrValue: string }> } | undefined;
    const specs: Record<string, string> = {};
    (propMod?.showedProps || []).slice(0, 15).forEach(p => { if (p.attrName && p.attrValue) specs[p.attrName] = p.attrValue; });

    // Seller
    const shopCard = result.SHOP_CARD_PC as { storeTitle?: string } | undefined;
    const seller = shopCard?.storeTitle || '';

    // Variants from skuPaths
    const variantGroups: Record<string, Set<string>> = {};
    for (const sku of skuPaths) {
      (sku.skuAttr || '').split(';').forEach(part => {
        const hashIdx = part.indexOf('#');
        if (hashIdx >= 0) {
          const propId = part.split(':')[0];
          const val = part.substring(hashIdx + 1);
          if (!variantGroups[propId]) variantGroups[propId] = new Set();
          variantGroups[propId].add(val);
        }
      });
    }
    const variants = Object.entries(variantGroups).map(([name, values]) => ({ name, values: [...values] }));

    await browser.close();
    console.log(`[Playwright] OK: title="${title.slice(0, 50)}" variants=${variantPrices.length} shipsFrom="${shipsFrom}"`);
    // GPSR: Playwright hat keinen direkten HTML-Zugang hier — gpsr bleibt undefined (wird durch HTML-Fallback ergänzt)
    return { title, images, price, description: '', specs, shipsFrom, shipsFromDE, variants, variantPrices, seller, gpsr: undefined };
  } catch (e) {
    console.error('[Playwright] Error:', e);
    try { await browser?.close(); } catch { /* ignore */ }
    return null;
  }
}

export async function scrapeAliExpressUrl(url: string): Promise<ScrapedProduct | null> {
  // Normalize URL — always use de.aliexpress.com + clean URL (strip tracking params)
  let fetchUrl = url;
  try {
    const u = new URL(url);
    // Force de.aliexpress.com (German store, EUR prices, EU shipping visible)
    u.hostname = 'de.aliexpress.com';
    // Extract product ID from path and build clean URL
    const itemMatch = u.pathname.match(/\/item\/(\d+)\.html/);
    if (itemMatch) {
      fetchUrl = `https://de.aliexpress.com/item/${itemMatch[1]}.html`;
    } else {
      // Keep path but strip all query params
      u.search = '';
      u.hash = '';
      fetchUrl = u.toString();
    }
  } catch { /* keep original */ }

  console.log(`[AliExpress] Starting scrape: ${fetchUrl}`);

  // ── Weg 1: DS API (schnellste Methode — direkte API, keine Browser nötig) ──
  const itemIdMatch = fetchUrl.match(/\/item\/(\d+)\.html/);
  const productId = itemIdMatch ? itemIdMatch[1] : '';
  if (productId) {
    const dsResult = await scrapeWithDsApi(productId);
    if (dsResult && dsResult.title) {
      console.log('[AliExpress] DS API erfolgreich — überspringe Playwright/HTML');
      return dsResult;
    }
    console.log('[AliExpress] DS API fehlgeschlagen, versuche Playwright...');
  }

  // ── Weg 2: Playwright (intercepts mtop API → full variant prices) ────────
  if (PLAYWRIGHT_AVAILABLE) {
    console.log('[AliExpress] Trying Playwright scraper...');
    const playwrightResult = await scrapeWithPlaywright(fetchUrl);
    if (playwrightResult) {
      return playwrightResult;
    }
    console.log('[AliExpress] Playwright failed, falling back to HTML scrapers...');
  }

  const html = await fetchWithFallbacks(fetchUrl);
  if (!html) {
    console.log('[AliExpress] All fetch attempts failed');
    return null;
  }

  // ── Parse JSON-LD ──────────────────────────────────────────────────────────
  let title = '';
  let jsonLdImages: string[] = [];
  let jsonLdPrice = '';
  let jsonLdDesc = '';

  const ldBlocks = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of ldBlocks) {
    try {
      const data = JSON.parse(block[1]) as Record<string, unknown>;
      const items = Array.isArray(data['@graph']) ? data['@graph'] as Record<string, unknown>[] : [data];
      for (const item of items) {
        if (item['@type'] === 'Product') {
          title = cleanTitle(String(item['name'] ?? ''));
          const imgRaw = item['image'];
          if (Array.isArray(imgRaw)) jsonLdImages = imgRaw.map(String);
          else if (typeof imgRaw === 'string') jsonLdImages = [imgRaw];
          const offers = item['offers'] as Record<string, unknown> | undefined;
          if (offers) {
            const p = parseFloat(String(offers['price'] ?? '0'));
            if (p > 0) jsonLdPrice = `${p.toFixed(2)} €`;
          }
          jsonLdDesc = String(item['description'] ?? '');
          break;
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
    if (title) break;
  }

  // ── OG fallback ────────────────────────────────────────────────────────────
  if (!title) {
    const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
    if (ogTitle) title = cleanTitle(ogTitle[1]);
  }

  // ── Page <title> fallback ──────────────────────────────────────────────────
  if (!title) {
    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/);
    if (pageTitle) title = cleanTitle(pageTitle[1]);
  }

  if (!title) {
    console.log('[AliExpress] Could not extract title');
    return null;
  }

  const images = extractImages(html, jsonLdImages);
  // extractSteleData holt Preis + alle Varianten mit SKU-IDs aus JS-Snippet
  const { minPrice: steleMinPrice, variantPrices } = extractSteleData(html);
  const price = jsonLdPrice || steleMinPrice || extractMinPrice(html);
  const specs = extractSpecs(html);
  const { shipsFrom, shipsFromDE } = extractShipsFrom(html);

  // ── Seller/Shop Name ───────────────────────────────────────────────────────
  let seller = '';
  // Try JSON-LD seller
  const ldBlocksSeller = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of ldBlocksSeller) {
    try {
      const data = JSON.parse(block[1]) as Record<string, unknown>;
      const items = Array.isArray(data['@graph']) ? data['@graph'] as Record<string, unknown>[] : [data];
      for (const item of items) {
        if (item['@type'] === 'Product') {
          const brand = item['brand'] as Record<string, unknown> | undefined;
          if (brand?.['name']) { seller = String(brand['name']); break; }
          const offers = item['offers'] as Record<string, unknown> | undefined;
          if (offers?.['seller']) {
            const s = offers['seller'] as Record<string, unknown>;
            if (s?.['name']) { seller = String(s['name']); break; }
          }
        }
      }
    } catch { /* ignore */ }
    if (seller) break;
  }
  // Fallback: storeName in page HTML
  if (!seller) {
    const m = html.match(/"storeName"\s*:\s*"([^"]+)"/) ||
              html.match(/store-name[^>]*>([^<]{3,60})</) ||
              html.match(/"sellerName"\s*:\s*"([^"]+)"/);
    if (m) seller = m[1].trim();
  }

  // Clean description — HTML raus, Footer/Spam-Zeilen filtern
  const BLOCKED = [
    /aliexpress/i, /alibaba/i, /alimama/i, /taobao/i, /tmall/i,
    /amazon/i, /temu/i, /mehrsprachige/i, /browse by category/i,
    /hilfe.?center/i, /streitigkeiten/i, /transparenz/i, /dsa.*osa/i,
    /русский|portuguese|español|français|italiano|türkçe/i,
    /käuferschutz/i, /datenschutz/i, /nutzungsbedingungen/i, /impressum/i,
    /warenkorb/i, /wunschliste/i, /anmelden/i, /registrieren/i,
    /cookie/i, /newsletter/i, /alle rechte vorbehalten/i, /sitemap/i,
    /^\s*\d+\s*$/, // nur Zahlen
    /http[s]?:\/\//i, // URLs
  ];
  const description = jsonLdDesc
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .split(/[.\n]/)
    .filter(s => {
      const t = s.trim();
      return t.length > 15 && !BLOCKED.some(re => re.test(t));
    })
    .slice(0, 6)
    .join('. ')
    .trim()
    .slice(0, 800);

  console.log(`[AliExpress] title="${title.slice(0, 60)}" images=${images.length} price="${price}" shipsFrom="${shipsFrom}"`);

  const variants = extractVariants(html);
  console.log(`[AliExpress] variants=${JSON.stringify(variants.map(v => `${v.name}:${v.values.length}`))}`);

  if (seller) console.log(`[AliExpress] seller="${seller}"`);

  if (variantPrices.length > 0) {
    console.log(`[AliExpress] variantPrices: ${variantPrices.length} Varianten, z.B.: ${JSON.stringify(variantPrices[0])}`);
  }

  // GPSR extrahieren
  const gpsr = extractGpsr(html);
  if (gpsr?.name) console.log(`[AliExpress] GPSR gefunden: ${gpsr.name}`);
  else console.log('[AliExpress] GPSR: kein Block gefunden');

  return { title, images, price, description, specs, shipsFrom, shipsFromDE, variants, variantPrices, seller, gpsr };
}
