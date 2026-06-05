import { Hono } from 'hono';
import { cors } from "hono/cors"
import { listOnEbay, suggestCategory, getOAuthUrl, exchangeCodeForToken } from './ebay';
import { scrapeAliExpressUrl } from './aliexpress';
import { eq } from 'drizzle-orm';
import { createBackupArchive } from './backup';
import { sendBackupEmail } from './mailer';

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const PIECE_TRANSLATIONS: Record<string, string> = {
  'pezzi': 'Stück', 'pezzo': 'Stück', 'pz': 'Stück',
  'pièces': 'Stück', 'pieces': 'Stück', 'pièce': 'Stück',
  'piezas': 'Stück', 'pieza': 'Stück', 'unidades': 'Stück', 'unidad': 'Stück',
  'piece': 'Stück', 'pcs': 'Stück', 'pc': 'Stück', 'units': 'Stück', 'unit': 'Stück', 'pack': 'Stück',
  'stuks': 'Stück', 'stuk': 'Stück',
  'sztuki': 'Stück', 'sztuka': 'Stück', 'szt': 'Stück',
};

function translatePieceTerms(text: string): string {
  return text.replace(/\((\d+)\s+([a-zA-ZäöüÄÖÜßàáâãèéêìíîòóôùúûñç]+)\)/gi, (match, num, word) => {
    const lower = word.toLowerCase();
    if (PIECE_TRANSLATIONS[lower]) return `(${num} ${PIECE_TRANSLATIONS[lower]})`;
    return match;
  });
}

function fixText(text: string): string {
  let fixed = text.replace(/\b([A-ZÄÖÜa-zäöüß]+)\b/g, word => {
    if (/[a-zäöüß][A-ZÄÖÜ]/.test(word) && /[A-ZÄÖÜ][a-zäöüß].*[A-ZÄÖÜ]/.test(word)) {
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    }
    return word;
  });
  fixed = fixed.replace(/(\b[\wäöüÄÖÜß][\wäöüÄÖÜß\s]{4,40}?)(\1)/gi, '$1');
  fixed = fixed.replace(/\b(.{8,40})\s+\1\b/gi, '$1');
  fixed = fixed.replace(/,\s*[a-zäöüß][a-zäöüßA-ZÄÖÜ\s]{3,25}?\s*,/g, (match) => {
    const inner = match.replace(/,/g, '').trim();
    if (/^(und|oder|aber|sowie|bzw|auch|sehr|noch|mehr|für|mit|bei|von|zu|an)\b/i.test(inner)) return match;
    if (/^[a-z][a-zäöüß]+\s[a-z][a-zäöüß]+$/.test(inner)) return ', ';
    return match;
  });
  fixed = translatePieceTerms(fixed);
  return fixed.replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

const app = new Hono()
  .basePath('api')
  .use(cors({ origin: (origin) => origin ?? '*', credentials: true }))
  .get('/ping', (c) => c.json({ message: `Pong! ${Date.now()}` }, 200))
  .get('/health', (c) => c.json({ status: 'ok' }, 200))
  .get('/backup/run', async (c) => {
    try {
      const archive = await createBackupArchive();
      await sendBackupEmail({
        to: 'contact@stele-e-transfer.com',
        subject: `Daily Backup ${new Date().toLocaleDateString('de-DE')}`,
        text: 'Daily backup abgeschlossen. Anhang ist beigefügt.',
        attachmentPath: archive.path,
        attachmentName: archive.name,
      });
      return c.json({ ok: true, archive: archive.name }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })
  .get('/ebay/deletion', async (c) => {
    const challengeCode = c.req.query('challenge_code');
    if (!challengeCode) return c.json({ error: 'challenge_code fehlt' }, 400);
    const VERIFY_TOKEN = 'stele-ebay-marketplace-deletion-verify-2024';
    const ENDPOINT = 'https://stele-e-transfer.onrender.com/api/ebay/deletion';
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(challengeCode + VERIFY_TOKEN + ENDPOINT).digest('hex');
    return c.json({ challengeResponse: hash }, 200);
  })
  .post('/ebay/deletion', async (c) => {
    console.log('eBay deletion notification received');
    return c.json({ acknowledged: true }, 200);
  })
  .get('/ebay/auth', (c) => {
    const state = Math.random().toString(36).slice(2);
    return c.redirect(getOAuthUrl(state));
  })
  .get('/ebay/callback', async (c) => {
    const code = c.req.query('code');
    if (!code) return c.json({ error: 'Kein Code' }, 400);
    try {
      const tokens = await exchangeCodeForToken(code);
      console.log('eBay refresh token:', tokens.refresh_token);
      return c.json({ message: 'Erfolgreich! Refresh Token in Server-Logs.', expires_in: tokens.expires_in }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })
  .post('/products', async (c) => {
    try {
      const { db, schema } = await import('../db/index').then(async m => ({ db: m.db, schema: await import('../db/schema') }));
      const body = await c.req.json() as {
        asin: string; amazonUrl: string; title: string; generatedTitle: string; htmlDescription: string; bullets: string[]; variants: string[]; description?: string;
      };
      const existing = await db.select().from(schema.products).where(eq(schema.products.asin, body.asin)).limit(1);
      if (existing.length > 0) {
        await db.update(schema.products).set({ generatedTitle: body.generatedTitle, htmlDescription: body.htmlDescription, bullets: JSON.stringify(body.bullets), variants: JSON.stringify(body.variants), updatedAt: new Date().toISOString() }).where(eq(schema.products.asin, body.asin));
        return c.json({ id: existing[0].id, updated: true }, 200);
      }
      const result = await db.insert(schema.products).values({ asin: body.asin, amazonUrl: body.amazonUrl, title: body.title, generatedTitle: body.generatedTitle, htmlDescription: body.htmlDescription, bullets: JSON.stringify(body.bullets), variants: JSON.stringify(body.variants), description: body.description ?? '', ebayStatus: 'none' }).returning({ id: schema.products.id });
      return c.json({ id: result[0].id, created: true }, 201);
    } catch (e) {
      console.error('DB error:', e);
      return c.json({ error: 'DB nicht verfügbar' }, 503);
    }
  })
  .get('/products', async (c) => {
    try {
      const { db, schema } = await import('../db/index').then(async m => ({ db: m.db, schema: await import('../db/schema') }));
      const all = await db.select().from(schema.products).orderBy(schema.products.createdAt);
      return c.json(all.map(p => ({ ...p, bullets: JSON.parse(p.bullets), variants: JSON.parse(p.variants) })), 200);
    } catch {
      return c.json({ error: 'DB nicht verfügbar' }, 503);
    }
  })
  .post('/ebay/list', async (c) => {
    const body = await c.req.json() as { asin: string; title: string; description: string; price: number; quantity: number; imageUrls?: string[]; };
    if (!body.asin || !body.title || !body.description || !body.price) return c.json({ error: 'asin, title, description, price sind Pflichtfelder' }, 400);
    try {
      const categoryId = await suggestCategory(body.title).catch(() => null);
      const listingId = await listOnEbay({ sku: body.asin, title: body.title.slice(0, 80), description: body.description, price: body.price, quantity: body.quantity ?? 10, condition: 'NEW', imageUrls: body.imageUrls ?? [], categoryId: categoryId ?? undefined });
      try {
        const { db, schema } = await import('../db/index').then(async m => ({ db: m.db, schema: await import('../db/schema') }));
        await db.update(schema.products).set({ ebayListingId: listingId, ebayStatus: 'listed', updatedAt: new Date().toISOString() }).where(eq(schema.products.asin, body.asin));
      } catch {}
      return c.json({ listingId, success: true }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        const { db, schema } = await import('../db/index').then(async m => ({ db: m.db, schema: await import('../db/schema') }));
        await db.update(schema.products).set({ ebayStatus: 'error', ebayError: msg, updatedAt: new Date().toISOString() }).where(eq(schema.products.asin, body.asin));
      } catch {}
      return c.json({ error: msg }, 500);
    }
  })
  .post('/aliexpress/scrape', async (c) => {
    const body = await c.req.json() as { url?: string };
    const url = body?.url?.trim();
    if (!url) return c.json({ error: 'url fehlt' }, 400);
    if (!url.includes('aliexpress')) return c.json({ error: 'Keine AliExpress-URL' }, 400);
    const data = await scrapeAliExpressUrl(url);
    if (!data) return c.json({ error: 'AliExpress-Seite konnte nicht geladen werden. Bitte direkte Produkt-URL verwenden.' }, 503);
    return c.json(data, 200);
  })
  .patch('/products/:id/price', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    const body = await c.req.json() as { buyPrice?: number };
    if (!body.buyPrice || body.buyPrice <= 0) return c.json({ error: 'buyPrice fehlt' }, 400);
    try {
      const { db, schema } = await import('../db/index').then(async m => ({ db: m.db, schema: await import('../db/schema') }));
      const existing = await db.select().from(schema.products).where(eq(schema.products.id, id)).limit(1);
      if (existing.length === 0) return c.json({ error: 'Produkt nicht gefunden' }, 404);
      const old = existing[0];
      const priceChanged = old.buyPrice !== null && Math.abs((old.buyPrice ?? 0) - body.buyPrice) > 0.01;
      await db.insert(schema.priceHistory).values({ productId: id, price: body.buyPrice, source: 'aliexpress' });
      await db.update(schema.products).set({ buyPrice: body.buyPrice, lastPriceCheck: new Date().toISOString(), priceChanged, updatedAt: new Date().toISOString() }).where(eq(schema.products.id, id));
      return c.json({ ok: true, priceChanged, oldPrice: old.buyPrice, newPrice: body.buyPrice }, 200);
    } catch (e) {
      console.error('Price update error:', e);
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })
  .get('/products/:id/price-history', async (c) => {
    const id = parseInt(c.req.param('id'));
    if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
    try {
      const { db, schema } = await import('../db/index').then(async m => ({ db: m.db, schema: await import('../db/schema') }));
      const history = await db.select().from(schema.priceHistory).where(eq(schema.priceHistory.productId, id)).orderBy(schema.priceHistory.checkedAt);
      return c.json(history, 200);
    } catch {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  })
  .get('/ebay/returns', async (c) => {
    try {
      const token = await (await import('./ebay')).getAccessToken();
      const res = await fetch('https://api.ebay.com/post-order/v2/return?limit=50&status=OPEN,IN_PROGRESS', { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE' } });
      if (!res.ok) throw new Error(`eBay Returns API: ${res.status}`);
      const data = await res.json() as { returns?: Array<{ returnId: string; orderId: string; title?: string; buyerLoginName?: string; reason?: { reasonDescription?: string }; state?: { name?: string }; creationDate?: string; returnedItemPrice?: { value?: string; currency?: string } }>; };
      const mapped = (data.returns ?? []).map(r => ({ returnId: r.returnId, orderId: r.orderId, itemTitle: r.title ?? 'Unbekanntes Produkt', buyerName: r.buyerLoginName ?? 'Unbekannt', reason: r.reason?.reasonDescription ?? 'Kein Grund angegeben', status: (r.state?.name ?? 'OPEN') as 'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'REFUNDED', createdAt: r.creationDate ?? new Date().toISOString(), amount: parseFloat(r.returnedItemPrice?.value ?? '0'), currency: r.returnedItemPrice?.currency ?? 'EUR' }));
      return c.json(mapped, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 503);
    }
  })
  .post('/ebay/returns/:returnId/refund', async (c) => {
    const returnId = c.req.param('returnId');
    try {
      const token = await (await import('./ebay')).getAccessToken();
      const res = await fetch(`https://api.ebay.com/post-order/v2/return/${returnId}/issue_refund`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE' }, body: JSON.stringify({ refundDetail: { itemizedRefundDetail: [] } }) });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Refund failed: ${res.status} ${text}`);
      }
      return c.json({ success: true }, 200);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })
  .post('/products/check-all-prices', async (c) => {
    try {
      const { db, schema } = await import('../db/index').then(async m => ({ db: m.db, schema: await import('../db/schema') }));
      const all = await db.select().from(schema.products);
      const results: { id: number; title: string; status: string; oldPrice?: number | null; newPrice?: number }[] = [];
      for (const product of all) {
        const url = product.sourceUrl || product.amazonUrl;
        if (!url || url === 'manual' || !url.includes('aliexpress')) {
          results.push({ id: product.id, title: product.generatedTitle, status: 'skipped' });
          continue;
        }
        try {
          const scraped = await scrapeAliExpressUrl(url);
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
          await db.update(schema.products).set({ buyPrice: newPrice, lastPriceCheck: new Date().toISOString(), priceChanged, updatedAt: new Date().toISOString() }).where(eq(schema.products.id, product.id));
          results.push({ id: product.id, title: product.generatedTitle, status: priceChanged ? 'changed' : 'unchanged', oldPrice: product.buyPrice, newPrice });
        } catch {
          results.push({ id: product.id, title: product.generatedTitle, status: 'error' });
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      return c.json({ checked: results.length, results }, 200);
    } catch {
      return c.json({ error: 'DB Fehler' }, 503);
    }
  });

export type AppType = typeof app;
export default app;
