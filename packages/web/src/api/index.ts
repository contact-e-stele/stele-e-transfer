import { Hono } from 'hono';
import { cors } from "hono/cors"
import { listOnEbay, suggestCategory, getOAuthUrl, exchangeCodeForToken } from './ebay';
import { searchProducts, getProductDetail } from './aliexpress';
import { eq } from 'drizzle-orm';

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const PIECE_TRANSLATIONS: Record<string, string> = {
  // Italienisch
  'pezzi': 'Stück', 'pezzo': 'Stück', 'pz': 'Stück',
  // Französisch
  'pièces': 'Stück', 'pieces': 'Stück', 'pièce': 'Stück',
  // Spanisch
  'piezas': 'Stück', 'pieza': 'Stück', 'unidades': 'Stück', 'unidad': 'Stück',
  // Englisch
  'pieces': 'Stück', 'piece': 'Stück', 'pcs': 'Stück', 'pc': 'Stück', 'units': 'Stück', 'unit': 'Stück', 'pack': 'Stück',
  // Niederländisch
  'stuks': 'Stück', 'stuk': 'Stück',
  // Polnisch
  'sztuki': 'Stück', 'sztuka': 'Stück', 'szt': 'Stück',
};

function translatePieceTerms(text: string): string {
  // Muster: (5 pezzi), (3er Set), (10 pcs) — in Klammern oder direkt nach Zahl
  return text.replace(/\((\d+)\s+([a-zA-ZäöüÄÖÜßàáâãèéêìíîòóôùúûñç]+)\)/gi, (match, num, word) => {
    const lower = word.toLowerCase();
    if (PIECE_TRANSLATIONS[lower]) {
      return `(${num} ${PIECE_TRANSLATIONS[lower]})`;
    }
    return match;
  });
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
  // Nonsense-Keyword-Einschübe entfernen: alleinstehende Produktnamen ohne Kontext
  // z.B. "dauer backfolie," oder ", backmatte," mitten im Satz
  fixed = fixed.replace(/,\s*[a-zäöüß][a-zäöüßA-ZÄÖÜ\s]{3,25}?\s*,/g, (match) => {
    // Nur entfernen wenn es kein normaler Satzteil ist (kein Verb, kein Adjektiv-Kontext)
    const inner = match.replace(/,/g, '').trim();
    // Behalte wenn es nach Komma ein sinnvolles Wort ist (Adjektiv/Verb-Form)
    if (/^(und|oder|aber|sowie|bzw|auch|sehr|noch|mehr|für|mit|bei|von|zu|an)\b/i.test(inner)) return match;
    // Entferne wenn es ein alleinstehender Compound-Nomen-Keyword ist (kein Verb, kein Artikel)
    if (/^[a-z][a-zäöüß]+\s[a-z][a-zäöüß]+$/.test(inner)) return ', ';
    return match;
  });
  fixed = translatePieceTerms(fixed);
  return fixed.replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim();
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
    .map(v => translatePieceTerms(v))
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
  })
  // eBay Marketplace Account Deletion Notification Endpoint
  // Docs: https://developer.ebay.com/marketplace-account-deletion
  .get('/ebay/deletion', async (c) => {
    const challengeCode = c.req.query('challenge_code');
    if (!challengeCode) return c.json({ error: 'challenge_code fehlt' }, 400);

    const VERIFY_TOKEN = 'stele-ebay-marketplace-deletion-verify-2024';
    const ENDPOINT = 'https://stele-e-transfer.onrender.com/api/ebay/deletion';

    // eBay erwartet SHA-256 Hash von: challengeCode + verificationToken + endpoint
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256')
      .update(challengeCode + VERIFY_TOKEN + ENDPOINT)
      .digest('hex');

    return c.json({ challengeResponse: hash }, 200);
  })
  .post('/ebay/deletion', async (c) => {
    // Eingehende Löschbenachrichtigungen — einfach 200 zurückgeben
    console.log('eBay deletion notification received');
    return c.json({ acknowledged: true }, 200);
  })

  // ─── eBay OAuth ─────────────────────────────────────────────────────────────
  .get('/ebay/auth', (c) => {
    const state = Math.random().toString(36).slice(2);
    const url = getOAuthUrl(state);
    return c.redirect(url);
  })
  .get('/ebay/callback', async (c) => {
    const code = c.req.query('code');
    if (!code) return c.json({ error: 'Kein Code' }, 400);
    try {
      const tokens = await exchangeCodeForToken(code);
      // In Produktion: refresh_token in DB/Env speichern
      console.log('eBay refresh token:', tokens.refresh_token);
      return c.json({ message: 'Erfolgreich! Refresh Token in Server-Logs.', expires_in: tokens.expires_in }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })

  // ─── Produkt speichern ───────────────────────────────────────────────────────
  .post('/products', async (c) => {
    let db;
    try {
      const { db: database, schema } = await import('../db/index').then(async m => {
        const schema = await import('../db/schema');
        return { db: m.db, schema };
      });
      db = database;
      const body = await c.req.json() as {
        asin: string;
        amazonUrl: string;
        title: string;
        generatedTitle: string;
        htmlDescription: string;
        bullets: string[];
        variants: string[];
        description?: string;
      };
      const existing = await db.select().from(schema.products).where(eq(schema.products.asin, body.asin)).limit(1);
      if (existing.length > 0) {
        await db.update(schema.products).set({
          generatedTitle: body.generatedTitle,
          htmlDescription: body.htmlDescription,
          bullets: JSON.stringify(body.bullets),
          variants: JSON.stringify(body.variants),
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.products.asin, body.asin));
        return c.json({ id: existing[0].id, updated: true }, 200);
      }
      const result = await db.insert(schema.products).values({
        asin: body.asin,
        amazonUrl: body.amazonUrl,
        title: body.title,
        generatedTitle: body.generatedTitle,
        htmlDescription: body.htmlDescription,
        bullets: JSON.stringify(body.bullets),
        variants: JSON.stringify(body.variants),
        description: body.description ?? '',
        ebayStatus: 'none',
      }).returning({ id: schema.products.id });
      return c.json({ id: result[0].id, created: true }, 201);
    } catch (e) {
      console.error('DB error:', e);
      return c.json({ error: 'DB nicht verfügbar' }, 503);
    }
  })

  .get('/products', async (c) => {
    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const schema = await import('../db/schema');
        return { db: m.db, schema };
      });
      const all = await db.select().from(schema.products).orderBy(schema.products.createdAt);
      return c.json(all.map(p => ({
        ...p,
        bullets: JSON.parse(p.bullets),
        variants: JSON.parse(p.variants),
      })), 200);
    } catch (e) {
      return c.json({ error: 'DB nicht verfügbar' }, 503);
    }
  })

  // ─── eBay Listing ────────────────────────────────────────────────────────────
  .post('/ebay/list', async (c) => {
    const body = await c.req.json() as {
      asin: string;
      title: string;
      description: string;
      price: number;
      quantity: number;
      imageUrls?: string[];
    };

    if (!body.asin || !body.title || !body.description || !body.price) {
      return c.json({ error: 'asin, title, description, price sind Pflichtfelder' }, 400);
    }

    try {
      // Kategorie vorschlagen
      const categoryId = await suggestCategory(body.title).catch(() => null);

      const listingId = await listOnEbay({
        sku: body.asin,
        title: body.title.slice(0, 80),
        description: body.description,
        price: body.price,
        quantity: body.quantity ?? 10,
        condition: 'NEW',
        imageUrls: body.imageUrls ?? [],
        categoryId: categoryId ?? undefined,
      });

      // Status in DB aktualisieren wenn vorhanden
      try {
        const { db, schema } = await import('../db/index').then(async m => {
          const schema = await import('../db/schema');
          return { db: m.db, schema };
        });
        await db.update(schema.products).set({
          ebayListingId: listingId,
          ebayStatus: 'listed',
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.products.asin, body.asin));
      } catch { /* DB optional */ }

      return c.json({ listingId, success: true }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      // Status in DB als error speichern
      try {
        const { db, schema } = await import('../db/index').then(async m => {
          const schema = await import('../db/schema');
          return { db: m.db, schema };
        });
        await db.update(schema.products).set({
          ebayStatus: 'error',
          ebayError: msg,
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.products.asin, body.asin));
      } catch { /* DB optional */ }

      return c.json({ error: msg }, 500);
    }
  })

  // ─── AliExpress ──────────────────────────────────────────────────────────────
  .get('/aliexpress/search', async (c) => {
    const keyword = c.req.query('q');
    const page = Number(c.req.query('page') || '1');
    if (!keyword) return c.json({ error: 'q fehlt' }, 400);
    try {
      const products = await searchProducts(keyword, page);
      return c.json({ products }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })

  .get('/aliexpress/product/:id', async (c) => {
    const productId = c.req.param('id');
    try {
      const detail = await getProductDetail(productId);
      if (!detail) return c.json({ error: 'Produkt nicht gefunden oder nicht aus EU-Lager' }, 404);
      return c.json(detail, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

export type AppType = typeof app;
export default app;
