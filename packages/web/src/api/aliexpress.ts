// AliExpress URL Scraper — JSON-LD based, no API key needed
// Uses ScrapingAnt (residential proxies) to bypass AliExpress bot-detection

const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY || '';

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

export interface ScrapedProduct {
  title: string;
  images: string[];
  price: string;
  description: string;
  specs: Record<string, string>;
  shipsFromDE: boolean;   // true wenn Versand aus DE/EU erkannt
  shipsFrom: string;      // z.B. "Germany", "Spain", "China"
  variants: Array<{ name: string; values: string[] }>; // z.B. [{name:"Farbe", values:["Schwarz","Blau"]}]
  seller?: string;        // AliExpress Shopname für GPSR
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

  // Kein Versandland gefunden → China (Standard AliExpress)
  return { shipsFrom: 'China', shipsFromDE: false };
}

function extractSpecs(html: string): Record<string, string> {
  const specs: Record<string, string> = {};

  // Try to find spec table rows: <th>Key</th><td>Value</td>
  const tableRe = /<tr[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = tableRe.exec(html)) !== null) {
    const k = m[1].replace(/<[^>]*>/g, '').trim();
    const v = m[2].replace(/<[^>]*>/g, '').trim();
    if (k && v && k.length < 80 && v.length < 200) specs[k] = v;
    if (Object.keys(specs).length >= 15) break;
  }

  // Fallback: dt/dd pairs
  if (Object.keys(specs).length === 0) {
    const dtRe = /<dt[^>]*>([\s\S]*?)<\/dt>[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    while ((m = dtRe.exec(html)) !== null) {
      const k = m[1].replace(/<[^>]*>/g, '').trim();
      const v = m[2].replace(/<[^>]*>/g, '').trim();
      if (k && v) specs[k] = v;
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
    // Two tries: first with wait_for_selector, then without (fallback)
    const attempts = [
      `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${SCRAPINGANT_API_KEY}&browser=true&proxy_country=DE&wait_for_selector=.pdp-info-main&block_resources=false`,
      `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${SCRAPINGANT_API_KEY}&browser=true&proxy_country=DE&block_resources=false`,
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

  return null;
}

function extractVariants(html: string): Array<{ name: string; values: string[] }> {
  const variants: Array<{ name: string; values: string[] }> = [];

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
  const price = jsonLdPrice || extractPrice(html);
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

  return { title, images, price, description, specs, shipsFrom, shipsFromDE, variants, seller };
}
