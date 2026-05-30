import { Hono } from 'hono';
import { cors } from "hono/cors"
import puppeteer from "puppeteer";

async function scrapePrice(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "de-DE,de;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }
    });
    const html = await res.text();

    if (url.includes("amazon")) {
      const patterns = [
        /"priceAmount":([\d.]+)/,
        /class="a-price-whole"[^>]*>([\d,.]+)</,
        /"price":\s*"([\d,.]+)"/,
        /id="priceblock_ourprice"[^>]*>([\d,.]+)\s*€/,
        /id="priceblock_dealprice"[^>]*>([\d,.]+)\s*€/,
        /"buyingPrice":([\d.]+)/,
        /class="a-offscreen"[^>]*>([\d,.]+)\s*€/,
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) {
          const val = parseFloat(m[1].replace(",", ".").replace(/\./g, match => match === "." && m[1].indexOf(",") === -1 ? "." : ""));
          if (!isNaN(val) && val > 0 && val < 10000) return val;
        }
      }
    }

    if (url.includes("ebay")) {
      const patterns = [
        /"price":\s*\{[^}]*"value":\s*"([\d,.]+)"/,
        /itemprop="price"\s+content="([\d.]+)"/,
        /class="x-price-primary"[^>]*>.*?<span[^>]*>([\d,.]+)/s,
        /id="prcIsum"[^>]*content="([\d.]+)"/,
        /"binPrice":"EUR ([\d,.]+)"/,
        /x-price-approx__price[^>]*>([\d,.]+)/,
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) {
          const val = parseFloat(m[1].replace(",", "."));
          if (!isNaN(val) && val > 0 && val < 10000) return val;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function scrapeAmazonWithBrowser(url: string): Promise<{
  title: string;
  bullets: string[];
  variants: string[];
  description: string;
} | null> {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--lang=de-DE',
      ],
    });

    const page = await browser.newPage();

    // German locale + UA
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set German cookies before navigation
    await page.setCookie(
      { name: 'lc-acbde', value: 'de_DE', domain: '.amazon.de', path: '/' },
      { name: 'i18n-prefs', value: 'EUR', domain: '.amazon.de', path: '/' },
      { name: 'sp-cdn', value: 'L5Z9:DE', domain: '.amazon.de', path: '/' },
    );

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Dismiss cookie banner if present
    await page.evaluate(() => {
      (document.querySelector('#sp-cc-accept') as HTMLElement | null)?.click();
      (document.querySelector('input[name="accept"]') as HTMLElement | null)?.click();
    }).catch(() => {});

    // Wait for product title to appear
    await page.waitForSelector('#productTitle', { timeout: 8000 }).catch(() => {});

    const data = await page.evaluate(() => {
      return {
        title: document.querySelector('#productTitle')?.textContent?.trim() || '',
        bullets: Array.from(document.querySelectorAll('#feature-bullets .a-list-item'))
          .map(e => e.textContent?.trim() || '')
          .filter(t => t.length > 10 && !t.includes('Make sure') && !t.includes('Stellen Sie sicher')),
        variants: [...new Set([
          ...Array.from(document.querySelectorAll('.swatch-title-text, .swatch-title-text-display'))
            .map(e => e.textContent?.trim().replace(/\s+/g, ' ') || '')
            .filter(t => t.length > 1 && !t.includes('Option')),
          ...Array.from(document.querySelectorAll('.twisterTextDiv p, #variation_style_name .selection, #variation_size_name .selection, #variation_color_name .selection'))
            .map(e => e.textContent?.trim() || ''),
          ...Array.from(document.querySelectorAll('[data-value]'))
            .map(e => e.getAttribute('data-value') || '')
            .filter(v => v && v.length < 60 && v !== 'search-alias=aps' && !v.startsWith('search-'))
        ].filter(v => v && v.length > 1 && !v.includes('€') && !v.includes('Option von') && !/^[←→\d]+$/.test(v)))].slice(0, 20),
        description: document.querySelector('#productDescription p')?.textContent?.trim()
          || document.querySelector('#aplus p')?.textContent?.trim()
          || '',
      };
    });

    if (!data.title) return null;
    return data;
  } catch (e) {
    console.error("Puppeteer scrape error:", e);
    return null;
  } finally {
    await browser?.close();
  }
}

const app = new Hono()
  .basePath('api')
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true }))
  .get('/ping', (c) => c.json({ message: `Pong! ${Date.now()}` }, 200))
  .get('/health', (c) => c.json({ status: 'ok' }, 200))
  .get('/scrape-price', async (c) => {
    const url = c.req.query('url');
    if (!url) return c.json({ error: 'url fehlt' }, 400);
    const price = await scrapePrice(url);
    if (price === null) return c.json({ error: 'Preis nicht gefunden' }, 404);
    return c.json({ price }, 200);
  })
  .get('/scrape-amazon', async (c) => {
    let url = c.req.query('url');
    if (!url) return c.json({ error: 'url fehlt' }, 400);
    if (!url.includes("amazon")) return c.json({ error: 'Keine Amazon-URL' }, 400);

    try {
      const u = new URL(url);
      if (!u.searchParams.has('language')) u.searchParams.set('language', 'de_DE');
      url = u.toString();
    } catch { /* invalid URL, pass through */ }

    const data = await scrapeAmazonWithBrowser(url);
    if (!data) return c.json({ error: 'Amazon-Seite konnte nicht geladen werden. Bitte direkte Produkt-URL verwenden (amazon.de/dp/ASIN).' }, 503);
    return c.json(data, 200);
  });

export type AppType = typeof app;
export default app;
