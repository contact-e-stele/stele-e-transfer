import { Hono } from 'hono';
import { cors } from "hono/cors"

async function scrapeAmazon(url: string): Promise<{
  title: string;
  bullets: string[];
  variants: string[];
  description: string;
} | null> {
  // Try multiple user agents / approaches
  const attempts = [
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
        'Cookie': 'lc-acbde=de_DE; i18n-prefs=EUR; sp-cdn=L5Z9:DE',
      }
    },
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Cookie': 'lc-acbde=de_DE; i18n-prefs=EUR',
      }
    },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(url, { headers: attempt.headers });
      if (!res.ok) continue;
      const html = await res.text();

      // Check if we got a real product page (not captcha/redirect)
      if (html.includes('api-services-support@amazon.com') || html.includes('Enter the characters you see below')) {
        console.log("Got captcha page, trying next...");
        continue;
      }

      const title = extractText(html, /<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/);
      if (!title) continue;

      const bullets = extractBullets(html);
      const variants = extractVariants(html);
      const description = extractText(html, /<div[^>]*id="productDescription"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/) ||
        extractText(html, /<div[^>]*id="aplus"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);

      return {
        title: stripTags(title).trim(),
        bullets,
        variants,
        description: stripTags(description || '').trim(),
      };
    } catch (e) {
      console.error("Fetch attempt failed:", e);
    }
  }
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function extractText(html: string, pattern: RegExp): string {
  const m = html.match(pattern);
  return m ? stripTags(m[1]) : '';
}

function fixConcatenatedText(text: string): string {
  // Fehlende Leerzeichen: kleinBuchstabe → klein Buchstabe
  let fixed = text.replace(/([a-zäöüß])([A-ZÄÖÜ])/g, '$1 $2');
  // Doppelte aufeinanderfolgende Phrasen entfernen
  // z.B. "dauer backfoliedauer backfolie" → "dauer backfolie"
  // Suche nach Mustern wo eine Zeichenkette sich direkt wiederholt
  fixed = fixed.replace(/\b(\w{4,}(?:\s+\w+){0,4})\1\b/gi, '$1');
  // Auch mit Leerzeichen getrennte Duplikate
  fixed = fixed.replace(/\b(.{8,40})\s+\1\b/gi, '$1');
  fixed = fixed.replace(/\s{2,}/g, ' ').trim();
  return fixed;
}

function extractBullets(html: string): string[] {
  const section = html.match(/<div[^>]*id="feature-bullets"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  const items: string[] = [];
  const re = /<li[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/li>/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const text = fixConcatenatedText(stripTags(m[1]).trim());
    if (text.length > 10 && !text.includes('Make sure') && !text.includes('Stellen Sie sicher')) {
      items.push(text);
    }
  }
  return items;
}

function extractVariants(html: string): string[] {
  const variants = new Set<string>();
  let m;

  // Methode 1: data-value auf li-Elementen (Twister Buttons)
  const re1 = /data-value="([^"]{1,60})"/g;
  while ((m = re1.exec(html)) !== null) {
    const v = m[1].trim();
    if (v.length > 0) variants.add(v);
  }

  // Methode 2: class="selection" spans
  const re2 = /class="[^"]*selection[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
  while ((m = re2.exec(html)) !== null) {
    const v = stripTags(m[1]).trim();
    if (v.length > 1 && v.length < 60) variants.add(v);
  }

  // Methode 3: inline-twister-dim-title spans
  const re3 = /inline-twister-dim-title[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
  while ((m = re3.exec(html)) !== null) {
    const v = stripTags(m[1]).trim();
    if (v.length > 0 && v.length < 60) variants.add(v);
  }

  return [...variants]
    .filter(v =>
      !v.includes('€') &&
      !v.includes('Option von') &&
      !v.startsWith('search-') &&
      !v.includes('amazon') &&
      !/^[←→\d\s]+$/.test(v) &&
      v !== 'search-alias=aps' &&
      // Keine Dimensionen/Maße (z.B. "40 x 33 x 0 cm", "30x40cm")
      !/\d+\s*[xX×]\s*\d+/.test(v) &&
      // Kein "Größe:" oder andere Label-Prefixe ohne Wert
      !/^(Größe|Farbe|Menge|Stück|Material|Stil|Modell)\s*:?\s*$/.test(v) &&
      // Muss mindestens ein Buchstabe enthalten
      /[a-zA-ZäöüÄÖÜß]/.test(v)
    )
    .slice(0, 20);
}

const app = new Hono()
  .basePath('api')
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true }))
  .get('/ping', (c) => c.json({ message: `Pong! ${Date.now()}` }, 200))
  .get('/health', (c) => c.json({ status: 'ok' }, 200))
  .get('/scrape-amazon', async (c) => {
    let url = c.req.query('url');
    if (!url) return c.json({ error: 'url fehlt' }, 400);
    if (!url.includes("amazon")) return c.json({ error: 'Keine Amazon-URL' }, 400);

    try {
      const u = new URL(url);
      if (!u.searchParams.has('language')) u.searchParams.set('language', 'de_DE');
      if (!u.searchParams.has('th')) u.searchParams.set('th', '1');
      url = u.toString();
    } catch {}

    const data = await scrapeAmazon(url);
    if (!data) return c.json({ error: 'Amazon-Seite konnte nicht geladen werden. Bitte direkte Produkt-URL verwenden (amazon.de/dp/ASIN).' }, 503);
    return c.json(data, 200);
  });

export type AppType = typeof app;
export default app;
