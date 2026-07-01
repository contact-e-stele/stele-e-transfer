import { Hono } from 'hono';
import { cors } from "hono/cors"
import { listOnEbay, suggestCategory, getOAuthUrl, exchangeCodeForToken, getAllSellerListings } from './ebay';
import { buildEbayHTMLLight, type ScrapedProduct as EbayScrapedProduct } from '../web/lib/ebay-description';
import { scrapeAliExpressUrl } from './aliexpress';
import { getAliExpressOAuthUrl, exchangeAliCodeForToken, refreshAliToken, getAliProductByApi } from './aliexpress-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { eq } from 'drizzle-orm';
import { authRouter, authMiddleware } from './auth';

// ─── AliExpress Token Helper ──────────────────────────────────────────────────
// Liest Token aus DB (app_settings) oder Env-Variable als Fallback
async function getAliAccessToken(): Promise<string | null> {
  // 1) Env-Variable (gesetzt in Render oder lokal)
  if (process.env.ALIEXPRESS_ACCESS_TOKEN) return process.env.ALIEXPRESS_ACCESS_TOKEN;
  // 2) DB (gespeichert nach OAuth-Login)
  try {
    const { db } = await import('../db/index');
    const { appSettings } = await import('../db/schema');
    const row = await db.select().from(appSettings).where(eq(appSettings.key, 'aliexpress_access_token')).get();
    if (row?.value) return row.value;
  } catch { /* DB nicht verfügbar */ }
  return null;
}

async function saveAliTokens(accessToken: string, refreshToken: string, expiresAt: number): Promise<void> {
  try {
    const { db } = await import('../db/index');
    const { appSettings } = await import('../db/schema');
    const now = new Date().toISOString();
    await db.insert(appSettings).values({ key: 'aliexpress_access_token', value: accessToken, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: accessToken, updatedAt: now } });
    await db.insert(appSettings).values({ key: 'aliexpress_refresh_token', value: refreshToken, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: refreshToken, updatedAt: now } });
    await db.insert(appSettings).values({ key: 'aliexpress_token_expires', value: String(expiresAt), updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: String(expiresAt), updatedAt: now } });
    console.log('[AliExpress OAuth] Tokens in DB gespeichert ✓');
  } catch (e) {
    console.error('[AliExpress OAuth] Token-Speicherung in DB fehlgeschlagen:', e);
  }
}

// ─── Beschreibung generieren (Gemini oder Fallback) ──────────────────────────
function generateFallbackDescription(
  title: string,
  specs: Record<string, string>,
  rawDescription?: string,
  setContents?: Record<string, string>
): string {
  // Intro: Produkttitel sauber formulieren
  const cleanTitle = title.replace(/\(.*?\)/g, '').trim();
  const intro = `${cleanTitle} – solide Verarbeitungsqualität für den täglichen Einsatz.`;

  // Bullets: aus Specs + Set-Inhalte
  const bullets: string[] = [];

  // Bis zu 6 Specs als Bullets
  for (const [k, v] of Object.entries(specs).slice(0, 6)) {
    bullets.push(`${k}: ${v}`);
  }

  // Fehlende Bullets mit rawDescription-Sätzen auffüllen (falls vorhanden)
  if (rawDescription && bullets.length < 4) {
    const sentences = rawDescription
      .replace(/<[^>]*>/g, ' ')
      .split(/[.;]\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 120 && !/aliexpress|amazon|china/i.test(s));
    for (const s of sentences.slice(0, 4 - bullets.length)) {
      bullets.push(s);
    }
  }

  // Set-Inhalte als eigenen Bullet
  if (setContents && Object.keys(setContents).length > 0) {
    const setLine = Object.entries(setContents).map(([k, v]) => `${k}: ${v}`).join(' | ');
    bullets.push(`Lieferumfang je Variante: ${setLine}`);
  }

  // Immer mindestens 3 Bullets — Filler wenn nötig
  if (bullets.length < 3) {
    bullets.push('Schnelle Lieferung aus dem EU-Lager');
    bullets.push('30 Tage Rückgabe über eBay Käuferschutz');
  }

  // Outro
  const outro = 'Für zuverlässigen Einsatz im Alltag – einfache Handhabung und schnelle Lieferung.';

  return [
    '###INTRO###',
    intro,
    '###BULLETS###',
    ...bullets.map(b => `- ${b}`),
    '###OUTRO###',
    outro,
  ].join('\n');
}

// Modelle in Reihenfolge: primary zuerst, dann Fallback-Modelle bei 503
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash-lite'];

async function generateDescriptionWithGemini(title: string, specs: Record<string, string>, description: string, retries = 3, setContents?: Record<string, string>): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log('[Gemini] Kein API Key – nutze Fallback-Beschreibung');
    return generateFallbackDescription(title, specs, description, setContents);
  }

  const specsText = Object.entries(specs).slice(0, 15).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  
  // SET-Inhalte formatieren falls vorhanden
  const setContentsText = setContents && Object.keys(setContents).length > 0
    ? '\nLIEFERUMFANG JE SET:\n' + Object.entries(setContents).map(([k, v]) => `- ${k}: ${v}`).join('\n')
    : '';

  const prompt = `Du bist ein Top-eBay-Produkttexter für den deutschen Markt. Deine Beschreibungen sind sachlich, überzeugend und basieren NUR auf echten Produktdaten.

PRODUKTTITEL: ${title}
${specsText ? `\nTECHNISCHE DATEN (alle verwenden!):\n${specsText}` : ''}
${setContentsText}
${description ? `\nPRODUKTINFO VOM HERSTELLER:\n${description.slice(0, 1200)}` : ''}

AUFGABE: Erstelle eine strukturierte eBay-Beschreibung auf Deutsch. Nutze ALLE verfügbaren Produktinfos oben.

FORMAT (exakt so zurückgeben, mit den Trennzeichen):
###INTRO###
[1 starker Einleitungssatz: Was ist das Produkt, für wen, welcher Hauptnutzen – max. 25 Wörter]
###BULLETS###
- [konkretes Feature/Vorteil mit echten Daten, z.B. Maße, Material, Funktion]
- [konkretes Feature/Vorteil]
- [konkretes Feature/Vorteil]
- [konkretes Feature/Vorteil]
${setContentsText ? '- Lieferumfang je Set: [alle Set-Inhalte aus LIEFERUMFANG JE SET oben aufführen, z.B. "SET1: 10 kleine + 10 große + Schraubendreher + Gummistreifen"]' : '- [konkretes Feature/Vorteil]'}
- [konkretes Feature/Vorteil, wenn möglich Anwendungsbereich]
###OUTRO###
[1 Abschlusssatz: Qualität + Einsatzbereich – max. 20 Wörter]

REGELN (unbedingt einhalten):
- Nur echte Infos aus den Produktdaten – KEIN generisches "hochwertig", "perfekt" ohne Beleg
- Keine Emojis, kein Markdown (kein **, kein #)
- NICHT erwähnen: AliExpress, China, Amazon, Händlername
- EU-Maße: cm statt inch, ml statt oz, Komma als Dezimalzeichen
- Wenn LIEFERUMFANG JE SET vorhanden: ALLE Sets mit ihren Inhalten im Bullet aufführen
- Anwendungsbereich konkret nennen (Auto, Motorrad, LKW etc.) wenn aus Produktinfo ersichtlich
- Sprache: sachlich, direkt, kein Marketingsprech`;


  // Versuche jedes Modell nacheinander (Fallback bei 503/Überlastung)
  for (const modelName of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        console.log(`[Gemini] Beschreibung generiert (Modell: ${modelName}, Versuch ${attempt})`);
        return text;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const is503 = msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('overloaded');
        const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
        console.error(`[Gemini] ${modelName} Versuch ${attempt}/${retries} fehlgeschlagen:`, msg.slice(0, 120));

        if (attempt < retries) {
          // Exponential Backoff: 5s, 10s, 20s — länger bei 503
          const waitMs = (is503 || isQuota) ? 5000 * attempt : 2000 * attempt;
          console.log(`[Gemini] Warte ${waitMs / 1000}s vor Versuch ${attempt + 1}…`);
          await new Promise(r => setTimeout(r, waitMs));
        } else if (is503 || isQuota) {
          // Modell überlastet → nächstes Modell versuchen
          console.log(`[Gemini] ${modelName} überlastet → versuche nächstes Modell`);
          break; // aus dem attempt-Loop raus, nächstes Modell
        }
      }
    }
  }

  console.log('[Gemini] Alle Modelle fehlgeschlagen – nutze Fallback');
  return generateFallbackDescription(title, specs, description, setContents);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Deutschen eBay-Titel generieren (max. 80 Zeichen) ────────────────────────
async function generateGermanTitle(rawTitle: string, specs: Record<string, string>): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return rawTitle.slice(0, 80);

  const specsHint = Object.entries(specs).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(', ');
  const prompt = `Du bist ein eBay-Titeltexter für den deutschen Markt.

AUFGABE: Übersetze und optimiere diesen englischen Produkttitel für eBay Deutschland.
Englischer Rohtitel: "${rawTitle}"
${specsHint ? `Produktinfos: ${specsHint}` : ''}

REGELN:
- Ausgabe: NUR der fertige deutsche eBay-Titel, keine Erklärung, kein Kommentar
- Sprache: Deutsch
- Länge: exakt 75-80 Zeichen (sehr wichtig – eBay nutzt alle 80 Zeichen)
- Keine Mengenangaben (Stück, Set, Pack)
- Keine Maße/Größen (werden als Varianten gelistet)
- Keine Sonderzeichen, keine Emojis
- Wichtigste Keywords vorne
- Kein AliExpress, China, Amazon, Markenname
- Sachlich, klar, verkaufsstark`;

  for (const modelName of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim().replace(/^["']|["']$/g, '').slice(0, 80);
        console.log(`[Gemini-Titel] "${text}" (${text.length} Zeichen)`);
        return text;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const is503 = msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('overloaded');
        if (attempt < 2) await new Promise(r => setTimeout(r, is503 ? 5000 : 2000));
        else if (is503) break; // nächstes Modell
      }
    }
  }
  // Fallback: Rohtitel kürzen
  return rawTitle.slice(0, 80);
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

  // ─── eBay alle Listings abrufen (Server-Cache 10 Min) ───────────────────────
  // In-Memory Cache damit der Browser nicht auf eBay API warten muss
  .get('/ebay/listings', async (c) => {
    // Cache
    const CACHE_TTL = 10 * 60 * 1000; // 10 Minuten
    const cacheKey = 'ebay_listings';
    const cached = (globalThis as Record<string, unknown>)[cacheKey] as { ts: number; data: unknown } | undefined;
    const forceRefresh = c.req.query('refresh') === '1';

    let ebayListings;
    if (!forceRefresh && cached && (Date.now() - cached.ts) < CACHE_TTL) {
      console.log('[eBay listings] Serving from cache');
      ebayListings = cached.data;
    } else {
      ebayListings = await getAllSellerListings();
      (globalThis as Record<string, unknown>)[cacheKey] = { ts: Date.now(), data: ebayListings };
    }

    try {

      // DB importieren
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });

      // App-DB Produkte laden (für Match)
      const dbProducts = await db.select({
        id: schema.products.id,
        ebayListingId: schema.products.ebayListingId,
        buyPrice: schema.products.buyPrice,
        sellPrice: schema.products.sellPrice,
        asin: schema.products.asin,
        sourceUrl: schema.products.sourceUrl,
        generatedTitle: schema.products.generatedTitle,
        adRate: schema.products.adRate,
      }).from(schema.products).all();

      // Index: ebayListingId → DB-Produkt
      const dbByListingId = new Map(
        dbProducts.filter(p => p.ebayListingId).map(p => [p.ebayListingId!, p])
      );

      // Match zusammenführen — Response schlank halten (nur 1 Bild pro Listing)
      const listings = ebayListings as import('./ebay').EbaySellerListing[];
      const merged = listings.map(listing => ({
        ...listing,
        appProduct: dbByListingId.get(listing.itemId) ?? null,
      }));

      // Paginierung via Query-Param ?page=1&limit=100
      const pageParam = parseInt(c.req.query('page') ?? '1');
      const limitParam = Math.min(parseInt(c.req.query('limit') ?? '335'), 335);
      const start = (pageParam - 1) * limitParam;
      const paginated = merged.slice(start, start + limitParam);

      return c.json({ listings: paginated, total: merged.length, page: pageParam, pages: Math.ceil(merged.length / limitParam) }, 200);
    } catch (e) {
      console.error('[eBay listings]', e);
      return c.json({ error: String(e) }, 500);
    }
  })

  // ─── eBay Listing Preis aktualisieren ────────────────────────────────────────
  .patch('/ebay/listings/:itemId/price', async (c) => {
    const itemId = c.req.param('itemId');
    const body = await c.req.json<{ price: number }>();
    if (!body.price || body.price <= 0) return c.json({ error: 'Ungültiger Preis' }, 400);

    try {
      const token = await (await import('./ebay')).getAccessToken();
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <InventoryStatus>
    <ItemID>${itemId}</ItemID>
    <StartPrice>${body.price.toFixed(2)}</StartPrice>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;

      const res = await fetch('https://api.ebay.com/ws/api.dll', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-SITEID': '77',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus',
          'X-EBAY-API-APP-NAME': process.env.EBAY_CLIENT_ID ?? '',
        },
        body: xml,
      });

      const text = await res.text();
      const hasError = text.includes('<Ack>Failure</Ack>');
      if (hasError) {
        const errMsg = text.match(/<LongMessage>([^<]*)<\/LongMessage>/)?.[1] ?? 'Unbekannter Fehler';
        return c.json({ error: errMsg }, 400);
      }

      // Auch in DB aktualisieren wenn Produkt verknüpft
      const dbProduct = await db.select().from(schema.products)
        .where(eq(schema.products.ebayListingId, itemId)).get();
      if (dbProduct) {
        await db.update(schema.products).set({ sellPrice: body.price }).where(eq(schema.products.ebayListingId, itemId));
      }

      return c.json({ ok: true, newPrice: body.price }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })

  // ─── eBay Listing pausieren/beenden (via itemId direkt) ──────────────────────
  .delete('/ebay/listings/:itemId', async (c) => {
    const itemId = c.req.param('itemId');
    try {
      const token = await (await import('./ebay')).getAccessToken();
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndItemRequest>`;

      const res = await fetch('https://api.ebay.com/ws/api.dll', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-SITEID': '77',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-CALL-NAME': 'EndItem',
          'X-EBAY-API-APP-NAME': process.env.EBAY_CLIENT_ID ?? '',
        },
        body: xml,
      });

      const text = await res.text();
      const hasError = text.includes('<Ack>Failure</Ack>');

      // DB-Produkt auch updaten wenn verknüpft
      const dbProduct = await db.select().from(schema.products)
        .where(eq(schema.products.ebayListingId, itemId)).get();
      if (dbProduct) {
        await db.update(schema.products).set({
          ebayListingId: null, ebayStatus: 'none', ebayError: null
        }).where(eq(schema.products.ebayListingId, itemId));
      }

      if (hasError) {
        const errMsg = text.match(/<LongMessage>([^<]*)<\/LongMessage>/)?.[1] ?? 'Fehler';
        return c.json({ warning: errMsg }, 200);
      }
      return c.json({ ok: true }, 200);
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
    // Token automatisch in DB speichern
    await saveAliTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
    return c.html(`
      <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff;font-family:Montserrat,sans-serif">
        <h2 style="color:#C9A227">✅ AliExpress erfolgreich verbunden!</h2>
        <p>Token wurde automatisch gespeichert. Die App nutzt ab sofort die offizielle AliExpress API für alle Produktdaten inkl. Varianten-Preise.</p>
        <hr style="border-color:#333;margin:20px 0">
        <p style="color:#888;font-size:12px">Falls nötig, kannst du den Token auch manuell in Render hinterlegen:</p>
        <p style="font-size:11px"><b>ALIEXPRESS_ACCESS_TOKEN=</b><code style="color:#C9A227;word-break:break-all">${tokens.access_token}</code></p>
        <p style="font-size:11px"><b>ALIEXPRESS_REFRESH_TOKEN=</b><code style="color:#C9A227;word-break:break-all">${tokens.refresh_token}</code></p>
        <br>
        <a href="/" style="color:#C9A227;font-weight:bold">→ Zurück zur App</a>
      </body></html>
    `);
  })
  .get('/aliexpress/status', async (c) => {
    const token = await getAliAccessToken();
    const hasToken = !!token;
    const source = process.env.ALIEXPRESS_ACCESS_TOKEN ? 'env' : hasToken ? 'db' : 'none';
    // Token-Ablauf aus DB lesen
    let expiresAt: number | null = null;
    let refreshToken: string | null = null;
    try {
      const { db: database } = await import('../db/index');
      const { appSettings } = await import('../db/schema');
      const expRow = await database.select().from(appSettings).where(eq(appSettings.key, 'aliexpress_token_expires')).get();
      const refRow = await database.select().from(appSettings).where(eq(appSettings.key, 'aliexpress_refresh_token')).get();
      if (expRow?.value) expiresAt = Number(expRow.value);
      if (refRow?.value) refreshToken = refRow.value;
    } catch { /* ignore */ }
    return c.json({ connected: hasToken, appKey: '535690', source, expiresAt, hasRefreshToken: !!refreshToken });
  })

  .post('/aliexpress/refresh', async (c) => {
    // Refresh Token aus DB holen und neuen Access Token besorgen
    try {
      const { db: database } = await import('../db/index');
      const { appSettings } = await import('../db/schema');
      const refRow = await database.select().from(appSettings).where(eq(appSettings.key, 'aliexpress_refresh_token')).get();
      if (!refRow?.value) return c.json({ error: 'Kein Refresh Token in DB — bitte neu verbinden' }, 400);
      const tokens = await refreshAliToken(refRow.value);
      if (!tokens) return c.json({ error: 'Refresh fehlgeschlagen — Token möglicherweise abgelaufen. Bitte neu verbinden.' }, 502);
      const expiresAt = Date.now() + tokens.expires_in * 1000;
      await saveAliTokens(tokens.access_token, tokens.refresh_token, expiresAt);
      return c.json({ ok: true, expiresAt });
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
        variantPrices?: Array<{ skuId: string; attrs: Record<string, string>; price: number; originalPrice?: number; stock?: number; imageUrl?: string; ebayPrice?: number }>;
        description?: string;
        images?: string[];
        buyPrice?: number | null;
        sellPrice?: number | null;
        adRate?: number;
        sourceUrl?: string;
        specs?: Record<string, string>;
        variantContents?: Record<string, string>;
        gpsrRaw?: string;
        gpsrHtml?: string;
        shipsFrom?: string;
      };

      // Titel + Beschreibung parallel generieren (schneller)
      const specs = body.specs ?? {};
      const rawTitle = body.generatedTitle ?? body.title;

      const [germanTitle, generatedDescription] = await Promise.all([
        generateGermanTitle(rawTitle, specs),
        generateDescriptionWithGemini(rawTitle, specs, body.description ?? '', 3, body.variantContents),
      ]);
      console.log(`[Import] Titel: "${germanTitle}" | Beschreibung generiert`);

      const existing = await db.select().from(schema.products).where(eq(schema.products.asin, body.asin)).limit(1);
      if (existing.length > 0) {
        await db.update(schema.products).set({
          generatedTitle: germanTitle,
          generatedDescription,
          htmlDescription: body.htmlDescription,
          bullets: JSON.stringify(body.bullets),
          variants: JSON.stringify(body.variants),
          variantPrices: body.variantPrices ? JSON.stringify(body.variantPrices) : undefined,
          variantContents: body.variantContents ? JSON.stringify(body.variantContents) : undefined,
          images: body.images ? JSON.stringify(body.images) : undefined,
          buyPrice: body.buyPrice ?? undefined,
          sellPrice: body.sellPrice ?? undefined,
          adRate: body.adRate ?? undefined,
          specs: body.specs ? JSON.stringify(body.specs) : undefined,
          gpsrRaw: body.gpsrRaw ?? undefined,
          gpsrHtml: body.gpsrHtml ?? undefined,
          shipsFrom: body.shipsFrom ?? undefined,
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.products.asin, body.asin));
        return c.json({ id: existing[0].id, updated: true }, 200);
      }
      const result = await db.insert(schema.products).values({
        asin: body.asin,
        amazonUrl: body.amazonUrl,
        sourceUrl: body.sourceUrl ?? body.amazonUrl,
        title: body.title,
        generatedTitle: germanTitle,
        generatedDescription,
        htmlDescription: body.htmlDescription,
        bullets: JSON.stringify(body.bullets),
        variants: JSON.stringify(body.variants),
        variantPrices: body.variantPrices ? JSON.stringify(body.variantPrices) : null,
        description: body.description ?? '',
        images: body.images ? JSON.stringify(body.images) : '[]',
        buyPrice: body.buyPrice ?? null,
        sellPrice: body.sellPrice ?? null,
        adRate: body.adRate ?? 5,
        specs: body.specs ? JSON.stringify(body.specs) : null,
        variantContents: body.variantContents ? JSON.stringify(body.variantContents) : null,
        gpsrRaw: body.gpsrRaw ?? null,
        gpsrHtml: body.gpsrHtml ?? null,
        shipsFrom: body.shipsFrom ?? null,
        ebayStatus: 'none',
        aliexpressItemId: (body.sourceUrl ?? body.amazonUrl ?? '').match(/\/item\/(\d+)\.html/)?.[1] ?? null,
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
        variantContents: p.variantContents ? JSON.parse(p.variantContents) : null,
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

    // Duplikat-Schutz: Nicht doppelt listen wenn bereits aktiv auf eBay
    if (product.ebayStatus === 'listed' && product.ebayListingId) {
      return c.json({ error: `Artikel ist bereits auf eBay gelistet (Listing-ID: ${product.ebayListingId}). Zuerst beenden oder Status zurücksetzen.` }, 409);
    }

    // sellPrice Fallback: wenn nicht gesetzt, niedrigsten Varianten-Preis nehmen
    let effectiveSellPrice = product.sellPrice;
    if (!effectiveSellPrice) {
      try {
        const varPrices = JSON.parse(product.variantPrices ?? '[]') as Array<{ ebayPrice?: number; price?: number }>;
        const prices = varPrices.map(v => v.ebayPrice ?? v.price ?? 0).filter(p => p > 0);
        if (prices.length > 0) effectiveSellPrice = Math.min(...prices);
      } catch { /* ignore */ }
    }
    if (!effectiveSellPrice) return c.json({ error: 'Kein Verkaufspreis gesetzt — bitte VK Preis eintragen' }, 400);

    // Alten Fehler-Status zurücksetzen
    await db.update(schema.products).set({ ebayStatus: 'none', ebayError: null }).where(eq(schema.products.id, body.productId));

    // Bilder parsen
    const images: string[] = (() => { try { return JSON.parse(product.images ?? '[]') as string[]; } catch { return []; } })();
    if (images.length === 0) {
      return c.json({ error: 'Keine Bilder gespeichert — bitte Produkt neu importieren' }, 400);
    }

    // Beschreibung: htmlDescription aus DB bevorzugen (bereits vollständige Vorlage)
    const rawHtml = product.htmlDescription ?? '';
    const isFullTemplate = rawHtml.includes('STELE-E-TRANSFER') && (rawHtml.includes('stet-tabs') || rawHtml.includes('stet-l-tabs'));

    let fullDescription: string;
    if (isFullTemplate) {
      // Bereits fertige Vorlage aus DB — direkt verwenden
      fullDescription = rawHtml;
    } else {
      // Varianten + SetContents für Template aufbereiten
      const variantGroupsParsed: Array<{ name: string; values: string[] }> = (() => {
        try {
          const parsed = JSON.parse(product.variants ?? '[]');
          if (Array.isArray(parsed) && parsed.length > 0 && 'name' in parsed[0]) return parsed;
        } catch { /* ignore */ }
        return [];
      })();
      const setContentsParsed: Record<string, string> = (() => {
        try { return JSON.parse(product.variantContents ?? '{}') as Record<string, string>; } catch { return {}; }
      })();
      const skuVariantsParsed: Array<{ name: string; price: number; imageUrl?: string }> = (() => {
        try {
          const parsed = JSON.parse(product.variantPrices ?? '[]');
          if (Array.isArray(parsed)) return parsed.map((v: { sku?: string; name?: string; ebayPrice?: number; price?: number; imageUrl?: string }) => ({
            name: v.sku ?? v.name ?? '',
            price: v.ebayPrice ?? v.price ?? 0,
            imageUrl: v.imageUrl,
          }));
        } catch { /* ignore */ }
        return [];
      })();
      const specsParsed: Record<string, string> = (() => {
        try { return JSON.parse(product.specs ?? '{}') as Record<string, string>; } catch { return {}; }
      })();
      const bulletsParsed: string[] = (() => {
        try { return JSON.parse(product.bullets ?? '[]') as string[]; } catch { return []; }
      })();

      // buildEbayHTMLLight aufrufen — helle Vorlage (lesbar auf eBay)
      const templateProduct: EbayScrapedProduct = {
        title: product.generatedTitle ?? product.title,
        description: product.generatedDescription ?? product.description ?? '',
        specs: specsParsed,
        variants: variantGroupsParsed,
        skuVariants: skuVariantsParsed.length > 0 ? skuVariantsParsed : undefined,
        setContents: Object.keys(setContentsParsed).length > 0 ? setContentsParsed : undefined,
        bullets: bulletsParsed.length > 0 ? bulletsParsed : undefined,
        images: images.filter(u => u.startsWith('http')).slice(0, 3),
      };
      fullDescription = buildEbayHTMLLight(templateProduct);
    }

    try {
      const categoryId = product.ebayCategory ?? await suggestCategory(product.generatedTitle ?? product.title).catch(() => null) ?? '79720';

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

      // variantPrices für pro-Variante Preise
      const variantPricesForListing: Array<{ sku?: string; name?: string; ebayPrice?: number; price?: number }> = (() => {
        try {
          const parsed = JSON.parse(product.variantPrices ?? '[]');
          if (Array.isArray(parsed)) return parsed;
        } catch { /* ignore */ }
        return [];
      })();

      // GPSR aus Produkt — strukturierte Felder haben Vorrang, sonst Fallback auf Stele-Adresse
      const gpsrFromProduct = (product.gpsrName || product.gpsrEmail) ? {
        name:    product.gpsrName    ?? 'Stele-E-Transfer',
        address: product.gpsrAddress ?? 'Am Hochfeld 47',
        city:    product.gpsrCity    ?? '65205 Wiesbaden',
        email:   product.gpsrEmail   ?? 'contact@stele-e-transfer.com',
        phone:   product.gpsrPhone   ?? '+4915904826737',
      } : undefined;

      const listingId = await listOnEbay({
        sku: `stele-${product.id}`,
        title: (product.generatedTitle ?? product.title).slice(0, 80),
        description: fullDescription,
        price: effectiveSellPrice,
        quantity: 3,
        condition: 'NEW',
        imageUrls: images.filter(u => u.startsWith('http')).slice(0, 8),
        categoryId: categoryId ?? undefined,
        variantGroups: variantGroups.length > 0 ? variantGroups : undefined,
        variantPrices: variantPricesForListing.length > 0 ? variantPricesForListing : undefined,
        specs,
        mpn,
        adRate: product.adRate ?? 5,
        handlingTimeDays: product.handlingTimeDays ?? undefined,
        gpsr: gpsrFromProduct,
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
    const accessToken = await getAliAccessToken();
    if (accessToken && productId) {
      console.log(`[AliExpress] Using DS API for product ${productId}`);
      const apiData = await getAliProductByApi(productId, accessToken);
      if (apiData) {
        const aiDesc = await generateDescriptionWithGemini(apiData.title, apiData.specs ?? {}, apiData.description ?? '');
        if (aiDesc) apiData.description = aiDesc;
        // Rückgabe als ScrapedProduct-kompatibles Objekt (variantPrices + variants inkludiert)
        return c.json({
          title: apiData.title,
          images: apiData.images,
          price: apiData.price,
          description: apiData.description,
          specs: apiData.specs,
          shipsFrom: apiData.shipsFrom,
          shipsFromDE: apiData.shipsFromDE,
          variants: apiData.variants ?? [],
          variantPrices: apiData.variantPrices ?? [],
          seller: apiData.seller ?? '',
          gpsr: apiData.gpsr ?? null,
          _source: 'ds-api',
        }, 200);
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
  // ─── Anzeigentarif (adRate) pro Produkt setzen ──────────────────────────────
  .patch('/products/:id/adRate', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    try {
      const body = await c.req.json() as { adRate?: number };
      const adRate = typeof body.adRate === 'number' ? body.adRate : parseFloat(String(body.adRate));
      if (isNaN(adRate) || adRate < 0 || adRate > 20) return c.json({ error: 'Ungültiger Wert (0–20)' }, 400);
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      await db.update(schema.products).set({ adRate, updatedAt: new Date().toISOString() })
        .where(eq(schema.products.id, id));
      return c.json({ ok: true, adRate }, 200);
    } catch (e) {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })

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

  // ─── Fehler zurücksetzen ─────────────────────────────────────────────────────
  // ─── Bild-Upload (Base64 → öffentliche URL) ────────────────────────────────
  .post('/upload-image', async (c) => {
    try {
      const { dataUrl, filename } = await c.req.json() as { dataUrl: string; filename?: string };
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        return c.json({ error: 'Kein gültiges Bild' }, 400);
      }
      const base64 = dataUrl.split(',')[1];
      const ext = dataUrl.match(/data:image\/(\w+);/)?.[1] ?? 'jpg';
      const name = (filename ?? `img-${Date.now()}`).replace(/[^a-z0-9_-]/gi, '_') + '.' + ext;
      const uploadsDir = `${import.meta.dir}/../../dist/uploads`;
      await Bun.write(`${uploadsDir}/${name}`, Buffer.from(base64, 'base64'));
      const baseUrl = process.env.PUBLIC_URL ?? 'https://stele-e-transfer.onrender.com';
      return c.json({ url: `${baseUrl}/uploads/${name}` }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })

  // ─── Produkt-Felder patchen (ebayCategory etc.) ──────────────────────────────
  .patch('/products/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    try {
      const body = await c.req.json() as Record<string, unknown>;
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      const allowed: Partial<typeof schema.products.$inferInsert> = {};
      if ('ebayCategory' in body) allowed.ebayCategory = body.ebayCategory as string | null;
      if ('gpsrName'    in body) allowed.gpsrName    = body.gpsrName    as string | null;
      if ('gpsrAddress' in body) allowed.gpsrAddress = body.gpsrAddress as string | null;
      if ('gpsrCity'    in body) allowed.gpsrCity    = body.gpsrCity    as string | null;
      if ('gpsrEmail'   in body) allowed.gpsrEmail   = body.gpsrEmail   as string | null;
      if ('gpsrPhone'   in body) allowed.gpsrPhone   = body.gpsrPhone   as string | null;
      if ('handlingTimeDays' in body) allowed.handlingTimeDays = (body.handlingTimeDays as number | null);
      if (Object.keys(allowed).length === 0) return c.json({ error: 'Keine bekannten Felder' }, 400);
      allowed.updatedAt = new Date().toISOString();
      await db.update(schema.products).set(allowed).where(eq(schema.products.id, id));
      return c.json({ ok: true }, 200);
    } catch (e) {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })

  // ─── Beschreibung bearbeiten (Titel + Bullets + HTML) ───────────────────────
  .patch('/products/:id/description', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    try {
      const body = await c.req.json() as { generatedTitle?: string; bullets?: string[]; htmlDescription?: string };
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      const update: Partial<typeof schema.products.$inferInsert> = { updatedAt: new Date().toISOString() };
      if (body.generatedTitle !== undefined) update.generatedTitle = body.generatedTitle;
      if (body.bullets !== undefined) update.bullets = JSON.stringify(body.bullets);
      if (body.htmlDescription !== undefined) update.htmlDescription = body.htmlDescription;
      await db.update(schema.products).set(update).where(eq(schema.products.id, id));
      return c.json({ ok: true }, 200);
    } catch (e) {
      return c.json({ error: 'DB Fehler: ' + String(e) }, 503);
    }
  })

  .post('/products/:id/reset-error', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      await db.update(schema.products).set({
        ebayStatus: 'none',
        ebayError: null,
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
  // eBay Kategorie-Suche via Taxonomy API (EBAY_DE tree_id=77)
  .get('/ebay/categories', async (c) => {
    const q = c.req.query('q')?.trim();
    if (!q) return c.json({ error: 'q fehlt' }, 400);
    try {
      const { getAppToken } = await import('./ebay');
      const token = await getAppToken();
      const BASE_URL = process.env.EBAY_SANDBOX === 'true' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
      const res = await fetch(
        `${BASE_URL}/commerce/taxonomy/v1/category_tree/77/get_category_suggestions?q=${encodeURIComponent(q)}`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      if (!res.ok) {
        const txt = await res.text();
        return c.json({ error: `eBay API ${res.status}`, detail: txt }, 502);
      }
      const data = await res.json() as {
        categorySuggestions?: Array<{
          category: { categoryId: string; categoryName: string };
          categoryTreeNodeAncestors?: Array<{ categoryName: string }>;
        }>;
      };
      const results = (data.categorySuggestions ?? []).slice(0, 10).map(s => ({
        id: s.category.categoryId,
        name: s.category.categoryName,
        path: (s.categoryTreeNodeAncestors ?? []).map(a => a.categoryName).reverse().join(' > '),
      }));
      return c.json({ results });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })

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
    // Sofort antworten — Job läuft async im Hintergrund (kein Render-Timeout)
    try {
      const { db, schema } = await import('../db/index').then(async m => {
        const s = await import('../db/schema');
        return { db: m.db, schema: s };
      });
      const all = await db.select().from(schema.products);
      const jobId = Date.now().toString();

      // Globaler Job-Status (in-memory, reicht für Single-Instance Render)
      const g = globalThis as Record<string, unknown>;
      g.__priceJobs = g.__priceJobs || {};
      (g.__priceJobs as Record<string, unknown>)[jobId] = { status: 'running', total: all.length, done: 0, results: [] };

      // Background-Funktion — läuft weiter nach dem Response
      (async () => {
        const job = (g.__priceJobs as Record<string, { status: string; done: number; results: unknown[] }>)[jobId];
        for (const product of all) {
          const url = product.sourceUrl || product.amazonUrl;
          if (!url || url === 'manual' || !url.includes('aliexpress')) {
            job.results.push({ id: product.id, title: product.generatedTitle, status: 'skipped' });
            job.done++;
            continue;
          }
          try {
            const accessToken = await getAliAccessToken();
            const productIdMatch = url.match(/\/item\/(\d+)\.html/) || url.match(/[?&]id=(\d+)/);
            const productId = productIdMatch?.[1];
            let scraped = null;
            if (accessToken && productId) scraped = await getAliProductByApi(productId, accessToken);
            if (!scraped) scraped = await scrapeAliExpressUrl(url);
            if (!scraped?.price) {
              job.results.push({ id: product.id, title: product.generatedTitle, status: 'no_price' });
              job.done++;
              continue;
            }
            const newPrice = parseFloat(scraped.price.replace(/[^0-9.]/g, ''));
            if (isNaN(newPrice) || newPrice <= 0) {
              job.results.push({ id: product.id, title: product.generatedTitle, status: 'parse_error' });
              job.done++;
              continue;
            }
            const priceChanged = product.buyPrice !== null && Math.abs((product.buyPrice ?? 0) - newPrice) > 0.01;
            // Neuen VK-Preis berechnen: (buyPrice + 1.60€ Mindestgewinn [+ 3€ China-Zoll]) / (1 - 0.18 eBay-Fee)
            const isChina = (product.shipsFrom ?? '').toLowerCase() === 'china';
            const chinaZoll = isChina ? 3.00 : 0;
            const newSellPrice = Math.ceil(((newPrice + 1.60 + chinaZoll) / (1 - 0.18)) * 100) / 100;
            await db.insert(schema.priceHistory).values({ productId: product.id, price: newPrice, source: 'aliexpress' });
            await db.update(schema.products).set({
              buyPrice: newPrice,
              sellPrice: priceChanged ? newSellPrice : product.sellPrice,
              lastPriceCheck: new Date().toISOString(),
              priceChanged,
              updatedAt: new Date().toISOString(),
            }).where(eq(schema.products.id, product.id));

            // eBay Listing Preis automatisch aktualisieren wenn Preis gestiegen/gesunken
            // Inventory API (neue Listings) zuerst, dann Trading API Fallback
            let ebayUpdated = false;
            if (priceChanged && product.ebayListingId && product.ebayStatus === 'listed') {
              try {
                const { getAccessToken } = await import('./ebay');
                const ebayToken = await getAccessToken();

                // 1. Inventory API: Offer per SKU suchen + updaten
                const invSku = `stele-${product.id}`;
                const skusToTry = [invSku, `${invSku}-GROUP`];
                let invOk = false;
                for (const trySku of skusToTry) {
                  const offerRes = await fetch(
                    `https://api.ebay.com/sell/inventory/v1/offer?sku=${encodeURIComponent(trySku)}&marketplace_id=EBAY_DE`,
                    { headers: { 'Authorization': `Bearer ${ebayToken}` } }
                  );
                  if (!offerRes.ok) continue;
                  const offerData = await offerRes.json() as { offers?: Array<{ offerId: string; sku: string }> };
                  const offers = offerData.offers ?? [];
                  if (offers.length > 0) {
                    for (const offer of offers) {
                      await fetch(`https://api.ebay.com/sell/inventory/v1/offer/${offer.offerId}`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${ebayToken}`, 'Content-Type': 'application/json', 'Content-Language': 'de-DE' },
                        body: JSON.stringify({ sku: offer.sku, marketplaceId: 'EBAY_DE', pricingSummary: { price: { value: newSellPrice.toFixed(2), currency: 'EUR' } } }),
                      });
                    }
                    invOk = true;
                    break;
                  }
                }

                if (invOk) {
                  ebayUpdated = true;
                } else {
                  // 2. Fallback: Trading API (alte Listings)
                  const reviseXml = `<?xml version="1.0" encoding="utf-8"?><ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>${ebayToken}</eBayAuthToken></RequesterCredentials><InventoryStatus><ItemID>${product.ebayListingId}</ItemID><StartPrice>${newSellPrice.toFixed(2)}</StartPrice></InventoryStatus></ReviseInventoryStatusRequest>`;
                  const ebayRes = await fetch('https://api.ebay.com/ws/api.dll', {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml', 'X-EBAY-API-SITEID': '77', 'X-EBAY-API-COMPATIBILITY-LEVEL': '967', 'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus', 'X-EBAY-API-APP-NAME': process.env.EBAY_CLIENT_ID ?? '' },
                    body: reviseXml,
                  });
                  const ebayText = await ebayRes.text();
                  ebayUpdated = !ebayText.includes('<Ack>Failure</Ack>');
                }
              } catch { /* eBay Update fehlgeschlagen, nicht kritisch */ }
            }

            job.results.push({ id: product.id, title: product.generatedTitle, status: priceChanged ? 'changed' : 'unchanged', oldPrice: product.buyPrice, newPrice, newSellPrice: priceChanged ? newSellPrice : undefined, ebayUpdated });
          } catch {
            job.results.push({ id: product.id, title: product.generatedTitle, status: 'error' });
          }
          job.done++;
          await new Promise(r => setTimeout(r, 1200));
        }
        job.status = 'done';
      })();

      return c.json({ jobId, total: all.length, message: 'Preischeck gestartet — Status per /api/products/price-job/:jobId abrufen' }, 202);
    } catch (e) {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })

  // Job-Status abrufen
  .get('/products/price-job/:jobId', (c) => {
    const jobId = c.req.param('jobId');
    const g = globalThis as Record<string, unknown>;
    const jobs = g.__priceJobs as Record<string, { status: string; total: number; done: number; results: unknown[] }> | undefined;
    const job = jobs?.[jobId];
    if (!job) return c.json({ error: 'Job nicht gefunden' }, 404);
    return c.json({
      jobId,
      status: job.status,
      total: job.total,
      done: job.done,
      progress: Math.round((job.done / (job.total || 1)) * 100),
      results: job.status === 'done' ? job.results : undefined,
      changed: (job.results as Array<{ status: string }>).filter(r => r.status === 'changed').length,
    });
  });

// ─── AliExpress DS Produkt-Suche ─────────────────────────────────────────────
// aliexpress.ds.product.search — sucht Produkte mit EU/DE-Lager Filter
app.get('/aliexpress/search', async (c) => {
  const keyword = c.req.query('keyword') || '';
  const page = parseInt(c.req.query('page') || '1');
  const shipFrom = c.req.query('ship_from') || 'DE';

  if (!keyword.trim()) return c.json({ error: 'keyword fehlt' }, 400);

  const SCRAPINGANT_KEY = process.env.SCRAPINGANT_API_KEY || '';
  if (!SCRAPINGANT_KEY) {
    return c.json({ status: 'no_token', message: 'ScrapingAnt Key fehlt.', results: [], total: 0 }, 200);
  }

  try {
    const slug = keyword.trim().replace(/\s+/g, '-').toLowerCase();
    const shipParam = (shipFrom && shipFrom !== 'ALL') ? `&shipCountry=${shipFrom.toLowerCase()}` : '';
    const searchUrl = `https://de.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html?sorttype=total_tranAmount_sort${shipParam}`;
    const antUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(searchUrl)}&x-api-key=${SCRAPINGANT_KEY}&browser=true&proxy_country=DE`;

    console.log('[AliSearch] Scraping:', searchUrl);

    // Retry bei 409 (concurrent limit) — bis 3x mit 4s Pause
    let res: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = await fetch(antUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(50000),
      });
      if (res.status !== 409) break;
      console.log(`[AliSearch] 409 concurrent — Versuch ${attempt}/3, warte 4s...`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 4000));
    }

    if (!res!.ok) {
      const errText = await res!.text();
      console.error('[AliSearch] ScrapingAnt error:', res!.status, errText.slice(0, 200));
      return c.json({ status: 'api_error', message: `ScrapingAnt ${res!.status}`, results: [], total: 0 }, 200);
    }

    const html = await res!.text();
    console.log(`[AliSearch] Got ${html.length} chars from ScrapingAnt`);

    const listIdx = html.indexOf('"itemList":{"content":[');
    if (listIdx === -1) {
      console.warn('[AliSearch] itemList not found in HTML');
      return c.json({ status: 'no_result', results: [], total: 0, page, keyword }, 200);
    }

    const arrStart = html.indexOf('[', listIdx);
    let depth = 0;
    let arrEnd = arrStart;
    for (let i = arrStart; i < Math.min(html.length, arrStart + 600000); i++) {
      if (html[i] === '[') depth++;
      else if (html[i] === ']') {
        depth--;
        if (depth === 0) { arrEnd = i + 1; break; }
      }
    }

    let rawItems: Record<string, unknown>[] = [];
    try {
      rawItems = JSON.parse(html.slice(arrStart, arrEnd)) as Record<string, unknown>[];
    } catch (parseErr) {
      console.error('[AliSearch] JSON parse error:', parseErr);
      return c.json({ status: 'api_error', message: 'HTML parse error', results: [], total: 0 }, 200);
    }

    const productItems = rawItems.filter(item => item.productId && item.itemType === 'productV3');
    console.log(`[AliSearch] ${productItems.length} products extracted`);

    const PAGE_SIZE = 20;
    const startIdx = (page - 1) * PAGE_SIZE;
    const pageItems = productItems.slice(startIdx, startIdx + PAGE_SIZE);
    const total = productItems.length;

    const EU_CODES = ['de','at','fr','es','it','nl','pl','cz','be','lu','ch'];

    interface AliItem {
      productId?: unknown;
      title?: { displayTitle?: string };
      image?: { imgUrl?: string };
      images?: { imgUrl?: string }[];
      prices?: {
        salePrice?: { minPrice?: number; formattedPrice?: string };
        originalPrice?: { minPrice?: number; formattedPrice?: string };
      };
      evaluation?: { starRating?: number; averageStar?: string };
      trade?: { tradeCount?: string; realTradeCount?: number };
      shipFromCountry?: string;
      logisticsInfo?: { shipFromCountry?: string };
    }

    const results = (pageItems as AliItem[]).map((item) => {
      const id = String(item.productId || '');
      const title = item.title?.displayTitle?.trim() || '';
      let img = item.image?.imgUrl || item.images?.[0]?.imgUrl || '';
      if (img.startsWith('//')) img = 'https:' + img;
      const salePrice = item.prices?.salePrice?.minPrice ?? item.prices?.originalPrice?.minPrice ?? 0;
      const priceFormatted = item.prices?.salePrice?.formattedPrice || item.prices?.originalPrice?.formattedPrice || '';
      const price = salePrice || parseFloat(priceFormatted.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
      const shipCountry = (item.shipFromCountry || item.logisticsInfo?.shipFromCountry || '').toLowerCase();
      const isEU = EU_CODES.some(c => shipCountry.includes(c));
      const rating = Number(item.evaluation?.starRating || item.evaluation?.averageStar || 0);
      const sold = Number(item.trade?.realTradeCount || (item.trade?.tradeCount || '').toString().replace(/[^\d]/g, '') || 0);
      const url = `https://de.aliexpress.com/item/${id}.html`;
      return { id, title, image: img, price, shipFrom: shipCountry || '?', isEU, rating, sold, url };
    });

    return c.json({ status: 'ok', results, total, page, keyword }, 200);
  } catch (e) {
    console.error('[AliExpress Search] Fehler:', e);
    return c.json({ status: 'error', message: String(e), results: [], total: 0 }, 500);
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

// ─── Fallback: Beschreibung aus Rohtext ohne KI generieren ───────────────────
function generateFallbackFromRawText(rawText: string, title?: string): string {
  const cleanText = rawText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const productTitle = (title ?? '').trim();

  // Intro
  const intro = productTitle
    ? `${productTitle} – praktisches Produkt für den täglichen Einsatz.`
    : 'Hochwertiges Produkt – schnelle Lieferung aus dem EU-Lager.';

  // Sätze/Zeilen aus Rohtext extrahieren
  const lines = cleanText
    .split(/[\n;.]+/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.length < 130)
    .filter(s => !/aliexpress|amazon|china|free ship|click|buy|order|seller|store|shop|feedback|rating/i.test(s))
    .slice(0, 6);

  const bullets = lines.length > 0
    ? lines
    : [
        'Schnelle Lieferung aus dem EU-Lager',
        '30 Tage Rückgabe über eBay Käuferschutz',
        'Zuverlässige Qualität für den Alltag',
      ];

  // Sicherstellen: mindestens 3 Bullets
  if (bullets.length < 3) {
    bullets.push('Schnelle Lieferung aus dem EU-Lager');
    bullets.push('30 Tage Rückgabe über eBay Käuferschutz');
  }

  const outro = 'Solide Verarbeitung und einfache Handhabung – geeignet für den täglichen Einsatz.';

  return [
    '###INTRO###',
    intro,
    '###BULLETS###',
    ...bullets.map(b => `- ${b}`),
    '###OUTRO###',
    outro,
  ].join('\n');
}

// ─── Deutschen eBay-Titel generieren (Endpoint für Frontend) ─────────────────
app.post('/generate-german-title', async (c) => {
  try {
    const { title, specs } = await c.req.json<{ title: string; specs?: Record<string, string> }>();
    if (!title?.trim()) return c.json({ error: 'Kein Titel übergeben' }, 400);
    const germanTitle = await generateGermanTitle(title, specs ?? {});
    return c.json({ title: germanTitle });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── KI-Beschreibung aus Rohtext generieren ───────────────────────────────────
app.post('/generate-description-from-raw', async (c) => {
  try {
    const { rawText, title } = await c.req.json<{ rawText: string; title?: string }>();
    if (!rawText || rawText.trim().length < 10) {
      return c.json({ error: 'Kein Rohtext übergeben' }, 400);
    }

    const key = process.env.GEMINI_API_KEY;
    const productTitle = title?.trim() || '';

    // Ohne Key direkt Fallback
    if (!key) {
      console.log('[RawDesc] Kein API Key – nutze Text-Fallback');
      const fallback = generateFallbackFromRawText(rawText, productTitle);
      return c.json({ description: fallback, _fallback: true });
    }

    const prompt = `Du bist ein Top-eBay-Produkttexter für den deutschen Markt. Deine Aufgabe: Aus dem folgenden rohen AliExpress-Produkttext eine strukturierte, überzeugende eBay-Beschreibung auf Deutsch erstellen.

${productTitle ? `PRODUKTTITEL: ${productTitle}\n` : ''}
ROHER PRODUKTTEXT VON ALIEXPRESS:
${rawText.slice(0, 3000)}

AUFGABE: Erstelle eine strukturierte eBay-Beschreibung auf Deutsch. Nutze NUR Infos aus dem Text oben — keine erfundenen Angaben.

FORMAT (exakt so zurückgeben, mit den Trennzeichen):
###INTRO###
[1 starker Einleitungssatz: Was ist das Produkt, für wen, welcher Hauptnutzen – max. 25 Wörter]
###BULLETS###
- [konkretes Feature/Vorteil mit echten Daten, z.B. Maße, Material, Funktion]
- [konkretes Feature/Vorteil]
- [konkretes Feature/Vorteil]
- [konkretes Feature/Vorteil]
- [konkretes Feature/Vorteil]
- [konkretes Feature/Vorteil, Anwendungsbereich wenn bekannt]
###OUTRO###
[1 Abschlusssatz: Qualität + Einsatzbereich – max. 20 Wörter]

REGELN:
- Nur echte Infos aus dem Rohtext – KEIN generisches "hochwertig", "perfekt" ohne Beleg
- Keine Emojis, kein Markdown (kein **, kein #)
- NICHT erwähnen: AliExpress, China, Amazon, Händlername
- EU-Maße: cm statt inch, ml statt oz, Komma als Dezimalzeichen (z.B. 2,5 cm)
- Sprache: sachlich, direkt, kein Marketingsprech`;

    for (const modelName of GEMINI_MODELS) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const genAI = new GoogleGenerativeAI(key);
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(prompt);
          const text = result.response.text().trim();
          console.log(`[Gemini/RawDesc] Beschreibung generiert (${modelName})`);
          return c.json({ description: text });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const is503 = msg.includes('503') || msg.includes('overloaded');
          const isQuota = msg.includes('429') || msg.includes('quota');
          console.error(`[Gemini/RawDesc] ${modelName} Versuch ${attempt} fehlgeschlagen:`, msg.slice(0, 100));
          if (attempt < 3) await new Promise(r => setTimeout(r, (is503 || isQuota) ? 5000 * attempt : 2000 * attempt));
          else if (is503 || isQuota) break;
        }
      }
    }

    // Alle Modelle fehlgeschlagen → Text-Fallback statt 503
    console.log('[RawDesc] Gemini nicht verfügbar – nutze Text-Fallback');
    const fallback = generateFallbackFromRawText(rawText, productTitle);
    return c.json({ description: fallback, _fallback: true });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Vertrauenswürdige Lieferanten ───────────────────────────────────────────
app.get('/api/trusted-suppliers', async (c) => {
  try {
    const { db, schema } = await import('../db/index').then(async m => {
      const s = await import('../db/schema');
      return { db: m.db, schema: s };
    });
    const suppliers = await db.select().from(schema.trustedSuppliers).orderBy(schema.trustedSuppliers.createdAt);
    return c.json(suppliers);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.post('/api/trusted-suppliers', async (c) => {
  try {
    const body = await c.req.json() as { shopName: string; shopUrl: string; aliStoreId?: string; euConfirmed?: boolean };
    if (!body.shopName || !body.shopUrl) return c.json({ error: 'shopName und shopUrl erforderlich' }, 400);
    const { db, schema } = await import('../db/index').then(async m => {
      const s = await import('../db/schema');
      return { db: m.db, schema: s };
    });
    const result = await db.insert(schema.trustedSuppliers).values({
      shopName: body.shopName,
      shopUrl: body.shopUrl,
      aliStoreId: body.aliStoreId ?? null,
      euConfirmed: body.euConfirmed ?? true,
    }).returning();
    return c.json(result[0], 201);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.delete('/api/trusted-suppliers/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
  try {
    const { db, schema } = await import('../db/index').then(async m => {
      const s = await import('../db/schema');
      return { db: m.db, schema: s };
    });
    await db.delete(schema.trustedSuppliers).where(eq(schema.trustedSuppliers.id, id));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});


export type AppType = typeof app;
export default app;
