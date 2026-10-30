// ENTSCHEIDUNG 018 (Inhaber „W5“): POST /api/ebay/campaign-ads gegen lokale Datei-DB + echte App; eBay Marketing API als Attrappe.
// Beweist: 5 % je Anzeige (nicht Kampagnen-Standard 10 %), schon vorhandene Anzeige → nur Satz ändern, adRate nur bei Erfolg, nicht gelistet → übersprungen.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IS_CHILD = process.env.A030_CHILD === '1';
const dbFile = join(tmpdir(), 'campaign-ads-route-test.db').replace(/\\/g, '/');
if (IS_CHILD) {
  try { rmSync(dbFile, { force: true }); } catch { /* neu anlegen */ }
  process.env.TURSO_DATABASE_URL = 'file:' + dbFile;
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.SESSION_SECRET = 'test-secret-cmp';
  process.env.AUTH_USER1_NAME = 'cmp-tester';
  process.env.AUTH_USER1_PASS = 'cmp-pass';
  process.env.EBAY_REFRESH_TOKEN = 'test-refresh-token';
}

describe.skipIf(!IS_CHILD)('Kampagne 5 % (eigener Prozess, lokale Datei-DB)', () => {
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let cookie = '';
  const realFetch = globalThis.fetch;
  const posts: Array<{ url: string; body: unknown }> = [];

  beforeAll(async () => {
    if (!process.env.TURSO_DATABASE_URL!.startsWith('file:')) throw new Error('nur gegen lokale Datei-DB');
    const { runMigrations } = await import('../db/migrate');
    const { createClient } = await import('@libsql/client');
    const { getTableConfig } = await import('drizzle-orm/sqlite-core');
    const schema = await import('../db/schema');
    const cols = getTableConfig(schema.products).columns.map(c => `"${c.name}" ${c.getSQLType().toUpperCase()}${c.primary ? ' PRIMARY KEY' : ''}`);
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
    await client.execute('DROP TABLE IF EXISTS products');
    await client.execute(`CREATE TABLE products (${cols.join(', ')})`);
    await runMigrations();
    const { db } = await import('../db/index');
    const base = { sourceUrl: 'x', amazonUrl: 'x', title: 't', generatedTitle: 'T', htmlDescription: '<p/>', bullets: '[]', variants: '[]' };
    await db.insert(schema.products).values({ ...base, id: 235, asin: 'a235', ebayStatus: 'listed', ebayListingId: '198754366503', adRate: 0 } as never);
    await db.insert(schema.products).values({ ...base, id: 243, asin: 'a243', ebayStatus: 'listed', ebayListingId: '198755130523', adRate: 0 } as never);
    await db.insert(schema.products).values({ ...base, id: 226, asin: 'a226', ebayStatus: 'listed', ebayListingId: '198725787016', adRate: 5 } as never);
    await db.insert(schema.products).values({ ...base, id: 244, asin: 'a244', ebayStatus: 'error', ebayListingId: null, adRate: 5 } as never);
    app = (await import('./index')).default as typeof app;
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.AUTH_USER1_NAME, password: process.env.AUTH_USER1_PASS }) });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/identity/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'mkt', expires_in: 7200 }), { status: 200 });
      if (url.includes('/ad_campaign?')) return new Response(JSON.stringify({ campaigns: [{ campaignId: '154721036015', campaignName: 'K', campaignStatus: 'RUNNING', fundingStrategy: { fundingModel: 'COST_PER_SALE', bidPercentage: '10.0' } }] }), { status: 200 });
      if (/\/ad_campaign\/154721036015\/ad\?/.test(url)) return new Response(JSON.stringify({ ads: [] }), { status: 200 });
      if (url.endsWith('/bulk_create_ads_by_listing_id')) {
        const b = JSON.parse(String(init?.body)); posts.push({ url, body: b });
        return new Response(JSON.stringify({ responses: b.requests.map((r: { listingId: string }) => r.listingId === '198725787016'
          ? { listingId: r.listingId, statusCode: 400, errors: [{ errorId: 35036, message: 'The listing ID already exists in the campaign.' }] }
          : { listingId: r.listingId, statusCode: 201, adId: 'ad' + r.listingId }) }), { status: 207 });
      }
      if (url.endsWith('/bulk_update_ads_bid_by_listing_id')) {
        const b = JSON.parse(String(init?.body)); posts.push({ url, body: b });
        return new Response(JSON.stringify({ responses: b.requests.map((r: { listingId: string }) => ({ listingId: r.listingId, statusCode: 200 })) }), { status: 207 });
      }
      throw new Error('unerwarteter Netzwerkaufruf: ' + url);
    }) as unknown as typeof fetch;
  }, 30_000);
  afterAll(() => { globalThis.fetch = realFetch; try { rmSync(dbFile, { force: true }); } catch { /* egal */ } });

  const call = (body: unknown) => app.request('/api/ebay/campaign-ads', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const ad = async (id: number) => {
    const { db } = await import('../db/index');
    const schema = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    return (await db.select({ a: schema.products.adRate }).from(schema.products).where(eq(schema.products.id, id)))[0].a;
  };

  test('Vorschau sendet nichts', async () => {
    const d = await (await call({ productIds: [235, 243, 226, 244] })).json() as { mode: string; send: unknown[]; skipped: number[] };
    expect(d.mode).toBe('preview');
    expect(d.send.length).toBe(3);
    expect(d.skipped).toEqual([244]);
    expect(posts.length).toBe(0);
  });
  test('Senden: 5.0 je Anzeige, vorhandene Anzeige nur Satz geändert, adRate 5', async () => {
    const r = await call({ productIds: [235, 243, 226, 244], confirm: true });
    const d = await r.json() as { ok: boolean; campaignId: string; results: Array<{ listingId: string; ok: boolean }> };
    expect(d.ok).toBe(true);
    expect(d.campaignId).toBe('154721036015');
    const sent = (posts[0].body as { requests: Array<{ listingId: string; bidPercentage: string }> }).requests;
    expect([...sent].sort((a, b) => a.listingId.localeCompare(b.listingId))).toEqual([
      { listingId: '198725787016', bidPercentage: '5.0' }, { listingId: '198754366503', bidPercentage: '5.0' }, { listingId: '198755130523', bidPercentage: '5.0' },
    ]);
    expect(posts[1].url.endsWith('/bulk_update_ads_bid_by_listing_id')).toBe(true);
    expect(posts[1].body).toEqual({ requests: [{ listingId: '198725787016', bidPercentage: '5.0' }] });
    expect(await ad(235)).toBe(5);
    expect(await ad(243)).toBe(5);
    expect(await ad(244)).toBe(5);
    console.log('Textauszug Ergebnis: ' + d.results.map(x => `${x.listingId}=${x.ok ? 'ok' : 'Fehler'}`).join(', '));
  });
});
