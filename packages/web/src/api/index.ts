import { Hono } from 'hono';
import { cors } from "hono/cors"

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function fixText(text: string): string {
  // "SpÜLmaschinen" → normalisiere gemischte Groß/Klein-Schreibung
  let fixed = text.replace(/\b([A-ZÄÖÜa-zäöüß]+)\b/g, word => {
    if (/[a-zäöüß][A-ZÄÖÜ]/.test(word) && /[A-ZÄÖÜ][a-zäöüß].*[A-ZÄÖÜ]/.test(word)) {
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    }
    return word;
  });
  // Direkt aneinanderhängende Duplikate: "dauer backfoliedauer backfolie" → "dauer backfolie"
  fixed = fixed.replace(/(\b[\wäöüÄÖÜß][\wäöüÄÖÜß\s]{4,40}?)(\1)/gi, '$1');
  // Mit Leerzeichen getrennte Duplikate
  fixed = fixed.replace(/\b(.{8,40})\s+\1\b/gi, '$1');
  return fixed.replace(/\s{2,}/g, ' ').trim();
}

function extractBullets(html: string): string[] {
  const section = html.match(/<div[^>]*id="feature-bullets"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  const items: string[] = [];
  const re = /<li[^>]*>\s*<span[^>]*class="[^"]*a-list-item[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/li>/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const text = fixText(stripTags(m[1]).trim());
    if (text.length > 10 && !text.toLowerCase().includes('make sure') && !text.toLowerCase().includes('stellen sie sicher')) {
      items.push(text);
    }
  }
  // Fallback: alle li > span
  if (items.length === 0) {
    const re2 = /<li[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/li>/g;
    while ((m = re2.exec(section)) !== null) {
      const text = fixText(stripTags(m[1]).trim());
      if (text.length > 10 && !text.toLowerCase().includes('make sure') && !text.toLowerCase().includes('stellen sie sicher')) {
        items.push(text);
      }
    }
  }
  return items;
}

function extractVariants(html: string): string[] {
  const variants = new Set<string>();

  // Primär: dimensionValuesDisplayData (zuverlässigste Quelle)
  const dimMatch = html.match(/"dimensionValuesDisplayData"\s*:\s*(\{[^}]+\})/);
  if (dimMatch) {
    try {
      const dimData = JSON.parse(dimMatch[1]) as Record<string, string[]>;
      for (const vals of Object.values(dimData)) {
        for (const v of vals) {
          if (v && v.length > 1 && v.length < 80) variants.add(v.trim());
        }
      }
    } catch { /* ignore */ }
  }

  // Fallback: data-value auf li-Elementen
  if (variants.size === 0) {
    const re = /data-value="([^"]{1,80})"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const v = m[1].trim();
      if (
        v.length > 1 &&
        !v.startsWith('search-') &&
        !v.includes('amazon') &&
        /[a-zA-ZäöüÄÖÜß]/.test(v)
      ) variants.add(v);
    }
  }

  return [...variants]
    .filter(v =>
      !/^(Größe|Farbe|Menge|Stil|Modell)\s*:?\s*$/.test(v) &&
      // Keine reinen Dimensionen wie "40 x 33 x 0 cm" oder "30x40"
      !/^\d+\s*[xX×]\s*\d+\s*([xX×]\s*\d+)?\s*(cm|mm|m)?$/.test(v.trim())
    )
    .slice(0, 20);
}

async function scrapeAmazon(url: string): Promise<{
  title: string;
  bullets: string[];
  variants: string[];
  description: string;
} | null> {
  const attempts = [
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
      'Cookie': 'lc-acbde=de_DE; i18n-prefs=EUR; sp-cdn=L5Z9:DE',
    },
    {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9',
      'Accept-Encoding': 'identity',
      'Cookie': 'lc-acbde=de_DE; i18n-prefs=EUR',
    },
  ];

  for (const headers of attempts) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.log(`HTTP ${res.status} for ${url}`);
        continue;
      }
      const html = await res.text();

      // Captcha / Bot-Detection
      if (
        html.includes('api-services-support@amazon.com') ||
        html.includes('Enter the characters you see below') ||
        html.includes('validateCaptcha') ||
        html.includes('Type the characters you see in this image')
      ) {
        console.log('Got captcha/bot-detection page, trying next...');
        continue;
      }

      const titleMatch = html.match(/<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/);
      if (!titleMatch) {
        console.log('No productTitle found in response');
        continue;
      }

      const title = stripTags(titleMatch[1]).trim();
      if (!title) continue;

      const bullets = extractBullets(html);
      const variants = extractVariants(html);
      const descMatch =
        html.match(/<div[^>]*id="productDescription"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/) ||
        html.match(/<div[^>]*id="aplus"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
      const description = descMatch ? fixText(stripTags(descMatch[1]).trim()) : '';

      console.log(`Scraped: "${title.slice(0, 60)}" | bullets:${bullets.length} variants:${variants.length}`);

      return { title, bullets, variants, description };
    } catch (e) {
      console.error('Fetch attempt failed:', e);
    }
  }
  return null;
}

const app = new Hono()
  .basePath('api')
  .use(cors({ origin: (origin) => origin ?? '*', credentials: true }))
  .get('/ping', (c) => c.json({ message: `Pong! ${Date.now()}` }, 200))
  .get('/health', (c) => c.json({ status: 'ok' }, 200))
  .get('/scrape-amazon', async (c) => {
    let url = c.req.query('url');
    if (!url) return c.json({ error: 'url fehlt' }, 400);
    if (!url.includes('amazon')) return c.json({ error: 'Keine Amazon-URL' }, 400);

    try {
      const u = new URL(url);
      if (!u.searchParams.has('language')) u.searchParams.set('language', 'de_DE');
      if (!u.searchParams.has('th')) u.searchParams.set('th', '1');
      url = u.toString();
    } catch { /* ignore malformed url params */ }

    const data = await scrapeAmazon(url);
    if (!data) return c.json({ error: 'Amazon-Seite konnte nicht geladen werden. Bitte direkte Produkt-URL verwenden (amazon.de/dp/ASIN).' }, 503);
    return c.json(data, 200);
  });

export type AppType = typeof app;
export default app;
