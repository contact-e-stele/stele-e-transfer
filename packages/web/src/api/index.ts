import { Hono } from 'hono';
import { cors } from "hono/cors"
import { listOnEbay, suggestCategory, getOAuthUrl, exchangeCodeForToken } from './ebay';
import { scrapeAliExpressUrl } from './aliexpress';
import { getAliExpressOAuthUrl, exchangeAliCodeForToken, refreshAliToken, getAliProductByApi } from './aliexpress-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { eq } from 'drizzle-orm';
import { authRouter, authMiddleware } from './auth';

// ─── Beschreibung generieren (Gemini oder Fallback) ──────────────────────────
function generateFallbackDescription(title: string, specs: Record<string, string>): string {
  const specsEntries = Object.entries(specs).slice(0, 5);
  const specsText = specsEntries.map(([k, v]) => `${k}: ${v}`).join(' | ');
  let desc = `${title} – hochwertige Qualität für anspruchsvolle Anwendungen.`;
  if (specsText) desc += ` Technische Details: ${specsText}.`;
  desc += ' Schnelle Lieferung aus dem EU-Lager. Einfache Rückgabe innerhalb von 30 Tagen.';
  return desc;
}

async function generateDescriptionWithGemini(title: string, specs: Record<string, string>, description: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log('[Gemini] Kein API Key – nutze Fallback-Beschreibung');
    return generateFallbackDescription(title, specs);
  }
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const specsText = Object.entries(specs).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    const prompt = `Du bist ein eBay-Produkttexter für den deutschen Markt. Erstelle eine professionelle, verkaufsstarke Produktbeschreibung auf Deutsch.

Produkt: ${title}
${specsText ? `\nTechnische Daten:\n${specsText}` : ''}
${description ? `\nZusatzinfo: ${description.slice(0, 400)}` : ''}

Regeln:
- Maximal 5 kurze Sätze
- Keine Emojis, keine Sonderzeichen
- Keine Erwähnung von AliExpress, Amazon, China
- Kundenvorteil in den Vordergrund stellen
- Professioneller, sachlicher Ton
- Nur den Beschreibungstext ausgeben, keine Überschrift`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (e) {
    console.error('[Gemini] Fehler:', e);
    return generateFallbackDescription(title, specs);
  }
}

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
  .route('/auth', authRouter)
  .use('*', authMiddleware)
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

  // ─── AliExpress OAuth ────────────────────────────────────────────────────────
  .get('/aliexpress/auth', (c) => {
    const baseUrl = process.env.WEBSITE_URL || process.env.RENDER_EXTERNAL_URL || 'https://stele-e-transfer.onrender.com';
    const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/aliexpress/callback`;
    const state = Math.random().toString(36).slice(2);
    const url = getAliExpressOAuthUrl(redirectUri, state);
    console.log('[AliExpress OAuth] Redirect URI:', redirectUri);
    return c.redirect(url);
  })
  .get('/aliexpress/callback', async (c) => {
    const code = c.req.query('code');
    if (!code) return c.json({ error: 'Kein Code von AliExpress' }, 400);
    const baseUrl = process.env.WEBSITE_URL || process.env.RENDER_EXTERNAL_URL || 'https://stele-e-transfer.onrender.com';
    const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/aliexpress/callback`;
    const tokens = await exchangeAliCodeForToken(code, redirectUri);
    if (!tokens) return c.json({ error: 'Token-Exchange fehlgeschlagen' }, 500);
    console.log('[AliExpress OAuth] Access token obtained:', tokens.access_token.slice(0, 20) + '...');
    console.log('[AliExpress OAuth] Refresh token:', tokens.refresh_token.slice(0, 20) + '...');
    // In Produktion: Tokens in DB/Env speichern
    return c.html(`
      <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff">
        <h2 style="color:#C9A227">✅ AliExpress verbunden!</h2>
        <p>Access Token erhalten. Bitte diese Werte in den Render-Umgebungsvariablen speichern:</p>
        <p><b>ALIEXPRESS_ACCESS_TOKEN=</b><code style="color:#C9A227">${tokens.access_token}</code></p>
        <p><b>ALIEXPRESS_REFRESH_TOKEN=</b><code style="color:#C9A227">${tokens.refresh_token}</code></p>
        <p><small>Expires: ${tokens.expires_in}</small></p>
        <p><a href="/" style="color:#C9A227">Zurück zur App</a></p>
      </body></html>
    `);
  })
  .get('/aliexpress/status', async (c) => {
    const hasToken = !!(process.env.ALIEXPRESS_ACCESS_TOKEN);
    return c.json({ connected: hasToken, appKey: '535690' });
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
        images?: string[];
        buyPrice?: number | null;
        sellPrice?: number | null;
        sourceUrl?: string;
        specs?: Record<string, string>;
      };
      const existing = await db.select().from(schema.products).where(eq(schema.products.asin, body.asin)).limit(1);
      if (existing.length > 0) {
        await db.update(schema.products).set({
          generatedTitle: body.generatedTitle,
          htmlDescription: body.htmlDescription,
          bullets: JSON.stringify(body.bullets),
          variants: JSON.stringify(body.variants),
          images: body.images ? JSON.stringify(body.images) : undefined,
          buyPrice: body.buyPrice ?? undefined,
          sellPrice: body.sellPrice ?? undefined,
          specs: body.specs ? JSON.stringify(body.specs) : undefined,
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.products.asin, body.asin));
        return c.json({ id: existing[0].id, updated: true }, 200);
      }
      const result = await db.insert(schema.products).values({
        asin: body.asin,
        amazonUrl: body.amazonUrl,
        sourceUrl: body.sourceUrl ?? body.amazonUrl,
        title: body.title,
        generatedTitle: body.generatedTitle,
        htmlDescription: body.htmlDescription,
        bullets: JSON.stringify(body.bullets),
        variants: JSON.stringify(body.variants),
        description: body.description ?? '',
        images: body.images ? JSON.stringify(body.images) : '[]',
        buyPrice: body.buyPrice ?? null,
        sellPrice: body.sellPrice ?? null,
        specs: body.specs ? JSON.stringify(body.specs) : null,
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
    const body = await c.req.json() as { productId?: number };

    if (!body.productId) {
      return c.json({ error: 'productId fehlt' }, 400);
    }

    // Produkt aus DB laden
    const { db, schema } = await import('../db/index').then(async m => {
      const s = await import('../db/schema');
      return { db: m.db, schema: s };
    });

    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, body.productId));
    if (!product) return c.json({ error: 'Produkt nicht gefunden' }, 404);
    if (!product.sellPrice) return c.json({ error: 'Kein Verkaufspreis gesetzt — bitte VK Preis eintragen' }, 400);

    // Alten Fehler-Status zurücksetzen
    await db.update(schema.products).set({ ebayStatus: 'none', ebayError: null }).where(eq(schema.products.id, body.productId));

    // Bilder parsen
    const images: string[] = (() => { try { return JSON.parse(product.images ?? '[]') as string[]; } catch { return []; } })();
    if (images.length === 0) {
      return c.json({ error: 'Keine Bilder gespeichert — bitte Produkt neu importieren' }, 400);
    }

    // Versandinfo aus sourceUrl prüfen (shipsFrom aus gespeichertem Produkt)
    // Wir prüfen ob die sourceUrl eine EU-Versandinfo enthält
    const isEU = product.sourceUrl?.includes('ship_from=DE') ||
                 product.sourceUrl?.includes('ship_from=ES') ||
                 product.sourceUrl?.includes('ship_from=FR') ||
                 false;

    // Produktinhalt für die Vorlage
    const productTitle = (product.generatedTitle ?? product.title).slice(0, 80);

    // Specs als HTML-Tabelle aufbauen (aus product.specs JSON)
    const specsObj: Record<string, string> = (() => {
      try { return JSON.parse(product.specs ?? '{}') as Record<string, string>; } catch { return {}; }
    })();
    const specEntries = Object.entries(specsObj).slice(0, 12);
    let specsTableHtml = '';
    if (specEntries.length > 0) {
      const rows = specEntries.map(([k, v]) =>
        `<tr><td style="padding:6px 10px;color:#C9A84C;font-weight:bold;width:40%;border-bottom:1px solid #2a1a0a;">${k}</td><td style="padding:6px 10px;color:#a89050;border-bottom:1px solid #2a1a0a;">${v}</td></tr>`
      ).join('');
      specsTableHtml = `<table style="width:100%;border-collapse:collapse;margin:12px 0;">${rows}</table>`;
    }

    // HTML-Beschreibung nutzen — neue Vorlage enthält bereits alles (Header, Tabs, Footer)
    // Wenn htmlDescription mit unserer Vorlage beginnt → direkt verwenden, kein Wrapper
    const rawHtml = product.htmlDescription ?? '';
    const isFullTemplate = rawHtml.includes('STELE-E-TRANSFER') && rawHtml.includes('stet-tabs');

    let fullDescription: string;
    if (isFullTemplate) {
      // Neue vollständige Vorlage — direkt nutzen
      fullDescription = rawHtml;
    } else {
      // Fallback für ältere Einträge ohne neue Vorlage
      const productContent = rawHtml || `<p>${productTitle}</p>`;
      const shippingNote = isEU
        ? 'Lieferzeit 3-10 Werktage<br />Versand per DHL / Deutsche Post'
        : 'Lieferzeit 10-25 Werktage<br />Versand per Direktversand';
      fullDescription = `<div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#e8d5a0;background:#0a0a0a;border:1px solid #C9A84C;border-radius:8px">
<div style="background:#111;padding:14px;text-align:center;border-bottom:2px solid #C9A84C"><div style="color:#C9A84C;font-size:20px;font-weight:bold;letter-spacing:4px">STELE-E-TRANSFER</div><div style="color:#8a7040;font-size:11px;margin-top:4px">PREMIUM QUALITAET &middot; SCHNELLE LIEFERUNG</div></div>
<table width="100%" style="background:#111;border-collapse:collapse"><tr>
<td width="33%" style="padding:12px;text-align:center;border-right:1px solid #C9A84C"><b style="color:#C9A84C;font-size:12px">KOSTENLOSER VERSAND</b><br><small style="color:#8a7040">${shippingNote}</small></td>
<td width="33%" style="padding:12px;text-align:center;border-right:1px solid #C9A84C"><b style="color:#C9A84C;font-size:12px">30 TAGE R&Uuml;CKGABE</b><br><small style="color:#8a7040">K&auml;uferschutz &uuml;ber eBay</small></td>
<td width="34%" style="padding:12px;text-align:center"><b style="color:#C9A84C;font-size:12px">KUNDENSERVICE</b><br><small style="color:#8a7040">contact@stele-e-transfer.com</small></td>
</tr></table>
<div style="padding:18px;background:#0f0f07;color:#a89050;border-top:1px solid #C9A84C"><h3 style="color:#C9A84C;border-bottom:1px solid #3a2a0a;padding-bottom:6px;margin-top:0">${productTitle}</h3>${specsTableHtml}${productContent}<p style="font-size:11px;color:#5a4a20"><b>&sect;19 UStG:</b> Keine MwSt. als Kleinunternehmer.</p></div>
<div style="padding:14px;background:#0a0a0a;color:#a89050;border-top:1px solid #3a2a0a"><b style="color:#C9A84C">Versand:</b> Kostenlos &middot; 3-10 Werktage &middot; DHL/Deutsche Post &middot; 30 Tage R&uuml;ckgabe</div>
<div style="padding:14px;background:#0f0f07;color:#a89050;border-top:1px solid #3a2a0a"><b style="color:#C9A84C">GPSR:</b> Stele-E-Transfer | Evgenij Stele | Am Hochfeld 47, 65205 Wiesbaden | contact@stele-e-transfer.com | +49 159 04826737</div>
<div style="padding:14px;background:#0a0a0a;color:#a89050;border-top:1px solid #3a2a0a"><b style="color:#C9A84C">Impressum:</b> STELE-E-TRANSFER | Evgenij Stele | Am Hochfeld 47, 65205 Wiesbaden | &sect;19 UStG: Keine MwSt.</div>
<div style="background:#111;padding:10px;text-align:center;border-top:2px solid #C9A84C"><span style="color:#C9A84C;font-size:11px;letter-spacing:4px;font-weight:bold">STELE-E-TRANSFER</span> <span style="color:#5a4a20;font-size:10px">WIESBADEN &middot; DEUTSCHLAND</span></div>
</div>`;
    }

    try {
      const categoryId = await suggestCategory(product.generatedTitle ?? product.title).catch(() => null);

      // Varianten parsen
      const variantGroups: Array<{ name: string; values: string[] }> = (() => {
        try {
          const parsed = JSON.parse(product.variants ?? '[]');
          if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && 'name' in parsed[0]) {
            return parsed as Array<{ name: string; values: string[] }>;
          }
        } catch { /* ignore */ }
        return [];
      })();

      // Specs parsen für dynamische eBay Aspekte
      const specs: Record<string, string> = (() => {
        try { return JSON.parse(product.specs ?? '{}') as Record<string, string>; } catch { return {}; }
      })();

      // MPN = AliExpress Produkt-ID aus sourceUrl
      const mpn = product.sourceUrl
        ? (product.sourceUrl.match(/\/item\/(\d+)\.html/)?.[1] ?? product.sourceUrl.match(/productId=(\d+)/)?.[1] ?? undefined)
        : undefined;

      const listingId = await listOnEbay({
        sku: `${product.id}-${Date.now()}-ALI`,
        title: (product.generatedTitle ?? product.title).slice(0, 80),
        description: fullDescription,
        price: product.sellPrice,
        quantity: 3,
        condition: 'NEW',
        imageUrls: images.slice(0, 8),
        categoryId: categoryId ?? undefined,
        variantGroups: variantGroups.length > 0 ? variantGroups : undefined,
        specs,
        mpn,
      });

      await db.update(schema.products).set({
        ebayListingId: listingId,
        ebayStatus: 'listed',
        ebayError: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.products.id, body.productId));

      return c.json({ listingId, success: true }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      await db.update(schema.products).set({
        ebayStatus: 'error',
        ebayError: msg,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.products.id, body.productId));

      return c.json({ error: msg }, 500);
    }
  })

  // ─── AliExpress URL Scraper ───────────────────────────────────────────────────
  .post('/aliexpress/scrape', async (c) => {
    const body = await c.req.json() as { url?: string };
    const url = body?.url?.trim();
    if (!url) return c.json({ error: 'url fehlt' }, 400);
    if (!url.includes('aliexpress')) return c.json({ error: 'Keine AliExpress-URL' }, 400);

    // Extract product ID from URL
    const productIdMatch = url.match(/\/item\/(\d+)\.html/) || url.match(/[?&]id=(\d+)/);
    const productId = productIdMatch?.[1];

    // Try AliExpress DS API first (official, reliable) if access_token available
    const accessToken = process.env.ALIEXPRESS_ACCESS_TOKEN;
    if (accessToken && productId) {
      console.log(`[AliExpress] Using DS API for product ${productId}`);
      const apiData = await getAliProductByApi(productId, accessToken);
      if (apiData) {
        const aiDesc = await generateDescriptionWithGemini(apiData.title, apiData.specs ?? {}, apiData.description ?? '');
        if (aiDesc) apiData.description = aiDesc;
        return c.json(apiData, 200);
      }
      console.log('[AliExpress] DS API failed, falling back to scraper...');
    }

    // Fallback: scraper
    const data = await scrapeAliExpressUrl(url);
    if (!data) return c.json({ error: 'AliExpress-Seite konnte nicht geladen werden. Bitte direkte Produkt-URL verwenden (z.B. https://de.aliexpress.com/item/XXXX.html). Für bessere Ergebnisse AliExpress-Verbindung in den Einstellungen aktivieren.' }, 503);

    // Gemini Beschreibung automatisch generieren
    const aiDescription = await generateDescriptionWithGemini(data.title, data.specs, data.description);
    if (aiDescription) {
      console.log('[Gemini] Beschreibung generiert:', aiDescription.slice(0, 80));
      data.description = aiDescription;
    }

    return c.json(data, 200);
  })

  // ─── Preis-Update für einzelnes Produkt ──────────────────────────────────────
  .patch('/products/:id/price', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    const body = await c.req.json() as { buyPrice?: number };
    if (!body.buyPrice || body.buyPrice <= 0) return c.json({ error: 'buyPrice fehlt' }, 400);

    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });

      // Alten Preis holen
      const existing = await db.select().from(schema.products).where(eq(schema.products.id, id)).limit(1);
      if (existing.length === 0) return c.json({ error: 'Produkt nicht gefunden' }, 404);
      const old = existing[0];
      const priceChanged = old.buyPrice !== null && Math.abs((old.buyPrice ?? 0) - body.buyPrice) > 0.01;

      // Preis-Historie speichern
      await db.insert(schema.priceHistory).values({
        productId: id,
        price: body.buyPrice,
        source: 'aliexpress',
      });

      // Produkt aktualisieren
      await db.update(schema.products).set({
        buyPrice: body.buyPrice,
        lastPriceCheck: new Date().toISOString(),
        priceChanged: priceChanged,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.products.id, id));

      return c.json({ ok: true, priceChanged, oldPrice: old.buyPrice, newPrice: body.buyPrice }, 200);
    } catch (e) {
      console.error('Price update error:', e);
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })

  // ─── VK Preis setzen ─────────────────────────────────────────────────────────
  .patch('/products/:id/title', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    const body = await c.req.json() as { generatedTitle?: string };
    if (!body.generatedTitle?.trim()) return c.json({ error: 'generatedTitle fehlt' }, 400);
    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      await db.update(schema.products).set({
        generatedTitle: body.generatedTitle.trim().slice(0, 80),
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.products.id, id));
      return c.json({ ok: true }, 200);
    } catch (e) {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })

  .patch('/products/:id/sellprice', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    const body = await c.req.json() as { sellPrice?: number };
    if (!body.sellPrice || body.sellPrice <= 0) return c.json({ error: 'sellPrice fehlt' }, 400);

    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      await db.update(schema.products).set({
        sellPrice: body.sellPrice,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.products.id, id));
      return c.json({ ok: true }, 200);
    } catch (e) {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })

  // ─── Produkt aus DB löschen ──────────────────────────────────────────────────
  .delete('/products/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      await db.delete(schema.priceHistory).where(eq(schema.priceHistory.productId, id));
      await db.delete(schema.products).where(eq(schema.products.id, id));
      return c.json({ ok: true }, 200);
    } catch (e) {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })

  // ─── eBay Listing beenden ────────────────────────────────────────────────────
  .delete('/products/:id/ebay-listing', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id));
      if (!product) return c.json({ error: 'Produkt nicht gefunden' }, 404);
      if (!product.ebayListingId) return c.json({ error: 'Kein aktives eBay Listing' }, 400);

      // eBay Listing beenden via Trading API
      const token = await (await import('./ebay')).getAccessToken();
      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <ItemID>${product.ebayListingId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndItemRequest>`;

      const res = await fetch('https://api.ebay.com/ws/api.dll', {
        method: 'POST',
        headers: {
          'X-EBAY-API-SITEID': '77',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-CALL-NAME': 'EndItem',
          'Content-Type': 'text/xml',
        },
        body: xmlBody,
      });
      const text = await res.text();
      const success = text.includes('<Ack>Success</Ack>') || text.includes('<Ack>Warning</Ack>');

      // DB Status zurücksetzen
      await db.update(schema.products).set({
        ebayListingId: null,
        ebayStatus: 'none',
        ebayError: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.products.id, id));

      if (!success) {
        // Auch bei eBay-Fehler DB zurücksetzen — Listing war evtl. schon abgelaufen
        console.warn('[eBay EndItem]', text.slice(0, 300));
      }

      return c.json({ ok: true }, 200);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Fehler' }, 500);
    }
  })

  // ─── Varianten speichern ─────────────────────────────────────────────────────
  .patch('/products/:id/variants', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    const body = await c.req.json() as { variants?: Array<{ name: string; values: string[] }> };
    if (!Array.isArray(body.variants)) return c.json({ error: 'variants fehlt' }, 400);
    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      await db.update(schema.products).set({
        variants: JSON.stringify(body.variants),
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.products.id, id));
      return c.json({ ok: true }, 200);
    } catch (e) {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })

  // ─── Preis-Historie abrufen ──────────────────────────────────────────────────
  .get('/products/:id/price-history', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      const history = await db.select().from(schema.priceHistory)
        .where(eq(schema.priceHistory.productId, id))
        .orderBy(schema.priceHistory.checkedAt);
      return c.json(history, 200);
    } catch (e) {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })

  // ─── eBay Retouren ───────────────────────────────────────────────────────────
  .get('/ebay/returns', async (c) => {
    try {
      const token = await (await import('./ebay')).getAccessToken();
      const res = await fetch(
        'https://api.ebay.com/post-order/v2/return?limit=50&status=OPEN,IN_PROGRESS',
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE',
          },
        }
      );
      if (!res.ok) throw new Error(`eBay Returns API: ${res.status}`);
      const data = await res.json() as {
        returns?: Array<{
          returnId: string;
          orderId: string;
          title?: string;
          buyerLoginName?: string;
          reason?: { reasonDescription?: string };
          state?: { name?: string };
          creationDate?: string;
          returnedItemPrice?: { value?: string; currency?: string };
        }>;
      };
      const mapped = (data.returns ?? []).map(r => ({
        returnId: r.returnId,
        orderId: r.orderId,
        itemTitle: r.title ?? 'Unbekanntes Produkt',
        buyerName: r.buyerLoginName ?? 'Unbekannt',
        reason: r.reason?.reasonDescription ?? 'Kein Grund angegeben',
        status: (r.state?.name ?? 'OPEN') as 'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'REFUNDED',
        createdAt: r.creationDate ?? new Date().toISOString(),
        amount: parseFloat(r.returnedItemPrice?.value ?? '0'),
        currency: r.returnedItemPrice?.currency ?? 'EUR',
      }));
      return c.json(mapped, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 503);
    }
  })
  .post('/ebay/returns/:returnId/refund', async (c) => {
    const returnId = c.req.param('returnId');
    try {
      const token = await (await import('./ebay')).getAccessToken();
      const res = await fetch(
        `https://api.ebay.com/post-order/v2/return/${returnId}/issue_refund`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE',
          },
          body: JSON.stringify({ refundDetail: { itemizedRefundDetail: [] } }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Refund failed: ${res.status} ${text}`);
      }
      return c.json({ success: true }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })

  // ─── Alle Preise aktualisieren (Batch) ───────────────────────────────────────
  .get('/ebay/policies', async (c) => {
    try {
      const { getAccessToken } = await import('./ebay');
      const token = await getAccessToken();
      const BASE_URL = process.env.EBAY_SANDBOX === 'true' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';

      const [fp, pp, rp] = await Promise.all([
        fetch(`${BASE_URL}/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
        fetch(`${BASE_URL}/sell/account/v1/payment_policy?marketplace_id=EBAY_DE`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
        fetch(`${BASE_URL}/sell/account/v1/return_policy?marketplace_id=EBAY_DE`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
      ]);

      return c.json({ fulfillment: fp, payment: pp, return: rp }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })

  .post('/ebay/setup-location', async (c) => {
    try {
      const { getAccessToken } = await import('./ebay');
      const token = await getAccessToken();
      const BASE_URL = process.env.EBAY_SANDBOX === 'true' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';

      const body = {
        location: {
          address: {
            addressLine1: 'Am Hochfeld 47',
            city: 'Wiesbaden',
            stateOrProvince: 'Hessen',
            postalCode: '65205',
            country: 'DE',
          },
        },
        locationTypes: ['WAREHOUSE'],
        name: 'Stele E-Transfer Lager',
        merchantLocationStatus: 'ENABLED',
      };

      const res = await fetch(`${BASE_URL}/sell/inventory/v1/location/default`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Language': 'de-DE',
        },
        body: JSON.stringify(body),
      });

      const resText = await res.text();
      // 409 = already exists, 400 mit "already exists" = auch ok
      const alreadyExists = res.status === 409 || resText.includes('already exists');
      if (!res.ok && !alreadyExists) {
        return c.json({ error: `Location setup failed: ${res.status} ${resText}` }, 500);
      }
      return c.json({ ok: true, status: alreadyExists ? 'already_exists' : 'created' }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })

  .post('/products/check-all-prices', async (c) => {
    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      const all = await db.select().from(schema.products);
      const results: { id: number; title: string; status: string; oldPrice?: number | null; newPrice?: number }[] = [];

      for (const product of all) {
        const url = product.sourceUrl || product.amazonUrl;
        if (!url || url === 'manual' || !url.includes('aliexpress')) {
          results.push({ id: product.id, title: product.generatedTitle, status: 'skipped' });
          continue;
        }
        try {
          // Try DS API first if token available
          const accessToken = process.env.ALIEXPRESS_ACCESS_TOKEN;
          const productIdMatch = url.match(/\/item\/(\d+)\.html/) || url.match(/[?&]id=(\d+)/);
          const productId = productIdMatch?.[1];
          let scraped = null;
          if (accessToken && productId) {
            scraped = await getAliProductByApi(productId, accessToken);
          }
          if (!scraped) {
            scraped = await scrapeAliExpressUrl(url);
          }
          if (!scraped?.price) {
            results.push({ id: product.id, title: product.generatedTitle, status: 'no_price' });
            continue;
          }
          const newPrice = parseFloat(scraped.price.replace(/[^0-9.]/g, ''));
          if (isNaN(newPrice) || newPrice <= 0) {
            results.push({ id: product.id, title: product.generatedTitle, status: 'parse_error' });
            continue;
          }
          const priceChanged = product.buyPrice !== null && Math.abs((product.buyPrice ?? 0) - newPrice) > 0.01;
          await db.insert(schema.priceHistory).values({ productId: product.id, price: newPrice, source: 'aliexpress' });
          await db.update(schema.products).set({
            buyPrice: newPrice,
            lastPriceCheck: new Date().toISOString(),
            priceChanged,
            updatedAt: new Date().toISOString(),
          }).where(eq(schema.products.id, product.id));
          results.push({ id: product.id, title: product.generatedTitle, status: priceChanged ? 'changed' : 'unchanged', oldPrice: product.buyPrice, newPrice });
        } catch {
          results.push({ id: product.id, title: product.generatedTitle, status: 'error' });
        }
        // Kurze Pause um AliExpress nicht zu spammen
        await new Promise(r => setTimeout(r, 1500));
      }

      return c.json({ checked: results.length, results }, 200);
    } catch (e) {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  });

app.get('/backup/test', async (c) => {
  const { runBackup } = await import('./backup');
  const result = await runBackup();
  if (!result.ok) return c.json({ success: false, error: result.error }, 500);
  return c.json({ success: true, message: `Backup gesendet — ${result.productCount} Produkte` }, 200);
});

// Alias für GitHub Actions Workflow
app.get('/backup/run', async (c) => {
  const { runBackup } = await import('./backup');
  const result = await runBackup();
  if (!result.ok) return c.json({ success: false, error: result.error }, 500);
  return c.json({ success: true, message: `Backup gesendet — ${result.productCount} Produkte` }, 200);
});

export type AppType = typeof app;
export default app;
