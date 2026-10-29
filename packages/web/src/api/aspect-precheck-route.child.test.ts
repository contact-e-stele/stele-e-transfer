// Inhaber 29.10.2026 „Extra-Knopf“ (OFFEN 015 Schritt 6): GET /api/products/:id/aspect-precheck gegen lokale Datei-DB + echte App,
// eBay-Taxonomie per fetch-Attrappe (Kategorie verlangt Höhe + Breite wie stele-234, Kat. 20638). Nur lesen: DB bleibt unverändert.
// Eigener Prozess (Muster A-030), gestartet von aspect-precheck-route.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IS_CHILD = process.env.A030_CHILD === '1';
const dbFile = join(tmpdir(), 'aspect-precheck-route-test.db').replace(/\\/g, '/');
if (IS_CHILD) {
  try { rmSync(dbFile, { force: true }); } catch { /* neu anlegen */ }
  process.env.TURSO_DATABASE_URL = 'file:' + dbFile;
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.SESSION_SECRET = 'test-secret-asp';
  process.env.AUTH_USER1_NAME = 'asp-tester';
  process.env.AUTH_USER1_PASS = 'asp-pass';
  process.env.EBAY_REFRESH_TOKEN = 'test-refresh-token';
}

describe.skipIf(!IS_CHILD)('Pflichtmerkmale prüfen (eigener Prozess, lokale Datei-DB)', () => {
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let cookie = '';
  const realFetch = globalThis.fetch;
  const calls: string[] = [];

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
    const base = { sourceUrl: 'x', amazonUrl: 'x', title: 'Rolltasche Kochmesser Canvas Braun', generatedTitle: 'Rolltasche Kochmesser Canvas Braun', htmlDescription: '<p/>', bullets: '[]', variants: '[{"name":"Varianten","values":["Brown"]}]', variantPrices: '[{"skuId":"1","attrs":{"Color":"Brown"},"price":8.79}]', ebayCategory: 'TEST-20638', ebayStatus: 'none' };
    await db.insert(schema.products).values({ ...base, id: 234, asin: 'a234' } as never);
    await db.insert(schema.products).values({ ...base, id: 235, asin: 'a235', manualAspects: JSON.stringify({ 'Höhe': '52 cm', 'Breite': '45 cm' }) } as never);
    app = (await import('./index')).default as typeof app;
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.AUTH_USER1_NAME, password: process.env.AUTH_USER1_PASS }) });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.includes('/identity/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'app', expires_in: 7200 }), { status: 200 });
      if (url.includes('get_item_aspects_for_category')) return new Response(JSON.stringify({ aspects: [
        { localizedAspectName: 'Höhe', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT' } },
        { localizedAspectName: 'Breite', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT' } },
        { localizedAspectName: 'Marke', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT' } },
      ] }), { status: 200 });
      throw new Error('unerwarteter Netzwerkaufruf: ' + url);
    }) as unknown as typeof fetch;
  }, 30_000);
  afterAll(() => { globalThis.fetch = realFetch; try { rmSync(dbFile, { force: true }); } catch { /* egal */ } });

  const get = (id: number) => app.request(`/api/products/${id}/aspect-precheck`, { headers: { Cookie: cookie } });
  const read = async (id: number) => {
    const { db } = await import('../db/index');
    const schema = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    return (await db.select().from(schema.products).where(eq(schema.products.id, id)))[0];
  };

  test('ohne Maße → fehlt Höhe + Breite, DB unverändert', async () => {
    const r = await get(234);
    expect(r.status).toBe(200);
    const d = await r.json() as { ok: boolean; missing: string[]; editable: string[] };
    expect(d.ok).toBe(false);
    expect(d.missing).toEqual(['Höhe', 'Breite']);
    expect(d.editable).toEqual(['Höhe', 'Breite']);
    const p = await read(234);
    expect(p.ebayStatus).toBe('none');
    expect(p.ebayError).toBeNull();
    console.log('Textauszug Prüfung 234: fehlt ' + d.missing.join(', '));
  });
  test('mit Maßen 52 cm / 45 cm → ok', async () => {
    const d = await (await get(235)).json() as { ok: boolean; missing: string[] };
    expect(d.ok).toBe(true);
    expect(d.missing).toEqual([]);
  });
  test('nur eBay-Taxonomie gelesen, nichts an eBay gesendet', () => {
    expect(calls.every(u => u.includes('/identity/v1/oauth2/token') || u.includes('get_item_aspects_for_category'))).toBe(true);
  });
});
