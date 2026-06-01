// AliExpress URL Scraper — JSON-LD based, no API key needed

const HEADERS = {
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
  // Force global site with EUR prices
  'Cookie': 'aep_usuc_f=site=glo&c_tp=EUR&region=DE&b_locale=de_DE; xman_t=test; acs_usuc_t=x_csrf=test',
};

export interface ScrapedProduct {
  title: string;
  images: string[];
  price: string;
  description: string;
  specs: Record<string, string>;
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
  // JSON-LD offers.price
  const ldMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/);
  if (ldMatch) {
    const num = parseFloat(ldMatch[1]);
    if (!isNaN(num) && num > 0) return `${num.toFixed(2)} €`;
  }

  // EUR price in text
  const eurMatch = html.match(/€\s*([\d]+[,.][\d]{2})/);
  if (eurMatch) return `${eurMatch[1].replace(',', '.')} €`;

  // data-price attribute
  const dataPrice = html.match(/data-price="([\d.]+)"/);
  if (dataPrice) return `${parseFloat(dataPrice[1]).toFixed(2)} €`;

  return '';
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

export async function scrapeAliExpressUrl(url: string): Promise<ScrapedProduct | null> {
  // Normalize URL — force www.aliexpress.com global
  let fetchUrl = url;
  try {
    const u = new URL(url);
    // Always use www.aliexpress.com to avoid US redirect
    if (u.hostname === 'de.aliexpress.com' || u.hostname === 'aliexpress.com') {
      u.hostname = 'www.aliexpress.com';
    }
    fetchUrl = u.toString();
  } catch { /* keep original */ }

  console.log(`[AliExpress] Fetching: ${fetchUrl}`);

  let html = '';
  try {
    const res = await fetch(fetchUrl, { headers: HEADERS, redirect: 'follow' });
    console.log(`[AliExpress] Status: ${res.status} | URL: ${res.url}`);
    if (!res.ok) return null;
    html = await res.text();
  } catch (e) {
    console.error('[AliExpress] Fetch error:', e);
    return null;
  }

  if (html.length < 1000) {
    console.log('[AliExpress] Response too short, likely blocked');
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

  // Clean description
  const description = jsonLdDesc
    .replace(/<[^>]*>/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 1000);

  console.log(`[AliExpress] title="${title.slice(0, 60)}" images=${images.length} price="${price}"`);

  return { title, images, price, description, specs };
}
